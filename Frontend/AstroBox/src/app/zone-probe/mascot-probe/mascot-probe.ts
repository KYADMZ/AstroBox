import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import type { GeoPoint } from '../../map.models';
import type { MapProbeAdapter, VernyAnimation, ZoneMood } from '../zone-probe.models';
import { ZoneProbeStore } from '../zone-probe.store';

/** Minimum time between live map samples while dragging (ms). */
const PREVIEW_INTERVAL_MS = 50;
/** Arrow-key nudge when Verny is placed (degrees). */
const KEYBOARD_STEP_DEGREES = 2;

const MOOD_LABELS: Record<ZoneMood, string> = {
  cold: 'cold zone',
  neutral: 'mild zone',
  hot: 'hot zone',
};

/**
 * Verny, the draggable zone probe. Drag it from its dock onto the map:
 * while dragging its drawing reacts to the area below it, and once dropped
 * it stays anchored to that place (following pans, zooms and map switches)
 * and the zone status panel and screen effects start.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-mascot-probe',
  styleUrl: './mascot-probe.scss',
  templateUrl: './mascot-probe.html',
  host: {
    '[class.is-hidden]': 'suspended()',
  },
})
export class MascotProbeComponent {
  /** The visible map, or null while it is loading. */
  readonly adapter = input<MapProbeAdapter | null>(null);
  /** Hidden while the guided story runs. */
  readonly suspended = input(false);

  protected readonly store = inject(ZoneProbeStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly mascot = viewChild.required<ElementRef<HTMLButtonElement>>('mascot');

  protected readonly moods: ZoneMood[] = ['cold', 'neutral', 'hot'];
  protected readonly animations: VernyAnimation[] = ['burning', 'rain', 'wind', 'heat', 'wave'];
  /**
   * Animation shown right now: Verny waves from its dock; on the map it plays
   * the animation of the strongest phenomenon below it (null = static drawing).
   */
  protected readonly activeAnimation = computed<VernyAnimation | null>(() =>
    this.store.phase() === 'docked' ? 'wave' : this.store.animation(),
  );
  protected readonly ariaLabel = computed(() => {
    switch (this.store.phase()) {
      case 'docked':
        return 'Verny zone probe. Drag onto the map, or press Enter to drop it at the map center.';
      case 'dragging':
        return `Verny is over a ${MOOD_LABELS[this.store.mood()]}.`;
      default:
        return `Verny is scanning a ${MOOD_LABELS[this.store.mood()]}. Drag to move, arrow keys to nudge, Escape to return to the dock.`;
    }
  });

  private dragOffset = { x: 0, y: 0 };
  private stageRect?: DOMRect;
  private lastPreviewAt = 0;
  private activePointerId?: number;

  constructor() {
    // Keep a placed Verny attached to its place after every map render.
    effect((onCleanup) => {
      const adapter = this.adapter();
      if (!adapter) {
        return;
      }
      const unsubscribe = adapter.onFrame(() => this.syncPlacedPosition());
      onCleanup(unsubscribe);
    });

    // Clear inline positioning when Verny returns to its dock.
    effect(() => {
      if (this.store.phase() === 'docked') {
        const element = this.mascot().nativeElement;
        element.style.transform = '';
        element.classList.remove('is-offscreen');
      }
    });
  }

  protected imageFor(mood: ZoneMood): string {
    return `verny/verny-${mood}.png`;
  }

  protected animationFor(animation: VernyAnimation): string {
    return `verny/anim/verny-${animation}.webp`;
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.suspended() || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const element = this.mascot().nativeElement;
    const bounds = element.getBoundingClientRect();
    this.stageRect = this.host.nativeElement.getBoundingClientRect();
    this.dragOffset = {
      x: event.clientX - (bounds.left + bounds.width / 2),
      y: event.clientY - (bounds.top + bounds.height / 2),
    };
    this.activePointerId = event.pointerId;
    element.setPointerCapture(event.pointerId);
    // Switch to free positioning right away (the class binding catches up on render).
    element.classList.remove('is-docked');
    this.store.startDrag();
    this.moveTo(event);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    this.moveTo(event);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    this.activePointerId = undefined;
    const center = this.centerFromPointer(event);
    const point = center ? this.adapter()?.pick(center.x, center.y) : undefined;
    if (point) {
      this.store.place(point);
      this.syncPlacedPosition();
    } else {
      this.store.dock();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const phase = this.store.phase();
    if (event.key === 'Escape' && phase !== 'docked') {
      event.stopPropagation();
      this.store.dock();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && phase === 'docked') {
      event.preventDefault();
      const stage = this.host.nativeElement.getBoundingClientRect();
      const point = this.adapter()?.pick(stage.width / 2, stage.height / 2);
      if (point) {
        this.store.place(point);
      }
      return;
    }
    const location = this.store.location();
    if (phase === 'placed' && location) {
      const delta = ARROW_DELTAS[event.key];
      if (delta) {
        event.preventDefault();
        this.store.place(nudge(location, delta[0], delta[1]));
      }
    }
  }

  protected returnToDock(): void {
    this.store.dock();
  }

  private moveTo(event: PointerEvent): void {
    const center = this.centerFromPointer(event);
    if (!center) {
      return;
    }
    this.applyTransform(center.x, center.y);

    const now = performance.now();
    if (now - this.lastPreviewAt >= PREVIEW_INTERVAL_MS) {
      this.lastPreviewAt = now;
      this.store.preview(this.adapter()?.pick(center.x, center.y));
    }
  }

  private centerFromPointer(event: PointerEvent): { x: number; y: number } | undefined {
    const stage = this.stageRect ?? this.host.nativeElement.getBoundingClientRect();
    return {
      x: event.clientX - stage.left - this.dragOffset.x,
      y: event.clientY - stage.top - this.dragOffset.y,
    };
  }

  private syncPlacedPosition(): void {
    const location = this.store.location();
    if (this.store.phase() !== 'placed' || !location) {
      return;
    }
    const element = this.mascot().nativeElement;
    const position = this.adapter()?.project(location);
    if (!position) {
      element.classList.add('is-offscreen');
      return;
    }
    element.classList.remove('is-offscreen');
    this.applyTransform(position.x, position.y);
  }

  private applyTransform(centerX: number, centerY: number): void {
    const element = this.mascot().nativeElement;
    element.style.transform = `translate3d(${centerX}px, ${centerY}px, 0) translate(-50%, -50%)`;
  }
}

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-KEYBOARD_STEP_DEGREES, 0],
  ArrowRight: [KEYBOARD_STEP_DEGREES, 0],
  ArrowUp: [0, KEYBOARD_STEP_DEGREES],
  ArrowDown: [0, -KEYBOARD_STEP_DEGREES],
};

function nudge(point: GeoPoint, deltaLongitude: number, deltaLatitude: number): GeoPoint {
  const longitude = point.longitude + deltaLongitude;
  return {
    longitude: ((((longitude + 180) % 360) + 360) % 360) - 180,
    latitude: Math.min(Math.max(point.latitude + deltaLatitude, -85), 85),
  };
}
