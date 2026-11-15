import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type * as Cesium from 'cesium';
import {
  GIBS_SEA_SURFACE_TEMPERATURE_ANOMALY_LAYER,
  createGibsWmsProvider,
  toIsoDate,
} from './gibs/gibs-wms';
import { Map2DComponent } from './map-2d/map-2d';
import type { FireObservation, VisualizationId } from './map.models';

interface EonetGeometry {
  date: string;
  type: string;
  coordinates: unknown;
}

interface EonetEvent {
  id: string;
  title: string;
  geometry: EonetGeometry[];
}

interface MonthOption {
  key: string;
  label: string;
  shortLabel: string;
  year: number;
}

interface VisualizationOption {
  id: VisualizationId;
  label: string;
  /** Restricts the visualization to one map mode. Omitted: available in both. */
  mapMode?: '3d' | '2d';
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Map2DComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly browser = isPlatformBrowser(this.platformId);
  private readonly now = new Date();
  private readonly playIntervalMs = 1800;
  private cesium?: typeof Cesium;
  private viewer?: Cesium.Viewer;
  private fireDataSource?: Cesium.CustomDataSource;
  private precipitationLayer?: Cesium.ImageryLayer;
  private precipitationDate?: string;
  private precipitationRequestId = 0;
  private seaTemperatureLayer?: Cesium.ImageryLayer;
  private seaTemperatureLayerDate?: string;
  private seaTemperatureRequestId = 0;
  private playInterval?: number;
  private destroyed = false;

  protected readonly months = this.createMonths();
  protected readonly mapMode = signal<'3d' | '2d'>('3d');
  protected readonly visualizations: VisualizationOption[] = [
    { id: 'wildfires', label: 'Wildfires' },
    { id: 'precipitation', label: 'Precipitation' },
    { id: 'seaTemperature', label: 'Sea temperature anomaly', mapMode: '3d' },
  ];
  protected readonly availableVisualizations = computed(() =>
    this.visualizations.filter(
      (visualization) => !visualization.mapMode || visualization.mapMode === this.mapMode(),
    ),
  );
  protected readonly selectedMonthIndex = signal(this.months.length - 1);
  protected readonly selectedMonth = computed(
    () => this.months[this.selectedMonthIndex()],
  );
  protected readonly selectedMonthFires = computed(() => {
    const monthKey = this.selectedMonth().key;
    return this.fireObservations().filter((fire) => fire.date.startsWith(monthKey));
  });
  protected readonly isLoading = signal(true);
  protected readonly isPlaying = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly precipitationError = signal<string | null>(null);
  protected readonly seaTemperatureError = signal<string | null>(null);
  protected readonly seaTemperatureOpacity = signal(0.7);
  protected readonly seaTemperatureOpacityPercent = computed(() =>
    Math.round(this.seaTemperatureOpacity() * 100),
  );
  /** Date requested from GIBS for the selected month (see seaTemperatureDateForMonth). */
  protected readonly seaTemperatureDate = computed(() =>
    this.seaTemperatureDateForMonth(this.selectedMonth().key),
  );
  /** True while the guided El Niño story is running on the 2D map. */
  protected readonly storyActive = signal(false);
  protected readonly sliderProgress = computed(
    () => (this.selectedMonthIndex() / (this.months.length - 1)) * 100,
  );

  private readonly enabledVisualizations = signal<ReadonlySet<VisualizationId>>(
    new Set(['wildfires']),
  );
  private readonly fireObservations = signal<FireObservation[]>([]);

  async ngAfterViewInit(): Promise<void> {
    if (!this.browser || this.mapMode() !== '3d') {
      return;
    }

    await Promise.all([this.initializeMap(), this.loadWildfires()]);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopPlayback();
    this.viewer?.destroy();
  }

  protected onMonthInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.selectedMonthIndex.set(Number(input.value));
    this.updateSelectedMonthLayers();
  }

  protected isVisualizationEnabled(id: VisualizationId): boolean {
    return this.enabledVisualizations().has(id);
  }

  protected selectMapMode(mode: '3d' | '2d'): void {
    if (this.mapMode() === mode) {
      return;
    }

    if (mode === '2d') {
      this.destroy3DMap();
      this.mapMode.set('2d');
      return;
    }

    this.mapMode.set('3d');
    this.storyActive.set(false);
    window.setTimeout(() => void this.initializeMap(), 0);
  }

  protected onMap2DError(message: string | null): void {
    this.errorMessage.set(message);
  }

  protected onMap2DPrecipitationError(message: string | null): void {
    this.precipitationError.set(message);
  }

  protected onMap2DStoryActiveChange(active: boolean): void {
    this.storyActive.set(active);
  }

  protected onSeaTemperatureOpacityInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const opacity = Math.min(Math.max(Number(input.value), 0), 1);
    this.seaTemperatureOpacity.set(opacity);
    if (this.seaTemperatureLayer) {
      this.seaTemperatureLayer.alpha = opacity;
    }
  }

  protected toggleVisualization(id: VisualizationId): void {
    const enabled = new Set(this.enabledVisualizations());
    if (enabled.has(id)) {
      enabled.delete(id);
    } else {
      enabled.add(id);
    }
    this.enabledVisualizations.set(enabled);
    this.syncVisualizationLayers();
  }

  protected togglePlayback(): void {
    if (this.isPlaying()) {
      this.stopPlayback();
      return;
    }

    this.isPlaying.set(true);
    this.playInterval = window.setInterval(() => {
      const nextIndex = (this.selectedMonthIndex() + 1) % this.months.length;
      this.selectedMonthIndex.set(nextIndex);
      this.updateSelectedMonthLayers();
    }, this.playIntervalMs);
  }

  private createMonths(): MonthOption[] {
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date(
        Date.UTC(this.now.getUTCFullYear(), this.now.getUTCMonth() - 5 + index, 1),
      );
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = new Intl.DateTimeFormat('en', {
        month: 'long',
        timeZone: 'UTC',
      }).format(date);
      const shortLabel = new Intl.DateTimeFormat('en', {
        month: 'short',
        timeZone: 'UTC',
      }).format(date);

      return { key, label, shortLabel, year: date.getUTCFullYear() };
    });
  }

  private async initializeMap(): Promise<void> {
    if (!this.browser || this.destroyed || this.mapMode() !== '3d') {
      return;
    }

    try {
      (globalThis as typeof globalThis & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL =
        '/assets/cesium/';
      const cesium = await import('cesium');
      if (this.destroyed) {
        return;
      }

      this.cesium = cesium;
      const container = this.host.nativeElement.querySelector<HTMLElement>('.cesium-map');
      if (!container) {
        throw new Error('The Cesium map container is unavailable.');
      }

      this.viewer = new cesium.Viewer(container, {
        animation: false,
        baseLayer: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
      });
      this.viewer.imageryLayers.addImageryProvider(
        new cesium.UrlTemplateImageryProvider({
          credit: '© OpenStreetMap contributors',
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        }),
      );
      this.viewer.scene.globe.baseColor = cesium.Color.fromCssColorString('#102027');
      this.viewer.camera.setView({
        destination: cesium.Cartesian3.fromDegrees(-100, 25, 16_000_000),
      });
      this.fireDataSource = new cesium.CustomDataSource('Wildfires');
      void this.viewer.dataSources.add(this.fireDataSource);
      this.syncVisualizationLayers();
      this.updateSelectedMonthLayers();
    } catch (error) {
      if (!this.destroyed) {
        console.error('Unable to initialize the Cesium wildfire map.', error);
        this.errorMessage.set('The map could not be loaded. Please refresh to try again.');
      }
    }
  }

  private async loadWildfires(): Promise<void> {
    try {
      const ranges = this.createDateRanges();
      const observations: FireObservation[] = [];
      for (let index = 0; index < ranges.length; index += 4) {
        const batch = await Promise.all(
          ranges.slice(index, index + 4).map((range) => this.loadWildfireRange(range)),
        );
        observations.push(...batch.flat());
      }

      if (!this.destroyed) {
        const uniqueObservations = new Map(
          observations.map((observation) => [observation.id, observation]),
        );
        this.fireObservations.set([...uniqueObservations.values()]);
        this.updateSelectedMonthLayers();
      }
    } catch (error) {
      if (!this.destroyed) {
        console.error('Unable to load wildfire events from NASA EONET.', error);
        this.errorMessage.set(
          'Wildfire data is unavailable right now. Please try again later.',
        );
      }
    } finally {
      if (!this.destroyed) {
        this.isLoading.set(false);
      }
    }
  }

  private createDateRanges(): { start: string; end: string }[] {
    const firstDay = new Date(`${this.months[0].key}-01T00:00:00Z`);
    const lastDay = new Date(`${this.now.toISOString().slice(0, 10)}T00:00:00Z`);
    const ranges: { start: string; end: string }[] = [];
    const dayInMs = 24 * 60 * 60 * 1000;

    for (let startTime = firstDay.getTime(); startTime <= lastDay.getTime(); ) {
      const endTime = Math.min(startTime + 6 * dayInMs, lastDay.getTime());
      ranges.push({
        start: new Date(startTime).toISOString().slice(0, 10),
        end: new Date(endTime).toISOString().slice(0, 10),
      });
      startTime = endTime + dayInMs;
    }

    return ranges;
  }

  private async loadWildfireRange(range: {
    start: string;
    end: string;
  }): Promise<FireObservation[]> {
    const params = new URLSearchParams({
      category: 'wildfires',
      end: range.end,
      limit: '500',
      start: range.start,
      status: 'all',
    });
    const response = await fetch(
      `https://eonet.gsfc.nasa.gov/api/v3/events?${params.toString()}`,
    );
    if (!response.ok) {
      throw new Error(`NASA EONET returned HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    if (!isEonetResponse(payload)) {
      throw new Error('NASA EONET returned an unexpected response.');
    }

    if (payload.events.length === 500 && range.start !== range.end) {
      const startTime = new Date(`${range.start}T00:00:00Z`).getTime();
      const endTime = new Date(`${range.end}T00:00:00Z`).getTime();
      const dayInMs = 24 * 60 * 60 * 1000;
      const splitTime =
        startTime +
        Math.floor((endTime - startTime) / (2 * dayInMs)) * dayInMs;
      const left = {
        start: range.start,
        end: new Date(splitTime).toISOString().slice(0, 10),
      };
      const right = {
        start: new Date(splitTime + dayInMs).toISOString().slice(0, 10),
        end: range.end,
      };
      const splitObservations = await Promise.all([
        this.loadWildfireRange(left),
        this.loadWildfireRange(right),
      ]);
      return splitObservations.flat();
    }

    return payload.events.flatMap((event) =>
      event.geometry.flatMap((geometry, index) => {
        const date = new Date(geometry.date);
        if (!Number.isFinite(date.getTime())) {
          return [];
        }
        const observationDate = date.toISOString().slice(0, 10);
        if (observationDate < range.start || observationDate > range.end) {
          return [];
        }

        return positionsForGeometry(geometry).map((position, positionIndex) => ({
          id: `${event.id}-${observationDate}-${index}-${positionIndex}`,
          title: event.title,
          date: observationDate,
          longitude: position[0],
          latitude: position[1],
        }));
      }),
    );
  }

  private updateSelectedMonthLayers(): void {
    this.updateMapMarkers();
    if (this.isVisualizationEnabled('precipitation')) {
      this.loadPrecipitation(`${this.selectedMonth().key}-01`);
    }
    if (this.isVisualizationEnabled('seaTemperature')) {
      this.loadSeaTemperature(this.seaTemperatureDate());
    }
  }

  private syncVisualizationLayers(): void {
    if (!this.viewer || this.viewer.isDestroyed()) {
      return;
    }

    if (this.fireDataSource) {
      this.fireDataSource.show = this.isVisualizationEnabled('wildfires');
    }
    if (this.isVisualizationEnabled('precipitation')) {
      this.loadPrecipitation(`${this.selectedMonth().key}-01`);
    } else {
      this.removePrecipitationLayer();
    }
    if (this.isVisualizationEnabled('seaTemperature')) {
      this.loadSeaTemperature(this.seaTemperatureDate());
    } else {
      this.removeSeaTemperatureLayer();
    }
  }

  private loadPrecipitation(date: string): void {
    if (!this.viewer || !this.cesium || this.viewer.isDestroyed()) {
      return;
    }
    if (this.precipitationLayer && this.precipitationDate === date) {
      return;
    }

    this.removePrecipitationLayer();
    const requestId = this.precipitationRequestId;
    this.precipitationError.set(null);

    try {
      const provider = new this.cesium.WebMapServiceImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
        layers: 'IMERG_Precipitation_Rate',
        parameters: {
          service: 'WMS',
          version: '1.1.1',
          request: 'GetMap',
          styles: '',
          format: 'image/png',
          transparent: true,
          time: date,
        },
        tilingScheme: new this.cesium.GeographicTilingScheme(),
        enablePickFeatures: false,
        credit: 'NASA GPM IMERG / NASA GIBS',
      });

      provider.errorEvent.addEventListener((error) => {
        if (requestId !== this.precipitationRequestId || this.destroyed) {
          return;
        }
        console.error('Unable to load NASA GPM IMERG precipitation imagery.', error);
        this.precipitationError.set(
          'NASA precipitation imagery is unavailable for this date.',
        );
      });

      this.precipitationLayer = this.viewer.imageryLayers.addImageryProvider(provider);
      this.precipitationLayer.alpha = 0.75;
      this.precipitationDate = date;
    } catch (error) {
      console.error('Unable to create the NASA GPM IMERG precipitation layer.', error);
      this.precipitationDate = undefined;
      this.precipitationError.set(
        'NASA precipitation imagery could not be loaded.',
      );
    }
  }

  private removePrecipitationLayer(): void {
    this.precipitationRequestId += 1;
    if (this.precipitationLayer && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.imageryLayers.remove(this.precipitationLayer, true);
    }
    this.precipitationLayer = undefined;
    this.precipitationDate = undefined;
    this.precipitationError.set(null);
  }

  /**
   * GHRSST MUR anomalies are daily. The middle of the month represents the
   * selected month; for the current month the most recent day that is likely
   * published (about two days of latency) is used instead.
   */
  private seaTemperatureDateForMonth(monthKey: string): string {
    const midMonth = new Date(`${monthKey}-15T00:00:00Z`);
    const latestAvailable = new Date(
      Date.UTC(this.now.getUTCFullYear(), this.now.getUTCMonth(), this.now.getUTCDate() - 2),
    );
    return toIsoDate(midMonth < latestAvailable ? midMonth : latestAvailable);
  }

  private loadSeaTemperature(date: string): void {
    if (!this.viewer || !this.cesium || this.viewer.isDestroyed()) {
      return;
    }
    if (this.seaTemperatureLayer && this.seaTemperatureLayerDate === date) {
      return;
    }

    this.removeSeaTemperatureLayer();
    const requestId = this.seaTemperatureRequestId;
    this.seaTemperatureError.set(null);

    try {
      const provider = createGibsWmsProvider(this.cesium, {
        layer: GIBS_SEA_SURFACE_TEMPERATURE_ANOMALY_LAYER,
        time: date,
        credit: 'NASA JPL GHRSST MUR / NASA GIBS',
      });

      provider.errorEvent.addEventListener((error) => {
        if (requestId !== this.seaTemperatureRequestId || this.destroyed) {
          return;
        }
        console.error('Unable to load NASA GHRSST sea surface temperature anomalies.', error);
        this.seaTemperatureError.set(
          `Sea temperature anomaly imagery is unavailable for ${date}.`,
        );
      });

      this.seaTemperatureLayer = this.viewer.imageryLayers.addImageryProvider(provider);
      this.seaTemperatureLayer.alpha = this.seaTemperatureOpacity();
      this.seaTemperatureLayerDate = date;
      // Keep precipitation readable above the ocean temperature layer.
      if (this.precipitationLayer) {
        this.viewer.imageryLayers.raiseToTop(this.precipitationLayer);
      }
    } catch (error) {
      console.error('Unable to create the sea surface temperature anomaly layer.', error);
      this.seaTemperatureLayerDate = undefined;
      this.seaTemperatureError.set('Sea temperature anomaly imagery could not be loaded.');
    }
  }

  private removeSeaTemperatureLayer(): void {
    this.seaTemperatureRequestId += 1;
    if (this.seaTemperatureLayer && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.imageryLayers.remove(this.seaTemperatureLayer, true);
    }
    this.seaTemperatureLayer = undefined;
    this.seaTemperatureLayerDate = undefined;
    this.seaTemperatureError.set(null);
  }

  private destroy3DMap(): void {
    this.removeSeaTemperatureLayer();
    this.removePrecipitationLayer();
    this.viewer?.destroy();
    this.viewer = undefined;
    this.fireDataSource = undefined;
    this.cesium = undefined;
  }

  private updateMapMarkers(): void {
    if (!this.viewer || !this.cesium || !this.fireDataSource || this.viewer.isDestroyed()) {
      return;
    }

    this.fireDataSource.show = this.isVisualizationEnabled('wildfires');
    this.fireDataSource.entities.removeAll();
    for (const fire of this.selectedMonthFires()) {
      this.fireDataSource.entities.add({
        id: fire.id,
        name: fire.title,
        position: this.cesium.Cartesian3.fromDegrees(fire.longitude, fire.latitude),
        point: {
          color: this.cesium.Color.fromCssColorString('#ff7548').withAlpha(0.94),
          outlineColor: this.cesium.Color.fromCssColorString('#ffd2a1'),
          outlineWidth: 2,
          pixelSize: new this.cesium.CallbackProperty(
            () => 8 + Math.sin(Date.now() / 250) * 2,
            false,
          ),
        },
      });
    }
  }

  private stopPlayback(): void {
    if (this.playInterval !== undefined) {
      window.clearInterval(this.playInterval);
      this.playInterval = undefined;
    }
    this.isPlaying.set(false);
  }
}

function isEonetResponse(value: unknown): value is { events: EonetEvent[] } {
  if (typeof value !== 'object' || value === null || !('events' in value)) {
    return false;
  }
  const events = value.events;
  return Array.isArray(events) && events.every(isEonetEvent);
}

function isEonetEvent(value: unknown): value is EonetEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'geometry' in value &&
    Array.isArray(value.geometry) &&
    value.geometry.every(isEonetGeometry)
  );
}

function isEonetGeometry(value: unknown): value is EonetGeometry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'date' in value &&
    typeof value.date === 'string' &&
    'type' in value &&
    typeof value.type === 'string' &&
    'coordinates' in value
  );
}

function positionsForGeometry(geometry: EonetGeometry): [number, number][] {
  if (geometry.type === 'Point') {
    const position = toPosition(geometry.coordinates);
    return position ? [position] : [];
  }

  if (geometry.type === 'MultiPoint' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map(toPosition)
      .filter((position): position is [number, number] => position !== undefined);
  }

  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    const center = ringCenter(geometry.coordinates[0]);
    return center ? [center] : [];
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map((polygon) =>
        Array.isArray(polygon) ? ringCenter(polygon[0]) : undefined,
      )
      .filter((position): position is [number, number] => position !== undefined);
  }

  return [];
}

function ringCenter(ring: unknown): [number, number] | undefined {
  if (!Array.isArray(ring)) {
    return undefined;
  }
  const positions = ring
    .map(toPosition)
    .filter((position): position is [number, number] => position !== undefined);
  if (positions.length === 0) {
    return undefined;
  }

  const longitude = positions.reduce((sum, position) => sum + position[0], 0) / positions.length;
  const latitude = positions.reduce((sum, position) => sum + position[1], 0) / positions.length;
  return [longitude, latitude];
}

function toPosition(value: unknown): [number, number] | undefined {
  if (
    !Array.isArray(value) ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    value[0] < -180 ||
    value[0] > 180 ||
    value[1] < -90 ||
    value[1] > 90
  ) {
    return undefined;
  }
  return [value[0], value[1]];
}
