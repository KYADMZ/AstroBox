import type * as Cesium from 'cesium';
import { createGibsWmsProvider } from '../gibs/gibs-wms';
import type {
  CameraDestination,
  CameraOrientation,
  LonLat,
  StoryDefinition,
  StoryLayerId,
  StoryScene,
  StoryStage,
  StoryVisualElement,
} from '../storytelling/story.models';

/** Anything on the map whose visibility can be toggled (data sources, imagery layers). */
export interface ToggleableMapItem {
  show: boolean;
}

export interface StoryMapDirectorOptions {
  /** Existing 2D map content to hide while the story plays and restore afterwards. */
  getItemsToHide: () => ToggleableMapItem[];
  /** Called when a story data layer cannot be loaded (null clears the message). */
  onLayerError: (message: string | null) => void;
}

interface CameraSnapshot {
  position: Cesium.Cartesian3;
  direction: Cesium.Cartesian3;
  up: Cesium.Cartesian3;
  right: Cesium.Cartesian3;
  frustum?: { left: number; right: number; top: number; bottom: number };
  rectangle?: Cesium.Rectangle;
}

interface MapSnapshot {
  camera: CameraSnapshot;
  enableInputs: boolean;
  doubleClickAction?: Cesium.ScreenSpaceEventHandler.PositionedEventCallback;
  hiddenItems: { item: ToggleableMapItem; show: boolean }[];
}

interface CameraFlight {
  destination: CameraDestination;
  orientation?: CameraOrientation;
}

const RESUME_FLIGHT_SECONDS = 1.2;
const OUTLINE_STEP_DEGREES = 5;

/**
 * Renders a story on the existing Cesium 2D viewer.
 *
 * It reuses the 2D map's viewer (no new viewer is created), takes exclusive
 * control of the camera while a story plays, and restores the camera,
 * controls and previously visible layers when the story ends.
 */
export class StoryMapDirector implements StoryStage {
  private snapshot?: MapSnapshot;
  private story?: StoryDefinition;
  private dataSource?: Cesium.CustomDataSource;
  private readonly layers = new Map<StoryLayerId, Cesium.ImageryLayer>();
  private readonly layerOpacity = new Map<StoryLayerId, number>();
  private readonly visibleElements = new Map<string, Cesium.Entity>();
  private readonly appliedWaypoints = new Set<number>();
  private activeFlight?: CameraFlight;
  private flightInterrupted = false;
  private layerGeneration = 0;

  constructor(
    private readonly cesium: typeof Cesium,
    private readonly viewer: Cesium.Viewer,
    private readonly options: StoryMapDirectorOptions,
  ) {}

  begin(story: StoryDefinition): void {
    if (this.viewer.isDestroyed()) {
      return;
    }
    if (this.snapshot) {
      // A previous story was not ended properly: restore it first.
      this.end();
    }

    this.story = story;
    this.layerOpacity.clear();
    for (const layer of Object.values(story.layers)) {
      this.layerOpacity.set(layer.id, layer.opacity);
    }

    const { ScreenSpaceEventType } = this.cesium;
    const eventHandler = this.viewer.cesiumWidget.screenSpaceEventHandler;
    const controller = this.viewer.scene.screenSpaceCameraController;
    const hiddenItems = this.options.getItemsToHide().map((item) => ({ item, show: item.show }));

    this.snapshot = {
      camera: this.captureCamera(),
      enableInputs: controller.enableInputs,
      doubleClickAction: eventHandler.getInputAction(
        ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      ) as Cesium.ScreenSpaceEventHandler.PositionedEventCallback | undefined,
      hiddenItems,
    };

    // Lock manual navigation: the story controller owns the camera.
    controller.enableInputs = false;
    eventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    this.viewer.trackedEntity = undefined;
    this.viewer.selectedEntity = undefined;

    for (const { item } of hiddenItems) {
      item.show = false;
    }

    this.dataSource = new this.cesium.CustomDataSource(`${story.id}-story`);
    void this.viewer.dataSources.add(this.dataSource);
  }

  enterScene(scene: StoryScene): void {
    if (this.viewer.isDestroyed()) {
      return;
    }
    this.appliedWaypoints.clear();
    this.flightInterrupted = false;
    this.syncLayers(scene.enabledLayers);
    this.flyTo(
      { destination: scene.cameraDestination, orientation: scene.cameraOrientation },
      scene.cameraFlightSeconds,
    );
  }

  update(scene: StoryScene, sceneElapsedMs: number): void {
    if (this.viewer.isDestroyed()) {
      return;
    }

    scene.cameraWaypoints?.forEach((waypoint, index) => {
      if (!this.appliedWaypoints.has(index) && sceneElapsedMs >= waypoint.atMs) {
        this.appliedWaypoints.add(index);
        this.flyTo(
          { destination: waypoint.destination, orientation: waypoint.orientation },
          waypoint.flightSeconds,
        );
      }
    });

    for (const element of scene.visualElements) {
      const appearAt = element.appearAtMs ?? 0;
      const disappearAt = element.disappearAtMs ?? Number.POSITIVE_INFINITY;
      const shouldShow = sceneElapsedMs >= appearAt && sceneElapsedMs < disappearAt;
      const entity = this.visibleElements.get(element.id);

      if (shouldShow && !entity) {
        const created = this.createEntity(element);
        if (created) {
          this.visibleElements.set(element.id, created);
        }
      } else if (!shouldShow && entity) {
        this.dataSource?.entities.remove(entity);
        this.visibleElements.delete(element.id);
      }
    }
  }

  exitScene(): void {
    this.dataSource?.entities.removeAll();
    this.visibleElements.clear();
    this.appliedWaypoints.clear();
  }

  pause(): void {
    if (this.viewer.isDestroyed()) {
      return;
    }
    if (this.activeFlight) {
      this.flightInterrupted = true;
      this.viewer.camera.cancelFlight();
    }
  }

  resume(): void {
    if (this.viewer.isDestroyed() || !this.flightInterrupted || !this.activeFlight) {
      this.flightInterrupted = false;
      return;
    }
    this.flightInterrupted = false;
    this.flyTo(this.activeFlight, RESUME_FLIGHT_SECONDS);
  }

  end(): void {
    const snapshot = this.snapshot;
    this.snapshot = undefined;
    this.activeFlight = undefined;
    this.flightInterrupted = false;
    this.visibleElements.clear();
    this.appliedWaypoints.clear();
    this.removeAllLayers();
    this.options.onLayerError(null);

    if (this.viewer.isDestroyed()) {
      this.dataSource = undefined;
      return;
    }

    this.viewer.camera.cancelFlight();
    if (this.dataSource) {
      this.viewer.dataSources.remove(this.dataSource, true);
      this.dataSource = undefined;
    }
    if (!snapshot) {
      return;
    }

    for (const { item, show } of snapshot.hiddenItems) {
      item.show = show;
    }
    this.viewer.scene.screenSpaceCameraController.enableInputs = snapshot.enableInputs;
    if (snapshot.doubleClickAction) {
      this.viewer.cesiumWidget.screenSpaceEventHandler.setInputAction(
        snapshot.doubleClickAction,
        this.cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      );
    }
    this.restoreCamera(snapshot.camera);
  }

  setLayerOpacity(layerId: StoryLayerId, opacity: number): void {
    const alpha = Math.min(Math.max(opacity, 0), 1);
    this.layerOpacity.set(layerId, alpha);
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.alpha = alpha;
    }
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  private flyTo(flight: CameraFlight, durationSeconds: number): void {
    const { cesium } = this;
    this.activeFlight = flight;
    const orientation = flight.orientation
      ? {
          heading: cesium.Math.toRadians(flight.orientation.heading),
          pitch: cesium.Math.toRadians(flight.orientation.pitch),
          roll: cesium.Math.toRadians(flight.orientation.roll),
        }
      : undefined;

    this.viewer.camera.flyTo({
      destination: this.toCesiumDestination(flight.destination),
      orientation,
      duration: durationSeconds,
      easingFunction: cesium.EasingFunction.QUADRATIC_IN_OUT,
      complete: () => {
        if (this.activeFlight === flight) {
          this.activeFlight = undefined;
        }
      },
    });
  }

  private toCesiumDestination(
    destination: CameraDestination,
  ): Cesium.Rectangle | Cesium.Cartesian3 {
    if (destination.kind === 'rectangle') {
      return this.cesium.Rectangle.fromDegrees(
        destination.west,
        destination.south,
        destination.east,
        destination.north,
      );
    }
    return this.cesium.Cartesian3.fromDegrees(
      destination.longitude,
      destination.latitude,
      destination.height,
    );
  }

  private captureCamera(): CameraSnapshot {
    const camera = this.viewer.camera;
    const frustum = camera.frustum;
    let frustumBounds: CameraSnapshot['frustum'];
    if (frustum instanceof this.cesium.OrthographicOffCenterFrustum) {
      const { left, right, top, bottom } = frustum;
      if (left !== undefined && right !== undefined && top !== undefined && bottom !== undefined) {
        frustumBounds = { left, right, top, bottom };
      }
    }
    return {
      position: camera.position.clone(),
      direction: camera.direction.clone(),
      up: camera.up.clone(),
      right: camera.right.clone(),
      frustum: frustumBounds,
      rectangle: camera.computeViewRectangle(),
    };
  }

  private restoreCamera(snapshot: CameraSnapshot): void {
    const camera = this.viewer.camera;
    const frustum = camera.frustum;

    if (snapshot.frustum && frustum instanceof this.cesium.OrthographicOffCenterFrustum) {
      this.cesium.Cartesian3.clone(snapshot.position, camera.position);
      this.cesium.Cartesian3.clone(snapshot.direction, camera.direction);
      this.cesium.Cartesian3.clone(snapshot.up, camera.up);
      this.cesium.Cartesian3.clone(snapshot.right, camera.right);
      frustum.left = snapshot.frustum.left;
      frustum.right = snapshot.frustum.right;
      frustum.top = snapshot.frustum.top;
      frustum.bottom = snapshot.frustum.bottom;
      return;
    }

    camera.setView({
      destination: snapshot.rectangle ?? this.cesium.Rectangle.fromDegrees(-180, -80, 180, 80),
    });
  }

  // ---------------------------------------------------------------------------
  // Data layers (observed NASA GIBS imagery)
  // ---------------------------------------------------------------------------

  private syncLayers(enabled: readonly StoryLayerId[]): void {
    for (const [id, layer] of this.layers) {
      if (!enabled.includes(id)) {
        this.viewer.imageryLayers.remove(layer, true);
        this.layers.delete(id);
      }
    }

    for (const id of enabled) {
      if (!this.layers.has(id)) {
        this.addLayer(id);
      }
    }
  }

  private addLayer(id: StoryLayerId): void {
    const definition = this.story?.layers[id];
    if (!definition) {
      return;
    }

    const generation = this.layerGeneration;
    try {
      const provider = createGibsWmsProvider(this.cesium, {
        layer: definition.gibsLayer,
        time: definition.date,
        credit: definition.credit,
      });
      provider.errorEvent.addEventListener((error) => {
        if (generation !== this.layerGeneration || !this.layers.has(id)) {
          return;
        }
        console.error(`Unable to load story layer "${definition.gibsLayer}".`, error);
        this.options.onLayerError(
          `${definition.label} is unavailable for ${definition.date}. The story continues without it.`,
        );
      });

      const layer = this.viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = this.layerOpacity.get(id) ?? definition.opacity;
      this.layers.set(id, layer);
    } catch (error) {
      console.error(`Unable to create story layer "${definition.gibsLayer}".`, error);
      this.options.onLayerError(`${definition.label} could not be loaded.`);
    }
  }

  private removeAllLayers(): void {
    this.layerGeneration += 1;
    if (!this.viewer.isDestroyed()) {
      for (const layer of this.layers.values()) {
        this.viewer.imageryLayers.remove(layer, true);
      }
    }
    this.layers.clear();
  }

  // ---------------------------------------------------------------------------
  // Visual elements
  // ---------------------------------------------------------------------------

  private createEntity(element: StoryVisualElement): Cesium.Entity | undefined {
    if (!this.dataSource) {
      return undefined;
    }

    const { cesium } = this;
    const color = cesium.Color.fromCssColorString(element.color);
    const illustrative = element.nature === 'illustrative';
    const outlineMaterial = illustrative
      ? new cesium.PolylineDashMaterialProperty({ color, dashLength: 14 })
      : new cesium.ColorMaterialProperty(color);

    switch (element.type) {
      case 'highlightArea': {
        const outline = this.rectangleOutline(
          element.west,
          element.south,
          element.east,
          element.north,
        );
        return this.dataSource.entities.add({
          id: element.id,
          name: element.caption,
          rectangle: {
            coordinates: cesium.Rectangle.fromDegrees(
              element.west,
              element.south,
              element.east,
              element.north,
            ),
            height: 0,
            material: this.fillMaterial(color, element.pulse ?? false),
          },
          polyline: {
            positions: cesium.Cartesian3.fromDegreesArray(outline.flat()),
            width: 2,
            arcType: cesium.ArcType.RHUMB,
            material: outlineMaterial,
          },
        });
      }
      case 'zone': {
        const closed = [...element.outline, element.outline[0]];
        return this.dataSource.entities.add({
          id: element.id,
          name: element.caption,
          polygon: {
            hierarchy: new cesium.PolygonHierarchy(
              cesium.Cartesian3.fromDegreesArray(element.outline.flat()),
            ),
            height: 0,
            material: this.fillMaterial(color, element.pulse ?? false),
          },
          polyline: {
            positions: cesium.Cartesian3.fromDegreesArray(closed.flat()),
            width: 2,
            arcType: cesium.ArcType.RHUMB,
            material: outlineMaterial,
          },
        });
      }
      case 'arrow':
        return this.dataSource.entities.add({
          id: element.id,
          name: element.caption,
          polyline: {
            positions: cesium.Cartesian3.fromDegreesArray(element.path.flat()),
            width: element.width ?? 12,
            arcType: cesium.ArcType.RHUMB,
            material: new cesium.PolylineArrowMaterialProperty(color),
          },
        });
      case 'label':
        return this.dataSource.entities.add({
          id: element.id,
          name: element.text,
          position: cesium.Cartesian3.fromDegrees(element.position[0], element.position[1]),
          label: this.labelGraphics(element.text, color, illustrative),
        });
      case 'marker':
        return this.dataSource.entities.add({
          id: element.id,
          name: element.text,
          position: cesium.Cartesian3.fromDegrees(element.position[0], element.position[1]),
          point: {
            pixelSize: 10,
            color,
            outlineColor: cesium.Color.WHITE,
            outlineWidth: 2,
          },
          label: {
            ...this.labelGraphics(element.text, cesium.Color.WHITE, illustrative),
            pixelOffset: new cesium.Cartesian2(0, -20),
          },
        });
    }
  }

  private labelGraphics(
    text: string,
    color: Cesium.Color,
    illustrative: boolean,
  ): Cesium.LabelGraphics.ConstructorOptions {
    const { cesium } = this;
    return {
      text,
      font: `${illustrative ? 'italic ' : ''}600 13px Inter, "Segoe UI", sans-serif`,
      fillColor: color,
      outlineColor: cesium.Color.fromCssColorString('#0e1719'),
      outlineWidth: 3,
      style: cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: cesium.Color.fromCssColorString('#111a1d').withAlpha(0.72),
      backgroundPadding: new cesium.Cartesian2(8, 5),
      horizontalOrigin: cesium.HorizontalOrigin.CENTER,
      verticalOrigin: cesium.VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
  }

  private fillMaterial(color: Cesium.Color, pulse: boolean): Cesium.ColorMaterialProperty {
    const { cesium } = this;
    if (!pulse) {
      return new cesium.ColorMaterialProperty(color.withAlpha(0.2));
    }
    const scratch = new cesium.Color();
    return new cesium.ColorMaterialProperty(
      new cesium.CallbackProperty(
        () => color.withAlpha(0.16 + 0.12 * (0.5 + 0.5 * Math.sin(Date.now() / 450)), scratch),
        false,
      ),
    );
  }

  /** Densified rectangle outline that also works across the antimeridian. */
  private rectangleOutline(west: number, south: number, east: number, north: number): LonLat[] {
    const adjustedEast = east < west ? east + 360 : east;
    const longitudes: number[] = [];
    for (let lon = west; lon < adjustedEast; lon += OUTLINE_STEP_DEGREES) {
      longitudes.push(lon);
    }
    longitudes.push(adjustedEast);
    const normalize = (lon: number): number => (lon > 180 ? lon - 360 : lon);

    return [
      ...longitudes.map((lon): LonLat => [normalize(lon), north]),
      ...[...longitudes].reverse().map((lon): LonLat => [normalize(lon), south]),
      [normalize(longitudes[0]), north],
    ];
  }
}
