import { CLIMATE_CLASSES } from '../../climate-zones';
import { EL_NINO_STORY } from '../../storytelling/el-nino-story';
import { RAIN_SHADOW_STORY } from '../../storytelling/rain-shadow-story';
import { storySoundMix } from '../../storytelling/story-audio';
import { ambienceForClimateCode } from './climate-ambience';
import { whistleStrength } from './sound-mix';

describe('climate-zone soundscapes', () => {
  it('has a soundscape for every Köppen-Geiger class', () => {
    for (const climateClass of CLIMATE_CLASSES) {
      expect(ambienceForClimateCode(climateClass.code), climateClass.code).toBeDefined();
    }
  });

  it('plays jungle sounds in tropical rainforest and none over the ocean', () => {
    const jungle = ambienceForClimateCode('Af');
    expect(jungle?.label).toBe('Jungle');
    expect(jungle?.levels.birds).toBeGreaterThan(0.5);
    expect(jungle?.levels.insects).toBeGreaterThan(0.5);
    expect(ambienceForClimateCode(null)).toBeUndefined();
  });

  it('only whistles for strong winds', () => {
    expect(whistleStrength(5)).toBe(0);
    expect(whistleStrength(10.5)).toBeCloseTo(0.5);
    expect(whistleStrength(20)).toBe(1);
  });
});

describe('story soundtrack', () => {
  it('rains while El Niño shows wetter South America, then turns dry', () => {
    const scene = EL_NINO_STORY.scenes[2];
    const wet = storySoundMix(scene, 6_000);
    expect(wet.rain).toBeGreaterThan(0.5);
    expect(wet.ambience.thunder).toBeGreaterThan(0);

    const dry = storySoundMix(scene, 12_000);
    expect(dry.rain).toBe(0);
    expect(dry.ambience.desert).toBeGreaterThan(0);
  });

  it('keeps the rain-shadow story shorter than the El Niño story', () => {
    const total = (scenes: readonly { durationMs: number }[]): number =>
      scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
    expect(total(RAIN_SHADOW_STORY.scenes)).toBeLessThan(total(EL_NINO_STORY.scenes));
  });
});
