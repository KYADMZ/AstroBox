import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** One stop of the guide: what to highlight and a one-line explanation. */
interface TourStep {
  /** CSS selectors tried in order; the first visible element is highlighted. */
  targets: readonly string[];
  title: string;
  text: string;
}

/** Each step advances by itself after this long. */
const STEP_MS = 4_000;
const SEEN_KEY = 'astrobox.tour.seen';
const SPOTLIGHT_PADDING = 6;
const TOOLTIP_WIDTH = 288;

const STEPS: readonly TourStep[] = [
  {
    targets: ['.brand'],
    title: 'Welcome to AstroBox',
    text: "NASA's changing Earth becomes a jukebox of sights, sounds and stories.",
  },
  {
    targets: ['.mode-tabs'],
    title: 'Globe or map',
    text: 'Set out from a 3D globe, then unfold the planet into a 2D map (Q / E).',
  },
  {
    targets: ['app-layer-panel'],
    title: 'Data layers',
    text: 'Reveal rain, fires, heat, wind and climate layer by layer.',
  },
  {
    targets: ['app-mascot-probe .mascot'],
    title: 'Meet Verny',
    text: 'Drop Verny anywhere: it samples local conditions and responds to what it finds.',
  },
  {
    targets: ['.sound-controls'],
    title: 'Sounds',
    text: 'Turn the landscape into sound; tune the mix or mute it any time (M).',
  },
  {
    targets: ['.timeline'],
    title: 'Timeline',
    text: 'Watch six months of Earth change, or press Space to set time in motion.',
  },
  {
    targets: ['.story-entry', '.mode-tabs .mode-tab:last-of-type'],
    title: 'Guided stories',
    text: 'Take the 2D map into guided journeys like El Niño, with maps and sound.',
  },
];

const DEMO_DURATION_MS = STEP_MS * STEPS.length;

/** Starts and stops the quick demo; shared by the app and the demo overlay. */
@Injectable({ providedIn: 'root' })
export class QuickTourService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly stepState = signal(-1);

  readonly steps = STEPS;
  readonly step = this.stepState.asReadonly();
  readonly active = computed(() => this.stepState() >= 0);

  /** Shows the demo once, the first time someone opens the app. */
  startIfFirstVisit(): void {
    if (!this.browser) {
      return;
    }
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === 'true';
    } catch {
      // Storage unavailable: show the guide.
    }
    if (!seen) {
      this.start();
    }
  }

  start(): void {
    this.stepState.set(0);
  }

  next(): void {
    const next = this.stepState() + 1;
    if (next >= STEPS.length) {
      this.finish();
    } else {
      this.stepState.set(next);
    }
  }

  previous(): void {
    this.stepState.update((step) => Math.max(step - 1, 0));
  }

  finish(): void {
    this.stepState.set(-1);
    try {
      localStorage.setItem(SEEN_KEY, 'true');
    } catch {
      // Not remembered; the guide may show again next time.
    }
  }
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Quick demo overlay: spotlights the app's main features in seven 4-second
 * scenes, with a hard 28-second limit.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-quick-tour',
  styleUrl: './quick-tour.scss',
  template: `
    @if (tour.active() && current(); as step) {
      <div class="tour-backdrop" aria-hidden="true"></div>
      @for (blocker of interactionBlockers(); track $index) {
        <div
          class="tour-blocker"
          aria-hidden="true"
          [style.top.px]="blocker.top"
          [style.left.px]="blocker.left"
          [style.width.px]="blocker.width"
          [style.height.px]="blocker.height"
        ></div>
      }
      @if (spotlight(); as box) {
        <div
          class="tour-spotlight"
          aria-hidden="true"
          [style.top.px]="box.top"
          [style.left.px]="box.left"
          [style.width.px]="box.width"
          [style.height.px]="box.height"
        ></div>
      }
      <section
        class="tour-tooltip"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        [style.top.px]="tooltip().top"
        [style.left.px]="tooltip().left"
        [style.width.px]="tooltipWidth"
      >
        <header>
          <span class="tour-count">{{ tour.step() + 1 }} / {{ tour.steps.length }}</span>
          <button type="button" class="tour-skip" (click)="tour.finish()">Skip</button>
        </header>
        <h2 id="tour-title">{{ step.title }}</h2>
        <p id="tour-text" aria-live="polite">{{ step.text }}</p>
        <div class="tour-progress" aria-hidden="true">
          @for (item of tour.steps; track $index) {
            <span
              [class.done]="$index < tour.step()"
              [class.current]="$index === tour.step()"
            ></span>
          }
        </div>
        <footer>
          <button type="button" [disabled]="tour.step() === 0" (click)="tour.previous()">Back</button>
          <button type="button" class="primary" (click)="tour.next()">
            {{ tour.step() === tour.steps.length - 1 ? 'Done' : 'Next' }}
          </button>
        </footer>
      </section>
    }
  `,
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class QuickTourComponent {
  protected readonly tour = inject(QuickTourService);
  protected readonly tooltipWidth = TOOLTIP_WIDTH;
  protected readonly current = computed(() => this.tour.steps[this.tour.step()] ?? null);
  protected readonly spotlight = signal<Box | null>(null);
  protected readonly interactionBlockers = signal<Box[]>([], { equal: sameBoxes });
  protected readonly tooltip = computed(() => this.placeTooltip(this.spotlight()));

  private frame?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private startedAt?: number;

  constructor() {
    effect((onCleanup) => {
      const step = this.tour.step();
      if (step < 0) {
        this.startedAt = undefined;
        return;
      }
      if (this.startedAt === undefined) {
        this.startedAt = performance.now();
      }
      // Follow the highlighted element (it may move or animate).
      const track = (): void => {
        this.spotlight.set(this.measure(this.tour.steps[step]));
        this.interactionBlockers.set(this.measureInteractionBlockers());
        this.frame = requestAnimationFrame(track);
      };
      track();
      const remainingMs = Math.max(
        0,
        DEMO_DURATION_MS - (performance.now() - this.startedAt),
      );
      this.timer = setTimeout(
        () => {
          if (remainingMs <= STEP_MS) {
            this.tour.finish();
          } else {
            this.tour.next();
          }
        },
        Math.min(STEP_MS, remainingMs),
      );
      onCleanup(() => this.stop());
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.tour.active()) {
      return;
    }
    if (
      event.key !== 'Escape' &&
      event.target instanceof HTMLElement &&
      event.target.closest('.mascot')
    ) {
      return;
    }
    switch (event.key) {
      case 'Escape':
        this.tour.finish();
        break;
      case 'ArrowRight':
      case 'Enter':
        this.tour.next();
        break;
      case 'ArrowLeft':
        this.tour.previous();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private stop(): void {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private measure(step: TourStep): Box | null {
    for (const selector of step.targets) {
      const element = document.querySelector<HTMLElement>(selector);
      const rect = element?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const top = Math.max(rect.top - SPOTLIGHT_PADDING, 4);
        const left = Math.max(rect.left - SPOTLIGHT_PADDING, 4);
        const box = {
          top,
          left,
          width: Math.min(rect.right + SPOTLIGHT_PADDING, innerWidth - 4) - left,
          height: Math.min(rect.bottom + SPOTLIGHT_PADDING, innerHeight - 4) - top,
        };
        const previous = this.spotlight();
        // Avoid re-rendering when nothing moved.
        return previous &&
          previous.top === box.top &&
          previous.left === box.left &&
          previous.width === box.width &&
          previous.height === box.height
          ? previous
          : box;
      }
    }

    return null;
  }

  private measureInteractionBlockers(): Box[] {
    const rect = document.querySelector<HTMLElement>('.mascot')?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return [{ top: 0, left: 0, width: innerWidth, height: innerHeight }];
    }

    const top = Math.max(Math.floor((rect.top - 8) / 8) * 8, 0);
    const left = Math.max(Math.floor((rect.left - 8) / 8) * 8, 0);
    const right = Math.min(Math.ceil((rect.right + 8) / 8) * 8, innerWidth);
    const bottom = Math.min(Math.ceil((rect.bottom + 8) / 8) * 8, innerHeight);
    if (right <= left || bottom <= top) {
      return [{ top: 0, left: 0, width: innerWidth, height: innerHeight }];
    }

    return [
      { top: 0, left: 0, width: innerWidth, height: top },
      { top, left: 0, width: left, height: bottom - top },
      { top, left: right, width: innerWidth - right, height: bottom - top },
      { top: bottom, left: 0, width: innerWidth, height: innerHeight - bottom },
    ].filter((box) => box.width > 0 && box.height > 0);
  }

  /** Below the element when there is room, otherwise above it; centered and kept on screen. */
  private placeTooltip(box: Box | null): { top: number; left: number } {
    if (!box) {
      return { top: innerHeight / 2 - 90, left: innerWidth / 2 - TOOLTIP_WIDTH / 2 };
    }
    const estimatedHeight = 190;
    const gap = 12;
    const centeredLeft = Math.min(
      Math.max(box.left + box.width / 2 - TOOLTIP_WIDTH / 2, gap),
      innerWidth - TOOLTIP_WIDTH - gap,
    );
    const below = box.top + box.height + gap;
    if (below + estimatedHeight < innerHeight) {
      return { top: below, left: centeredLeft };
    }
    const above = box.top - estimatedHeight - gap;
    if (above >= gap) {
      return { top: above, left: centeredLeft };
    }
    // Tall element (e.g. the layer panel): put the tooltip beside it.
    const top = Math.min(
      Math.max(box.top + box.height / 2 - estimatedHeight / 2, gap),
      innerHeight - estimatedHeight - gap,
    );
    const left =
      box.left > TOOLTIP_WIDTH + 2 * gap
        ? box.left - TOOLTIP_WIDTH - gap
        : Math.min(box.left + box.width + gap, innerWidth - TOOLTIP_WIDTH - gap);
    return { top, left };
  }
}

function sameBoxes(left: readonly Box[], right: readonly Box[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (box, index) =>
        box.top === right[index].top &&
        box.left === right[index].left &&
        box.width === right[index].width &&
        box.height === right[index].height,
    )
  );
}
