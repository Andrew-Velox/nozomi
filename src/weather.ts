import type { Rgb } from "./color";

export const WEATHERS = ["clear", "sunset", "moonlight", "overcast", "mist", "rain"] as const;
export type Weather = (typeof WEATHERS)[number];

type Rgba = [number, number, number, number];

// One weather is a "look": a set of numbers the overlay is drawn from. Moving
// between weathers eases every number, so the sky changes slowly instead of
// cutting.
export interface Look {
  tint: Rgb; // multiplied over the whole scene
  veilTop: Rgba; // colour laid over the sky, rgba with alpha 0..1
  veilBottom: Rgba;
  glow: Rgb; // a soft light source, screen-blended
  glowAlpha: number;
  glowX: number; // 0..1 across the screen
  glowY: number;
  vignette: number;
  cloud: number; // drifting cloud shadows, 0..1
  fog: number; // low drifting fog, 0..1
  rain: number; // rain intensity, 0..1
  windMul: number; // wind strength multiplier
  fall: number; // petal fall speed multiplier
  dark: number; // extra darkening, 0..1
}

const NONE: Rgba = [0, 0, 0, 0];

export const LOOKS: Record<Weather, Look> = {
  clear: {
    tint: [255, 255, 255], veilTop: NONE, veilBottom: NONE,
    glow: [255, 200, 230], glowAlpha: 0, glowX: 0.5, glowY: 0.3,
    vignette: 0.12, cloud: 0, fog: 0, rain: 0, windMul: 1, fall: 1, dark: 0,
  },
  sunset: {
    tint: [255, 238, 228], veilTop: [150, 76, 156, 0.26], veilBottom: [255, 150, 88, 0.2],
    glow: [255, 150, 92], glowAlpha: 0.6, glowX: 0.5, glowY: 1.02,
    vignette: 0.26, cloud: 0.12, fog: 0, rain: 0, windMul: 0.85, fall: 0.95, dark: 0,
  },
  moonlight: {
    tint: [172, 192, 246], veilTop: [22, 42, 104, 0.26], veilBottom: [10, 20, 62, 0.2],
    glow: [150, 176, 255], glowAlpha: 0.24, glowX: 0.78, glowY: 0.12,
    vignette: 0.34, cloud: 0.2, fog: 0, rain: 0, windMul: 0.9, fall: 1, dark: 0.04,
  },
  overcast: {
    tint: [214, 224, 236], veilTop: [96, 103, 120, 0.62], veilBottom: [72, 78, 92, 0.5],
    glow: [200, 210, 230], glowAlpha: 0, glowX: 0.5, glowY: 0.2,
    vignette: 0.28, cloud: 0.78, fog: 0, rain: 0, windMul: 1.25, fall: 1.05, dark: 0.1,
  },
  mist: {
    tint: [236, 226, 242], veilTop: [192, 182, 208, 0.4], veilBottom: [216, 206, 226, 0.5],
    glow: [235, 225, 245], glowAlpha: 0.1, glowX: 0.5, glowY: 0.5,
    vignette: 0.16, cloud: 0.25, fog: 0.85, rain: 0, windMul: 0.6, fall: 0.85, dark: 0,
  },
  rain: {
    tint: [174, 194, 216], veilTop: [50, 62, 84, 0.64], veilBottom: [34, 44, 62, 0.56],
    glow: [150, 180, 220], glowAlpha: 0, glowX: 0.5, glowY: 0.2,
    vignette: 0.42, cloud: 0.62, fog: 0.25, rain: 1, windMul: 1.8, fall: 1.5, dark: 0.12,
  },
};

function blobSprite(color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.scale(1, 0.5);
  const fill = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  fill.addColorStop(0, color.replace("A)", "1)"));
  fill.addColorStop(0.55, color.replace("A)", "0.45)"));
  fill.addColorStop(1, color.replace("A)", "0)"));
  g.fillStyle = fill;
  g.fillRect(0, 0, 256, 256);
  return canvas;
}

interface Drifter {
  x: number; // 0..1 starting position
  y: number; // 0..1 height
  r: number; // radius in px at a 1500px wide window
  speed: number; // px/s
}

const drifters = (n: number, y0: number, y1: number, r0: number, r1: number, s0: number, s1: number): Drifter[] =>
  Array.from({ length: n }, () => ({
    x: Math.random(),
    y: y0 + Math.random() * (y1 - y0),
    r: r0 + Math.random() * (r1 - r0),
    speed: s0 + Math.random() * (s1 - s0),
  }));

const rgb = (c: Rgb): string => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const rgba = (c: Rgba): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3].toFixed(3)})`;

export class WeatherFx {
  readonly look: Look = structuredClone(LOOKS.clear);
  private target: Look = LOOKS.clear;
  private readonly cloudSprite = blobSprite("rgba(58,64,82,A)");
  private readonly fogSprite = blobSprite("rgba(228,220,238,A)");
  private readonly clouds = drifters(7, 0.0, 0.5, 220, 420, 6, 16);
  private readonly fogs = drifters(6, 0.55, 0.98, 240, 440, 4, 10);

  set(weather: Weather): void {
    this.target = LOOKS[weather];
  }

  /** Ease every number of the current look toward the target. */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 1.6);
    const cur = this.look as unknown as Record<string, number | number[]>;
    const tar = this.target as unknown as Record<string, number | number[]>;
    for (const key of Object.keys(cur)) {
      const a = cur[key];
      const b = tar[key];
      if (Array.isArray(a) && Array.isArray(b)) for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * k;
      else if (typeof a === "number" && typeof b === "number") cur[key] = a + (b - a) * k;
    }
  }

  /** Sky colour, light, clouds and fog, laid over the finished scene. */
  drawGrade(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const l = this.look;
    ctx.save();

    if (l.veilTop[3] > 0.004 || l.veilBottom[3] > 0.004) {
      const veil = ctx.createLinearGradient(0, 0, 0, h);
      veil.addColorStop(0, rgba(l.veilTop));
      veil.addColorStop(1, rgba(l.veilBottom));
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, w, h);
    }

    if (l.tint[0] < 254.5 || l.tint[1] < 254.5 || l.tint[2] < 254.5) {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = rgb(l.tint);
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    }

    if (l.dark > 0.004) {
      ctx.fillStyle = `rgba(0,0,0,${l.dark.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (l.glowAlpha > 0.004) {
      ctx.globalCompositeOperation = "screen";
      const gx = l.glowX * w;
      const gy = l.glowY * h;
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h) * 0.8);
      glow.addColorStop(0, `rgba(${l.glow.map(Math.round).join(",")},${l.glowAlpha.toFixed(3)})`);
      glow.addColorStop(1, `rgba(${l.glow.map(Math.round).join(",")},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    }

    const scale = Math.max(0.5, w / 1500);
    if (l.cloud > 0.02) this.drift(ctx, this.cloudSprite, this.clouds, w, h, t, scale, l.cloud * 0.4);
    if (l.fog > 0.02) {
      const low = ctx.createLinearGradient(0, h * 0.4, 0, h);
      low.addColorStop(0, "rgba(222,214,234,0)");
      low.addColorStop(1, `rgba(222,214,234,${(l.fog * 0.42).toFixed(3)})`);
      ctx.fillStyle = low;
      ctx.fillRect(0, h * 0.4, w, h * 0.6);
      this.drift(ctx, this.fogSprite, this.fogs, w, h, t, scale, l.fog * 0.28);
    }
    ctx.restore();
  }

  drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = this.look.vignette;
    if (v < 0.01) return;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.78);
    g.addColorStop(0, "rgba(2,8,14,0)");
    g.addColorStop(1, `rgba(2,8,14,${v.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private drift(
    ctx: CanvasRenderingContext2D,
    sprite: HTMLCanvasElement,
    list: Drifter[],
    w: number,
    h: number,
    t: number,
    scale: number,
    alpha: number,
  ): void {
    ctx.globalAlpha = Math.min(1, alpha);
    for (const d of list) {
      const r = d.r * scale;
      const span = w + r * 4;
      const x = ((d.x * span + t * d.speed * scale) % span) - r * 2;
      ctx.drawImage(sprite, x - r, d.y * h - r * 0.5, r * 2, r);
    }
    ctx.globalAlpha = 1;
  }
}
