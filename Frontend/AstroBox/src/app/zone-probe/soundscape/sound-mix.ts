/**
 * Shared vocabulary of the procedural soundscape: what the engine can play
 * (the mix) and the categories the user can switch on or off.
 */

/** Nature "beds" used for climate zones and stories (0–1 each). */
export interface AmbienceLevels {
  /** Songbirds chirping (forests, jungle). */
  birds: number;
  /** Dense tropical insect drone. */
  insects: number;
  /** Frogs calling (tropical wetlands). */
  frogs: number;
  /** Cicadas buzzing in the heat (Mediterranean, dry summers). */
  cicadas: number;
  /** Crickets chirping (grasslands, savanna, warm nights). */
  crickets: number;
  /** Leaves and branches rustling (forests). */
  leaves: number;
  /** Dry desert wind with blowing sand. */
  desert: number;
  /** Howling cold wind (tundra, ice caps, taiga). */
  polar: number;
  /** Ocean waves (stories). */
  waves: number;
  /** Distant thunder (stories, storms). */
  thunder: number;
}

export const SILENT_AMBIENCE: AmbienceLevels = {
  birds: 0,
  insects: 0,
  frogs: 0,
  cicadas: 0,
  crickets: 0,
  leaves: 0,
  desert: 0,
  polar: 0,
  waves: 0,
  thunder: 0,
};

/** Everything the engine plays at a given moment. */
export interface SoundMix {
  /** Rain strength 0–1. */
  rain: number;
  /** Fire strength 0–1. */
  fire: number;
  /** Wind speed (m/s) that drives the wind bed. */
  windSpeedMs: number;
  /** Aesthetic whistle on top of strong winds, 0–1. */
  whistle: number;
  ambience: AmbienceLevels;
}

export const SILENT_MIX: SoundMix = {
  rain: 0,
  fire: 0,
  windSpeedMs: 0,
  whistle: 0,
  ambience: SILENT_AMBIENCE,
};

/** Sound categories the user can toggle, one per map visualization (plus stories). */
export type SoundCategory = 'rain' | 'wind' | 'whistle' | 'fire' | 'climate' | 'story';

export const SOUND_CATEGORIES: readonly { id: SoundCategory; label: string; hint: string }[] = [
  { id: 'rain', label: 'Precipitation', hint: 'Rain and storms under Verny' },
  { id: 'wind', label: 'Wind', hint: 'Wind noise that follows wind speed' },
  { id: 'whistle', label: 'Strong-wind whistle', hint: 'Extra whistle when the wind is strong' },
  { id: 'fire', label: 'Wildfires', hint: 'Crackling flames near fires' },
  { id: 'climate', label: 'Climate zones', hint: 'Jungle, desert, forest, polar… ambience' },
  { id: 'story', label: 'Story audio', hint: 'Sounds during guided stories' },
];

export type SoundCategoryState = Record<SoundCategory, boolean>;

export const ALL_CATEGORIES_ON: SoundCategoryState = {
  rain: true,
  wind: true,
  whistle: true,
  fire: true,
  climate: true,
  story: true,
};

/**
 * Whistle strength from wind speed: starts at 7 m/s (≈25 km/h, a "strong
 * breeze") and is full at 14 m/s (≈50 km/h, near gale).
 */
export function whistleStrength(windSpeedMs: number): number {
  return Math.min(Math.max((windSpeedMs - 7) / 7, 0), 1);
}
