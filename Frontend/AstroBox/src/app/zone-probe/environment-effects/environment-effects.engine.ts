import type { EnvironmentTargets } from '../zone-probe.models';

/**
 * Canvas effects driven by the zone under Verny:
 * - back canvas: falling rain streaks (slanted by wind) and flames rising
 *   from the bottom of the map;
 * - glass canvas: drops landing on the "screen" glass; big drops slide down
 *   and leave small droplets behind.
 *
 * Strengths (0–1) ease toward their targets, so moving Verny from a drizzle
 * to a storm visibly ramps up. The loop stops by itself when nothing is left
 * to draw, so idle cost is zero.
 */

interface Droplet {
  x: number;
  y: number;
  radius: number;
  age: number;
  life: number;
  /** Seconds before a big drop starts sliding (Infinity for static drops). */
  slideDelay: number;
  velocity: number;
  trailDistance: number;
}

interface FlameParticle {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  age: number;
  life: number;
  size: number;
  ember: boolean;
}

const MAX_RAIN_STREAKS = 900;
const MAX_GLASS_DROPLETS = 240;
const MAX_FLAME_PARTICLES = 320;
/** Time constant of the intensity easing (seconds). */
const EASING_SECONDS = 0.9;
const MAX_DEVICE_PIXEL_RATIO = 1.5;
const RAIN_DEPTH_BUCKETS = 3;

export class EnvironmentEffectsEngine {
  private readonly backContext: CanvasRenderingContext2D;
  private readonly glassContext: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;

  private targets: EnvironmentTargets = { rain: 0, fire: 0, windSpeedMs: 0 };
  private rain = 0;
  private fire = 0;
  private wind = 0;

  private readonly streakX = new Float32Array(MAX_RAIN_STREAKS);
  private readonly streakY = new Float32Array(MAX_RAIN_STREAKS);
  private readonly streakDepth = new Float32Array(MAX_RAIN_STREAKS);
  private readonly droplets: Droplet[] = [];
  private readonly flames: FlameParticle[] = [];
  private dropletSpawnDebt = 0;
  private flameSpawnDebt = 0;
  private emberSpawnDebt = 0;

  private readonly dropletSprite: HTMLCanvasElement;
  private readonly flameSprites: HTMLCanvasElement[];
  private readonly emberSprite: HTMLCanvasElement;

  private frameHandle?: number;
  private lastFrameAt?: number;
  private destroyed = false;

  constructor(
    private readonly backCanvas: HTMLCanvasElement,
    private readonly glassCanvas: HTMLCanvasElement,
    private readonly fireGlow: HTMLElement,
    private readonly reducedMotion: boolean,
  ) {
    const back = backCanvas.getContext('2d');
    const glass = glassCanvas.getContext('2d');
    if (!back || !glass) {
      throw new Error('Canvas 2D is not available.');
    }
    this.backContext = back;
    this.glassContext = glass;
    this.dropletSprite = createDropletSprite();
    this.flameSprites = [
      createGlowSprite('255, 236, 150'),
      createGlowSprite('255, 150, 60'),
      createGlowSprite('220, 60, 40'),
    ];
    this.emberSprite = createGlowSprite('255, 210, 120');
  }

  setTargets(targets: EnvironmentTargets): void {
    this.targets = targets;
    this.start();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = Math.min(globalThis.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    for (const canvas of [this.backCanvas, this.glassCanvas]) {
      canvas.width = Math.round(this.width * this.pixelRatio);
      canvas.height = Math.round(this.height * this.pixelRatio);
    }
    this.backContext.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.glassContext.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    for (let index = 0; index < MAX_RAIN_STREAKS; index += 1) {
      this.resetStreak(index, true);
    }
    this.start();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frameHandle !== undefined) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = undefined;
    }
  }

  private start(): void {
    if (this.destroyed || this.frameHandle !== undefined) {
      return;
    }
    this.lastFrameAt = undefined;
    this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  private readonly onFrame = (now: number): void => {
    this.frameHandle = undefined;
    if (this.destroyed) {
      return;
    }
    const dt = this.lastFrameAt === undefined ? 1 / 60 : Math.min((now - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = now;

    const ease = 1 - Math.exp(-dt / EASING_SECONDS);
    this.rain += (this.targets.rain - this.rain) * ease;
    this.fire += (this.targets.fire - this.fire) * ease;
    this.wind += (this.targets.windSpeedMs - this.wind) * ease;
    if (this.rain < 0.002 && this.targets.rain === 0) {
      this.rain = 0;
    }
    if (this.fire < 0.002 && this.targets.fire === 0) {
      this.fire = 0;
    }

    this.drawBack(dt);
    this.drawGlass(dt);
    this.fireGlow.style.opacity = this.fire.toFixed(3);

    const idle =
      this.rain === 0 &&
      this.fire === 0 &&
      this.droplets.length === 0 &&
      this.flames.length === 0;
    if (!idle) {
      this.frameHandle = requestAnimationFrame(this.onFrame);
    }
  };

  // ------------------------------------------------------------------ back

  private drawBack(dt: number): void {
    const context = this.backContext;
    context.clearRect(0, 0, this.width, this.height);

    if (this.rain > 0) {
      // Storm light: darken the scene a little as rain gets stronger.
      // Storm light: dim the map a little (always a bit, so rain reads on light maps).
      context.fillStyle = `rgba(6, 14, 28, ${(0.06 + 0.3 * Math.pow(this.rain, 1.3)).toFixed(3)})`;
      context.fillRect(0, 0, this.width, this.height);
    }

    this.drawFlames(context, dt);
    this.drawRainStreaks(context, dt);
  }

  private drawRainStreaks(context: CanvasRenderingContext2D, dt: number): void {
    const scale = this.reducedMotion ? 0.35 : 1;
    // Steep curve: drizzle shows a few streaks, only storms fill the screen.
    const active = Math.floor(MAX_RAIN_STREAKS * scale * Math.pow(this.rain, 1.6));
    if (active === 0) {
      return;
    }
    const slant = 0.08 + Math.min(this.wind / 25, 0.6);
    const baseSpeed = 650 + 900 * this.rain;
    const baseLength = 10 + 26 * this.rain;

    context.lineCap = 'round';
    const visibility = Math.min(1, 0.45 + this.rain);
    for (let bucket = 0; bucket < RAIN_DEPTH_BUCKETS; bucket += 1) {
      const depthMin = bucket / RAIN_DEPTH_BUCKETS;
      const depthMax = (bucket + 1) / RAIN_DEPTH_BUCKETS;
      const depth = (depthMin + depthMax) / 2 + 0.25;
      const coreWidth = 0.7 + depth * 1.1;
      const alpha = (0.3 + 0.45 * depth) * visibility;
      context.beginPath();

      for (let index = 0; index < active; index += 1) {
        const z = this.streakDepth[index];
        if (z < depthMin || z >= depthMax) {
          continue;
        }
        const speed = baseSpeed * (0.55 + z * 0.75);
        this.streakY[index] += speed * dt;
        this.streakX[index] += speed * slant * dt;
        if (this.streakY[index] > this.height + 40 || this.streakX[index] > this.width + 60) {
          this.resetStreak(index, false);
        }
        const length = baseLength * (0.6 + z);
        const x = this.streakX[index];
        const y = this.streakY[index];
        context.moveTo(x, y);
        context.lineTo(x - length * slant, y - length);
      }
      // Dark edge + light core: readable over light base maps and dark oceans.
      context.lineWidth = coreWidth + 1.6;
      context.strokeStyle = `rgba(12, 28, 52, ${(alpha * 0.55).toFixed(3)})`;
      context.stroke();
      context.lineWidth = coreWidth;
      context.strokeStyle = `rgba(205, 228, 255, ${alpha.toFixed(3)})`;
      context.stroke();
    }
  }

  private resetStreak(index: number, anywhere: boolean): void {
    const slantRoom = this.height * 0.7;
    this.streakX[index] = Math.random() * (this.width + slantRoom) - slantRoom;
    this.streakY[index] = anywhere ? Math.random() * this.height : -Math.random() * 120;
    this.streakDepth[index] = Math.random() * 0.999;
  }

  private drawFlames(context: CanvasRenderingContext2D, dt: number): void {
    const scale = this.reducedMotion ? 0.4 : 1;
    this.flameSpawnDebt += dt * this.fire * 150 * scale;
    this.emberSpawnDebt += dt * this.fire * 28 * scale;
    while (this.flameSpawnDebt >= 1 && this.flames.length < MAX_FLAME_PARTICLES) {
      this.flameSpawnDebt -= 1;
      this.flames.push(this.createFlame(false));
    }
    while (this.emberSpawnDebt >= 1 && this.flames.length < MAX_FLAME_PARTICLES) {
      this.emberSpawnDebt -= 1;
      this.flames.push(this.createFlame(true));
    }
    this.flameSpawnDebt = Math.min(this.flameSpawnDebt, 1);
    this.emberSpawnDebt = Math.min(this.emberSpawnDebt, 1);
    if (this.flames.length === 0) {
      return;
    }

    context.save();
    context.globalCompositeOperation = 'lighter';
    const time = performance.now() / 1000;
    for (let index = this.flames.length - 1; index >= 0; index -= 1) {
      const particle = this.flames[index];
      particle.age += dt;
      if (particle.age >= particle.life) {
        this.flames.splice(index, 1);
        continue;
      }
      const progress = particle.age / particle.life;
      const sway = Math.sin(time * 3 + particle.x * 0.02) * (particle.ember ? 40 : 18);
      particle.x += (particle.velocityX + sway) * dt;
      particle.y += particle.velocityY * dt;

      if (particle.ember) {
        context.globalAlpha = (1 - progress) * 0.9;
        const size = particle.size;
        context.drawImage(this.emberSprite, particle.x - size, particle.y - size, size * 2, size * 2);
        continue;
      }
      const sprite =
        this.flameSprites[progress < 0.3 ? 0 : progress < 0.65 ? 1 : 2];
      const size = particle.size * (1 - progress * 0.45);
      context.globalAlpha = (1 - progress) * 0.5 * Math.max(this.fire, 0.25);
      context.drawImage(sprite, particle.x - size / 2, particle.y - size / 2, size, size);
    }
    context.restore();
  }

  private createFlame(ember: boolean): FlameParticle {
    const strength = 0.6 + 0.6 * this.fire;
    return ember
      ? {
          x: Math.random() * this.width,
          y: this.height + 4,
          velocityX: (Math.random() - 0.5) * 30,
          velocityY: -(90 + Math.random() * 160) * strength,
          age: 0,
          life: 1.6 + Math.random() * 2,
          size: 1.5 + Math.random() * 2.5,
          ember: true,
        }
      : {
          x: Math.random() * this.width,
          y: this.height + 20 + Math.random() * 20,
          velocityX: (Math.random() - 0.5) * 20,
          velocityY: -(55 + Math.random() * 110) * strength,
          age: 0,
          life: 0.9 + Math.random() * 1.1,
          size: (60 + Math.random() * 90) * strength,
          ember: false,
        };
  }

  // ----------------------------------------------------------------- glass

  private drawGlass(dt: number): void {
    const context = this.glassContext;
    context.clearRect(0, 0, this.width, this.height);

    const scale = this.reducedMotion ? 0.35 : 1;
    // Light rain: a few drops per second. Storm: dozens.
    const spawnRate = this.rain > 0 ? (1 + 44 * Math.pow(this.rain, 2)) * scale : 0;
    this.dropletSpawnDebt = Math.min(this.dropletSpawnDebt + spawnRate * dt, 4);
    while (this.dropletSpawnDebt >= 1 && this.droplets.length < MAX_GLASS_DROPLETS) {
      this.dropletSpawnDebt -= 1;
      this.droplets.push(this.createDroplet());
    }
    if (this.droplets.length === 0) {
      return;
    }

    for (let index = this.droplets.length - 1; index >= 0; index -= 1) {
      const droplet = this.droplets[index];
      droplet.age += dt;

      if (!this.reducedMotion && droplet.age > droplet.slideDelay) {
        droplet.velocity = Math.min(droplet.velocity + 260 * dt, 220);
        const step = droplet.velocity * dt;
        droplet.y += step;
        droplet.x += Math.sin(droplet.y * 0.05) * 0.4;
        droplet.trailDistance += step;
        if (droplet.trailDistance > 16 && this.droplets.length < MAX_GLASS_DROPLETS) {
          droplet.trailDistance = 0;
          droplet.radius *= 0.985;
          this.droplets.push({
            x: droplet.x + (Math.random() - 0.5) * 2,
            y: droplet.y - droplet.radius * 1.2,
            radius: droplet.radius * (0.22 + Math.random() * 0.15),
            age: 0,
            life: 1.5 + Math.random() * 2,
            slideDelay: Number.POSITIVE_INFINITY,
            velocity: 0,
            trailDistance: 0,
          });
        }
      }

      const outOfView = droplet.y - droplet.radius > this.height;
      if (droplet.age >= droplet.life || outOfView) {
        this.droplets.splice(index, 1);
        continue;
      }

      const fadeIn = Math.min(droplet.age / 0.15, 1);
      const fadeOut = Math.min((droplet.life - droplet.age) / 0.8, 1);
      context.globalAlpha = fadeIn * fadeOut;
      const size = droplet.radius * 2;
      // Slightly taller than wide, like water on glass.
      context.drawImage(
        this.dropletSprite,
        droplet.x - droplet.radius,
        droplet.y - droplet.radius * 1.1,
        size,
        size * 1.1,
      );
    }
    context.globalAlpha = 1;
  }

  private createDroplet(): Droplet {
    const big = Math.random() < 0.1 + 0.35 * Math.pow(this.rain, 1.5);
    const radius = big ? 5 + Math.random() * (5 + 8 * this.rain) : 1.5 + Math.random() * 3;
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height * 0.9,
      radius,
      age: 0,
      life: big ? 6 + Math.random() * 5 : 3 + Math.random() * 5,
      slideDelay: big ? 0.6 + Math.random() * 2.5 : Number.POSITIVE_INFINITY,
      velocity: 0,
      trailDistance: 0,
    };
  }
}

/**
 * Water drop on glass, readable on light and dark maps: soft shadow, darker
 * refracting body, dark lower rim, bright upper rim and a highlight.
 */
function createDropletSprite(): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }
  const center = size / 2;
  const radius = size / 2 - 5;

  // Shadow below the drop.
  context.fillStyle = 'rgba(0, 10, 25, 0.22)';
  context.beginPath();
  context.arc(center + 1.5, center + 3, radius, 0, Math.PI * 2);
  context.fill();

  // Body: darker at the bottom, like a lens refracting the scene.
  const body = context.createLinearGradient(0, center - radius, 0, center + radius);
  body.addColorStop(0, 'rgba(235, 245, 255, 0.35)');
  body.addColorStop(0.55, 'rgba(120, 160, 205, 0.28)');
  body.addColorStop(1, 'rgba(20, 45, 80, 0.5)');
  context.fillStyle = body;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();

  // Dark lower rim and bright upper rim.
  context.lineWidth = 2.5;
  context.strokeStyle = 'rgba(8, 22, 45, 0.7)';
  context.beginPath();
  context.arc(center, center, radius - 1, Math.PI * 0.05, Math.PI * 0.95);
  context.stroke();
  context.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(center, center, radius - 1.5, Math.PI * 1.15, Math.PI * 1.85);
  context.stroke();

  // Highlight.
  context.fillStyle = 'rgba(255, 255, 255, 0.95)';
  context.beginPath();
  context.ellipse(center - radius * 0.35, center - radius * 0.4, radius * 0.2, radius * 0.12, -0.6, 0, Math.PI * 2);
  context.fill();
  return canvas;
}

/** Soft round glow used for flame and ember particles. */
function createGlowSprite(rgb: string): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(${rgb}, 1)`);
  gradient.addColorStop(0.4, `rgba(${rgb}, 0.55)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return canvas;
}
