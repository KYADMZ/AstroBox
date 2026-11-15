/**
 * Global 10 m wind field for the animated wind layer.
 *
 * Sources (both free, no API key, data CC BY 4.0, attribution
 * "Weather data by Open-Meteo.com"):
 * - recent dates (last ~2.5 months): Open-Meteo Forecast API, which also
 *   serves past days with no publication delay;
 * - older dates: Open-Meteo Historical Weather API (ECMWF ERA5 reanalysis).
 * If one source returns no data, the other one is tried.
 *
 * A coarse 12° grid (420 points) is requested in a few batched calls and
 * cached in localStorage per date, because each grid point counts toward the
 * free API's daily quota. Past dates never change, so the cache never expires.
 */

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
/** The Forecast API serves up to ~92 past days; stay safely inside that. */
const FORECAST_PAST_DAYS = 80;
/** A field with fewer valid grid points than this share is rejected. */
const MIN_VALID_SHARE = 0.6;
export const WIND_GRID_STEP_DEGREES = 12;
const LATITUDE_LIMIT = 78;
const POINTS_PER_REQUEST = 140;
/** Snapshot hour (UTC) used for the selected day. */
const SNAPSHOT_HOUR_UTC = 12;
/** v2: v1 could contain empty (all-zero) fields from days ERA5 had not published yet. */
const CACHE_PREFIX = 'astrobox.wind.v2.';

export interface WindField {
  /** ISO date of the snapshot (12:00 UTC). */
  date: string;
  columns: number;
  rows: number;
  /** Longitude of column 0 and latitude of row 0 (degrees). */
  west: number;
  south: number;
  step: number;
  /** Eastward and northward components (m/s), row-major from south to north. */
  u: Float32Array;
  v: Float32Array;
  maxSpeed: number;
}

interface CachedWindField {
  date: string;
  columns: number;
  rows: number;
  west: number;
  south: number;
  step: number;
  u: number[];
  v: number[];
}

interface ArchiveLocation {
  hourly?: {
    wind_speed_10m?: (number | null)[];
    wind_direction_10m?: (number | null)[];
  };
}

/** The 15th of the selected month, or yesterday for the current month. */
export function windDateForMonth(monthKey: string, today = new Date()): string {
  const midMonth = new Date(`${monthKey}-15T00:00:00Z`);
  const yesterday = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1),
  );
  return (midMonth < yesterday ? midMonth : yesterday).toISOString().slice(0, 10);
}

export async function loadWindField(date: string, signal?: AbortSignal): Promise<WindField> {
  const cached = readCache(date);
  if (cached) {
    return cached;
  }

  const daysAgo = (Date.now() - new Date(`${date}T12:00:00Z`).getTime()) / 86_400_000;
  const sources = daysAgo <= FORECAST_PAST_DAYS ? [FORECAST_URL, ARCHIVE_URL] : [ARCHIVE_URL, FORECAST_URL];
  let lastError: unknown;
  for (const source of sources) {
    try {
      const field = await requestField(source, date, signal);
      writeCache(field);
      return field;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Wind data is unavailable.');
}

async function requestField(url: string, date: string, signal?: AbortSignal): Promise<WindField> {
  const longitudes: number[] = [];
  for (let lon = -180; lon < 180; lon += WIND_GRID_STEP_DEGREES) {
    longitudes.push(lon);
  }
  const latitudes: number[] = [];
  for (let lat = -LATITUDE_LIMIT; lat <= LATITUDE_LIMIT; lat += WIND_GRID_STEP_DEGREES) {
    latitudes.push(lat);
  }
  const points = latitudes.flatMap((lat) => longitudes.map((lon) => [lon, lat] as const));
  const u = new Float32Array(points.length);
  const v = new Float32Array(points.length);
  let valid = 0;

  // Sequential batches keep the load on the free API gentle.
  for (let start = 0; start < points.length; start += POINTS_PER_REQUEST) {
    const batch = points.slice(start, start + POINTS_PER_REQUEST);
    const params = new URLSearchParams({
      latitude: batch.map(([, lat]) => lat).join(','),
      longitude: batch.map(([lon]) => lon).join(','),
      start_date: date,
      end_date: date,
      hourly: 'wind_speed_10m,wind_direction_10m',
      wind_speed_unit: 'ms',
      timezone: 'GMT',
    });
    const response = await fetch(`${url}?${params}`, { signal });
    if (!response.ok) {
      throw new Error(`Open-Meteo responded with ${response.status}.`);
    }
    const body = (await response.json()) as ArchiveLocation | ArchiveLocation[];
    const locations = Array.isArray(body) ? body : [body];
    locations.forEach((location, index) => {
      const speed = location.hourly?.wind_speed_10m?.[SNAPSHOT_HOUR_UTC];
      const directionFrom = location.hourly?.wind_direction_10m?.[SNAPSHOT_HOUR_UTC];
      if (typeof speed !== 'number' || typeof directionFrom !== 'number') {
        return;
      }
      // Meteorological direction is where the wind blows FROM.
      const radians = (directionFrom * Math.PI) / 180;
      u[start + index] = -speed * Math.sin(radians);
      v[start + index] = -speed * Math.cos(radians);
      valid += 1;
    });
  }

  if (valid < points.length * MIN_VALID_SHARE) {
    throw new Error(`Open-Meteo has no wind data for ${date} yet.`);
  }
  return createField(date, longitudes.length, latitudes.length, u, v);
}

/** Bilinear wind at a point (m/s), wrapping across the antimeridian. */
export function sampleWind(
  field: WindField,
  longitude: number,
  latitude: number,
  out: { u: number; v: number },
): boolean {
  const gx = (((longitude - field.west) % 360) + 360) % 360 / field.step;
  const gy = (latitude - field.south) / field.step;
  if (gy < 0 || gy > field.rows - 1) {
    return false;
  }
  const x0 = Math.floor(gx);
  const y0 = Math.min(Math.floor(gy), field.rows - 2);
  const x1 = (x0 + 1) % field.columns;
  const fx = gx - x0;
  const fy = gy - y0;
  const i00 = y0 * field.columns + (x0 % field.columns);
  const i10 = y0 * field.columns + x1;
  const i01 = (y0 + 1) * field.columns + (x0 % field.columns);
  const i11 = (y0 + 1) * field.columns + x1;
  out.u =
    field.u[i00] * (1 - fx) * (1 - fy) +
    field.u[i10] * fx * (1 - fy) +
    field.u[i01] * (1 - fx) * fy +
    field.u[i11] * fx * fy;
  out.v =
    field.v[i00] * (1 - fx) * (1 - fy) +
    field.v[i10] * fx * (1 - fy) +
    field.v[i01] * (1 - fx) * fy +
    field.v[i11] * fx * fy;
  return true;
}

function createField(
  date: string,
  columns: number,
  rows: number,
  u: Float32Array,
  v: Float32Array,
): WindField {
  let maxSpeed = 0;
  for (let index = 0; index < u.length; index += 1) {
    maxSpeed = Math.max(maxSpeed, Math.hypot(u[index], v[index]));
  }
  return {
    date,
    columns,
    rows,
    west: -180,
    south: -LATITUDE_LIMIT,
    step: WIND_GRID_STEP_DEGREES,
    u,
    v,
    maxSpeed,
  };
}

function readCache(date: string): WindField | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + date);
    if (!raw) {
      return undefined;
    }
    const cached = JSON.parse(raw) as CachedWindField;
    if (cached.step !== WIND_GRID_STEP_DEGREES || cached.u.length !== cached.columns * cached.rows) {
      return undefined;
    }
    return createField(
      cached.date,
      cached.columns,
      cached.rows,
      Float32Array.from(cached.u),
      Float32Array.from(cached.v),
    );
  } catch {
    return undefined;
  }
}

function writeCache(field: WindField): void {
  try {
    const round = (values: Float32Array): number[] =>
      Array.from(values, (value) => Math.round(value * 10) / 10);
    const cached: CachedWindField = {
      date: field.date,
      columns: field.columns,
      rows: field.rows,
      west: field.west,
      south: field.south,
      step: field.step,
      u: round(field.u),
      v: round(field.v),
    };
    localStorage.setItem(CACHE_PREFIX + field.date, JSON.stringify(cached));
  } catch {
    // Storage full or unavailable: the field simply is not cached.
  }
}
