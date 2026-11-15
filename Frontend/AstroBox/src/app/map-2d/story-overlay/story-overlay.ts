import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { EL_NINO_STORY } from '../../storytelling/el-nino-story';
import { RAIN_SHADOW_STORY } from '../../storytelling/rain-shadow-story';
import { storySoundMix } from '../../storytelling/story-audio';
import { StoryPlayerService } from '../../storytelling/story-player.service';
import type {
  StoryDefinition,
  StoryLayerDefinition,
  StoryLayerId,
} from '../../storytelling/story.models';
import { SILENT_MIX } from '../../zone-probe/soundscape/sound-mix';
import { SoundscapeService } from '../../zone-probe/soundscape/soundscape.service';

/** Guided stories offered on the 2D map, longest first. */
const STORIES: readonly StoryDefinition[] = [EL_NINO_STORY, RAIN_SHADOW_STORY];

interface StoryCard {
  story: StoryDefinition;
  sceneCount: number;
  durationSeconds: number;
}

/** Neon cyan: default accent for the ocean-focused story. */
const DEFAULT_ACCENT = '#3ef0ff';

interface SceneIndicator {
  id: string;
  title: string;
  state: 'done' | 'current' | 'upcoming';
  progress: number;
}

/**
 * Storytelling interface for the 2D map: start card, narration panel,
 * scene indicator, progress bar, data legend and playback controls.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-story-overlay',
  styleUrl: './story-overlay.scss',
  templateUrl: './story-overlay.html',
  host: {
    '(document:keydown.escape)': 'onEscape()',
    '[style.--story-accent]': 'accentColor()',
  },
})
export class StoryOverlayComponent {
  protected readonly player = inject(StoryPlayerService);
  private readonly soundscape = inject(SoundscapeService);
  protected readonly storyCards: StoryCard[] = STORIES.map((story) => ({
    story,
    sceneCount: story.scenes.length,
    durationSeconds: Math.round(totalDuration(story) / 1000),
  }));
  /** The story being played (or the first one before any story starts). */
  protected readonly story = computed(() => this.player.story() ?? STORIES[0]);
  protected readonly sceneCount = computed(() => this.story().scenes.length);
  protected readonly totalDurationLabel = computed(() =>
    formatDuration(totalDuration(this.story())),
  );
  protected readonly expanded = signal(false);

  protected readonly scene = this.player.currentScene;

  constructor() {
    // Story soundtrack: rain where it gets wetter, dry wind where it dries…
    effect(() => {
      const status = this.player.status();
      const scene = this.scene();
      if (!this.player.isActive() || !scene) {
        this.soundscape.setStoryMix(null);
      } else if (status === 'paused') {
        this.soundscape.setStoryMix(SILENT_MIX);
      } else {
        this.soundscape.setStoryMix(storySoundMix(scene, this.player.sceneElapsedMs()));
      }
    });
    inject(DestroyRef).onDestroy(() => this.soundscape.setStoryMix(null));
  }
  protected readonly sceneNumber = computed(() => this.player.sceneIndex() + 1);
  protected readonly elapsedLabel = computed(() =>
    formatDuration(this.player.storyElapsedMs()),
  );

  protected readonly sceneIndicators = computed<SceneIndicator[]>(() => {
    const currentIndex = this.player.sceneIndex();
    const sceneProgress = this.player.sceneProgress();
    return this.story().scenes.map((scene, index) => ({
      id: scene.id,
      title: scene.title,
      state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
      progress: index < currentIndex ? 1 : index === currentIndex ? sceneProgress : 0,
    }));
  });

  /**
   * Accent color of the narration panel: the color of the newest highlighted
   * shape on the map (zones first, then arrows). Water and wetter areas are
   * neon cyan; warm water and drier areas are neon orange.
   */
  protected readonly accentColor = computed(() => {
    const scene = this.scene();
    const elapsed = this.player.sceneElapsedMs();
    if (!scene) {
      return DEFAULT_ACCENT;
    }

    let accent = DEFAULT_ACCENT;
    let bestRank = 0;
    let bestAppearAt = -1;
    for (const element of scene.visualElements) {
      const appearAt = element.appearAtMs ?? 0;
      const visible =
        elapsed >= appearAt && elapsed < (element.disappearAtMs ?? Number.POSITIVE_INFINITY);
      const rank =
        element.type === 'zone' || element.type === 'highlightArea'
          ? 2
          : element.type === 'arrow'
            ? 1
            : 0;
      if (!visible || rank === 0 || element.color.startsWith('rgba')) {
        continue;
      }
      if (rank > bestRank || (rank === bestRank && appearAt >= bestAppearAt)) {
        bestRank = rank;
        bestAppearAt = appearAt;
        accent = element.color;
      }
    }
    return accent;
  });

  /** Observed NASA layers visible in the current scene. */
  protected readonly observedLayers = computed<StoryLayerDefinition[]>(() => {
    const scene = this.scene();
    const story = this.player.story();
    if (!scene || !story) {
      return [];
    }
    return scene.enabledLayers
      .map((id: StoryLayerId) => story.layers[id])
      .filter((layer): layer is StoryLayerDefinition => layer !== undefined);
  });

  /** Captions of illustrative elements currently on the map. */
  protected readonly illustrativeCaptions = computed<{ caption: string; color: string }[]>(() => {
    const scene = this.scene();
    const elapsed = this.player.sceneElapsedMs();
    if (!scene) {
      return [];
    }
    const captions = new Map<string, string>();
    for (const element of scene.visualElements) {
      const visible =
        elapsed >= (element.appearAtMs ?? 0) &&
        elapsed < (element.disappearAtMs ?? Number.POSITIVE_INFINITY);
      if (visible && element.nature === 'illustrative' && element.caption) {
        captions.set(element.caption, element.color);
      }
    }
    return [...captions].map(([caption, color]) => ({ caption, color }));
  });

  protected start(story: StoryDefinition): void {
    this.expanded.set(false);
    this.player.start(story);
  }

  protected open(): void {
    this.expanded.set(true);
  }

  protected collapse(): void {
    this.expanded.set(false);
  }

  protected togglePause(): void {
    this.player.togglePause();
  }

  protected restart(): void {
    this.player.restart();
  }

  protected exit(): void {
    this.player.cancel();
  }

  protected onEscape(): void {
    if (this.player.isActive()) {
      this.player.cancel();
    } else {
      this.collapse();
    }
  }
}

function totalDuration(story: StoryDefinition): number {
  return story.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
