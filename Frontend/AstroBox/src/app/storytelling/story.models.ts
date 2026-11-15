/**
 * Map-agnostic models for the guided storytelling experience.
 *
 * The storytelling runs exclusively on the 2D map. These types describe
 * WHAT a story shows; the 2D map's StoryMapDirector decides HOW it is drawn
 * with Cesium. Nothing here depends on Cesium or on the 3D globe.
 */

/** Geographic coordinate as [longitude, latitude] in degrees. */
export type LonLat = readonly [longitude: number, latitude: number];

/**
 * Where the camera should look.
 * - `rectangle`: fit a geographic extent (recommended for the 2D map).
 *   `west` may be greater than `east` to cross the antimeridian.
 * - `point`: center on a coordinate at a given camera height in meters.
 * - `view`: center on a coordinate and show an extent in degrees. Unlike
 *   `rectangle`, it can show the whole world centered on any longitude
 *   (e.g. a Pacific-centered global view).
 */
export type CameraDestination =
  | {
      readonly kind: 'view';
      readonly centerLongitude: number;
      readonly centerLatitude: number;
      readonly widthDegrees: number;
      readonly heightDegrees: number;
    }
  | {
      readonly kind: 'rectangle';
      readonly west: number;
      readonly south: number;
      readonly east: number;
      readonly north: number;
    }
  | {
      readonly kind: 'point';
      readonly longitude: number;
      readonly latitude: number;
      readonly height: number;
    };

/** Camera orientation in degrees. On the 2D map only `heading` is meaningful. */
export interface CameraOrientation {
  readonly heading: number;
  readonly pitch: number;
  readonly roll: number;
}

/** An additional camera move scheduled inside a scene. */
export interface CameraWaypoint {
  /** Milliseconds after the scene starts. */
  readonly atMs: number;
  readonly destination: CameraDestination;
  readonly orientation?: CameraOrientation;
  readonly flightSeconds: number;
}

/** Identifiers of the data layers a story can enable. */
export type StoryLayerId = 'seaSurfaceTemperatureAnomaly' | 'precipitationRate';

/** A real, observed data layer served by NASA GIBS. */
export interface StoryLayerDefinition {
  readonly id: StoryLayerId;
  readonly gibsLayer: string;
  /** ISO date (YYYY-MM-DD) requested through the WMS TIME parameter. */
  readonly date: string;
  readonly opacity: number;
  /** Human-readable description shown in the data legend. */
  readonly label: string;
  /** Short context for the date, e.g. "Peak of the 2023–24 El Niño". */
  readonly dateContext: string;
  readonly credit: string;
}

/**
 * What a visual element represents:
 * - `observed`: real measurements.
 * - `illustrative`: a simplified teaching aid (drawn with dashed outlines and
 *   always labeled as illustrative in the UI).
 * - `reference`: geographic context such as place names or standard
 *   monitoring regions (e.g. the Niño 3.4 box).
 */
export type VisualElementNature = 'observed' | 'illustrative' | 'reference';

interface VisualElementBase {
  readonly id: string;
  readonly nature: VisualElementNature;
  /** CSS color used for the element. */
  readonly color: string;
  /** Legend text describing the element. Elements sharing a caption are listed once. */
  readonly caption?: string;
  /** Milliseconds after the scene starts. Defaults to 0. */
  readonly appearAtMs?: number;
  /** Milliseconds after the scene starts. Defaults to the end of the scene. */
  readonly disappearAtMs?: number;
}

export interface HighlightAreaElement extends VisualElementBase {
  readonly type: 'highlightArea';
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly pulse?: boolean;
}

export interface ZoneElement extends VisualElementBase {
  readonly type: 'zone';
  readonly outline: readonly LonLat[];
  readonly pulse?: boolean;
}

export interface ArrowElement extends VisualElementBase {
  readonly type: 'arrow';
  readonly path: readonly LonLat[];
  readonly width?: number;
}

export interface LabelElement extends VisualElementBase {
  readonly type: 'label';
  readonly position: LonLat;
  readonly text: string;
}

export interface MarkerElement extends VisualElementBase {
  readonly type: 'marker';
  readonly position: LonLat;
  readonly text: string;
}

export type StoryVisualElement =
  | HighlightAreaElement
  | ZoneElement
  | ArrowElement
  | LabelElement
  | MarkerElement;

/** A step of the cause-and-effect summary shown in the narration panel. */
export interface StorySummaryStep {
  readonly title: string;
  readonly description: string;
}

/** Controls available to scene callbacks while a scene is active. */
export interface StoryStageControls {
  setLayerOpacity(layerId: StoryLayerId, opacity: number): void;
}

export interface StorySceneContext {
  readonly story: StoryDefinition;
  readonly scene: StoryScene;
  readonly sceneIndex: number;
  readonly stage: StoryStageControls;
}

/**
 * Optional hooks reserved for future integrations (mascot animation and
 * audio narration). They are carried in scene events but not used yet.
 */
export interface StorySceneCues {
  readonly audioTrackId?: string;
  readonly mascotAnimationId?: string;
}

export interface StoryScene {
  readonly id: string;
  readonly title: string;
  /** Scene length in milliseconds. */
  readonly durationMs: number;
  readonly narration: string;
  readonly cameraDestination: CameraDestination;
  readonly cameraOrientation: CameraOrientation;
  /** Flight time to `cameraDestination` when the scene starts. */
  readonly cameraFlightSeconds: number;
  readonly cameraWaypoints?: readonly CameraWaypoint[];
  readonly enabledLayers: readonly StoryLayerId[];
  readonly visualElements: readonly StoryVisualElement[];
  /** Optional cause-and-effect summary rendered in the narration panel. */
  readonly summarySteps?: readonly StorySummaryStep[];
  readonly cues?: StorySceneCues;
  readonly onEnter?: (context: StorySceneContext) => void;
  readonly onExit?: (context: StorySceneContext) => void;
}

export interface StoryDefinition {
  readonly id: string;
  readonly title: string;
  readonly layers: Readonly<Record<StoryLayerId, StoryLayerDefinition>>;
  readonly scenes: readonly StoryScene[];
}

export type StoryPlaybackStatus = 'idle' | 'playing' | 'paused' | 'completed';

export type SceneEndReason = 'completed' | 'cancelled' | 'restarted';

interface StoryEventBase {
  readonly storyId: string;
  /** `performance.now()` timestamp when the event was emitted. */
  readonly timestamp: number;
  /** Milliseconds of story playback elapsed when the event was emitted. */
  readonly storyElapsedMs: number;
}

interface SceneEventBase extends StoryEventBase {
  readonly sceneIndex: number;
  readonly scene: StoryScene;
}

/**
 * Lifecycle events emitted by the StoryPlayerService. Future mascot and
 * audio systems subscribe to these to stay synchronized with the story.
 */
export type StoryLifecycleEvent =
  | (StoryEventBase & { readonly type: 'storyStarted' })
  | (SceneEventBase & { readonly type: 'sceneStarted' })
  | (SceneEventBase & { readonly type: 'sceneEnded'; readonly reason: SceneEndReason })
  | (SceneEventBase & { readonly type: 'storyPaused'; readonly sceneElapsedMs: number })
  | (SceneEventBase & { readonly type: 'storyResumed'; readonly sceneElapsedMs: number })
  | (StoryEventBase & { readonly type: 'storyRestarted' })
  | (StoryEventBase & { readonly type: 'storyCompleted' })
  | (StoryEventBase & { readonly type: 'storyCancelled' });

export type StoryLifecycleEventType = StoryLifecycleEvent['type'];

/**
 * Contract between the map-agnostic player and the map that renders the
 * story. Implemented by the 2D map only.
 */
export interface StoryStage extends StoryStageControls {
  /** Save map state, lock user navigation and prepare story layers. */
  begin(story: StoryDefinition): void;
  enterScene(scene: StoryScene, sceneIndex: number): void;
  /** Called on every animation frame while playing. */
  update(scene: StoryScene, sceneElapsedMs: number): void;
  exitScene(scene: StoryScene): void;
  pause(): void;
  resume(): void;
  /** Remove story content and restore camera, controls and layers. */
  end(): void;
}
