import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  PLATFORM_ID,
  SimpleChanges,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type * as Cesium from 'cesium';
import { createBasemapProvider } from '../basemap';
import { GibsImageryLayerController } from '../gibs/gibs-layer-controller';
import {
  GIBS_LAND_SURFACE_TEMPERATURE_LAYER,
  GIBS_SEA_SURFACE_TEMPERATURE_ANOMALY_LAYER,
} from '../gibs/gibs-wms';
import { FireObservation } from '../map.models';
import { StoryPlayerService } from '../storytelling/story-player.service';
import type { StoryLifecycleEvent } from '../storytelling/story.models';
import { StoryMapDirector, type ToggleableMapItem } from './story-map-director';
import { StoryOverlayComponent } from './story-overlay/story-overlay';
import { createCesiumProbeAdapter } from '../zone-probe/cesium-probe-adapter';
import type { MapProbeAdapter } from '../zone-probe/zone-probe.models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StoryOverlayComponent],
  // The story player is scoped to the 2D map: storytelling never reaches the 3D globe.
  providers: [StoryPlayerService],
  selector: 'app-map-2d',
  styleUrl: './map-2d.scss',
  templateUrl: './map-2d.html',
})
export class Map2DComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() fires: FireObservation[] = [];
  @Input() monthKey = '';
  @Input() wildfiresEnabled = true;
  @Input() precipitationEnabled = false;
  @Input() seaTemperatureEnabled = false;
  /** ISO date requested from GIBS for the sea temperature anomaly layer. */
  @Input() seaTemperatureDate = '';
  @Input() seaTemperatureOpacity = 0.7;
  @Input() surfaceTemperatureEnabled = false;
  /** ISO date requested from GIBS for the land surface temperature layer. */
  @Input() surfaceTemperatureDate = '';
  @Output() mapErrorChange = new EventEmitter<string | null>();
  @Output() precipitationErrorChange = new EventEmitter<string | null>();
  @Output() seaTemperatureErrorChange = new EventEmitter<string | null>();
  @Output() surfaceTemperatureErrorChange = new EventEmitter<string | null>();
  /** Re-emits every storytelling lifecycle event (for future mascot/audio integration). */
  @Output() storyEvent = new EventEmitter<StoryLifecycleEvent>();
  /** True while a guided story is playing or paused on the 2D map. */
  @Output() storyActiveChange = new EventEmitter<boolean>();
  /** Lets the Verny zone probe pick and track places on this map. */
  @Output() probeAdapterChange = new EventEmitter<MapProbeAdapter | null>();

  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private cesium?: typeof Cesium;
  private viewer?: Cesium.Viewer;
  private fireDataSource?: Cesium.CustomDataSource;
  private precipitationLayer?: Cesium.ImageryLayer;
  private precipitationDate?: string;
  private precipitationRequestId = 0;
  private seaTemperatureController?: GibsImageryLayerController;
  private surfaceTemperatureController?: GibsImageryLayerController;
  private destroyed = false;
  private readonly storyPlayer = inject(StoryPlayerService);
  private storyDirector?: StoryMapDirector;
  /** Input changes received while a story is playing, applied once it ends. */
  private pendingFireSync = false;
  private pendingPrecipitationSync = false;
  private pendingSeaTemperatureSync = false;
  private pendingSurfaceTemperatureSync = false;

  constructor() {
    this.storyPlayer.events$
      .pipe(takeUntilDestroyed())
      .subscribe((event) => this.onStoryEvent(event));
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.browser) {
      return;
    }

    await this.initializeMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // While a story plays, the storytelling controller owns the map. Defer
    // regular layer updates and apply them when the story ends.
    const storyActive = this.storyPlayer.isActive();
    if (changes['fires'] || changes['wildfiresEnabled']) {
      if (storyActive) {
        this.pendingFireSync = true;
      } else {
        this.updateFireMarkers();
      }
    }
    if (
      changes['monthKey'] ||
      changes['precipitationEnabled']
    ) {
      if (storyActive) {
        this.pendingPrecipitationSync = true;
      } else {
        this.syncPrecipitationLayer();
      }
    }
    if (changes['seaTemperatureOpacity']) {
      this.seaTemperatureController?.setOpacity(this.seaTemperatureOpacity);
    }
    if (changes['seaTemperatureEnabled'] || changes['seaTemperatureDate']) {
      if (storyActive) {
        this.pendingSeaTemperatureSync = true;
      } else {
        this.syncSeaTemperatureLayer();
      }
    }
    if (changes['surfaceTemperatureEnabled'] || changes['surfaceTemperatureDate']) {
      if (storyActive) {
        this.pendingSurfaceTemperatureSync = true;
      } else {
        this.syncSurfaceTemperatureLayer();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    // Cancels any running story and restores the map before the viewer goes away.
    this.storyPlayer.detachStage();
    this.probeAdapterChange.emit(null);
    this.storyDirector = undefined;
    this.seaTemperatureController?.hide();
    this.surfaceTemperatureController?.hide();
    this.removePrecipitationLayer();
    this.viewer?.destroy();
  }

  private async initializeMap(): Promise<void> {
    try {
      (globalThis as typeof globalThis & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL =
        '/assets/cesium/';
      const cesium = await import('cesium');
      if (this.destroyed) {
        return;
      }

      const container =
        this.host.nativeElement.querySelector<HTMLElement>('.map-2d-container');
      if (!container) {
        throw new Error('The 2D map container is unavailable.');
      }

      this.cesium = cesium;
      this.viewer = new cesium.Viewer(container, {
        animation: false,
        baseLayer: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneMode: cesium.SceneMode.SCENE2D,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
      });
      // English place names (Esri); OpenStreetMap tiles use local-language labels.
      this.viewer.imageryLayers.addImageryProvider(createBasemapProvider(cesium));
      const globe = this.viewer.scene.globe;
      globe.baseColor = cesium.Color.fromCssColorString('#161a2c');
      // Smoother guided camera moves: keep more tiles cached and preload neighbors.
      globe.tileCacheSize = 400;
      globe.preloadSiblings = true;
      this.viewer.camera.setView({
        destination: cesium.Rectangle.fromDegrees(-180, -80, 180, 80),
      });
      this.fireDataSource = new cesium.CustomDataSource('Wildfires');
      void this.viewer.dataSources.add(this.fireDataSource);
      this.seaTemperatureController = new GibsImageryLayerController(cesium, this.viewer, {
        layer: GIBS_SEA_SURFACE_TEMPERATURE_ANOMALY_LAYER,
        credit: 'NASA JPL GHRSST MUR / NASA GIBS',
        label: 'Sea temperature anomaly',
        opacity: this.seaTemperatureOpacity,
        onError: (message) => {
          if (!this.destroyed) {
            this.seaTemperatureErrorChange.emit(message);
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
            this.surfaceTemperatureErrorChange.emit(message);
          }
        },
        afterAdd: () => {
          if (this.precipitationLayer && this.viewer && !this.viewer.isDestroyed()) {
            this.viewer.imageryLayers.raiseToTop(this.precipitationLayer);
          }
        },
      });
      this.updateFireMarkers();
      this.syncPrecipitationLayer();
      this.syncSeaTemperatureLayer();
      this.syncSurfaceTemperatureLayer();
      this.attachStoryDirector(cesium, this.viewer);
      this.probeAdapterChange.emit(createCesiumProbeAdapter(cesium, this.viewer));
    } catch (error) {
      if (!this.destroyed) {
        console.error('Unable to initialize the Cesium 2D map.', error);
        this.mapErrorChange.emit('The 2D map could not be loaded.');
      }
    }
  }

  private attachStoryDirector(cesium: typeof Cesium, viewer: Cesium.Viewer): void {
    const labelHost = this.host.nativeElement.querySelector<HTMLElement>('.story-label-layer');
    if (!labelHost) {
      throw new Error('The story label layer is unavailable.');
    }
    this.storyDirector = new StoryMapDirector(cesium, viewer, {
      getItemsToHide: () =>
        [
          this.fireDataSource,
          this.precipitationLayer,
          this.seaTemperatureController?.imageryLayer,
          this.surfaceTemperatureController?.imageryLayer,
        ].filter(
          (item): item is Cesium.CustomDataSource | Cesium.ImageryLayer => item !== undefined,
        ) as ToggleableMapItem[],
      onLayerError: (message) => this.storyPlayer.reportLayerError(message),
      labelHost,
    });
    this.storyPlayer.attachStage(this.storyDirector);
  }

  private onStoryEvent(event: StoryLifecycleEvent): void {
    this.storyEvent.emit(event);
    if (event.type === 'storyStarted') {
      this.storyActiveChange.emit(true);
      return;
    }
    if (event.type === 'storyCompleted' || event.type === 'storyCancelled') {
      this.storyActiveChange.emit(false);
      this.applyPendingSync();
    }
  }

  private applyPendingSync(): void {
    if (this.destroyed) {
      return;
    }
    if (this.pendingFireSync) {
      this.pendingFireSync = false;
      this.updateFireMarkers();
    }
    if (this.pendingPrecipitationSync) {
      this.pendingPrecipitationSync = false;
      this.syncPrecipitationLayer();
    }
    if (this.pendingSeaTemperatureSync) {
      this.pendingSeaTemperatureSync = false;
      this.syncSeaTemperatureLayer();
    }
    if (this.pendingSurfaceTemperatureSync) {
      this.pendingSurfaceTemperatureSync = false;
      this.syncSurfaceTemperatureLayer();
    }
  }

  private syncSurfaceTemperatureLayer(): void {
    if (!this.surfaceTemperatureController) {
      return;
    }
    if (this.surfaceTemperatureEnabled && this.surfaceTemperatureDate) {
      this.surfaceTemperatureController.show(this.surfaceTemperatureDate);
    } else {
      this.surfaceTemperatureController.hide();
    }
  }

  private syncSeaTemperatureLayer(): void {
    if (!this.seaTemperatureController) {
      return;
    }
    if (this.seaTemperatureEnabled && this.seaTemperatureDate) {
      this.seaTemperatureController.show(this.seaTemperatureDate);
    } else {
      this.seaTemperatureController.hide();
    }
  }

  private updateFireMarkers(): void {
    if (
      !this.viewer ||
      !this.cesium ||
      !this.fireDataSource ||
      this.viewer.isDestroyed()
    ) {
      return;
    }

    this.fireDataSource.show = this.wildfiresEnabled;
    this.fireDataSource.entities.removeAll();
    for (const fire of this.fires) {
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

  private syncPrecipitationLayer(): void {
    if (!this.viewer || this.viewer.isDestroyed() || !this.precipitationEnabled) {
      this.removePrecipitationLayer();
      return;
    }
    if (this.monthKey) {
      this.loadPrecipitation(`${this.monthKey}-01`);
    }
  }

  private loadPrecipitation(date: string): void {
    if (
      !this.viewer ||
      !this.cesium ||
      this.viewer.isDestroyed() ||
      (this.precipitationLayer && this.precipitationDate === date)
    ) {
      return;
    }

    this.removePrecipitationLayer();
    const requestId = this.precipitationRequestId;
    this.precipitationErrorChange.emit(null);
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
        console.error('Unable to load precipitation on the 2D map.', error);
        this.precipitationErrorChange.emit(
          'NASA precipitation imagery is unavailable for this date.',
        );
      });

      this.precipitationLayer = this.viewer.imageryLayers.addImageryProvider(provider);
      this.precipitationLayer.alpha = 0.75;
      this.precipitationDate = date;
    } catch (error) {
      console.error('Unable to create the 2D precipitation layer.', error);
      this.precipitationErrorChange.emit(
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
    this.precipitationErrorChange.emit(null);
  }
}
