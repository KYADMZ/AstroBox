import type { EnvironmentTargets } from '../zone-probe.models';

/**
 * Procedural soundscape for the zone under Verny, built only with the
 * Web Audio API (no audio files, so nothing to license or download):
 *
 * - Rain: a filtered pink-noise "hiss" whose brightness and level follow the
 *   rain strength, a low rumble for storms, and individual drop "ticks"
 *   scheduled at a rate that grows with the rain.
 * - Wind: brown noise through a band-pass filter whose frequency and level
 *   drift in gusts; strong winds add a narrow "whistle" band.
 * - Fire: a low brown-noise roar plus random crackles and pops.
 *
 * Continuous layers glide to new levels (setTargetAtTime), and discrete
 * events are scheduled slightly ahead from a single timer, so changes in the
 * zone are heard smoothly and immediately.
 */

const NOISE_SECONDS = 4;
/** How far ahead discrete sounds are scheduled (seconds). */
const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 50;
/** Time constant for level changes (seconds). */
const GLIDE_SECONDS = 0.6;
const MASTER_LEVEL = 0.8;
/** Silence for this long suspends the audio context to save CPU (seconds). */
const IDLE_SUSPEND_SECONDS = 3;

interface NoiseBuffers {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

export class SoundscapeEngine {
  private readonly master: GainNode;
  private readonly noise: NoiseBuffers;

  private readonly rainBed: GainNode;
  private readonly rainTone: BiquadFilterNode;
  private readonly rainRumble: GainNode;
  private readonly dropsBus: GainNode;

  private readonly windBed: GainNode;
  private readonly windBand: BiquadFilterNode;
  private readonly windWhistle: GainNode;
  private readonly whistleBand: BiquadFilterNode;

  private readonly fireRoar: GainNode;
  private readonly crackleBus: GainNode;

  private targets: EnvironmentTargets = { rain: 0, fire: 0, windSpeedMs: 0 };
  private muted = false;
  private timer?: ReturnType<typeof setInterval>;
  private nextDropAt = 0;
  private nextCrackleAt = 0;
  private nextPopAt = 0;
  private gust = 0.5;
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

    // Wind: brown noise → moving band-pass; whistle: pink noise → narrow band.
    this.windBed = this.gain(0);
    this.windBand = this.filter('bandpass', 400, 0.9);
    this.loop(this.noise.brown, 2.1).connect(this.windBand).connect(this.windBed).connect(this.master);
    this.windWhistle = this.gain(0);
    this.whistleBand = this.filter('bandpass', 1100, 12);
    this.loop(this.noise.pink, 2.7)
      .connect(this.whistleBand)
      .connect(this.windWhistle)
      .connect(this.master);

    // Fire roar: brown noise → low-pass; crackles go through their own bus.
    this.fireRoar = this.gain(0);
    this.loop(this.noise.brown, 0.4)
      .connect(this.filter('lowpass', 420, 0.8))
      .connect(this.fireRoar)
      .connect(this.master);
    this.crackleBus = this.gain(1);
    this.crackleBus.connect(this.master);

    this.timer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
  }

  setTargets(targets: EnvironmentTargets): void {
    this.targets = targets;
    const now = this.context.currentTime;
    const rain = clamp01(targets.rain);
    const fire = clamp01(targets.fire);
    const wind = windStrength(targets.windSpeedMs);

    glide(this.rainBed.gain, 0.4 * Math.pow(rain, 1.4), now);
    glide(this.rainTone.frequency, 1600 + 6400 * rain, now);
    glide(this.rainRumble.gain, 0.3 * Math.pow(rain, 2.5), now);
    glide(this.windBed.gain, windLevel(wind), now);
    glide(this.windWhistle.gain, wind > 0.6 ? 0.05 * (wind - 0.6) / 0.4 : 0, now);
    glide(this.fireRoar.gain, 0.45 * fire, now);

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
    const rain = clamp01(this.targets.rain);
    const fire = clamp01(this.targets.fire);
    const wind = windStrength(this.targets.windSpeedMs);

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
    if (wind > 0) {
      this.gust = clamp01(this.gust + (Math.random() - 0.5) * 0.18);
      const level = windLevel(wind) * (0.65 + 0.7 * this.gust);
      glide(this.windBed.gain, level, now, 0.4);
      glide(this.windBand.frequency, 180 + 520 * wind + 380 * this.gust, now, 0.4);
      glide(this.whistleBand.frequency, 800 + 900 * this.gust + 600 * wind, now, 0.5);
    }

    // Suspend the context after a few silent seconds; resume when needed.
    if (this.isAudible()) {
      this.silentSince = 0;
    } else if (this.silentSince === 0) {
      this.silentSince = now;
    } else if (now - this.silentSince > IDLE_SUSPEND_SECONDS) {
      void this.context.suspend();
    }
  }

  private isAudible(): boolean {
    return (
      !this.muted &&
      (this.targets.rain > 0.001 || this.targets.fire > 0.001 || windStrength(this.targets.windSpeedMs) > 0)
    );
  }

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

  // ---------------------------------------------------------------- helpers

  /** A short slice of white noise starting at a random offset. */
  private burst(time: number, duration: number): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = this.noise.white;
    source.start(time, Math.random() * (NOISE_SECONDS - duration - 0.01), duration);
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
