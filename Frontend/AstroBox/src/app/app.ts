import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type * as Cesium from 'cesium';
import { BASEMAP_ATTRIBUTION, createBasemapProvider } from './basemap';
import { GibsImageryLayerController } from './gibs/gibs-layer-controller';
import {
  GIBS_LAND_SURFACE_TEMPERATURE_LAYER,
  GIBS_SEA_SURFACE_TEMPERATURE_ANOMALY_LAYER,
  toIsoDate,
} from './gibs/gibs-wms';
import { LayerPanelComponent, type LayerPanelOption } from './layer-panel/layer-panel';
import { Map2DComponent } from './map-2d/map-2d';
import type { FireObservation, VisualizationId } from './map.models';
import { windDateForMonth } from './wind/wind-field';
import { WindFieldStore } from './wind/wind-field.store';
import { WindLayerComponent } from './wind/wind-layer';
import { WIND_SPEED_COLORS } from './wind/wind-particle-renderer';
import { createCesiumProbeAdapter } from './zone-probe/cesium-probe-adapter';
import { SoundscapeService } from './zone-probe/soundscape/soundscape.service';
import { EnvironmentEffectsComponent } from './zone-probe/environment-effects/environment-effects';
import { MascotProbeComponent } from './zone-probe/mascot-probe/mascot-probe';
import type { MapProbeAdapter } from './zone-probe/zone-probe.models';
import { ZoneProbeStore } from './zone-probe/zone-probe.store';
import { ZoneStatusComponent } from './zone-probe/zone-status/zone-status';

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
}

type MapMode = '3d' | '2d';

const SURFACE_TEMPERATURE_SWATCH =
  'linear-gradient(90deg, #3a1c71, #2c7fb8, #7fcdbb, #ffffbf, #f46d43, #a50026)';
const WIND_SWATCH = `linear-gradient(90deg, ${WIND_SPEED_COLORS.map(({ color }) => color).join(', ')})`;
const SEA_TEMPERATURE_SWATCH = 'linear-gradient(90deg, #2c5fa8, #f1f1f1, #c62f2f)';
const PRECIPITATION_SWATCH = 'linear-gradient(90deg, #2968a8, #47c9d2, #b5f4e3)';
const WILDFIRE_SWATCH = '#ff8555';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Map2DComponent,
    LayerPanelComponent,
    MascotProbeComponent,
    ZoneStatusComponent,
    EnvironmentEffectsComponent,
    WindLayerComponent,
  ],
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
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
  private seaTemperatureController?: GibsImageryLayerController;
  private surfaceTemperatureController?: GibsImageryLayerController;
  private playInterval?: number;
  private destroyed = false;

  protected readonly months = this.createMonths();
  protected readonly mapMode = signal<MapMode>('3d');
  protected readonly basemapAttribution = BASEMAP_ATTRIBUTION;
  protected readonly mapModes: { id: MapMode; label: string }[] = [
    { id: '3d', label: '3D Globe' },
    { id: '2d', label: '2D Map' },
  ];
  protected readonly visualizations: VisualizationOption[] = [
    { id: 'wildfires', label: 'Wildfires' },
    { id: 'precipitation', label: 'Precipitation' },
    { id: 'surfaceTemperature', label: 'Surface temperature' },
    { id: 'seaTemperature', label: 'Sea temperature anomaly' },
    { id: 'wind', label: 'Wind' },
  ];
  /** The "Show on map" menu can be collapsed into a tab at the bottom of the map. */
  protected readonly layerPanelMinimized = signal(false);
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
  protected readonly surfaceTemperatureError = signal<string | null>(null);
  protected readonly seaTemperatureOpacity = signal(0.7);
  /** Date requested from GIBS for the selected month (see seaTemperatureDateForMonth). */
  protected readonly seaTemperatureDate = computed(() =>
    this.seaTemperatureDateForMonth(this.selectedMonth().key),
  );
  /** True while the guided El Niño story is running on the 2D map. */
  protected readonly storyActive = signal(false);

  /** Verny zone probe: shared state plus the adapter of whichever map is visible. */
  private readonly zoneProbe = inject(ZoneProbeStore);
  private readonly probeAdapter3d = signal<MapProbeAdapter | null>(null);
  private readonly probeAdapter2d = signal<MapProbeAdapter | null>(null);
  protected readonly probeAdapter = computed(() =>
    this.mapMode() === '3d' ? this.probeAdapter3d() : this.probeAdapter2d(),
  );
  private readonly probeContextSync = effect(() =>
    this.zoneProbe.setContext(this.selectedMonth().key, this.selectedMonthFires()),
  );

  /** Wind field shared by the wind layer on both maps. */
  private readonly windField = inject(WindFieldStore);
  protected readonly windDate = computed(() => windDateForMonth(this.selectedMonth().key));
  private readonly windFieldSync = effect(() => {
    if (this.isVisualizationEnabled('wind')) {
      this.windField.load(this.windDate());
    }
  });

  /** Procedural rain, wind and fire sounds for the zone under Verny. */
  protected readonly soundscape = inject(SoundscapeService);
  private readonly soundscapeSync = effect(() =>
    this.soundscape.setTargets(
      this.storyActive()
        ? { rain: 0, fire: 0, windSpeedMs: 0 }
        : this.zoneProbe.effectTargets(),
    ),
  );
  protected readonly sliderProgress = computed(
    () => (this.selectedMonthIndex() / (this.months.length - 1)) * 100,
  );
  protected readonly layerPanelOptions = computed<LayerPanelOption[]>(() => {
    const enabled = this.enabledVisualizations();
    const legends: Record<VisualizationId, { legend: string; swatch: string; error: string | null }> = {
      wildfires: {
        legend: 'Reported wildfire locations · NASA EONET',
        swatch: WILDFIRE_SWATCH,
        error: this.errorMessage(),
      },
      precipitation: {
        legend: `GPM IMERG precipitation rate · ${this.selectedMonth().key}-01`,
        swatch: PRECIPITATION_SWATCH,
        error: this.precipitationError(),
      },
      surfaceTemperature: {
        legend: `VIIRS land surface temperature (day) · ${this.seaTemperatureDate()} · land only`,
        swatch: SURFACE_TEMPERATURE_SWATCH,
        error: this.surfaceTemperatureError(),
      },
      wind: {
        legend:
          this.windField.status() === 'loading'
            ? 'Loading global wind field…'
            : `Open-Meteo ERA5 10 m wind · ${this.windDate()} 12:00 UTC · color = speed (calm → storm)`,
        swatch: WIND_SWATCH,
        error: this.windField.error(),
      },
      seaTemperature: {
        legend: `GHRSST anomaly · ${this.seaTemperatureDate()} · blue cooler, red warmer`,
        swatch: SEA_TEMPERATURE_SWATCH,
        error: this.seaTemperatureError(),
      },
    };
    return this.visualizations.map((visualization) => ({
      id: visualization.id,
      label: visualization.label,
      active: enabled.has(visualization.id),
      legend: legends[visualization.id].legend,
      legendSwatch: legends[visualization.id].swatch,
      error: legends[visualization.id].error,
    }));
  });
  /** Status line shown in the bottom hint bar. */
  protected readonly dataStatus = computed(() => {
    if (this.isLoading()) {
      return 'Loading NASA fire events…';
    }
    return this.errorMessage() ?? `${this.selectedMonth().label} ${this.selectedMonth().year}`;
  });

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

  protected selectMapMode(mode: MapMode): void {
    if (this.mapMode() === mode) {
      return;
    }
    this.seaTemperatureError.set(null);
    this.surfaceTemperatureError.set(null);

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

  protected onMap2DProbeAdapterChange(adapter: MapProbeAdapter | null): void {
    this.probeAdapter2d.set(adapter);
  }

  protected onMap2DSurfaceTemperatureError(message: string | null): void {
    this.surfaceTemperatureError.set(message);
  }

  protected onMap2DSeaTemperatureError(message: string | null): void {
    this.seaTemperatureError.set(message);
  }

  protected onSeaTemperatureOpacityChange(value: number): void {
    const opacity = Math.min(Math.max(value, 0), 1);
    this.seaTemperatureOpacity.set(opacity);
    this.seaTemperatureController?.setOpacity(opacity);
  }

  protected setLayerPanelMinimized(minimized: boolean): void {
    this.layerPanelMinimized.set(minimized);
  }

  /** Keyboard shortcuts shown in the hint bar: Q/E map mode, L layers, Space timeline. */
  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target;
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)))
    ) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'q':
        this.selectMapMode('3d');
        break;
      case 'e':
        this.selectMapMode('2d');
        break;
      case 'm':
        this.soundscape.toggle();
        break;
      case 'l':
        if (!this.storyActive()) {
          this.layerPanelMinimized.update((minimized) => !minimized);
        }
        break;
      case ' ':
        event.preventDefault();
        this.togglePlayback();
        break;
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
      // English place names (Esri); OpenStreetMap tiles use local-language labels.
      this.viewer.imageryLayers.addImageryProvider(createBasemapProvider(cesium));
      this.viewer.scene.globe.baseColor = cesium.Color.fromCssColorString('#102027');
      this.viewer.camera.setView({
        destination: cesium.Cartesian3.fromDegrees(-100, 25, 16_000_000),
      });
      this.probeAdapter3d.set(createCesiumProbeAdapter(cesium, this.viewer));
      this.fireDataSource = new cesium.CustomDataSource('Wildfires');
      void this.viewer.dataSources.add(this.fireDataSource);
      this.seaTemperatureController = new GibsImageryLayerController(cesium, this.viewer, {
        layer: GIBS_SEA_SURFACE_TEMPERATURE_ANOMALY_LAYER,
        credit: 'NASA JPL GHRSST MUR / NASA GIBS',
        label: 'Sea temperature anomaly',
        opacity: this.seaTemperatureOpacity(),
        onError: (message) => {
          if (!this.destroyed) {
            this.seaTemperatureError.set(message);
          }
        },
        // Keep precipitation readable above the ocean temperature layer.
        afterAdd: () => {
          if (this.precipitationLayer && this.viewer && !this.viewer.isDestroyed()) {
            this.viewer.imageryLayers.raiseToTop(this.precipitationLayer);
          }
        },
      });
      this.surfaceTemperatureController = new GibsImageryLayerController(cesium, this.viewer, {
        layer: GIBS_LAND_SURFACE_TEMPERATURE_LAYER,
        credit: 'NASA VIIRS NOAA-20 LST / NASA GIBS',
        label: 'Surface temperature',
        opacity: 0.75,
        onError: (message) => {
          if (!this.destroyed) {
            this.surfaceTemperatureError.set(message);
          }
        },
        afterAdd: () => {
          if (this.precipitationLayer && this.viewer && !this.viewer.isDestroyed()) {
            this.viewer.imageryLayers.raiseToTop(this.precipitationLayer);
          }
        },
      });
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
    if (this.isVisualizationEnabled('surfaceTemperature')) {
      this.surfaceTemperatureController?.show(this.seaTemperatureDate());
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
    if (this.isVisualizationEnabled('surfaceTemperature')) {
      this.surfaceTemperatureController?.show(this.seaTemperatureDate());
    } else {
      this.surfaceTemperatureController?.hide();
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
    this.seaTemperatureController?.show(date);
  }

  private removeSeaTemperatureLayer(): void {
    this.seaTemperatureController?.hide();
  }

  private destroy3DMap(): void {
    this.probeAdapter3d.set(null);
    this.removeSeaTemperatureLayer();
    this.seaTemperatureController = undefined;
    this.surfaceTemperatureController?.hide();
    this.surfaceTemperatureController = undefined;
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
