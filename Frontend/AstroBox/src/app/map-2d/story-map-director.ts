import type * as Cesium from 'cesium';
import { createClimateZoneImageryProvider } from '../climate-zones';
import { createGibsWmsProvider } from '../gibs/gibs-wms';
import { createStoryIcon, type StoryIconId } from '../storytelling/story-icons';
import type {
  CameraDestination,
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
  /** Element above the map canvas where HTML story labels are placed. */
  labelHost: HTMLElement;
}

/** A camera view in degrees: center plus visible extent. */
interface ViewBox {
  lon: number;
  lat: number;
  width: number;
  height: number;
}

interface CameraTween {
  from: ViewBox;
  to: ViewBox;
  /** Scene time (ms) when the move starts. */
  startMs: number;
  durationMs: number;
}

interface CameraSnapshot {
  position: Cesium.Cartesian3;
  direction: Cesium.Cartesian3;
  up: Cesium.Cartesian3;
  right: Cesium.Cartesian3;
  frustum?: { left: number; right: number; top: number; bottom: number };
  box: ViewBox;
}

interface MapSnapshot {
  camera: CameraSnapshot;
  enableInputs: boolean;
  doubleClickAction?: Cesium.ScreenSpaceEventHandler.PositionedEventCallback;
  hiddenItems: { item: ToggleableMapItem; show: boolean }[];
}

interface StoryLayerState {
  layer: Cesium.ImageryLayer;
  target: number;
}

/** A visual element currently on the map (or fading out). */
interface ElementState {
  element: StoryVisualElement;
  bornAt: number;
  leaveAt?: number;
  entity?: Cesium.Entity;
  label?: HTMLElement;
  labelPosition?: Cesium.Cartesian3;
  labelOffsetY: number;
}

/** Meters of the geographic 2D projection per degree of longitude. */
const METERS_PER_DEGREE = (Math.PI / 180) * 6_378_137;
const ELEMENT_FADE_MS = 450;
/** Imagery layers fade fully in or out in about 0.7 s. */
const LAYER_FADE_PER_MS = 1 / 700;
const RESTORE_FLIGHT_SECONDS = 1;
const OUTLINE_STEP_DEGREES = 5;
const MARKER_LABEL_OFFSET_PX = -24;

/**
 * Renders a story on the existing Cesium 2D viewer.
 *
 * Smoothness
 * - The camera is driven frame by frame from story time (no chained
 *   `flyTo` calls): moves use a smootherstep curve, zoom is interpolated
 *   logarithmically, and long jumps get a gentle zoom-out arc. Pausing
 *   simply freezes story time, so there is nothing to cancel or re-fly.
 * - All story imagery layers are created (transparent) when the story starts,
 *   so their tiles load early; scenes then fade them in and out.
 * - Annotations fade in and out instead of popping.
 *
 * Labels are HTML elements positioned over the map after each render, which
 * allows the neon interface style used by the rest of the app.
 */
export class StoryMapDirector implements StoryStage {
  private snapshot?: MapSnapshot;
  private story?: StoryDefinition;
  private dataSource?: Cesium.CustomDataSource;
  private readonly layers = new Map<StoryLayerId, StoryLayerState>();
  private readonly layerOpacity = new Map<StoryLayerId, number>();
  private readonly visibleElements = new Map<string, ElementState>();
  private readonly leavingElements: ElementState[] = [];
  private readonly appliedWaypoints = new Set<number>();
  private tween?: CameraTween;
  private currentBox?: ViewBox;
  private removePostRender?: () => void;
  private lastPostRenderAt?: number;
  private layerGeneration = 0;
  private currentScene?: StoryScene;
  private readonly scratchWindow: Cesium.Cartesian2;

  constructor(
    private readonly cesium: typeof Cesium,
    private readonly viewer: Cesium.Viewer,
    private readonly options: StoryMapDirectorOptions,
  ) {
    this.scratchWindow = new cesium.Cartesian2();
  }

  begin(story: StoryDefinition): void {
    if (this.viewer.isDestroyed()) {
      return;
    }
    if (this.snapshot) {
      this.end();
    }

    this.story = story;
    const { ScreenSpaceEventType } = this.cesium;
    const eventHandler = this.viewer.cesiumWidget.screenSpaceEventHandler;
    const controller = this.viewer.scene.screenSpaceCameraController;
    const hiddenItems = this.options.getItemsToHide().map((item) => ({ item, show: item.show }));

    this.viewer.camera.cancelFlight();
    this.snapshot = {
      camera: this.captureCamera(),
      enableInputs: controller.enableInputs,
      doubleClickAction: eventHandler.getInputAction(
        ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      ) as Cesium.ScreenSpaceEventHandler.PositionedEventCallback | undefined,
      hiddenItems,
    };
    this.currentBox = { ...this.snapshot.camera.box };

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

    this.layerOpacity.clear();
    for (const definition of Object.values(story.layers)) {
      if (!definition) {
        continue;
      }
      this.layerOpacity.set(definition.id, definition.opacity);
      this.preloadLayer(definition.id);
    }

    this.lastPostRenderAt = undefined;
    this.removePostRender = this.viewer.scene.postRender.addEventListener(this.onPostRender);
  }

  enterScene(scene: StoryScene): void {
    if (this.viewer.isDestroyed()) {
      return;
    }
    this.appliedWaypoints.clear();
    this.currentScene = scene;
    for (const [id, state] of this.layers) {
      state.target = this.targetOpacity(id);
    }
    this.startCameraMove(scene.cameraDestination, 0, scene.cameraFlightSeconds * 1000);
  }

  update(scene: StoryScene, sceneElapsedMs: number): void {
    if (this.viewer.isDestroyed()) {
      return;
    }

    scene.cameraWaypoints?.forEach((waypoint, index) => {
      if (!this.appliedWaypoints.has(index) && sceneElapsedMs >= waypoint.atMs) {
        this.appliedWaypoints.add(index);
        this.startCameraMove(waypoint.destination, waypoint.atMs, waypoint.flightSeconds * 1000);
      }
    });
    this.applyCamera(sceneElapsedMs);

    for (const element of scene.visualElements) {
      const appearAt = element.appearAtMs ?? 0;
      const disappearAt = element.disappearAtMs ?? Number.POSITIVE_INFINITY;
      const shouldShow = sceneElapsedMs >= appearAt && sceneElapsedMs < disappearAt;
      const state = this.visibleElements.get(element.id);

      if (shouldShow && !state) {
        this.visibleElements.set(element.id, this.createElement(element));
      } else if (!shouldShow && state) {
        this.beginLeaving(state);
      }
    }
  }

  exitScene(): void {
    for (const state of [...this.visibleElements.values()]) {
      this.beginLeaving(state);
    }
    this.appliedWaypoints.clear();
  }

  pause(): void {
    // Camera and element timing follow story time, so nothing to cancel.
  }

  resume(): void {
    // Story time continues from where it stopped.
  }

  end(): void {
    const snapshot = this.snapshot;
    this.snapshot = undefined;
    this.currentScene = undefined;
    this.tween = undefined;
    this.currentBox = undefined;
    this.removePostRender?.();
    this.removePostRender = undefined;
    for (const state of [...this.visibleElements.values(), ...this.leavingElements]) {
      this.removeElement(state);
    }
    this.visibleElements.clear();
    this.leavingElements.length = 0;
    this.appliedWaypoints.clear();
    this.removeAllLayers();
    this.options.onLayerError(null);

    if (this.viewer.isDestroyed()) {
      this.dataSource = undefined;
      return;
    }

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
    const state = this.layers.get(layerId);
    if (state && state.target > 0) {
      state.target = alpha;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame work after Cesium renders (runs while playing and while paused)
  // ---------------------------------------------------------------------------

  private readonly onPostRender = (): void => {
    const now = performance.now();
    const delta =
      this.lastPostRenderAt === undefined ? 16 : Math.min(now - this.lastPostRenderAt, 100);
    this.lastPostRenderAt = now;

    this.fadeLayers(delta);
    this.positionLabels();
    this.purgeLeavingElements(now);
  };

  private fadeLayers(delta: number): void {
    const step = delta * LAYER_FADE_PER_MS;
    for (const state of this.layers.values()) {
      const current = state.layer.alpha;
      if (current !== state.target) {
        const difference = state.target - current;
        state.layer.alpha =
          Math.abs(difference) <= step ? state.target : current + Math.sign(difference) * step;
      }
    }
  }

  private positionLabels(): void {
    const scene = this.viewer.scene;
    const states = [...this.visibleElements.values(), ...this.leavingElements];
    for (const state of states) {
      if (!state.label || !state.labelPosition) {
        continue;
      }
      const windowPosition = this.cesium.SceneTransforms.worldToWindowCoordinates(
        scene,
        state.labelPosition,
        this.scratchWindow,
      );
      if (!windowPosition) {
        state.label.classList.add('is-hidden');
        continue;
      }
      state.label.classList.remove('is-hidden');
      state.label.style.transform = `translate3d(${windowPosition.x}px, ${
        windowPosition.y + state.labelOffsetY
      }px, 0) translate(-50%, -50%)`;
    }
  }

  private purgeLeavingElements(now: number): void {
    for (let index = this.leavingElements.length - 1; index >= 0; index -= 1) {
      const state = this.leavingElements[index];
      if (state.leaveAt !== undefined && now - state.leaveAt >= ELEMENT_FADE_MS) {
        this.removeElement(state);
        this.leavingElements.splice(index, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  private startCameraMove(
    destination: CameraDestination,
    startMs: number,
    durationMs: number,
  ): void {
    this.tween = {
      from: { ...(this.currentBox ?? this.captureCamera().box) },
      to: this.toViewBox(destination),
      startMs,
      durationMs: Math.max(durationMs, 1),
    };
  }

  private applyCamera(sceneElapsedMs: number): void {
    const tween = this.tween;
    if (!tween) {
      return;
    }
    const progress = clamp01((sceneElapsedMs - tween.startMs) / tween.durationMs);
    const box = interpolateViewBox(tween.from, tween.to, smootherstep(progress));
    this.applyViewBox(box);
    this.currentBox = box;
    if (progress >= 1) {
      this.tween = undefined;
    }
  }

  private applyViewBox(box: ViewBox): void {
    const canvas = this.viewer.scene.canvas;
    const aspect =
      canvas.clientWidth > 0 && canvas.clientHeight > 0
        ? canvas.clientHeight / canvas.clientWidth
        : 0.5;
    // In 2D the camera height is the visible width in projected meters.
    const widthDegrees = Math.min(Math.max(box.width, box.height / aspect, 0.5), 360);
    this.viewer.camera.setView({
      destination: this.cesium.Cartesian3.fromDegrees(
        normalizeLongitude(box.lon),
        Math.min(Math.max(box.lat, -80), 80),
        widthDegrees * METERS_PER_DEGREE,
      ),
    });
  }

  private toViewBox(destination: CameraDestination): ViewBox {
    switch (destination.kind) {
      case 'view':
        return {
          lon: destination.centerLongitude,
          lat: destination.centerLatitude,
          width: destination.widthDegrees,
          height: destination.heightDegrees,
        };
      case 'rectangle': {
        let width = destination.east - destination.west;
        if (width <= 0) {
          width += 360;
        }
        return {
          lon: normalizeLongitude(destination.west + width / 2),
          lat: (destination.south + destination.north) / 2,
          width,
          height: destination.north - destination.south,
        };
      }
      case 'point': {
        const width = destination.height / METERS_PER_DEGREE;
        return {
          lon: destination.longitude,
          lat: destination.latitude,
          width,
          height: width * 0.55,
        };
      }
    }
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

    const cartographic = camera.positionCartographic;
    const widthMeters = frustumBounds
      ? frustumBounds.right - frustumBounds.left
      : cartographic.height;
    const width = Math.min(Math.max(widthMeters / METERS_PER_DEGREE, 0.5), 360);
    const canvas = this.viewer.scene.canvas;
    const aspect = canvas.clientWidth > 0 ? canvas.clientHeight / canvas.clientWidth : 0.5;

    return {
      position: camera.position.clone(),
      direction: camera.direction.clone(),
      up: camera.up.clone(),
      right: camera.right.clone(),
      frustum: frustumBounds,
      box: {
        lon: this.cesium.Math.toDegrees(cartographic.longitude),
        lat: this.cesium.Math.toDegrees(cartographic.latitude),
        width,
        height: width * aspect,
      },
    };
  }

  /** Glides back to the view the user had before the story, then restores it exactly. */
  private restoreCamera(snapshot: CameraSnapshot): void {
    const { cesium } = this;
    const camera = this.viewer.camera;
    const restoreExactly = (): void => {
      if (this.viewer.isDestroyed()) {
        return;
      }
      const frustum = camera.frustum;
      if (snapshot.frustum && frustum instanceof cesium.OrthographicOffCenterFrustum) {
        cesium.Cartesian3.clone(snapshot.position, camera.position);
        cesium.Cartesian3.clone(snapshot.direction, camera.direction);
        cesium.Cartesian3.clone(snapshot.up, camera.up);
        cesium.Cartesian3.clone(snapshot.right, camera.right);
        frustum.left = snapshot.frustum.left;
        frustum.right = snapshot.frustum.right;
        frustum.top = snapshot.frustum.top;
        frustum.bottom = snapshot.frustum.bottom;
      } else {
        this.applyViewBox(snapshot.box);
      }
    };

    camera.flyTo({
      destination: cesium.Cartesian3.fromDegrees(
        normalizeLongitude(snapshot.box.lon),
        snapshot.box.lat,
        snapshot.box.width * METERS_PER_DEGREE,
      ),
      duration: RESTORE_FLIGHT_SECONDS,
      easingFunction: cesium.EasingFunction.SINUSOIDAL_IN_OUT,
      complete: restoreExactly,
    });
  }

  // ---------------------------------------------------------------------------
  // Data layers (observed NASA GIBS imagery)
  // ---------------------------------------------------------------------------

  /** Creates the layer fully transparent so its tiles start loading early. */
  private preloadLayer(id: StoryLayerId): void {
    const definition = this.story?.layers[id];
    if (!definition || this.layers.has(id)) {
      return;
    }

    const generation = this.layerGeneration;
    const reportError = (error: unknown): void => {
      if (generation !== this.layerGeneration) {
        return;
      }
      console.error(`Unable to load story layer "${definition.label}".`, error);
      this.options.onLayerError(
        `${definition.label} is unavailable. The story continues without it.`,
      );
    };
    const addLayer = (provider: Cesium.ImageryProvider): void => {
      if (generation !== this.layerGeneration || this.viewer.isDestroyed()) {
        return;
      }
      const layer = this.viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = 0;
      this.layers.set(id, { layer, target: this.targetOpacity(id) });
    };

    if (definition.source === 'koppen') {
      // The Köppen-Geiger raster needs its LERC decoder first (async).
      void createClimateZoneImageryProvider(this.cesium, (message) =>
        reportError(new Error(message)),
      ).then(addLayer, reportError);
      return;
    }

    try {
      const provider = createGibsWmsProvider(this.cesium, {
        layer: definition.gibsLayer,
        time: definition.date,
        credit: definition.credit,
      });
      provider.errorEvent.addEventListener((error) => {
        if (generation !== this.layerGeneration) {
          return;
        }
        console.error(`Unable to load story layer "${definition.gibsLayer}".`, error);
        this.options.onLayerError(
          `${definition.label} is unavailable for ${definition.date}. The story continues without it.`,
        );
      });
      addLayer(provider);
    } catch (error) {
      console.error(`Unable to create story layer "${definition.gibsLayer}".`, error);
      this.options.onLayerError(`${definition.label} could not be loaded.`);
    }
  }

  /** Opacity a story layer should fade to in the current scene. */
  private targetOpacity(id: StoryLayerId): number {
    return this.currentScene?.enabledLayers.includes(id) ? (this.layerOpacity.get(id) ?? 1) : 0;
  }

  private removeAllLayers(): void {
    this.layerGeneration += 1;
    if (!this.viewer.isDestroyed()) {
      for (const { layer } of this.layers.values()) {
        this.viewer.imageryLayers.remove(layer, true);
      }
    }
    this.layers.clear();
  }

  // ---------------------------------------------------------------------------
  // Visual elements
  // ---------------------------------------------------------------------------

  private createElement(element: StoryVisualElement): ElementState {
    const state: ElementState = {
      element,
      bornAt: performance.now(),
      labelOffsetY: 0,
    };

    switch (element.type) {
      case 'label':
        this.attachLabel(state, element.text, element.position, 0, element.icon);
        break;
      case 'marker':
        state.entity = this.createEntity(state);
        this.attachLabel(
          state,
          element.text,
          element.position,
          MARKER_LABEL_OFFSET_PX,
          element.icon,
        );
        break;
      default:
        state.entity = this.createEntity(state);
    }
    return state;
  }

  private beginLeaving(state: ElementState): void {
    this.visibleElements.delete(state.element.id);
    state.leaveAt = performance.now();
    state.label?.classList.remove('is-visible');
    this.leavingElements.push(state);
  }

  private removeElement(state: ElementState): void {
    if (state.entity && this.dataSource) {
      this.dataSource.entities.remove(state.entity);
    }
    state.label?.remove();
    state.entity = undefined;
    state.label = undefined;
  }

  private attachLabel(
    state: ElementState,
    text: string,
    position: LonLat,
    offsetY: number,
    icon?: StoryIconId,
  ): void {
    // Anchor = optional pictogram + neon text box, positioned together.
    const label = document.createElement('div');
    label.className = `astro-map-label-anchor is-${state.element.nature}`;
    label.style.setProperty('--label-color', state.element.color);
    if (icon) {
      const badge = document.createElement('span');
      badge.className = `astro-map-icon icon-${icon}`;
      badge.append(createStoryIcon(icon));
      label.append(badge);
    }
    const box = document.createElement('span');
    box.className = `astro-map-label is-${state.element.nature}`;
    box.textContent = text;
    label.append(box);
    this.options.labelHost.appendChild(label);

    state.label = label;
    state.labelOffsetY = offsetY;
    state.labelPosition = this.cesium.Cartesian3.fromDegrees(position[0], position[1]);
    this.positionLabels();
    // Force a style flush so the opacity transition runs.
    void label.offsetWidth;
    label.classList.add('is-visible');
  }

  private createEntity(state: ElementState): Cesium.Entity | undefined {
    if (!this.dataSource) {
      return undefined;
    }

    const { cesium } = this;
    const element = state.element;
    const color = cesium.Color.fromCssColorString(element.color);
    const illustrative = element.nature === 'illustrative';
    const outlineColor = this.animatedColor(state, color, 0.95, 0);
    const outlineMaterial = illustrative
      ? new cesium.PolylineDashMaterialProperty({ color: outlineColor, dashLength: 14 })
      : new cesium.ColorMaterialProperty(outlineColor);

    switch (element.type) {
      case 'highlightArea': {
        const outline = rectangleOutline(element.west, element.south, element.east, element.north);
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
            material: new cesium.ColorMaterialProperty(
              this.animatedColor(state, color, 0.14, element.pulse ? 0.12 : 0),
            ),
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
            material: new cesium.ColorMaterialProperty(
              this.animatedColor(state, color, 0.14, element.pulse ? 0.12 : 0),
            ),
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
            material: new cesium.PolylineArrowMaterialProperty(
              this.animatedColor(state, color, 1, 0),
            ),
          },
        });
      case 'marker':
        return this.dataSource.entities.add({
          id: element.id,
          name: element.text,
          position: cesium.Cartesian3.fromDegrees(element.position[0], element.position[1]),
          point: {
            pixelSize: 10,
            color: this.animatedColor(state, color, 1, 0),
            outlineColor: this.animatedColor(state, cesium.Color.WHITE, 1, 0),
            outlineWidth: 2,
          },
        });
      case 'label':
        return undefined;
    }
  }

  /**
   * Color property that fades with the element's lifecycle and, optionally,
   * pulses gently. Alpha = (base + pulse wave) × fade × the color's own alpha.
   */
  private animatedColor(
    state: ElementState,
    color: Cesium.Color,
    baseAlpha: number,
    pulseAmplitude: number,
  ): Cesium.CallbackProperty {
    const scratch = new this.cesium.Color();
    return new this.cesium.CallbackProperty(() => {
      const now = performance.now();
      let fade = clamp01((now - state.bornAt) / ELEMENT_FADE_MS);
      if (state.leaveAt !== undefined) {
        fade *= clamp01(1 - (now - state.leaveAt) / ELEMENT_FADE_MS);
      }
      const pulse = pulseAmplitude > 0 ? pulseAmplitude * (0.5 + 0.5 * Math.sin(now / 500)) : 0;
      return color.withAlpha(color.alpha * (baseAlpha + pulse) * fade, scratch);
    }, false);
  }
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** Ease curve with zero velocity and acceleration at both ends. */
function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function interpolateViewBox(from: ViewBox, to: ViewBox, t: number): ViewBox {
  const deltaLon = normalizeLongitude(to.lon - from.lon);
  const deltaLat = to.lat - from.lat;
  // Zoom feels linear when the extent changes geometrically.
  const width = from.width * Math.pow(to.width / from.width, t);
  const height = from.height * Math.pow(to.height / from.height, t);
  // Long moves zoom out slightly mid-way so the viewer keeps their bearings.
  const travel = Math.hypot(deltaLon, deltaLat) / Math.max(from.width, to.width);
  const lift = Math.min(Math.max((travel - 0.35) * 0.5, 0), 0.6);
  const arc = 1 + lift * Math.sin(Math.PI * t);
  return {
    lon: from.lon + deltaLon * t,
    lat: from.lat + deltaLat * t,
    width: Math.min(width * arc, 360),
    height: height * arc,
  };
}

/** Densified rectangle outline that also works across the antimeridian. */
function rectangleOutline(west: number, south: number, east: number, north: number): LonLat[] {
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
