import type { MapProbeAdapter } from '../zone-probe/zone-probe.models';
import { sampleWind, type WindField } from './wind-field';

/** Speed buckets (m/s) and their colors, from calm to storm. */
export const WIND_SPEED_COLORS: readonly { maxSpeed: number; color: string }[] = [
  { maxSpeed: 3, color: 'rgba(158, 201, 255, 0.75)' },
  { maxSpeed: 6, color: 'rgba(127, 224, 208, 0.82)' },
  { maxSpeed: 9, color: 'rgba(198, 240, 122, 0.88)' },
  { maxSpeed: 13, color: 'rgba(255, 209, 102, 0.92)' },
  { maxSpeed: 18, color: 'rgba(255, 143, 90, 0.95)' },
  { maxSpeed: Number.POSITIVE_INFINITY, color: 'rgba(255, 90, 122, 1)' },
];

const MAX_STREAMLINES = 180;
const MIN_STREAMLINES = 54;
const STEPS_PER_STREAMLINE = 36;
const STREAMLINE_STEP_DEGREES = 0.75;
const MAX_SEGMENT_PX = 120;
const OUTLINE_COLOR = 'rgba(8, 14, 30, 0.52)';
const MAX_LATITUDE = 84;
const VIEW_REBUILD_INTERVAL_MS = 140;

/**
 * Animated streamlines drawn over either Cesium map. Geographic paths are
 * integrated from the shared wind field; moving dashes show flow direction.
 */
export class WindStreamlineRenderer {
  private readonly context: CanvasRenderingContext2D;
  private field: WindField | null = null;
  private adapter: MapProbeAdapter | null = null;
  private active = false;
  private width = 0;
  private height = 0;
  private count = 0;
  private lastVersion = -1;
  private lastBuildAt = 0;

  private readonly longitude = new Float32Array(MAX_STREAMLINES * STEPS_PER_STREAMLINE);
  private readonly latitude = new Float32Array(MAX_STREAMLINES * STEPS_PER_STREAMLINE);
  private readonly projectedX = new Float32Array(MAX_STREAMLINES * STEPS_PER_STREAMLINE);
  private readonly projectedY = new Float32Array(MAX_STREAMLINES * STEPS_PER_STREAMLINE);
  private readonly projectedValid = new Uint8Array(MAX_STREAMLINES * STEPS_PER_STREAMLINE);
  private readonly pointCounts = new Uint8Array(MAX_STREAMLINES);
  private readonly speed = new Float32Array(MAX_STREAMLINES);
  private readonly wind = { u: 0, v: 0 };
  private readonly projected = { x: 0, y: 0 };
  private frameHandle?: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reducedMotion: boolean,
  ) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D is not available.');
    }
    this.context = context;
  }

  setField(field: WindField | null): void {
    this.field = field;
    this.lastVersion = -1;
    this.update();
  }

  setAdapter(adapter: MapProbeAdapter | null): void {
    this.adapter = adapter;
    this.lastVersion = -1;
    this.update();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.update();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const density = Math.round((this.width * this.height) / 18_000);
    this.count = Math.min(MAX_STREAMLINES, Math.max(MIN_STREAMLINES, density));
    this.lastVersion = -1;
    this.update();
  }

  destroy(): void {
    this.active = false;
    this.stop();
  }

  private update(): void {
    if (this.active && this.field && this.adapter) {
      if (this.frameHandle === undefined) {
        this.frameHandle = requestAnimationFrame(this.onFrame);
      }
    } else {
      this.stop();
      this.context.clearRect(0, 0, this.width, this.height);
    }
  }

  private stop(): void {
    if (this.frameHandle !== undefined) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = undefined;
    }
  }

  private rebuildStreamlines(): void {
    const field = this.field;
    const adapter = this.adapter;
    if (!field || !adapter) {
      return;
    }

    this.pointCounts.fill(0);
    const columns = Math.ceil(Math.sqrt((this.count * this.width) / this.height));
    const rows = Math.ceil(this.count / columns);
    let streamline = 0;

    for (let row = 0; row < rows && streamline < this.count; row += 1) {
      for (let column = 0; column < columns && streamline < this.count; column += 1) {
        const x = ((column + 0.5) * this.width) / columns;
        const y = ((row + 0.5) * this.height) / rows;
        const seed = adapter.pick(x, y);
        if (!seed || !sampleWind(field, seed.longitude, seed.latitude, this.wind)) {
          streamline += 1;
          continue;
        }

        let longitude = seed.longitude;
        let latitude = seed.latitude;
        let totalSpeed = 0;
        const offset = streamline * STEPS_PER_STREAMLINE;
        let pointCount = 0;

        for (let step = 0; step < STEPS_PER_STREAMLINE; step += 1) {
          if (!sampleWind(field, longitude, latitude, this.wind)) {
            break;
          }
          const windSpeed = Math.hypot(this.wind.u, this.wind.v);
          if (windSpeed < 0.25) {
            break;
          }
          this.longitude[offset + step] = longitude;
          this.latitude[offset + step] = latitude;
          totalSpeed += windSpeed;
          pointCount += 1;

          const cosLatitude = Math.max(Math.cos((latitude * Math.PI) / 180), 0.2);
          longitude += ((this.wind.u / windSpeed) * STREAMLINE_STEP_DEGREES) / cosLatitude;
          latitude += (this.wind.v / windSpeed) * STREAMLINE_STEP_DEGREES;
          if (longitude > 180) {
            longitude -= 360;
          } else if (longitude < -180) {
            longitude += 360;
          }
          if (Math.abs(latitude) > MAX_LATITUDE) {
            break;
          }
        }

        this.pointCounts[streamline] = pointCount;
        this.speed[streamline] = pointCount > 0 ? totalSpeed / pointCount : 0;
        streamline += 1;
      }
    }
  }

  private readonly onFrame = (now: number): void => {
    this.frameHandle = undefined;
    const field = this.field;
    const adapter = this.adapter;
    if (!this.active || !field || !adapter) {
      return;
    }

    const version = adapter.viewVersion();
    if (version !== this.lastVersion && now - this.lastBuildAt >= VIEW_REBUILD_INTERVAL_MS) {
      this.lastVersion = version;
      this.lastBuildAt = now;
      this.rebuildStreamlines();
    } else if (this.lastVersion < 0) {
      this.lastVersion = version;
      this.lastBuildAt = now;
      this.rebuildStreamlines();
    }

    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    const totalPoints = this.count * STEPS_PER_STREAMLINE;
    this.projectedValid.fill(0, 0, totalPoints);

    for (let line = 0; line < this.count; line += 1) {
      const offset = line * STEPS_PER_STREAMLINE;
      for (let point = 0; point < this.pointCounts[line]; point += 1) {
        const index = offset + point;
        if (adapter.projectInto(this.longitude[index], this.latitude[index], this.projected)) {
          this.projectedX[index] = this.projected.x;
          this.projectedY[index] = this.projected.y;
          this.projectedValid[index] = 1;
        }
      }

      const lineSpeed = this.speed[line];
      if (this.pointCounts[line] < 2 || lineSpeed < 0.25) {
        continue;
      }
      const bucket = speedBucket(lineSpeed);
      const color = WIND_SPEED_COLORS[bucket].color;
      const intensity = Math.min(0.82, 0.26 + lineSpeed / 24);
      this.traceLine(context, offset, this.pointCounts[line]);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.globalAlpha = intensity;
      context.lineWidth = 2.6;
      context.strokeStyle = OUTLINE_COLOR;
      context.stroke();
      context.lineWidth = 0.9 + Math.min(lineSpeed / 12, 0.8);
      context.strokeStyle = color;
      context.stroke();

      if (!this.reducedMotion) {
        this.traceLine(context, offset, this.pointCounts[line]);
        context.setLineDash([3, 13]);
        context.lineDashOffset = -((now / 1000) * lineSpeed * 1.35) % 16;
        context.globalAlpha = Math.min(1, 0.5 + lineSpeed / 30);
        context.lineWidth = 1.35;
        context.strokeStyle = color;
        context.stroke();
      }
      context.setLineDash([]);
    }

    context.globalAlpha = 1;
    this.frameHandle = requestAnimationFrame(this.onFrame);
  };

  private traceLine(context: CanvasRenderingContext2D, offset: number, count: number): void {
    context.beginPath();
    let hasPrevious = false;
    let previousX = 0;
    let previousY = 0;
    for (let point = 0; point < count; point += 1) {
      const index = offset + point;
      if (!this.projectedValid[index]) {
        hasPrevious = false;
        continue;
      }
      const x = this.projectedX[index];
      const y = this.projectedY[index];
      if (
        !hasPrevious ||
        Math.abs(x - previousX) > MAX_SEGMENT_PX ||
        Math.abs(y - previousY) > MAX_SEGMENT_PX
      ) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
      previousX = x;
      previousY = y;
      hasPrevious = true;
    }
  }
}

function speedBucket(speed: number): number {
  for (let index = 0; index < WIND_SPEED_COLORS.length; index += 1) {
    if (speed <= WIND_SPEED_COLORS[index].maxSpeed) {
      return index;
    }
  }
  return WIND_SPEED_COLORS.length - 1;
}
