import type { GeoPoint } from '../map.models';

/** Which Verny drawing to show. */
export type ZoneMood = 'cold' | 'neutral' | 'hot';

/**
 * Verny's animation, chosen from the strongest phenomenon at its location
 * (null = the static mood drawing, e.g. in cold zones).
 */
export type VernyAnimation = 'burning' | 'rain' | 'wind' | 'heat' | 'wave';

/** Whether precipitation falls as rain or snow. */
export type PrecipitationPhase = 'rain' | 'snow';

export type PrecipitationLevel = 'none' | 'light' | 'moderate' | 'heavy' | 'veryHeavy';

/** Where the mascot is: resting in its dock, being dragged, or dropped on the map. */
export type ProbePhase = 'docked' | 'dragging' | 'placed';

/**
 * Classification thresholds. They are intentionally simple and are expected
 * to be tuned later (e.g. per season or per region).
 */
export const ZONE_THRESHOLDS = {
  /** Mean surface (skin) temperature at or above this value is "hot" (°C). */
  hotTemperatureC: 30,
  /** Mean surface (skin) temperature at or below this value is "cold" (°C). */
  coldTemperatureC: 5,
  /** A wildfire closer than this makes the zone a fire zone (km). */
  fireRadiusKm: 100,
  /** Wildfires counted for context and flame intensity (km). */
  fireContextRadiusKm: 300,
  /** Precipitation falls as snow at or below this air temperature (°C, 2 m). */
  snowAirTemperatureC: 0.5,
  /** At or below this temperature the zone is "frozen": light snow in the background (°C). */
  frozenTemperatureC: 0,
  /** Daily precipitation thresholds (mm/day). */
  precipitationMmPerDay: {
    light: 0.2,
    moderate: 2.5,
    heavy: 8,
    veryHeavy: 20,
  },
} as const;

/** Monthly summary of NASA POWER daily point data (MERRA-2 based). */
export interface ClimateSummary {
  /** Grid cell center actually queried. */
  cell: GeoPoint;
  /** First and last day averaged (YYYY-MM-DD). */
  periodStart: string;
  periodEnd: string;
  validDays: number;
  /** Mean earth skin temperature (°C), the "surface temperature". */
  surfaceTemperatureC: number | null;
  /** Mean air temperature at 2 m (°C). */
  airTemperatureC: number | null;
  /** Mean corrected precipitation (mm/day). */
  precipitationMmPerDay: number | null;
  /** Wettest day in the period (mm/day). */
  maxPrecipitationMmPerDay: number | null;
  /** Mean wind speed at 10 m (m/s). */
  windSpeedMs: number | null;
  /** Strongest daily mean wind in the period (m/s). */
  maxWindSpeedMs: number | null;
}

export interface FireSummary {
  /** Distance to the nearest reported wildfire in the selected month (km). */
  nearestKm: number | null;
  nearestTitle: string | null;
  /** Fires within ZONE_THRESHOLDS.fireRadiusKm. */
  countWithinRadius: number;
  /** Fires within ZONE_THRESHOLDS.fireContextRadiusKm. */
  countWithinContext: number;
}

/** Target strengths (0–1) for the on-screen environment effects. */
export interface EnvironmentTargets {
  rain: number;
  /** Snowfall / frozen-zone flurries strength (0–1), drawn behind the rain. */
  snow: number;
  fire: number;
  /** Wind speed (m/s), used to slant the rain. */
  windSpeedMs: number;
}

/**
 * Bridge between the mascot (HTML, in map-stage pixels) and whichever Cesium
 * map is visible (3D globe or 2D map). Coordinates are relative to the map
 * stage, which the Cesium canvas fills.
 */
export interface MapProbeAdapter {
  pick(x: number, y: number): GeoPoint | undefined;
  /** Screen position of a point, or undefined when it is not visible. */
  project(point: GeoPoint): { x: number; y: number } | undefined;
  /** Runs after every map render. Returns a function that unsubscribes. */
  onFrame(callback: () => void): () => void;
  /**
   * Allocation-free projection for many points per frame (wind particles).
   * Writes into `out` and returns false when the point is not visible.
   */
  projectInto(longitude: number, latitude: number, out: { x: number; y: number }): boolean;
  /** Increases whenever the camera view changed since the previous call. */
  viewVersion(): number;
  /** Approximate ground meters covered by one screen pixel at the view center. */
  metersPerPixel(): number;
}
