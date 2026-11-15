import { SILENT_MIX, type AmbienceLevels, type SoundMix } from './sound-mix';

/**
 * Procedural soundscape built only with the Web Audio API (no audio files,
 * so nothing to license or download).
 *
 * Weather
 * - Rain: a filtered pink-noise "hiss" whose brightness and level follow the
 *   rain strength, a low rumble for storms, and individual drop "ticks".
 * - Wind: brown noise through a band-pass filter that drifts in gusts.
 * - Whistle: for strong winds, two gliding sine tones with vibrato plus a
 *   resonant "airy" noise band, swelling with the gusts (aesthetic).
 * - Fire: a low brown-noise roar plus random crackles and pops.
 *
 * Nature beds (climate zones and stories)
 * - Birds, crickets and frogs are scheduled calls made of short oscillator
 *   notes; insects and cicadas are amplitude-modulated noise bands; leaves,
 *   desert sand, polar howl and ocean waves are shaped noise loops; thunder
 *   is an occasional long, low rumble.
 *
 * Continuous layers glide to new levels (setTargetAtTime), and discrete
 * events are scheduled slightly ahead from a single timer, so changes are
 * heard smoothly and immediately.
 */

const NOISE_SECONDS = 4;
/** How far ahead discrete sounds are scheduled (seconds). */
const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 50;
/** Time constant for level changes (seconds). */
const GLIDE_SECONDS = 0.6;
/** Nature beds cross-fade more slowly between climate zones. */
const AMBIENCE_GLIDE_SECONDS = 1.4;
const MASTER_LEVEL = 0.8;
/** Silence for this long suspends the audio context to save CPU (seconds). */
const IDLE_SUSPEND_SECONDS = 3;
/** Ocean swell period (seconds). */
const WAVE_PERIOD_SECONDS = 7.5;

interface NoiseBuffers {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

export class SoundscapeEngine {
  private readonly master: GainNode;
  private readonly noise: NoiseBuffers;

  // Weather.
  private readonly rainBed: GainNode;
  private readonly rainTone: BiquadFilterNode;
  private readonly rainRumble: GainNode;
  private readonly dropsBus: GainNode;
  private readonly windBed: GainNode;
  private readonly windBand: BiquadFilterNode;
  private readonly whistleAir: GainNode;
  private readonly whistleBand: BiquadFilterNode;
  private readonly whistleTone: GainNode;
  private readonly whistleOscillators: OscillatorNode[] = [];
  private readonly fireRoar: GainNode;
  private readonly crackleBus: GainNode;

  // Nature beds.
  private readonly callsBus: GainNode;
  private readonly insectsBed: GainNode;
  private readonly cicadaBed: GainNode;
  private readonly cicadaBand: BiquadFilterNode;
  private readonly leavesBed: GainNode;
  private readonly desertBed: GainNode;
  private readonly desertBand: BiquadFilterNode;
  private readonly sandBed: GainNode;
  private readonly polarBed: GainNode;
  private readonly howlBands: BiquadFilterNode[] = [];
  private readonly wavesBed: GainNode;
  private readonly wavesTone: BiquadFilterNode;

  private mix: SoundMix = SILENT_MIX;
  private muted = false;
  private timer?: ReturnType<typeof setInterval>;
  private nextDropAt = 0;
  private nextCrackleAt = 0;
  private nextPopAt = 0;
  private nextBirdAt = 0;
  private nextCricketAt = 0;
  private nextFrogAt = 0;
  private nextThunderAt = 0;
  private gust = 0.5;
  private whistleDrift = 0.5;
  private rustle = 0.5;
  private cicadaSwell = 0.5;
  private sandGust = 0.5;
  private howl = [0.4, 0.6];
  private silentSince = 0;

  constructor(private readonly context: AudioContext) {
    this.noise = createNoiseBuffers(context);

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    this.master = context.createGain();
    this.master.gain.value = MASTER_LEVEL;
    this.master.connect(compressor).connect(context.destination);

    // Rain bed: pink noise → high-pass → low-pass (brightness) → level.
    this.rainBed = this.gain(0);
    this.rainTone = this.filter('lowpass', 2000, 0.5);
    this.loop(this.noise.pink, 0)
      .connect(this.filter('highpass', 350, 0.6))
      .connect(this.rainTone)
      .connect(this.rainBed)
      .connect(this.master);

    // Storm rumble: brown noise → low-pass.
    this.rainRumble = this.gain(0);
    this.loop(this.noise.brown, 1.3)
      .connect(this.filter('lowpass', 220, 0.7))
      .connect(this.rainRumble)
      .connect(this.master);
    this.dropsBus = this.gain(0.9);
    this.dropsBus.connect(this.master);

    // Wind: brown noise → moving band-pass.
    this.windBed = this.gain(0);
    this.windBand = this.filter('bandpass', 400, 0.9);
    this.loop(this.noise.brown, 2.1).connect(this.windBand).connect(this.windBed).connect(this.master);

    // Whistle: airy resonant noise band + two sine tones with vibrato.
    this.whistleAir = this.gain(0);
    this.whistleBand = this.filter('bandpass', 1100, 14);
    this.loop(this.noise.pink, 2.7)
      .connect(this.whistleBand)
      .connect(this.whistleAir)
      .connect(this.master);
    this.whistleTone = this.gain(0);
    const toneFilter = this.filter('lowpass', 2600, 0.7);
    this.whistleTone.connect(toneFilter).connect(this.master);
    const vibrato = context.createOscillator();
    vibrato.frequency.value = 4.6;
    const vibratoDepth = this.gain(7);
    vibrato.connect(vibratoDepth);
    vibrato.start();
    for (const [ratio, level] of [
      [1, 0.6],
      [1.498, 0.22],
    ] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = 900 * ratio;
      vibratoDepth.connect(oscillator.frequency);
      oscillator.connect(this.gain(level)).connect(this.whistleTone);
      oscillator.start();
      this.whistleOscillators.push(oscillator);
    }

    // Fire roar: brown noise → low-pass; crackles go through their own bus.
    this.fireRoar = this.gain(0);
    this.loop(this.noise.brown, 0.4)
      .connect(this.filter('lowpass', 420, 0.8))
      .connect(this.fireRoar)
      .connect(this.master);
    this.crackleBus = this.gain(1);
    this.crackleBus.connect(this.master);

    // Birds, crickets, frogs and thunder share one bus.
    this.callsBus = this.gain(1);
    this.callsBus.connect(this.master);

    // Tropical insects: two high noise bands, each pulsed by a fast LFO.
    this.insectsBed = this.gain(0);
    this.insectsBed.connect(this.master);
    for (const [frequency, rate, offset] of [
      [4600, 27, 0.3],
      [6300, 41, 1.7],
      [3700, 19, 2.9],
    ] as const) {
      const band = this.filter('bandpass', frequency, 9);
      const pulse = this.amplitudeModulator(rate, 0.85);
      this.loop(this.noise.white, offset).connect(band).connect(pulse).connect(this.insectsBed);
    }

    // Cicadas: a bright band buzzing at ~110 Hz that swells slowly.
    this.cicadaBed = this.gain(0);
    this.cicadaBand = this.filter('bandpass', 5600, 5);
    const cicadaPulse = this.amplitudeModulator(112, 0.9);
    this.loop(this.noise.white, 3.3)
      .connect(this.cicadaBand)
      .connect(cicadaPulse)
      .connect(this.cicadaBed)
      .connect(this.master);

    // Leaves: high-passed pink noise with a fast, random flutter.
    this.leavesBed = this.gain(0);
    this.loop(this.noise.pink, 1.1)
      .connect(this.filter('highpass', 1600, 0.5))
      .connect(this.filter('lowpass', 7000, 0.5))
      .connect(this.leavesBed)
      .connect(this.master);

    // Desert: low gusting wind plus a fine, hissing sand layer.
    this.desertBed = this.gain(0);
    this.desertBand = this.filter('bandpass', 320, 0.8);
    this.loop(this.noise.brown, 3.7).connect(this.desertBand).connect(this.desertBed).connect(this.master);
    this.sandBed = this.gain(0);
    this.loop(this.noise.white, 0.9)
      .connect(this.filter('highpass', 4200, 0.6))
      .connect(this.sandBed)
      .connect(this.master);

    // Polar howl: two very resonant bands sweeping slowly over a low bed.
    this.polarBed = this.gain(0);
    this.polarBed.connect(this.master);
    for (const [frequency, offset] of [
      [360, 0.6],
      [540, 2.2],
    ] as const) {
      const band = this.filter('bandpass', frequency, 16);
      this.howlBands.push(band);
      this.loop(this.noise.pink, offset).connect(band).connect(this.gain(2.4)).connect(this.polarBed);
    }
    this.loop(this.noise.brown, 1.9)
      .connect(this.filter('lowpass', 300, 0.7))
      .connect(this.gain(0.5))
      .connect(this.polarBed);

    // Ocean waves: low-passed noise whose level and brightness swell.
    this.wavesBed = this.gain(0);
    this.wavesTone = this.filter('lowpass', 700, 0.6);
    const wavesInput = this.gain(1);
    this.loop(this.noise.pink, 2.4).connect(wavesInput);
    this.loop(this.noise.brown, 0.2).connect(this.gain(0.8)).connect(wavesInput);
    wavesInput.connect(this.wavesTone).connect(this.wavesBed).connect(this.master);

    this.timer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
  }

  setMix(mix: SoundMix): void {
    this.mix = mix;
    const now = this.context.currentTime;
    const rain = clamp01(mix.rain);
    const fire = clamp01(mix.fire);
    const wind = windStrength(mix.windSpeedMs);

    glide(this.rainBed.gain, 0.4 * Math.pow(rain, 1.4), now);
    glide(this.rainTone.frequency, 1600 + 6400 * rain, now);
    glide(this.rainRumble.gain, 0.3 * Math.pow(rain, 2.5), now);
    glide(this.windBed.gain, windLevel(wind), now);
    glide(this.fireRoar.gain, 0.45 * fire, now);
    if (clamp01(mix.whistle) === 0) {
      glide(this.whistleTone.gain, 0, now);
      glide(this.whistleAir.gain, 0, now);
    }

    const ambience = mix.ambience;
    const slow = AMBIENCE_GLIDE_SECONDS;
    glide(this.insectsBed.gain, 0.045 * clamp01(ambience.insects), now, slow);
    if (ambience.cicadas <= 0) {
      glide(this.cicadaBed.gain, 0, now, slow);
    }
    if (ambience.leaves <= 0) {
      glide(this.leavesBed.gain, 0, now, slow);
    }
    if (ambience.desert <= 0) {
      glide(this.desertBed.gain, 0, now, slow);
      glide(this.sandBed.gain, 0, now, slow);
    }
    if (ambience.polar <= 0) {
      glide(this.polarBed.gain, 0, now, slow);
    }
    if (ambience.waves <= 0) {
      glide(this.wavesBed.gain, 0, now, slow);
    }

    if (this.isAudible() && this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    glide(this.master.gain, muted ? 0 : MASTER_LEVEL, this.context.currentTime, 0.25);
    if (!muted && this.isAudible()) {
      void this.context.resume();
    }
  }

  destroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    void this.context.close();
  }

  // ------------------------------------------------------------- scheduling

  private schedule(): void {
    if (this.context.state !== 'running') {
      return;
    }
    const now = this.context.currentTime;
    const horizon = now + LOOKAHEAD_SECONDS;
    const rain = clamp01(this.mix.rain);
    const fire = clamp01(this.mix.fire);
    const wind = windStrength(this.mix.windSpeedMs);
    const whistle = clamp01(this.mix.whistle);
    const ambience = this.mix.ambience;

    // Rain drops: ~2 per second (drizzle) up to ~80 per second (storm).
    if (rain > 0) {
      const rate = 1.5 + 80 * Math.pow(rain, 1.7);
      this.nextDropAt = Math.max(this.nextDropAt, now);
      while (this.nextDropAt < horizon) {
        this.playDrop(this.nextDropAt, rain);
        this.nextDropAt += exponentialInterval(rate);
      }
    }

    // Fire crackles and pops.
    if (fire > 0) {
      const crackleRate = 5 + 45 * fire;
      this.nextCrackleAt = Math.max(this.nextCrackleAt, now);
      while (this.nextCrackleAt < horizon) {
        this.playCrackle(this.nextCrackleAt, fire);
        this.nextCrackleAt += exponentialInterval(crackleRate);
      }
      const popRate = 0.4 + 3 * fire;
      this.nextPopAt = Math.max(this.nextPopAt, now);
      while (this.nextPopAt < horizon) {
        this.playPop(this.nextPopAt, fire);
        this.nextPopAt += exponentialInterval(popRate);
      }
    }

    // Wind gusts: a smoothed random walk moves the filter and the level.
    if (wind > 0 || whistle > 0) {
      this.gust = walk(this.gust, 0.18);
      const level = windLevel(wind) * (0.65 + 0.7 * this.gust);
      glide(this.windBed.gain, level, now, 0.4);
      glide(this.windBand.frequency, 180 + 520 * wind + 380 * this.gust, now, 0.4);
    }

    // Whistle: pitch drifts with the gusts and swells at their peaks.
    if (whistle > 0) {
      this.whistleDrift = walk(this.whistleDrift, 0.08);
      const swell = 0.25 + 0.75 * this.gust * this.gust;
      const pitch = 760 + 420 * this.whistleDrift + 260 * this.gust;
      for (const [index, oscillator] of this.whistleOscillators.entries()) {
        glide(oscillator.frequency, pitch * (index === 0 ? 1 : 1.498), now, 0.9);
      }
      glide(this.whistleBand.frequency, pitch * 1.25, now, 0.7);
      glide(this.whistleTone.gain, 0.05 * whistle * swell, now, 0.8);
      glide(this.whistleAir.gain, 0.22 * whistle * swell, now, 0.8);
    }

    this.scheduleNature(now, horizon, ambience);

    // Suspend the context after a few silent seconds; resume when needed.
    if (this.isAudible()) {
      this.silentSince = 0;
    } else if (this.silentSince === 0) {
      this.silentSince = now;
    } else if (now - this.silentSince > IDLE_SUSPEND_SECONDS) {
      void this.context.suspend();
    }
  }

  private scheduleNature(now: number, horizon: number, ambience: AmbienceLevels): void {
    const birds = clamp01(ambience.birds);
    if (birds > 0) {
      this.nextBirdAt = Math.max(this.nextBirdAt, now);
      while (this.nextBirdAt < horizon) {
        this.playBirdSong(this.nextBirdAt, birds);
        this.nextBirdAt += exponentialInterval(0.25 + 1.9 * birds);
      }
    }

    const crickets = clamp01(ambience.crickets);
    if (crickets > 0) {
      this.nextCricketAt = Math.max(this.nextCricketAt, now);
      while (this.nextCricketAt < horizon) {
        this.playCricket(this.nextCricketAt, crickets);
        this.nextCricketAt += exponentialInterval(1 + 6 * crickets);
      }
    }

    const frogs = clamp01(ambience.frogs);
    if (frogs > 0) {
      this.nextFrogAt = Math.max(this.nextFrogAt, now);
      while (this.nextFrogAt < horizon) {
        this.playFrog(this.nextFrogAt, frogs);
        this.nextFrogAt += exponentialInterval(0.3 + 2.4 * frogs);
      }
    }

    const thunder = clamp01(ambience.thunder);
    if (thunder > 0) {
      if (this.nextThunderAt < now) {
        // First rumble soon after thunder is requested, then every ~6–25 s.
        this.nextThunderAt = now + 0.8 + Math.random() * 2;
      }
      while (this.nextThunderAt < horizon) {
        this.playThunder(this.nextThunderAt, thunder);
        this.nextThunderAt += 4 + exponentialInterval(0.05 + 0.12 * thunder);
      }
    } else {
      this.nextThunderAt = 0;
    }

    const slow = AMBIENCE_GLIDE_SECONDS;
    const cicadas = clamp01(ambience.cicadas);
    if (cicadas > 0) {
      this.cicadaSwell = walk(this.cicadaSwell, 0.05);
      glide(this.cicadaBed.gain, 0.05 * cicadas * (0.35 + 0.65 * this.cicadaSwell), now, slow);
      glide(this.cicadaBand.frequency, 5000 + 1400 * this.cicadaSwell, now, slow);
    }

    const leaves = clamp01(ambience.leaves);
    if (leaves > 0) {
      this.rustle = walk(this.rustle, 0.35);
      glide(this.leavesBed.gain, 0.07 * leaves * (0.25 + 0.75 * this.rustle * this.rustle), now, 0.25);
    }

    const desert = clamp01(ambience.desert);
    if (desert > 0) {
      this.sandGust = walk(this.sandGust, 0.12);
      glide(this.desertBed.gain, 0.26 * desert * (0.45 + 0.55 * this.sandGust), now, 0.9);
      glide(this.desertBand.frequency, 220 + 280 * this.sandGust, now, 0.9);
      glide(this.sandBed.gain, 0.03 * desert * Math.pow(this.sandGust, 2), now, 0.6);
    }

    const polar = clamp01(ambience.polar);
    if (polar > 0) {
      this.howl = this.howl.map((value) => walk(value, 0.06));
      this.howlBands.forEach((band, index) =>
        glide(band.frequency, (index === 0 ? 280 : 430) + 260 * this.howl[index], now, 1.2),
      );
      glide(this.polarBed.gain, 0.22 * polar * (0.55 + 0.45 * this.howl[0]), now, 1);
    }

    const waves = clamp01(ambience.waves);
    if (waves > 0) {
      // A swell rises slowly, breaks, and drains away.
      const phase = (now % WAVE_PERIOD_SECONDS) / WAVE_PERIOD_SECONDS;
      const swell = phase < 0.6 ? Math.pow(phase / 0.6, 2) : Math.pow(1 - (phase - 0.6) / 0.4, 1.5);
      glide(this.wavesBed.gain, 0.32 * waves * (0.2 + 0.8 * swell), now, 0.2);
      glide(this.wavesTone.frequency, 450 + 1500 * swell, now, 0.2);
    }
  }

  private isAudible(): boolean {
    if (this.muted) {
      return false;
    }
    const mix = this.mix;
    const ambience = Object.values(mix.ambience).some((level) => level > 0.001);
    return (
      ambience ||
      mix.rain > 0.001 ||
      mix.fire > 0.001 ||
      mix.whistle > 0.001 ||
      windStrength(mix.windSpeedMs) > 0
    );
  }

  // ------------------------------------------------------------- weather

  private playDrop(time: number, rain: number): void {
    const source = this.burst(time, 0.04);
    const band = this.filter('bandpass', 1800 + Math.random() * 4600, 5 + Math.random() * 8);
    const envelope = this.context.createGain();
    const peak = (0.04 + Math.random() * 0.18) * (0.25 + 0.75 * rain);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(peak, time + 0.001);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.02 + Math.random() * 0.05);
    source.connect(band).connect(envelope).connect(this.panned(time)).connect(this.dropsBus);
  }

  private playCrackle(time: number, fire: number): void {
    const source = this.burst(time, 0.012);
    const highpass = this.filter('highpass', 1800 + Math.random() * 2500, 0.7);
    const envelope = this.context.createGain();
    const peak = (0.05 + Math.random() * 0.3) * (0.4 + 0.6 * fire);
    envelope.gain.setValueAtTime(peak, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.003 + Math.random() * 0.01);
    source.connect(highpass).connect(envelope).connect(this.panned(time)).connect(this.crackleBus);
  }

  private playPop(time: number, fire: number): void {
    const source = this.burst(time, 0.12);
    const band = this.filter('bandpass', 500 + Math.random() * 900, 3);
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime((0.2 + Math.random() * 0.35) * fire, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.05 + Math.random() * 0.08);
    source.connect(band).connect(envelope).connect(this.panned(time)).connect(this.crackleBus);
  }

  private playThunder(time: number, thunder: number): void {
    const duration = 2.5 + Math.random() * 2.5;
    const near = Math.random() < 0.35;
    const level = (0.35 + Math.random() * 0.35) * thunder;
    const pan = this.panned(time);
    pan.connect(this.callsBus);

    if (near) {
      // A sharp crack before the rumble.
      const crack = this.burst(time, 0.25);
      const crackEnvelope = this.context.createGain();
      crackEnvelope.gain.setValueAtTime(level * 0.5, time);
      crackEnvelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
      crack.connect(this.filter('bandpass', 900, 0.6)).connect(crackEnvelope).connect(pan);
    }

    // Two or three overlapping rolls make the rumble uneven.
    const rolls = 2 + Math.floor(Math.random() * 2);
    for (let roll = 0; roll < rolls; roll += 1) {
      const start = time + roll * (0.35 + Math.random() * 0.6);
      const source = this.noiseShot(this.noise.brown, start, duration);
      const envelope = this.context.createGain();
      const peak = level * (roll === 0 ? 1 : 0.55 + Math.random() * 0.3);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(peak, start + (near ? 0.05 : 0.4));
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source
        .connect(this.filter('lowpass', 140 + Math.random() * 160, 0.8))
        .connect(envelope)
        .connect(pan);
    }
  }

  // ------------------------------------------------------------- nature calls

  /** A short bird phrase: rising whistles, a trill or a two-note call. */
  private playBirdSong(time: number, birds: number): void {
    const pan = this.panned(time);
    const distance = 0.35 + Math.random() * 0.65;
    pan.connect(this.callsBus);
    const level = 0.06 * distance * (0.5 + 0.5 * birds);
    const base = 2200 + Math.random() * 2600;
    const species = Math.random();

    if (species < 0.4) {
      // Rising or falling whistles.
      const notes = 2 + Math.floor(Math.random() * 4);
      const rising = Math.random() < 0.6;
      for (let note = 0; note < notes; note += 1) {
        const start = time + note * (0.11 + Math.random() * 0.05);
        const from = base * (rising ? 0.8 : 1.25);
        const to = base * (rising ? 1.25 : 0.8);
        this.chirp(start, from, to, 0.07 + Math.random() * 0.05, level, pan);
      }
    } else if (species < 0.75) {
      // Fast trill.
      const notes = 6 + Math.floor(Math.random() * 8);
      for (let note = 0; note < notes; note += 1) {
        const start = time + note * 0.045;
        this.chirp(start, base * 1.05, base * 0.92, 0.03, level * 0.8, pan);
      }
    } else {
      // Two-tone "tee-oo".
      this.chirp(time, base * 1.2, base * 1.15, 0.16, level, pan);
      this.chirp(time + 0.2, base * 0.85, base * 0.78, 0.2, level, pan);
    }
  }

  private chirp(
    time: number,
    from: number,
    to: number,
    duration: number,
    level: number,
    output: AudioNode,
  ): void {
    const oscillator = this.context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(from, time);
    oscillator.frequency.exponentialRampToValueAtTime(to, time + duration);
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(level, time + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(envelope).connect(output);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
  }

  /** A cricket chirp: three or four very short high pulses. */
  private playCricket(time: number, crickets: number): void {
    const pan = this.panned(time);
    pan.connect(this.callsBus);
    const frequency = 4200 + Math.random() * 700;
    const level = (0.012 + Math.random() * 0.02) * (0.5 + 0.5 * crickets);
    const pulses = 3 + Math.floor(Math.random() * 2);
    for (let pulse = 0; pulse < pulses; pulse += 1) {
      this.chirp(time + pulse * 0.032, frequency, frequency * 0.98, 0.018, level, pan);
    }
  }

  /** A frog croak: a buzzy low tone chopped into quick pulses. */
  private playFrog(time: number, frogs: number): void {
    const pan = this.panned(time);
    pan.connect(this.callsBus);
    const frequency = 260 + Math.random() * 420;
    const level = (0.05 + Math.random() * 0.05) * (0.5 + 0.5 * frogs);
    const croaks = 1 + Math.floor(Math.random() * 3);
    const band = this.filter('bandpass', frequency * 2.2, 2.5);
    band.connect(pan);
    for (let croak = 0; croak < croaks; croak += 1) {
      const start = time + croak * (0.22 + Math.random() * 0.1);
      const pulses = 5 + Math.floor(Math.random() * 4);
      const oscillator = this.context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.linearRampToValueAtTime(frequency * 0.9, start + pulses * 0.02);
      const envelope = this.context.createGain();
      envelope.gain.setValueAtTime(0, start);
      for (let pulse = 0; pulse < pulses; pulse += 1) {
        const at = start + pulse * 0.02;
        envelope.gain.setValueAtTime(level, at);
        envelope.gain.setValueAtTime(0, at + 0.011);
      }
      oscillator.connect(envelope).connect(band);
      oscillator.start(start);
      oscillator.stop(start + pulses * 0.02 + 0.02);
    }
  }

  // ---------------------------------------------------------------- helpers

  /** A short slice of white noise starting at a random offset. */
  private burst(time: number, duration: number): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = this.noise.white;
    source.start(time, Math.random() * (NOISE_SECONDS - duration - 0.01), duration);
    return source;
  }

  /** Noise of any length (loops the buffer) that stops by itself. */
  private noiseShot(buffer: AudioBuffer, time: number, duration: number): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start(time, Math.random() * NOISE_SECONDS);
    source.stop(time + duration + 0.05);
    return source;
  }

  private panned(time: number): StereoPannerNode {
    const panner = this.context.createStereoPanner();
    panner.pan.setValueAtTime(Math.random() * 1.6 - 0.8, time);
    return panner;
  }

  private loop(buffer: AudioBuffer, offset: number): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start(0, offset % NOISE_SECONDS);
    return source;
  }

  /** Gain node whose level is pulsed by a sine LFO (depth 0–1). */
  private amplitudeModulator(rate: number, depth: number): GainNode {
    const node = this.gain(1 - depth / 2);
    const lfo = this.context.createOscillator();
    lfo.frequency.value = rate;
    lfo.connect(this.gain(depth / 2)).connect(node.gain);
    lfo.start();
    return node;
  }

  private gain(value: number): GainNode {
    const node = this.context.createGain();
    node.gain.value = value;
    return node;
  }

  private filter(type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }
}

/** 0–1 wind strength from speed: silent below 2 m/s, full at 20 m/s (gale). */
export function windStrength(speedMs: number): number {
  return clamp01((speedMs - 2) / 18);
}

/**
 * Wind loudness: barely audible for a breeze, loud only for strong wind
 * (4 m/s ≈ 0.01, 8 m/s ≈ 0.07, 12 m/s ≈ 0.17, 16 m/s ≈ 0.32, 20 m/s = 0.5).
 */
function windLevel(strength: number): number {
  return 0.5 * Math.pow(strength, 1.8);
}

function glide(param: AudioParam, value: number, now: number, seconds = GLIDE_SECONDS): void {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, seconds / 3);
}

/** Smoothed random walk that stays within 0–1. */
function walk(value: number, step: number): number {
  return clamp01(value + (Math.random() - 0.5) * step);
}

function exponentialInterval(ratePerSecond: number): number {
  return -Math.log(1 - Math.random()) / ratePerSecond;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** White, pink (Paul Kellet's filter) and brown (integrated) noise buffers. */
function createNoiseBuffers(context: AudioContext): NoiseBuffers {
  const length = Math.floor(context.sampleRate * NOISE_SECONDS);
  const white = context.createBuffer(1, length, context.sampleRate);
  const pink = context.createBuffer(1, length, context.sampleRate);
  const brown = context.createBuffer(1, length, context.sampleRate);
  const whiteData = white.getChannelData(0);
  const pinkData = pink.getChannelData(0);
  const brownData = brown.getChannelData(0);

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let last = 0;
  for (let index = 0; index < length; index += 1) {
    const sample = Math.random() * 2 - 1;
    whiteData[index] = sample;

    b0 = 0.99886 * b0 + sample * 0.0555179;
    b1 = 0.99332 * b1 + sample * 0.0750759;
    b2 = 0.969 * b2 + sample * 0.153852;
    b3 = 0.8665 * b3 + sample * 0.3104856;
    b4 = 0.55 * b4 + sample * 0.5329522;
    b5 = -0.7616 * b5 - sample * 0.016898;
    pinkData[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + sample * 0.5362) * 0.11;
    b6 = sample * 0.115926;

    last = (last + 0.02 * sample) / 1.02;
    brownData[index] = last * 3.5;
  }
  return { white, pink, brown };
}
