import type { Wind } from "./wind";

interface Drop {
  x: number;
  y: number;
  speed: number; // px/s
  len: number;
  near: boolean;
}

interface Splash {
  x: number;
  y: number;
  age: number;
}

const SPLASH_LIFE = 0.28;

export class Rain {
  private drops: Drop[] = [];
  private splashes: Splash[] = [];

  update(dt: number, intensity: number, w: number, groundY: number, scale: number, wind: Wind): void {
    const want = Math.round(Math.min(1, intensity) * Math.min(520, w / 3.2));
    while (this.drops.length < want) this.drops.push(this.make(w, groundY, scale, true));
    if (this.drops.length > want) this.drops.length = want;

    const slant = 70 + wind.x * 0.55; // rain leans with the wind
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.y += d.speed * dt;
      d.x += slant * (d.near ? 1 : 0.7) * dt;
      if (d.y >= groundY - Math.random() * 26 * scale) {
        if (d.near && this.splashes.length < 70 && Math.random() < 0.55) this.splashes.push({ x: d.x, y: groundY - 1, age: 0 });
        this.drops[i] = this.make(w, groundY, scale, false);
      }
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      this.splashes[i].age += dt;
      if (this.splashes[i].age > SPLASH_LIFE) {
        this.splashes[i] = this.splashes[this.splashes.length - 1];
        this.splashes.pop();
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, wind: Wind, intensity: number): void {
    if (!this.drops.length && !this.splashes.length) return;
    const slant = 70 + wind.x * 0.55;
    ctx.save();
    ctx.lineCap = "butt";
    for (const near of [false, true]) {
      ctx.strokeStyle = near ? `rgba(200,218,240,${(0.42 * intensity).toFixed(3)})` : `rgba(170,190,220,${(0.2 * intensity).toFixed(3)})`;
      ctx.lineWidth = near ? 1.4 : 1;
      ctx.beginPath();
      for (const d of this.drops) {
        if (d.near !== near) continue;
        const v = d.speed;
        const k = (slant * (near ? 1 : 0.7)) / v;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - k * d.len, d.y - d.len);
      }
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(215,228,245,1)";
    for (const s of this.splashes) {
      const p = s.age / SPLASH_LIFE;
      const r = 2 + p * 9;
      ctx.globalAlpha = (1 - p) * 0.5 * intensity;
      ctx.fillRect(Math.round(s.x - r), Math.round(s.y), 2, 1);
      ctx.fillRect(Math.round(s.x + r), Math.round(s.y), 2, 1);
      ctx.fillRect(Math.round(s.x), Math.round(s.y - r * 0.6), 1, 1);
    }
    ctx.restore();
  }

  clear(): void {
    this.drops.length = 0;
    this.splashes.length = 0;
  }

  private make(w: number, groundY: number, scale: number, scatter: boolean): Drop {
    const near = Math.random() < 0.55;
    const speed = (near ? 820 : 560) * (0.8 + Math.random() * 0.4) * scale;
    return {
      x: Math.random() * (w + 240) - 120, // wider than the screen so slanting rain still reaches the left edge
      y: scatter ? Math.random() * groundY : -20 - Math.random() * 120,
      speed,
      len: (near ? 16 : 9) * scale * (0.8 + Math.random() * 0.5),
      near,
    };
  }
}
