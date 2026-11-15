import type { GeoPoint } from '../map.models';
import type { ClimateSummary } from './zone-probe.models';

/**
 * Minimal client for the NASA POWER daily point API
 * (https://power.larc.nasa.gov/docs/services/api/temporal/daily/).
 * No API key is required. Values come from MERRA-2 and are global
 * (land and ocean) on a ~0.5° grid.
 */
const POWER_DAILY_POINT_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const PARAMETERS = ['TS', 'T2M', 'PRECTOTCORR', 'WS10M'] as const;
/** POWER near-real-time data usually lags a few days behind today. */
const LATENCY_DAYS = 3;
const FALLBACK_WINDOW_DAYS = 7;

type PowerParameter = (typeof PARAMETERS)[number];

interface PowerResponse {
  header?: { fill_value?: number };
  properties?: { parameter?: Partial<Record<PowerParameter, Record<string, number>>> };
  messages?: string[];
}

/** Snaps a point to the POWER grid so nearby points share one request. */
export function toPowerCell(point: GeoPoint): GeoPoint {
  return {
    latitude: Math.min(Math.max(Math.round(point.latitude * 2) / 2, -89.5), 89.5),
    longitude: Math.round(normalizeLongitude(point.longitude) * 2) / 2,
  };
}

/**
 * Daily window for a month key (YYYY-MM): the whole month, cut at today
 * minus the data latency. Early in the current month it falls back to the
 * latest available week.
 */
export function powerPeriodForMonth(monthKey: string, today = new Date()): { start: Date; end: Date } {
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const latest = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - LATENCY_DAYS),
  );
  const end = monthEnd < latest ? monthEnd : latest;
  if (end >= monthStart) {
    return { start: monthStart, end };
  }
  return {
    start: new Date(end.getTime() - (FALLBACK_WINDOW_DAYS - 1) * 86_400_000),
    end,
  };
}

export async function fetchClimateSummary(
  cell: GeoPoint,
  monthKey: string,
  signal?: AbortSignal,
): Promise<ClimateSummary> {
  const { start, end } = powerPeriodForMonth(monthKey);
  const params = new URLSearchParams({
    parameters: PARAMETERS.join(','),
    community: 'AG',
    longitude: cell.longitude.toFixed(2),
    latitude: cell.latitude.toFixed(2),
    start: compactDate(start),
    end: compactDate(end),
    format: 'JSON',
  });

  const response = await fetch(`${POWER_DAILY_POINT_URL}?${params}`, { signal });
  if (!response.ok) {
    throw new Error(`NASA POWER responded with ${response.status}.`);
  }
  const body = (await response.json()) as PowerResponse;
  const fill = body.header?.fill_value ?? -999;
  const series = body.properties?.parameter ?? {};

  const values = (parameter: PowerParameter): number[] =>
    Object.values(series[parameter] ?? {}).filter(
      (value) => Number.isFinite(value) && value !== fill && value > -900,
    );

  const surface = values('TS');
  const air = values('T2M');
  const precipitation = values('PRECTOTCORR');
  const wind = values('WS10M');
  const validDays = Math.max(surface.length, air.length, precipitation.length, wind.length);
  if (validDays === 0) {
    throw new Error('NASA POWER has no data for this place and period yet.');
  }

  return {
    cell,
    periodStart: isoDate(start),
    periodEnd: isoDate(end),
    validDays,
    surfaceTemperatureC: mean(surface),
    airTemperatureC: mean(air),
    precipitationMmPerDay: mean(precipitation),
    maxPrecipitationMmPerDay: precipitation.length ? Math.max(...precipitation) : null,
    windSpeedMs: mean(wind),
    maxWindSpeedMs: wind.length ? Math.max(...wind) : null,
  };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function compactDate(date: Date): string {
  return isoDate(date).replaceAll('-', '');
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}
