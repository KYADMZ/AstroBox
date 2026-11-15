import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { Observable, Subject, filter } from 'rxjs';
import type {
  SceneEndReason,
  StoryDefinition,
  StoryLayerId,
  StoryLifecycleEvent,
  StoryLifecycleEventType,
  StoryPlaybackStatus,
  StoryScene,
  StorySceneContext,
  StoryStage,
} from './story.models';

/** Frames longer than this (e.g. a background tab) do not advance the story further. */
const MAX_FRAME_DELTA_MS = 250;

/**
 * Map-agnostic playback controller for guided stories.
 *
 * It is provided by the 2D map component (not in root), so each 2D map has
 * its own player and the 3D globe never receives storytelling behavior.
 *
 * Timing uses a single requestAnimationFrame loop instead of chained
 * timeouts: pausing simply stops accumulating elapsed time, and all scene
 * events (camera waypoints, element appearance) are derived from it.
 */
@Injectable()
export class StoryPlayerService implements OnDestroy {
  private readonly eventsSubject = new Subject<StoryLifecycleEvent>();
  private readonly statusState = signal<StoryPlaybackStatus>('idle');
  private readonly storyState = signal<StoryDefinition | null>(null);
  private readonly sceneIndexState = signal(-1);
  private readonly sceneElapsedState = signal(0);
  private readonly stageReadyState = signal(false);
  private readonly layerErrorState = signal<string | null>(null);

  private stage?: StoryStage;
  private frameHandle?: number;
  private lastFrameTime?: number;

  /** All lifecycle events. Intended for the future mascot and audio systems. */
  readonly events$: Observable<StoryLifecycleEvent> = this.eventsSubject.asObservable();

  readonly status = this.statusState.asReadonly();
  readonly story = this.storyState.asReadonly();
  readonly sceneIndex = this.sceneIndexState.asReadonly();
  readonly sceneElapsedMs = this.sceneElapsedState.asReadonly();
  readonly stageReady = this.stageReadyState.asReadonly();
  readonly layerError = this.layerErrorState.asReadonly();

  readonly isActive = computed(() => {
    const status = this.statusState();
    return status === 'playing' || status === 'paused';
  });
  readonly currentScene = computed<StoryScene | null>(() => {
    const story = this.storyState();
    const index = this.sceneIndexState();
    return story && index >= 0 ? (story.scenes[index] ?? null) : null;
  });
  readonly totalDurationMs = computed(
    () => this.storyState()?.scenes.reduce((sum, scene) => sum + scene.durationMs, 0) ?? 0,
  );
  readonly storyElapsedMs = computed(() => {
    const story = this.storyState();
    const index = this.sceneIndexState();
    if (!story || index < 0) {
      return 0;
    }
    const previous = story.scenes
      .slice(0, index)
      .reduce((sum, scene) => sum + scene.durationMs, 0);
    return previous + this.sceneElapsedState();
  });
  /** Story progress between 0 and 1. */
  readonly storyProgress = computed(() => {
    const total = this.totalDurationMs();
    return total > 0 ? Math.min(this.storyElapsedMs() / total, 1) : 0;
  });
  /** Current scene progress between 0 and 1. */
  readonly sceneProgress = computed(() => {
    const scene = this.currentScene();
    return scene ? Math.min(this.sceneElapsedState() / scene.durationMs, 1) : 0;
  });

  /** Convenience helper to listen to one event type. */
  on<T extends StoryLifecycleEventType>(
    type: T,
  ): Observable<Extract<StoryLifecycleEvent, { type: T }>> {
    return this.events$.pipe(
      filter((event): event is Extract<StoryLifecycleEvent, { type: T }> => event.type === type),
    );
  }

  /** Called by the 2D map once its viewer is ready. */
  attachStage(stage: StoryStage): void {
    this.stage = stage;
    this.stageReadyState.set(true);
  }

  /** Called by the 2D map before its viewer is destroyed. */
  detachStage(): void {
    if (this.isActive()) {
      this.cancel();
    }
    this.stage = undefined;
    this.stageReadyState.set(false);
  }

  /** Reported by the stage when an external data layer fails to load. */
  reportLayerError(message: string | null): void {
    this.layerErrorState.set(message);
  }

  start(story: StoryDefinition): void {
    if (!this.stage || story.scenes.length === 0) {
      return;
    }
    if (this.isActive()) {
      this.cancel();
    }

    this.storyState.set(story);
    this.layerErrorState.set(null);
    this.safely(() => this.stage?.begin(story));
    this.emit({ type: 'storyStarted', ...this.baseEvent() });
    this.enterScene(0);
    this.statusState.set('playing');
    this.scheduleFrame();
  }

  pause(): void {
    if (this.statusState() !== 'playing') {
      return;
    }
    this.cancelFrame();
    this.statusState.set('paused');
    this.safely(() => this.stage?.pause());
    const sceneEvent = this.sceneEvent();
    if (sceneEvent) {
      this.emit({ type: 'storyPaused', ...sceneEvent, sceneElapsedMs: this.sceneElapsedState() });
    }
  }

  resume(): void {
    if (this.statusState() !== 'paused') {
      return;
    }
    this.safely(() => this.stage?.resume());
    this.statusState.set('playing');
    const sceneEvent = this.sceneEvent();
    if (sceneEvent) {
      this.emit({ type: 'storyResumed', ...sceneEvent, sceneElapsedMs: this.sceneElapsedState() });
    }
    this.scheduleFrame();
  }

  togglePause(): void {
    if (this.statusState() === 'playing') {
      this.pause();
    } else {
      this.resume();
    }
  }

  /** Restart from the first scene without restoring the map in between. */
  restart(): void {
    const story = this.storyState();
    if (!story) {
      return;
    }
    if (!this.isActive()) {
      this.start(story);
      return;
    }

    this.cancelFrame();
    this.exitCurrentScene('restarted');
    this.emit({ type: 'storyRestarted', ...this.baseEvent() });
    this.layerErrorState.set(null);
    this.enterScene(0);
    this.safely(() => this.stage?.resume());
    this.statusState.set('playing');
    this.scheduleFrame();
  }

  /** Exit the story: restore the map and emit `storyCancelled`. */
  cancel(): void {
    if (!this.isActive()) {
      this.resetToIdle();
      return;
    }
    this.cancelFrame();
    this.exitCurrentScene('cancelled');
    const event = this.baseEvent();
    // Restore the map before announcing the end, so listeners see the final state.
    this.safely(() => this.stage?.end());
    this.resetToIdle();
    this.emit({ type: 'storyCancelled', ...event });
  }

  ngOnDestroy(): void {
    this.cancel();
    this.eventsSubject.complete();
  }

  private readonly onFrame = (now: number): void => {
    this.frameHandle = undefined;
    if (this.statusState() !== 'playing') {
      return;
    }

    const scene = this.currentScene();
    if (!scene) {
      this.complete();
      return;
    }

    const delta =
      this.lastFrameTime === undefined
        ? 0
        : Math.min(Math.max(now - this.lastFrameTime, 0), MAX_FRAME_DELTA_MS);
    this.lastFrameTime = now;
    const elapsed = this.sceneElapsedState() + delta;

    if (elapsed >= scene.durationMs) {
      this.sceneElapsedState.set(scene.durationMs);
      const story = this.storyState();
      const nextIndex = this.sceneIndexState() + 1;
      if (!story || nextIndex >= story.scenes.length) {
        this.complete();
        return;
      }
      this.exitCurrentScene('completed');
      this.enterScene(nextIndex);
    } else {
      this.sceneElapsedState.set(elapsed);
      this.safely(() => this.stage?.update(scene, elapsed));
    }

    this.scheduleFrame();
  };

  private enterScene(index: number): void {
    const story = this.storyState();
    const scene = story?.scenes[index];
    if (!story || !scene) {
      return;
    }

    this.sceneIndexState.set(index);
    this.sceneElapsedState.set(0);
    this.safely(() => this.stage?.enterScene(scene, index));
    this.safely(() => scene.onEnter?.(this.sceneContext(story, scene, index)));
    this.safely(() => this.stage?.update(scene, 0));
    this.emit({ type: 'sceneStarted', ...this.baseEvent(), sceneIndex: index, scene });
  }

  private exitCurrentScene(reason: SceneEndReason): void {
    const story = this.storyState();
    const index = this.sceneIndexState();
    const scene = story?.scenes[index];
    if (!story || !scene) {
      return;
    }

    this.safely(() => scene.onExit?.(this.sceneContext(story, scene, index)));
    this.safely(() => this.stage?.exitScene(scene));
    this.emit({ type: 'sceneEnded', ...this.baseEvent(), sceneIndex: index, scene, reason });
  }

  private complete(): void {
    this.cancelFrame();
    this.exitCurrentScene('completed');
    const event = this.baseEvent();
    // Restore the map before announcing the end, so listeners see the final state.
    this.safely(() => this.stage?.end());
    this.statusState.set('completed');
    this.sceneIndexState.set(-1);
    this.sceneElapsedState.set(0);
    this.layerErrorState.set(null);
    this.emit({ type: 'storyCompleted', ...event });
  }

  private resetToIdle(): void {
    this.cancelFrame();
    this.statusState.set('idle');
    this.sceneIndexState.set(-1);
    this.sceneElapsedState.set(0);
    this.layerErrorState.set(null);
  }

  private sceneContext(
    story: StoryDefinition,
    scene: StoryScene,
    sceneIndex: number,
  ): StorySceneContext {
    return {
      story,
      scene,
      sceneIndex,
      stage: {
        setLayerOpacity: (layerId: StoryLayerId, opacity: number) =>
          this.stage?.setLayerOpacity(layerId, opacity),
      },
    };
  }

  private baseEvent(): { storyId: string; timestamp: number; storyElapsedMs: number } {
    return {
      storyId: this.storyState()?.id ?? '',
      timestamp: performance.now(),
      storyElapsedMs: this.storyElapsedMs(),
    };
  }

  private sceneEvent():
    | { storyId: string; timestamp: number; storyElapsedMs: number; sceneIndex: number; scene: StoryScene }
    | undefined {
    const scene = this.currentScene();
    return scene
      ? { ...this.baseEvent(), sceneIndex: this.sceneIndexState(), scene }
      : undefined;
  }

  private emit(event: StoryLifecycleEvent): void {
    this.eventsSubject.next(event);
  }

  private scheduleFrame(): void {
    if (this.frameHandle !== undefined || typeof requestAnimationFrame !== 'function') {
      return;
    }
    this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  private cancelFrame(): void {
    if (this.frameHandle !== undefined) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = undefined;
    }
    this.lastFrameTime = undefined;
  }

  /** Stage or scene callback failures must never break playback. */
  private safely(action: () => void): void {
    try {
      action();
    } catch (error) {
      console.error('Storytelling step failed.', error);
    }
  }
}
