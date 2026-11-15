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
import type { MapProbeAdapter } from '../zone-probe/zone-probe.models';
import { WindFieldStore } from './wind-field.store';
import { WindStreamlineRenderer } from './wind-streamline-renderer';

/**
 * Animated wind streamlines colored by speed over the visible map. Works on
 * the 3D globe and the 2D map through the map adapter.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-wind-layer',
  template: '<canvas #canvas></canvas>',
  styles: `
    :host {
      position: absolute;
      z-index: 1;
      inset: 0;
      display: block;
      pointer-events: none;
    }

    canvas {
      width: 100%;
      height: 100%;
    }
  `,
  host: {
    'aria-hidden': 'true',
  },
})
export class WindLayerComponent {
  readonly adapter = input<MapProbeAdapter | null>(null);
  /** True when the wind visualization is switched on (and no story is playing). */
  readonly active = input(false);

  private readonly store = inject(WindFieldStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private renderer?: WindStreamlineRenderer;

  constructor() {
    // Read the signals unconditionally: with `this.renderer?.set(this.x())`
    // the signal would not be read while the renderer does not exist yet, the
    // effect would track nothing, and it would never run again.
    effect(() => {
      const adapter = this.adapter();
      this.renderer?.setAdapter(adapter);
    });
    effect(() => {
      const field = this.store.field();
      this.renderer?.setField(field);
    });
    effect(() => {
      const active = this.active();
      this.renderer?.setActive(active);
    });

    let observer: ResizeObserver | undefined;
    afterNextRender(() => {
      try {
        this.renderer = new WindStreamlineRenderer(
          this.canvas().nativeElement,
          matchMedia('(prefers-reduced-motion: reduce)').matches,
        );
      } catch (error) {
        console.error('The wind layer is unavailable.', error);
        return;
      }
      const element = this.host.nativeElement;
      this.renderer.resize(element.clientWidth, element.clientHeight);
      this.renderer.setAdapter(this.adapter());
      this.renderer.setField(this.store.field());
      this.renderer.setActive(this.active());
      observer = new ResizeObserver(() =>
        this.renderer?.resize(element.clientWidth, element.clientHeight),
      );
      observer.observe(element);
    });

    inject(DestroyRef).onDestroy(() => {
      observer?.disconnect();
      this.renderer?.destroy();
    });
  }
}
