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

/** Each step advances by itself after this long: 7 steps ≈ 28 s in total. */
const STEP_MS = 4_000;
const SEEN_KEY = 'astrobox.tour.seen';
const SPOTLIGHT_PADDING = 6;
const TOOLTIP_WIDTH = 288;

const STEPS: readonly TourStep[] = [
  {
    targets: ['.brand'],
    title: 'Welcome to AstroBox',
    text: 'An Earth Jukebox: NASA data you can see, hear and feel.',
  },
  {
    targets: ['.mode-tabs'],
    title: 'Globe or map',
    text: 'Switch between the 3D globe and the 2D map (Q / E).',
  },
  {
    targets: ['app-layer-panel'],
    title: 'Data layers',
    text: 'Turn NASA layers on or off: rain, fires, temperature, wind, climate zones.',
  },
  {
    targets: ['app-mascot-probe .mascot'],
    title: 'Meet Verny',
    text: 'Drag Verny anywhere on Earth: it reads the data, plays its sounds and reacts.',
  },
  {
    targets: ['.sound-controls'],
    title: 'Sounds',
    text: 'Mute everything (M) or choose which sounds you hear.',
  },
  {
    targets: ['.timeline'],
    title: 'Timeline',
    text: 'Travel through the last six months, or press Space to play.',
  },
  {
    targets: ['.story-entry', '.mode-tabs .mode-tab:last-of-type'],
    title: 'Guided stories',
    text: 'On the 2D map, open a guided story (El Niño and more) with sound.',
  },
];

/** Starts and stops the quick guide; shared by the app and the guide overlay. */
@Injectable({ providedIn: 'root' })
export class QuickTourService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly stepState = signal(-1);

  readonly steps = STEPS;
  readonly step = this.stepState.asReadonly();
  readonly active = computed(() => this.stepState() >= 0);

  /** Shows the guide once, the first time someone opens the app. */
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
 * Quick guide overlay: dims the app, spotlights one feature at a time and
 * shows a short tooltip next to it. Advances by itself every 4 seconds.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-quick-tour',
  styleUrl: './quick-tour.scss',
  template: `
    @if (tour.active() && current(); as step) {
      <div class="tour-backdrop" aria-hidden="true"></div>
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
  protected readonly tooltip = computed(() => this.placeTooltip(this.spotlight()));

  private frame?: number;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect((onCleanup) => {
      const step = this.tour.step();
      if (step < 0) {
        return;
      }
      // Follow the highlighted element (it may move or animate).
      const track = (): void => {
        this.spotlight.set(this.measure(this.tour.steps[step]));
        this.frame = requestAnimationFrame(track);
      };
      track();
      this.timer = setTimeout(() => this.tour.next(), STEP_MS);
      onCleanup(() => this.stop());
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.tour.active()) {
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
