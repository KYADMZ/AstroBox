import { SILENT_AMBIENCE, type AmbienceLevels, type SoundMix } from '../zone-probe/soundscape/sound-mix';
import type { StoryScene } from './story.models';

/** The scene's soundtrack at a given scene time (loudest cue per channel). */
export function storySoundMix(scene: StoryScene, sceneElapsedMs: number): SoundMix {
  let rain = 0;
  let wind = 0;
  let whistle = 0;
  const ambience: AmbienceLevels = { ...SILENT_AMBIENCE };

  for (const cue of scene.audio ?? []) {
    const from = cue.fromMs ?? 0;
    const until = cue.untilMs ?? Number.POSITIVE_INFINITY;
    if (sceneElapsedMs < from || sceneElapsedMs >= until) {
      continue;
    }
    const level = Math.min(Math.max(cue.level, 0), 1);
    switch (cue.channel) {
      case 'rain':
        rain = Math.max(rain, level);
        break;
      case 'wind':
        wind = Math.max(wind, level);
        break;
      case 'whistle':
        whistle = Math.max(whistle, level);
        break;
      default:
        ambience[cue.channel] = Math.max(ambience[cue.channel], level);
    }
  }

  return {
    rain,
    fire: 0,
    // Wind level 0–1 maps onto the engine's 2–20 m/s range.
    windSpeedMs: wind > 0 ? 2 + 18 * wind : 0,
    whistle,
    ambience,
  };
}
