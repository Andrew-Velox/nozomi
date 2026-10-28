export interface LightningWorld {
  w: number;
  h: number;
  groundY: number;
  u: number; // size of one pixel in the picture
}

type Point = [number, number];

// Brightness over time of one strike: a hard first flash, a weak flicker, a
// second strong flash and a fading tail.
const PULSES: [number, number][] = [
  [0, 1],
  [0.1, 0.35],
  [0.19, 0.8],
  [0.34, 0.3],
];
const PULSE_FADE = 0.07; // seconds
const BOLT_LIFE = 0.5;

export class Lightning {
  enabled = false;
  /** Called with the strength (0..1) when the thunder reaches us, a moment after the flash. */
  onThunder: ((strength: number) => void) | null = null;
  /** Gentler flashes, for people who asked for less motion. */
  soft = false;

  private next = 3;
  private age = -1; // seconds since the current strike, -1 when none
  private thunderAt = 0;
  private thunderStrength = 0;
  private thunderDone = true;
  private bolt: Point[][] = [];
  private flash = 0;

  /** How soon after switching it on the first strike lands. */
  arm(): void {
    this.next = 1.2;
  }

  /** `storm` (0..1) is how stormy the sky is: darker skies strike more often. */
  update(dt: number, storm: number, world: LightningWorld): void {
    if (this.age >= 0) {
      this.age += dt;
      if (!this.thunderDone && this.age >= this.thunderAt) {
        this.thunderDone = true;
        this.onThunder?.(this.thunderStrength);
      }
      if (this.age > BOLT_LIFE + 0.2 && this.thunderDone) this.age = -1;
    }
    const pulses = this.soft ? PULSES.slice(0, 1) : PULSES;
    this.flash = 0;
    if (this.age >= 0) {
      for (const [at, strength] of pulses) {
        if (this.age >= at) this.flash = Math.max(this.flash, strength * Math.exp(-(this.age - at) / PULSE_FADE));
      }
      if (this.soft) this.flash *= 0.5;
    }

    if (!this.enabled) return;
    this.next -= dt;
    if (this.next <= 0) {
      this.strike(world);
      this.next = (14 - 10 * Math.min(1, storm)) * (0.6 + Math.random() * 0.9);
    }
  }

  strike(world: LightningWorld): void {
    this.age = 0;
    this.thunderAt = 0.4 + Math.random() * 1.8; // farther strikes rumble later
    this.thunderStrength = 0.5 + Math.random() * 0.5;
    this.thunderDone = false;
    this.makeBolt(world);
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, world: LightningWorld): void {
    if (this.age < 0 || this.flash < 0.01) return;
    const f = this.flash;
    ctx.save();

    // the whole sky and everything under it lights up
    ctx.globalCompositeOperation = "screen";
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, `rgba(208,222,255,${(f * 0.6).toFixed(3)})`);
    sky.addColorStop(1, `rgba(160,182,250,${(f * 0.3).toFixed(3)})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";

    if (this.age < BOLT_LIFE && !this.soft) {
      const a = Math.min(1, f * 1.5);
      ctx.lineCap = "square";
      ctx.lineJoin = "miter";
      for (const [width, color] of [
        [world.u * 7, `rgba(150,180,255,${(0.2 * a).toFixed(3)})`],
        [world.u * 2.6, `rgba(205,222,255,${(0.85 * a).toFixed(3)})`],
        [Math.max(1, world.u * 1), `rgba(255,255,255,${a.toFixed(3)})`],
      ] as [number, string][]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        for (const path of this.bolt) {
          ctx.beginPath();
          ctx.moveTo(path[0][0], path[0][1]);
          for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private makeBolt(world: LightningWorld): void {
    const { w, groundY, u } = world;
    const seg = Math.max(u * 5, groundY * 0.03);
    const snap = (v: number): number => Math.round(v / u) * u; // keep the bolt on the picture's pixel grid
    const endY = groundY - Math.random() * 14;

    const main: Point[] = [[snap(w * (0.12 + Math.random() * 0.76)), -4]];
    while (main[main.length - 1][1] < endY) {
      const [x, y] = main[main.length - 1];
      main.push([snap(x + (Math.random() - 0.5) * seg * 1.9), snap(y + seg * (0.65 + Math.random() * 0.7))]);
    }
    this.bolt = [main];

    // a few forks leave the main bolt and peter out
    const forks = 2 + Math.floor(Math.random() * 3);
    for (let f = 0; f < forks; f++) {
      const i = 2 + Math.floor(Math.random() * Math.max(1, main.length - 4));
      const dir = Math.random() < 0.5 ? -1 : 1;
      const path: Point[] = [[main[i][0], main[i][1]]];
      const steps = 3 + Math.floor(Math.random() * 4);
      for (let s = 0; s < steps; s++) {
        const [x, y] = path[path.length - 1];
        path.push([snap(x + dir * seg * (0.4 + Math.random() * 0.8)), snap(y + seg * (0.45 + Math.random() * 0.5))]);
      }
      this.bolt.push(path);
    }
  }
}
