import type { Point } from "./tree";
import type { Wind } from "./wind";

interface Petal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fall: number; // fall speed, px/s
  amp: number; // sideways sway, px/s
  freq: number; // sway rate, rad/s
  phase: number;
  gain: number; // how much wind this petal catches
  kind: number;
  tone: number; // index into the light half of the ramp
  rest: number; // < 0 while falling, else seconds left lying on the ground
  alpha: number;
}

export interface PetalWorld {
  w: number;
  h: number;
  groundY: number;
  u: number; // size of one petal "pixel"
  scale: number; // speed multiplier for big or small windows
  sources: Point[]; // where blossom can fall from, in px
  colors: string[]; // four petal tones
  faded: string; // colour of a petal lying on the ground
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export class Petals {
  target = 200;
  /** Weather: rain weighs petals down so they fall faster. */
  fallMul = 1;
  private items: Petal[] = [];
  private debt = 0;

  constructor(
    private readonly world: PetalWorld,
    private readonly wind: Wind,
  ) {}

  scatter(): void {
    this.items = [];
    const n = Math.floor(this.target * 0.6);
    for (let i = 0; i < n; i++) {
      const p = this.make(false);
      p.y = rnd(0, this.world.groundY);
      this.items.push(p);
    }
  }

  update(dt: number): void {
    const { groundY, w, scale } = this.world;

    this.debt += (this.target / 14) * dt;
    while (this.debt >= 1) {
      this.debt -= 1;
      if (this.items.length < this.target) this.items.push(this.make(true));
    }

    const k = 1 - Math.exp(-dt * 1.7);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      if (p.rest >= 0) {
        p.rest -= dt;
        p.alpha = Math.min(p.alpha, Math.max(0, p.rest / 1.5));
        if (p.rest < 0 || p.alpha <= 0) this.drop(i);
        continue;
      }
      p.phase += p.freq * dt;
      const sway = Math.sin(p.phase) * p.amp * scale;
      p.vx += (this.wind.x * p.gain * scale + sway - p.vx) * k;
      p.vy += (p.fall * scale * this.fallMul + Math.cos(p.phase * 0.7) * 8 - p.vy) * k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < -10) p.x = w + 8;
      else if (p.x > w + 10) p.x = -8;

      if (p.y >= groundY) {
        p.y = groundY;
        p.rest = rnd(2, 7);
        p.kind = 3;
        p.vx = p.vy = 0;
      }
    }
  }

  /** Wind from a point: pushes nearby petals away and lets them tumble up. */
  impulse(x: number, y: number, radius: number, strength: number): void {
    for (const p of this.items) {
      if (p.rest >= 0) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const f = Math.pow(1 - d / radius, 1.4);
      const n = d > 0.001 ? 1 / d : 0;
      p.vx += dx * n * strength * f;
      p.vy += dy * n * strength * f * 0.7 - strength * f * 0.25;
    }
  }

  /** Shake blossom loose from the crown near a point. */
  shed(x: number, y: number, radius: number, count: number): void {
    const { sources } = this.world;
    const cap = Math.floor(this.target * 1.4);
    let made = 0;
    for (let tries = 0; tries < count * 12 && made < count && this.items.length < cap; tries++) {
      const s = sources[Math.floor(Math.random() * sources.length)];
      if (!s || Math.hypot(s[0] - x, s[1] - y) > radius) continue;
      const p = this.make(true, s);
      p.vx = rnd(-30, 30);
      this.items.push(p);
      made++;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { u, colors, faded } = this.world;
    for (const p of this.items) {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.rest >= 0 ? faded : colors[p.tone];
      switch (p.kind) {
        case 0: // tiny flower
          ctx.fillRect(x - u, y, u * 3, u);
          ctx.fillRect(x, y - u, u, u * 3);
          break;
        case 1:
          ctx.fillRect(x, y, u * 2, u * 2);
          break;
        case 2: // a petal turning over as it falls
          if (Math.sin(p.phase * 1.6) > 0) ctx.fillRect(x, y, u * 2, u);
          else ctx.fillRect(x, y, u, u * 2);
          break;
        default:
          ctx.fillRect(x, y, u, u);
      }
    }
    ctx.globalAlpha = 1;
  }

  private make(fromTree: boolean, at?: Point): Petal {
    const { sources, w } = this.world;
    let x: number;
    let y: number;
    const s = at ?? (fromTree && sources.length && Math.random() < 0.85 ? sources[Math.floor(Math.random() * sources.length)] : null);
    if (s) {
      x = s[0] + rnd(-4, 4);
      y = s[1] + rnd(0, 6);
    } else {
      x = rnd(0, w);
      y = -rnd(0, 20);
    }
    const r = Math.random();
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      fall: rnd(28, 72),
      amp: rnd(8, 34),
      freq: rnd(1.2, 4.2),
      phase: rnd(0, Math.PI * 2),
      gain: rnd(0.8, 1.3),
      kind: r < 0.22 ? 0 : r < 0.5 ? 1 : r < 0.85 ? 2 : 3,
      tone: Math.floor(Math.random() * 4),
      rest: -1,
      alpha: rnd(0.7, 1),
    };
  }

  private drop(i: number): void {
    this.items[i] = this.items[this.items.length - 1];
    this.items.pop();
  }
}
