import { Injectable, OnDestroy, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { EnvironmentTargets } from '../zone-probe.models';
import { SoundscapeEngine } from './soundscape.engine';
import {
  ALL_CATEGORIES_ON,
  SILENT_AMBIENCE,
  SILENT_MIX,
  type AmbienceLevels,
  type SoundCategory,
  type SoundCategoryState,
  type SoundMix,
} from './sound-mix';

const PREFERENCE_KEY = 'astrobox.sound.enabled';
const CATEGORIES_KEY = 'astrobox.sound.categories';

/** What Verny hears where it stands. */
export interface ZoneSoundInput {
  targets: EnvironmentTargets;
  /** 0–1 strong-wind whistle. */
  whistle: number;
  /** Climate-zone nature bed, or null (ocean / unknown). */
  ambience: AmbienceLevels | null;
}

const SILENT_ZONE: ZoneSoundInput = {
  targets: { rain: 0, snow: 0, fire: 0, windSpeedMs: 0 },
  whistle: 0,
  ambience: null,
};

/**
 * Owns the audio context for the procedural soundscape. Browsers only allow
 * audio after a user gesture, so the engine is created on the first pointer
 * or key press (dragging Verny counts).
 *
 * Two sources feed the engine: the zone under Verny and, while a guided story
 * plays, the story's own soundtrack (which replaces the zone sounds). Each
 * sound category can be switched on or off; the master switch and the
 * categories are remembered.
 */
@Injectable({ providedIn: 'root' })
export class SoundscapeService implements OnDestroy {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly enabledState = signal(this.readPreference());
  private readonly categoriesState = signal<SoundCategoryState>(this.readCategories());
  private engine?: SoundscapeEngine;
  private zone: ZoneSoundInput = SILENT_ZONE;
  private story: SoundMix | null = null;
  private readonly unlockListener = (): void => this.unlock();

  /** Whether sound is switched on. */
  readonly enabled = this.enabledState.asReadonly();
  /** Which sound categories are switched on. */
  readonly categories = this.categoriesState.asReadonly();

  constructor() {
    if (this.browser) {
      document.addEventListener('pointerdown', this.unlockListener, { capture: true });
      document.addEventListener('keydown', this.unlockListener, { capture: true });
    }
  }

  /** Sounds of the zone under Verny. */
  setZone(zone: ZoneSoundInput): void {
    this.zone = zone;
    this.push();
  }

  /** Soundtrack of a guided story; null when no story is playing. */
  setStoryMix(mix: SoundMix | null): void {
    this.story = mix;
    this.push();
  }

  toggle(): void {
    const enabled = !this.enabledState();
    this.enabledState.set(enabled);
    this.save(PREFERENCE_KEY, String(enabled));
    if (enabled) {
      this.unlock();
    }
    this.engine?.setMuted(!enabled);
  }

  toggleCategory(category: SoundCategory): void {
    const next = { ...this.categoriesState(), [category]: !this.categoriesState()[category] };
    this.categoriesState.set(next);
    this.save(CATEGORIES_KEY, JSON.stringify(next));
    this.push();
  }

  ngOnDestroy(): void {
    this.removeUnlockListeners();
    this.engine?.destroy();
  }

  /** Combines the active source with the category switches. */
  private currentMix(): SoundMix {
    const on = this.categoriesState();
    if (this.story) {
      return on.story ? this.story : SILENT_MIX;
    }
    const { targets, whistle, ambience } = this.zone;
    return {
      rain: on.rain ? targets.rain : 0,
      fire: on.fire ? targets.fire : 0,
      windSpeedMs: on.wind ? targets.windSpeedMs : 0,
      whistle: on.whistle ? whistle : 0,
      ambience: on.climate && ambience ? ambience : SILENT_AMBIENCE,
    };
  }

  private push(): void {
    this.engine?.setMix(this.currentMix());
  }

  private unlock(): void {
    if (!this.browser || !this.enabledState()) {
      return;
    }
    if (!this.engine) {
      const AudioContextClass = globalThis.AudioContext;
      if (!AudioContextClass) {
        this.removeUnlockListeners();
        return;
      }
      try {
        this.engine = new SoundscapeEngine(new AudioContextClass());
      } catch (error) {
        console.error('The zone soundscape is unavailable.', error);
        this.removeUnlockListeners();
        return;
      }
      this.push();
    }
    this.removeUnlockListeners();
  }

  private removeUnlockListeners(): void {
    if (this.browser) {
      document.removeEventListener('pointerdown', this.unlockListener, { capture: true });
      document.removeEventListener('keydown', this.unlockListener, { capture: true });
    }
  }

  private save(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Preference not saved; the change still applies for this session.
    }
  }

  private readPreference(): boolean {
    try {
      return localStorage.getItem(PREFERENCE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  private readCategories(): SoundCategoryState {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(CATEGORIES_KEY) ?? 'null');
      if (typeof stored !== 'object' || stored === null) {
        return { ...ALL_CATEGORIES_ON };
      }
      const state = { ...ALL_CATEGORIES_ON };
      for (const key of Object.keys(state) as SoundCategory[]) {
        const value = (stored as Record<string, unknown>)[key];
        if (typeof value === 'boolean') {
          state[key] = value;
        }
      }
      return state;
    } catch {
      return { ...ALL_CATEGORIES_ON };
    }
  }
}
