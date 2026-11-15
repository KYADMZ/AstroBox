import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { lookupClimateClass, type ClimateClass } from '../climate-zones';
import type { FireObservation, GeoPoint } from '../map.models';
import { whistleStrength } from './soundscape/sound-mix';
import { fetchClimateSummary, toPowerCell } from './nasa-power.client';
import {
  ZONE_THRESHOLDS,
  type ClimateSummary,
  type EnvironmentTargets,
  type FireSummary,
  type PrecipitationLevel,
  type PrecipitationPhase,
  type ProbePhase,
  type VernyAnimation,
  type ZoneMood,
} from './zone-probe.models';

/** While dragging, climate data is requested once the mascot rests this long (ms). */
const PREVIEW_DEBOUNCE_MS = 380;
const EARTH_RADIUS_KM = 6371;

type ClimateStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Shared state of the Verny zone probe: where the mascot is, the data for
 * that place (NASA POWER climate + EONET wildfires), Verny's mood and the
 * strength of the on-screen effects.
 *
 * Future sound effects can read `mood`, `precipitationLevel` and
 * `effectTargets` from here.
 */
@Injectable({ providedIn: 'root' })
export class ZoneProbeStore implements OnDestroy {
  private readonly monthKeyState = signal('');
  private readonly firesState = signal<readonly FireObservation[]>([]);
  private readonly phaseState = signal<ProbePhase>('docked');
  private readonly placedLocation = signal<GeoPoint | null>(null);
  private readonly previewLocation = signal<GeoPoint | null>(null);
  private readonly climateState = signal<ClimateSummary | null>(null);
  private readonly climateStatusState = signal<ClimateStatus>('idle');
  private readonly climateErrorState = signal<string | null>(null);
  private readonly climateZoneState = signal<ClimateClass | null>(null);
  private readonly climateZoneStatusState = signal<ClimateStatus>('idle');

  private readonly cache = new Map<string, Promise<ClimateSummary>>();
  private requestToken = 0;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private zoneTimer?: ReturnType<typeof setTimeout>;
  private zoneToken = 0;

  readonly phase = this.phaseState.asReadonly();
  readonly location = this.placedLocation.asReadonly();
  readonly climate = this.climateState.asReadonly();
  readonly climateStatus = this.climateStatusState.asReadonly();
  readonly climateError = this.climateErrorState.asReadonly();
  /** Köppen-Geiger class under Verny (null over oceans or while unknown). */
  readonly climateZone = this.climateZoneState.asReadonly();
  readonly climateZoneStatus = this.climateZoneStatusState.asReadonly();

  /** The point being inspected: the drag position or the drop position. */
  readonly focus = computed<GeoPoint | null>(() => {
    switch (this.phaseState()) {
      case 'dragging':
        return this.previewLocation();
      case 'placed':
        return this.placedLocation();
      default:
        return null;
    }
  });

  readonly fires = computed<FireSummary>(() => {
    const focus = this.focus();
    const summary: FireSummary = {
      nearestKm: null,
      nearestTitle: null,
      countWithinRadius: 0,
      countWithinContext: 0,
    };
    if (!focus) {
      return summary;
    }
    for (const fire of this.firesState()) {
      const distance = distanceKm(focus, fire);
      if (summary.nearestKm === null || distance < summary.nearestKm) {
        summary.nearestKm = distance;
        summary.nearestTitle = fire.title;
      }
      if (distance <= ZONE_THRESHOLDS.fireRadiusKm) {
        summary.countWithinRadius += 1;
      }
      if (distance <= ZONE_THRESHOLDS.fireContextRadiusKm) {
        summary.countWithinContext += 1;
      }
    }
    return summary;
  });

  /** Temperature used for the mood: surface (skin) temperature, else air temperature. */
  readonly temperatureC = computed(() => {
    const climate = this.climateState();
    return climate?.surfaceTemperatureC ?? climate?.airTemperatureC ?? null;
  });

  readonly mood = computed<ZoneMood>(() => {
    if (!this.focus()) {
      return 'neutral';
    }
    if (this.fires().countWithinRadius > 0) {
      return 'hot';
    }
    const temperature = this.temperatureC();
    if (temperature === null) {
      return 'neutral';
    }
    if (temperature >= ZONE_THRESHOLDS.hotTemperatureC) {
      return 'hot';
    }
    if (temperature <= ZONE_THRESHOLDS.coldTemperatureC) {
      return 'cold';
    }
    return 'neutral';
  });

  readonly precipitationLevel = computed<PrecipitationLevel>(() =>
    precipitationLevel(this.climateState()?.precipitationMmPerDay ?? null),
  );

  /**
   * Rain or snow. Daily point data has no precipitation type, so the phase
   * is inferred from the 2 m air temperature (snow at or below ~0.5 °C).
   */
  readonly precipitationPhase = computed<PrecipitationPhase | null>(() => {
    const climate = this.climateState();
    if (!climate || this.precipitationLevel() === 'none') {
      return null;
    }
    const air = climate.airTemperatureC ?? climate.surfaceTemperatureC;
    return air !== null && air <= ZONE_THRESHOLDS.snowAirTemperatureC ? 'snow' : 'rain';
  });

  /**
   * Verny's animation: the phenomenon with the highest normalized value
   * wins (rain, wind or heat). A nearby wildfire always wins ("burning
   * feet"); calm places get a friendly wave; cold zones keep the static
   * cold drawing.
   */
  readonly animation = computed<VernyAnimation | null>(() => {
    if (!this.focus()) {
      return null;
    }
    if (this.fires().countWithinRadius > 0) {
      return 'burning';
    }
    const climate = this.climateState();
    const temperature = this.temperatureC();
    if (!climate || temperature === null) {
      return null;
    }
    const rain =
      this.precipitationPhase() === 'rain' ? rainIntensity(climate.precipitationMmPerDay) : 0;
    const wind = Math.max(
      clamp01(((climate.windSpeedMs ?? 0) - 3) / 9),
      0.7 * clamp01(((climate.maxWindSpeedMs ?? 0) - 3) / 9),
    );
    const heat = clamp01((temperature - 26) / 14);
    const cold = clamp01((ZONE_THRESHOLDS.coldTemperatureC - temperature) / 20);
    const scores: [VernyAnimation | null, number][] = [
      ['rain', rain],
      ['wind', wind],
      ['heat', heat],
      [null, cold],
    ];
    const [winner, value] = scores.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
    if (value < 0.15) {
      return 'wave';
    }
    return winner;
  });

  /** Effects only run once the mascot has been dropped on the map. */
  readonly effectTargets = computed<EnvironmentTargets>(() => {
    if (this.phaseState() !== 'placed') {
      return { rain: 0, snow: 0, fire: 0, windSpeedMs: 0 };
    }
    const climate = this.climateState();
    const fires = this.fires();
    const fire =
      fires.countWithinRadius > 0 && fires.nearestKm !== null
        ? Math.min(
            1,
            0.45 +
              0.1 * (fires.countWithinContext - 1) +
              0.3 * (1 - fires.nearestKm / ZONE_THRESHOLDS.fireRadiusKm),
          )
        : 0;
    const precipitation = rainIntensity(climate?.precipitationMmPerDay ?? null);
    const snowing = this.precipitationPhase() === 'snow';
    // Frozen zones get light background flurries even without precipitation.
    const temperatures = [climate?.airTemperatureC, climate?.surfaceTemperatureC].filter(
      (value): value is number => value !== null && value !== undefined,
    );
    const coldest = temperatures.length > 0 ? Math.min(...temperatures) : null;
    const flurries =
      coldest !== null && coldest <= ZONE_THRESHOLDS.frozenTemperatureC
        ? Math.min(0.6, 0.2 + (ZONE_THRESHOLDS.frozenTemperatureC - coldest) / 30)
        : 0;
    return {
      // When it is cold enough, precipitation falls as snow and replaces the rain.
      rain: snowing ? 0 : precipitation,
      snow: Math.max(flurries, snowing ? Math.max(precipitation, 0.3) : 0),
      fire,
      windSpeedMs: climate?.windSpeedMs ?? 0,
    };
  });

  /**
   * 0–1 strength of the "strong wind" whistle. Uses the monthly mean wind and,
   * more gently, the windiest day, so gusty places whistle too.
   */
  readonly strongWind = computed(() => {
    if (this.phaseState() !== 'placed') {
      return 0;
    }
    const climate = this.climateState();
    return Math.max(
      whistleStrength(climate?.windSpeedMs ?? 0),
      0.6 * whistleStrength(climate?.maxWindSpeedMs ?? 0),
    );
  });

  /** Called by the app whenever the selected month or its wildfires change. */
  setContext(monthKey: string, fires: readonly FireObservation[]): void {
    const monthChanged = monthKey !== this.monthKeyState();
    this.monthKeyState.set(monthKey);
    this.firesState.set(fires);
    const focus = this.focus();
    if (monthChanged && focus) {
      this.loadClimate(focus, 0);
    }
  }

  startDrag(): void {
    this.phaseState.set('dragging');
  }

  /** Live update while dragging. `point` is undefined when off the map. */
  preview(point: GeoPoint | undefined): void {
    this.previewLocation.set(point ?? null);
    if (point) {
      this.loadClimate(point, PREVIEW_DEBOUNCE_MS);
      this.loadClimateZone(point, PREVIEW_DEBOUNCE_MS);
    } else {
      this.clearPreviewTimer();
    }
  }

  place(point: GeoPoint): void {
    this.placedLocation.set(point);
    this.previewLocation.set(null);
    this.phaseState.set('placed');
    this.loadClimate(point, 0);
    this.loadClimateZone(point, 0);
  }

  /** Sends Verny back to its dock and stops all effects. */
  dock(): void {
    this.clearPreviewTimer();
    this.requestToken += 1;
    this.phaseState.set('docked');
    this.placedLocation.set(null);
    this.previewLocation.set(null);
    this.climateState.set(null);
    this.climateStatusState.set('idle');
    this.climateErrorState.set(null);
    if (this.zoneTimer !== undefined) {
      clearTimeout(this.zoneTimer);
      this.zoneTimer = undefined;
    }
    this.zoneToken += 1;
    this.climateZoneState.set(null);
    this.climateZoneStatusState.set('idle');
  }

  ngOnDestroy(): void {
    this.clearPreviewTimer();
  }

  /** Looks up the climate zone (Köppen-Geiger raster) under a point. */
  private loadClimateZone(point: GeoPoint, delayMs: number): void {
    if (this.zoneTimer !== undefined) {
      clearTimeout(this.zoneTimer);
      this.zoneTimer = undefined;
    }
    const run = (): void => {
      this.zoneTimer = undefined;
      const token = ++this.zoneToken;
      this.climateZoneStatusState.set('loading');
      lookupClimateClass(point.longitude, point.latitude).then(
        (climateClass) => {
          if (token === this.zoneToken) {
            this.climateZoneState.set(climateClass ?? null);
            this.climateZoneStatusState.set('ready');
          }
        },
        (error: unknown) => {
          if (token === this.zoneToken) {
            console.error('Unable to look up the climate zone under Verny.', error);
            this.climateZoneState.set(null);
            this.climateZoneStatusState.set('error');
          }
        },
      );
    };
    if (delayMs > 0) {
      this.zoneTimer = setTimeout(run, delayMs);
    } else {
      run();
    }
  }

  private loadClimate(point: GeoPoint, delayMs: number): void {
    this.clearPreviewTimer();
    const monthKey = this.monthKeyState();
    if (!monthKey) {
      return;
    }
    const cell = toPowerCell(point);
    const key = `${monthKey}|${cell.latitude}|${cell.longitude}`;
    const current = this.climateState();
    if (
      current &&
      current.cell.latitude === cell.latitude &&
      current.cell.longitude === cell.longitude &&
      this.cache.has(key)
    ) {
      return;
    }

    const run = (): void => {
      const token = ++this.requestToken;
      this.climateStatusState.set('loading');
      this.climateErrorState.set(null);

      let request = this.cache.get(key);
      if (!request) {
        request = fetchClimateSummary(cell, monthKey);
        this.cache.set(key, request);
      }
      request.then(
        (summary) => {
          if (token === this.requestToken) {
            this.climateState.set(summary);
            this.climateStatusState.set('ready');
          }
        },
        (error: unknown) => {
          this.cache.delete(key);
          if (token === this.requestToken) {
            console.error('Unable to load NASA POWER data.', error);
            this.climateStatusState.set('error');
            this.climateErrorState.set(
              error instanceof Error ? error.message : 'NASA POWER data could not be loaded.',
            );
          }
        },
      );
    };

    if (delayMs > 0 && !this.cache.has(key)) {
      this.previewTimer = setTimeout(run, delayMs);
    } else {
      run();
    }
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer !== undefined) {
      clearTimeout(this.previewTimer);
      this.previewTimer = undefined;
    }
  }
}

export function precipitationLevel(mmPerDay: number | null): PrecipitationLevel {
  const thresholds = ZONE_THRESHOLDS.precipitationMmPerDay;
  if (mmPerDay === null || mmPerDay < thresholds.light) {
    return 'none';
  }
  if (mmPerDay < thresholds.moderate) {
    return 'light';
  }
  if (mmPerDay < thresholds.heavy) {
    return 'moderate';
  }
  if (mmPerDay < thresholds.veryHeavy) {
    return 'heavy';
  }
  return 'veryHeavy';
}

/**
 * 0–1 rain strength from mean daily precipitation. Gentle at low values
 * (1 mm/day ≈ 0.1, 2.5 ≈ 0.2, 8 ≈ 0.5) and saturating near 22 mm/day,
 * so only really wet places get the heavy storm effect.
 */
function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function rainIntensity(mmPerDay: number | null): number {
  const light = ZONE_THRESHOLDS.precipitationMmPerDay.light;
  if (mmPerDay === null || mmPerDay < light) {
    return 0;
  }
  return Math.min(Math.max(Math.pow((mmPerDay - light) / 22, 0.7), 0.04), 1);
}

function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRadians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRadians;
  const dLon = (b.longitude - a.longitude) * toRadians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * toRadians) * Math.cos(b.latitude * toRadians) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
