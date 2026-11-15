import { Injectable, OnDestroy, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { EnvironmentTargets } from '../zone-probe.models';
import { SoundscapeEngine } from './soundscape.engine';

const PREFERENCE_KEY = 'astrobox.sound.enabled';
const SILENT: EnvironmentTargets = { rain: 0, fire: 0, windSpeedMs: 0 };

/**
 * Owns the audio context for the zone soundscape. Browsers only allow audio
 * after a user gesture, so the engine is created on the first pointer or key
 * press (dragging Verny counts). The on/off choice is remembered.
 */
@Injectable({ providedIn: 'root' })
export class SoundscapeService implements OnDestroy {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly enabledState = signal(this.readPreference());
  private engine?: SoundscapeEngine;
  private targets: EnvironmentTargets = SILENT;
  private readonly unlockListener = (): void => this.unlock();

  /** Whether sound is switched on. */
  readonly enabled = this.enabledState.asReadonly();

  constructor() {
    if (this.browser) {
      document.addEventListener('pointerdown', this.unlockListener, { capture: true });
      document.addEventListener('keydown', this.unlockListener, { capture: true });
    }
  }

  setTargets(targets: EnvironmentTargets): void {
    this.targets = targets;
    this.engine?.setTargets(targets);
  }

  toggle(): void {
    const enabled = !this.enabledState();
    this.enabledState.set(enabled);
    try {
      localStorage.setItem(PREFERENCE_KEY, String(enabled));
    } catch {
      // Preference not saved; sound still toggles for this session.
    }
    if (enabled) {
      this.unlock();
    }
    this.engine?.setMuted(!enabled);
  }

  ngOnDestroy(): void {
    this.removeUnlockListeners();
    this.engine?.destroy();
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
      this.engine.setTargets(this.targets);
    }
    this.removeUnlockListeners();
  }

  private removeUnlockListeners(): void {
    if (this.browser) {
      document.removeEventListener('pointerdown', this.unlockListener, { capture: true });
      document.removeEventListener('keydown', this.unlockListener, { capture: true });
    }
  }

  private readPreference(): boolean {
    try {
      return localStorage.getItem(PREFERENCE_KEY) !== 'false';
    } catch {
      return true;
    }
  }
}
