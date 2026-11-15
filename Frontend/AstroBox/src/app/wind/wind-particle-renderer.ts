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

const MAX_PARTICLES = 2200;
const MIN_PARTICLES = 500;
/** One particle per this many square pixels. */
const PIXELS_PER_PARTICLE = 420;
/** On-screen speed: pixels per second for each m/s of wind, at any zoom. */
const PIXELS_PER_SECOND_PER_MS = 3.2;
const METERS_PER_DEGREE = 111_320;
/** Trails fade by this factor every frame. */
const TRAIL_RETENTION = 0.92;
const MAX_SEGMENT_PX = 60;
const OUTLINE_COLOR = 'rgba(8, 14, 30, 0.55)';
/** Each particle is drawn as a streak covering this much of its recent path (seconds). */
const TAIL_SECONDS = 0.3;

/**
 * Animated wind particles drawn on a canvas over either Cesium map.
 *
 * Particles live in longitude/latitude and are moved by the wind field;
 * each frame they are projected to the screen through the map adapter, so
 * the same renderer works on the 3D globe and the 2D map. Their on-screen
 * speed is kept constant across zoom levels. Each segment is drawn from the
 * particle's previous to its current geographic position, both projected with
 * the current camera, so it stays correct while the map is panned or zoomed
 * (only the fading trails are cleared when the camera moves).
 */
export class WindParticleRenderer {
  private readonly context: CanvasRenderingContext2D;
  private field: WindField | null = null;
  private adapter: MapProbeAdapter | null = null;
  private active = false;
  private width = 0;
  private height = 0;
  private count = 0;
  private lastVersion = -1;

  private readonly longitude = new Float32Array(MAX_PARTICLES);
  private readonly latitude = new Float32Array(MAX_PARTICLES);
  private readonly age = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly segments = WIND_SPEED_COLORS.map(() => new Float32Array(MAX_PARTICLES * 4));
  private readonly segmentCounts = new Int32Array(WIND_SPEED_COLORS.length);

  private readonly wind = { u: 0, v: 0 };
  private readonly projected = { x: 0, y: 0 };
  private readonly projectedPrevious = { x: 0, y: 0 };
  private frameHandle?: number;
  private lastFrameAt?: number;

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
    this.respawnAll();
    this.update();
  }

  setAdapter(adapter: MapProbeAdapter | null): void {
    this.adapter = adapter;
    this.lastVersion = -1;
    this.respawnAll();
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
    const density = Math.round((this.width * this.height) / PIXELS_PER_PARTICLE);
    this.count = Math.round(
      Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, density)) * (this.reducedMotion ? 0.4 : 1),
    );
    this.lastVersion = -1;
    this.respawnAll();
  }

  destroy(): void {
    this.active = false;
    this.stop();
  }

  private update(): void {
    if (this.active && this.field && this.adapter) {
      if (this.frameHandle === undefined) {
        this.lastFrameAt = undefined;
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

  private respawnAll(): void {
    this.age.fill(Number.POSITIVE_INFINITY);
  }

  private respawn(index: number): void {
    const adapter = this.adapter;
    if (!adapter) {
      return;
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const point = adapter.pick(Math.random() * this.width, Math.random() * this.height);
      if (point) {
        this.longitude[index] = point.longitude;
        this.latitude[index] = point.latitude;
        this.age[index] = Math.random() * 0.5;
        this.life[index] = 2 + Math.random() * 3.5;
        return;
      }
    }
    // Over empty space (3D, zoomed out): try again next frame.
    this.age[index] = Number.POSITIVE_INFINITY;
  }

  private readonly onFrame = (now: number): void => {
    this.frameHandle = undefined;
    const field = this.field;
    const adapter = this.adapter;
    if (!this.active || !field || !adapter) {
      return;
    }
    const dt = this.lastFrameAt === undefined ? 1 / 60 : Math.min((now - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = now;
    const context = this.context;

    const version = adapter.viewVersion();
    if (version !== this.lastVersion) {
      // The camera moved: old trails no longer line up with the map.
      this.lastVersion = version;
      context.clearRect(0, 0, this.width, this.height);
    } else {
      context.globalCompositeOperation = 'destination-in';
      context.fillStyle = `rgba(0, 0, 0, ${TRAIL_RETENTION})`;
      context.fillRect(0, 0, this.width, this.height);
      context.globalCompositeOperation = 'source-over';
    }

    const degreesPerMsPerSecond =
      (PIXELS_PER_SECOND_PER_MS * adapter.metersPerPixel()) / METERS_PER_DEGREE;
    const degreesPerMs = degreesPerMsPerSecond * dt;
    const tailDegreesPerMs = degreesPerMsPerSecond * TAIL_SECONDS;
    this.segmentCounts.fill(0);

    for (let index = 0; index < this.count; index += 1) {
      this.age[index] += dt;
      if (this.age[index] > this.life[index]) {
        this.respawn(index);
        continue;
      }
      if (!sampleWind(field, this.longitude[index], this.latitude[index], this.wind)) {
        this.respawn(index);
        continue;
      }
      const latitude = this.latitude[index];
      const cosLatitude = Math.max(Math.cos((latitude * Math.PI) / 180), 0.2);
      let longitude = this.longitude[index] + (this.wind.u * degreesPerMs) / cosLatitude;
      if (longitude > 180) {
        longitude -= 360;
      } else if (longitude < -180) {
        longitude += 360;
      }
      const nextLatitude = latitude + this.wind.v * degreesPerMs;
      if (Math.abs(nextLatitude) > 85) {
        this.respawn(index);
        continue;
      }
      this.longitude[index] = longitude;
      this.latitude[index] = nextLatitude;
      // Streak tail: where the particle was a moment ago, following the wind.
      const previousLongitude = longitude - (this.wind.u * tailDegreesPerMs) / cosLatitude;
      const previousLatitude = nextLatitude - this.wind.v * tailDegreesPerMs;

      if (
        !adapter.projectInto(previousLongitude, previousLatitude, this.projectedPrevious) ||
        !adapter.projectInto(longitude, nextLatitude, this.projected)
      ) {
        continue;
      }
      const dx = this.projected.x - this.projectedPrevious.x;
      const dy = this.projected.y - this.projectedPrevious.y;
      // Skip jumps (antimeridian wrap in 2D) and empty moves.
      if (Math.abs(dx) > MAX_SEGMENT_PX || Math.abs(dy) > MAX_SEGMENT_PX) {
        continue;
      }
      const speed = Math.hypot(this.wind.u, this.wind.v);
      let bucket = 0;
      while (speed > WIND_SPEED_COLORS[bucket].maxSpeed) {
        bucket += 1;
      }
      const offset = this.segmentCounts[bucket] * 4;
      const segments = this.segments[bucket];
      segments[offset] = this.projectedPrevious.x;
      segments[offset + 1] = this.projectedPrevious.y;
      segments[offset + 2] = this.projected.x;
      segments[offset + 3] = this.projected.y;
      this.segmentCounts[bucket] += 1;
    }

    context.lineCap = 'round';
    WIND_SPEED_COLORS.forEach(({ color }, bucket) => {
      const total = this.segmentCounts[bucket];
      if (total === 0) {
        return;
      }
      const segments = this.segments[bucket];
      context.beginPath();
      for (let segment = 0; segment < total; segment += 1) {
        const offset = segment * 4;
        context.moveTo(segments[offset], segments[offset + 1]);
        context.lineTo(segments[offset + 2], segments[offset + 3]);
      }
      // Dark outline first so the colored streak reads on light and dark maps.
      context.lineWidth = 3.4;
      context.strokeStyle = OUTLINE_COLOR;
      context.stroke();
      context.lineWidth = 1.7;
      context.strokeStyle = color;
      context.stroke();
    });

    this.frameHandle = requestAnimationFrame(this.onFrame);
  };
}
