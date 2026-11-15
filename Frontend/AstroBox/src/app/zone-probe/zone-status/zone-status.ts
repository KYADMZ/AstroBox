import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { PrecipitationLevel, ZoneMood } from '../zone-probe.models';
import { ZONE_THRESHOLDS } from '../zone-probe.models';
import { ZoneProbeStore } from '../zone-probe.store';

const MOOD_TITLES: Record<ZoneMood, string> = {
  cold: 'Very cold zone',
  neutral: 'Neutral zone',
  hot: 'Hot or burning zone',
};

const PRECIPITATION_LABELS: Record<PrecipitationLevel, string> = {
  none: 'Dry',
  light: 'Light rain',
  moderate: 'Moderate rain',
  heavy: 'Heavy rain',
  veryHeavy: 'Very heavy rain',
};

/** Right-side panel with the status of the zone under Verny. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-zone-status',
  styleUrl: './zone-status.scss',
  templateUrl: './zone-status.html',
})
export class ZoneStatusComponent {
  protected readonly store = inject(ZoneProbeStore);
  protected readonly thresholds = ZONE_THRESHOLDS;

  protected readonly moodTitle = computed(() => MOOD_TITLES[this.store.mood()]);
  protected readonly moodImage = computed(() => `verny/verny-${this.store.mood()}.png`);
  protected readonly precipitationLabel = computed(
    () => PRECIPITATION_LABELS[this.store.precipitationLevel()],
  );

  protected readonly coordinates = computed(() => {
    const focus = this.store.focus();
    if (!focus) {
      return 'Off the map';
    }
    const lat = `${Math.abs(focus.latitude).toFixed(2)}°${focus.latitude >= 0 ? 'N' : 'S'}`;
    const lon = `${Math.abs(focus.longitude).toFixed(2)}°${focus.longitude >= 0 ? 'E' : 'W'}`;
    return `${lat} · ${lon}`;
  });

  protected readonly period = computed(() => {
    const climate = this.store.climate();
    return climate ? `${formatDay(climate.periodStart)} – ${formatDay(climate.periodEnd)}` : '';
  });

  protected formatTemperature(value: number | null): string {
    return value === null ? '—' : `${value.toFixed(1)} °C`;
  }

  protected formatPrecipitation(value: number | null): string {
    return value === null ? '—' : `${value.toFixed(1)} mm/day`;
  }

  protected formatWind(value: number | null): string {
    return value === null ? '—' : `${(value * 3.6).toFixed(0)} km/h`;
  }

  protected formatDistance(value: number | null): string {
    return value === null ? '—' : `${Math.round(value).toLocaleString('en-US')} km`;
  }

  protected returnToDock(): void {
    this.store.dock();
  }
}

function formatDay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
