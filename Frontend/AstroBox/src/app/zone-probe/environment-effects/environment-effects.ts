import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import type { EnvironmentTargets } from '../zone-probe.models';
import { ZoneProbeStore } from '../zone-probe.store';
import { EnvironmentEffectsEngine } from './environment-effects.engine';

const NO_EFFECTS: EnvironmentTargets = { rain: 0, fire: 0, windSpeedMs: 0 };

/**
 * Full-map weather effects for the zone under Verny: background rain and
 * flames, plus water drops on the "screen". Purely visual (aria-hidden) and
 * never blocks the map (pointer-events: none).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-environment-effects',
  styleUrl: './environment-effects.scss',
  template: `
    <div #glow class="fire-glow"></div>
    <canvas #back class="fx-back"></canvas>
    <canvas #glass class="fx-glass"></canvas>
  `,
  host: {
    'aria-hidden': 'true',
  },
})
export class EnvironmentEffectsComponent {
  /** Effects fade out while the guided story runs. */
  readonly suspended = input(false);

  private readonly store = inject(ZoneProbeStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly back = viewChild.required<ElementRef<HTMLCanvasElement>>('back');
  private readonly glass = viewChild.required<ElementRef<HTMLCanvasElement>>('glass');
  private readonly glow = viewChild.required<ElementRef<HTMLElement>>('glow');

  private engine?: EnvironmentEffectsEngine;
  private latestTargets: EnvironmentTargets = NO_EFFECTS;

  constructor() {
    effect(() => {
      this.latestTargets = this.suspended() ? NO_EFFECTS : this.store.effectTargets();
      this.engine?.setTargets(this.latestTargets);
    });

    let observer: ResizeObserver | undefined;
    afterNextRender(() => {
      try {
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.engine = new EnvironmentEffectsEngine(
          this.back().nativeElement,
          this.glass().nativeElement,
          this.glow().nativeElement,
          reducedMotion,
        );
      } catch (error) {
        console.error('Environment effects are unavailable.', error);
        return;
      }
      const element = this.host.nativeElement;
      this.engine.resize(element.clientWidth, element.clientHeight);
      this.engine.setTargets(this.latestTargets);
      observer = new ResizeObserver(() =>
        this.engine?.resize(element.clientWidth, element.clientHeight),
      );
      observer.observe(element);
    });

    inject(DestroyRef).onDestroy(() => {
      observer?.disconnect();
      this.engine?.destroy();
    });
  }
}
