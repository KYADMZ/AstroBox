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
import { FireObservation } from '../map.models';
import { StoryPlayerService } from '../storytelling/story-player.service';
import type { StoryLifecycleEvent } from '../storytelling/story.models';
import { StoryMapDirector, type ToggleableMapItem } from './story-map-director';
import { StoryOverlayComponent } from './story-overlay/story-overlay';

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
  @Output() mapErrorChange = new EventEmitter<string | null>();
  @Output() precipitationErrorChange = new EventEmitter<string | null>();
  /** Re-emits every storytelling lifecycle event (for future mascot/audio integration). */
  @Output() storyEvent = new EventEmitter<StoryLifecycleEvent>();
  /** True while a guided story is playing or paused on the 2D map. */
  @Output() storyActiveChange = new EventEmitter<boolean>();

  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private cesium?: typeof Cesium;
  private viewer?: Cesium.Viewer;
  private fireDataSource?: Cesium.CustomDataSource;
  private precipitationLayer?: Cesium.ImageryLayer;
  private precipitationDate?: string;
  private precipitationRequestId = 0;
  private destroyed = false;
  private readonly storyPlayer = inject(StoryPlayerService);
  private storyDirector?: StoryMapDirector;
  /** Input changes received while a story is playing, applied once it ends. */
  private pendingFireSync = false;
  private pendingPrecipitationSync = false;

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
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    // Cancels any running story and restores the map before the viewer goes away.
    this.storyPlayer.detachStage();
    this.storyDirector = undefined;
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
      this.viewer.imageryLayers.addImageryProvider(
        new cesium.UrlTemplateImageryProvider({
          credit: '© OpenStreetMap contributors',
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        }),
      );
      this.viewer.scene.globe.baseColor = cesium.Color.fromCssColorString('#102027');
      this.viewer.camera.setView({
        destination: cesium.Rectangle.fromDegrees(-180, -80, 180, 80),
      });
      this.fireDataSource = new cesium.CustomDataSource('Wildfires');
      void this.viewer.dataSources.add(this.fireDataSource);
      this.updateFireMarkers();
      this.syncPrecipitationLayer();
      this.attachStoryDirector(cesium, this.viewer);
    } catch (error) {
      if (!this.destroyed) {
        console.error('Unable to initialize the Cesium 2D map.', error);
        this.mapErrorChange.emit('The 2D map could not be loaded.');
      }
    }
  }

  private attachStoryDirector(cesium: typeof Cesium, viewer: Cesium.Viewer): void {
    this.storyDirector = new StoryMapDirector(cesium, viewer, {
      getItemsToHide: () =>
        [this.fireDataSource, this.precipitationLayer].filter(
          (item): item is Cesium.CustomDataSource | Cesium.ImageryLayer => item !== undefined,
        ) as ToggleableMapItem[],
      onLayerError: (message) => this.storyPlayer.reportLayerError(message),
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
