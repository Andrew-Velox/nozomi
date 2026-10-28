import { brighten, hex, mix, type Rgb } from "./color";
import {
  G_BLADE, G_BLOCK, G_DOT,
  K_CANOPY, K_GROUND, K_WOOD,
  type Grid,
} from "./grid";
import { noise2 } from "./noise";
import type { Rng } from "./rng";

export type Form = "yoshino" | "bush" | "shidare";
export type Point = [number, number];

export const WOOD_D = hex("#4a2c19");
export const WOOD_M = hex("#7d4d27");
export const WOOD_L = hex("#a8703c");
export const GRASS = hex("#87a985");
export const GRASS_DARK = hex("#3f6b4a");

export interface CellEnv {
  grid: Grid;
  ramp: Rgb[];
  rowBg: Rgb[];
  rowHaze: Rgb[]; // the dark shade the canopy sits on, per row
  aspect: number; // cell height / cell width
  rng: Rng;
  foliage: Grid; // blossom goes here so it can sway
  strands: Grid; // weeping strands go here so they can sway
}

interface Blob {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

interface FormSpec {
  crown: [number, number]; // crown height as a share of tree height
  spread: [number, number]; // crown width over tree height
  maxw: number; // widest the crown may get, as a share of screen width
  dome: [number, number]; // how far centre limbs out-reach outer ones
  lift: [number, number]; // where the outer limb tips sit, in crown radii
  lean: number;
  bend: number; // how soon a limb turns upward
}

const SPECS: Record<Form, FormSpec> = {
  yoshino: { crown: [0.54, 0.64], spread: [1.15, 1.4], maxw: 0.8, dome: [0.4, 0.65], lift: [-0.15, -0.05], lean: 0.12, bend: 0.3 },
  bush: { crown: [0.58, 0.68], spread: [1.05, 1.25], maxw: 0.78, dome: [0.5, 0.7], lift: [-0.1, 0], lean: 0.08, bend: 0.35 },
  shidare: { crown: [0.46, 0.54], spread: [0.95, 1.15], maxw: 0.7, dome: [0.45, 0.6], lift: [-0.12, -0.04], lean: 0.06, bend: 0.35 },
};

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

function quadBez(a: Point, q: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * q[0] + t * t * b[0], u * u * a[1] + 2 * u * t * q[1] + t * t * b[1]];
}

// Shade steps for a partly covered cell.
const shadeOf = (c: number): number => (c > 0.85 ? 1 : c > 0.55 ? 0.74 : c > 0.28 ? 0.48 : 0.24);

/** Grow a tree out of character-style cells. Returns the cells petals fall from. */
export function growCellTree(env: CellEnv, form: Form): Point[] {
  const { grid, ramp, rowBg, rowHaze, rng, strands, foliage } = env;
  const gw = grid.w;
  const gh = grid.h;
  const ar = env.aspect;
  const sources: Point[] = [];
  const blobs: Blob[] = [];
  const tips: Point[] = [];

  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const pickIn = (r: [number, number]): number => rand(r[0], r[1]);
  const bloom = (): number => Math.floor(rng() * 4);

  const put = (x: number, y: number, glyph: number, color: Rgb, kind: number, cov = 1, bg?: Rgb): void => {
    grid.set(x, y, { glyph, color, bg: bg ?? rowBg[Math.floor(y)] ?? rowBg[gh - 1], cov, kind });
  };

  const putLeaf = (x: number, y: number, glyph: number, color: Rgb, cov: number, bg: Rgb): void => {
    foliage.set(x, y, { glyph, color, bg, cov, kind: K_CANOPY });
  };

  // ---- field of blossom: a sum of soft blobs --------------------------------
  const field = (x: number, y: number): number => {
    let s = 0;
    for (const b of blobs) {
      const dx = (x - b.x) / b.rx;
      const dy = (y - b.y) / b.ry;
      s += Math.exp(-(dx * dx + dy * dy) * 1.7);
    }
    return s;
  };
  const wobble = (x: number, period: number): number => noise2(x / period, 0.5) - 0.5;

  // ---- wood -----------------------------------------------------------------
  // One horizontal slice of wood. Partial coverage at the edges makes the
  // taper read as a curve instead of a staircase.
  const woodSpan = (x: number, y: number, w: number, dark: Rgb, mid: Rgb, lite: Rgb, sides: boolean): void => {
    for (let xi = Math.floor(x - w); xi <= Math.ceil(x + w); xi++) {
      const cov = Math.min(xi + 1, x + w) - Math.max(xi, x - w);
      if (cov <= 0.06) continue;
      if (cov <= 0.85 && grid.kind(xi, y) === K_WOOD) continue;
      const d = (xi + 0.5 - x) / Math.max(w, 0.5);
      const color = !sides ? mid : d < -0.3 ? dark : d > 0.4 ? lite : mid;
      put(xi, y, G_BLOCK, color, K_WOOD, shadeOf(cov));
    }
  };

  const genTrunk = (bx: number, tx: number, ty: number, maxw: number): void => {
    const baseY = gh - 2;
    const h = Math.max(baseY - ty, 2);
    const bend = rand(-1, 1) * Math.max(maxw * 0.7, 0.6);
    for (let y = Math.floor(ty); y <= baseY; y++) {
      const t = clamp((baseY - y) / h, 0, 1);
      const x = bx + (tx - bx) * t + Math.sin(t * Math.PI) * bend;
      const w = maxw * (1 - 0.45 * t) * (1 + 0.55 * Math.exp(-t * 7));
      woodSpan(x, y, Math.max(w, 0.55), WOOD_D, WOOD_M, WOOD_L, true);
    }
  };

  // A limb is a quadratic curve rather than a random walk, so the crown that
  // grows around the tips never comes out lopsided.
  const genLimb = (p0: Point, q: Point, p1: Point, w0: number, w1: number, mid: Rgb): void => {
    const len = Math.hypot(q[0] - p0[0], (q[1] - p0[1]) * ar) + Math.hypot(p1[0] - q[0], (p1[1] - q[1]) * ar);
    const steps = Math.floor(len * 2.5) + 4;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const w = w0 + (w1 - w0) * t;
      if (w < 0.32) break; // sub-cell twigs only scatter specks
      const [x, y] = quadBez(p0, q, p1, t);
      const dx = u * (q[0] - p0[0]) + t * (p1[0] - q[0]);
      const dy = (u * (q[1] - p0[1]) + t * (p1[1] - q[1])) * ar;
      woodSpan(x, Math.floor(y), w, WOOD_D, mid, WOOD_L, Math.abs(dy) > Math.abs(dx));
    }
  };

  // ---- canopy ---------------------------------------------------------------
  const genCanopy = (cx: number, rx: number, ryDesign: number): void => {
    let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
    for (const b of blobs) {
      bx0 = Math.min(bx0, b.x - b.rx);
      bx1 = Math.max(bx1, b.x + b.rx);
      by0 = Math.min(by0, b.y - b.ry);
      by1 = Math.max(by1, b.y + b.ry);
    }
    by0 = Math.max(by0, 0);
    const cy = (by0 + by1) / 2;
    const ry = Math.max((by1 - by0) / 2, 2);

    // Feature sizes follow the tree so texture scales with the window.
    const wobAmp = Math.max(ryDesign * 0.18, 0.8);
    const wobPer = Math.max(rx * 0.11, 2);
    const clumpX = Math.max(rx * 0.22, 2);
    const clumpY = Math.max(ryDesign * 0.26, 1.2);

    for (let y = Math.max(Math.floor(by0 - 1), 0); y <= Math.min(Math.floor(by1 + 3), gh - 1); y++) {
      const haze = rowHaze[y];
      for (let x = Math.max(Math.floor(bx0 - 3), 0); x <= Math.min(Math.floor(bx1 + 3), gw - 1); x++) {
        const wob = wobble(x, wobPer) * wobAmp;
        const f = field(x, y + wob);
        if (f < 0.2) continue;

        let cov0 = clamp((f - 0.2) / 0.6, 0, 1);
        cov0 = cov0 * cov0 * (3 - 2 * cov0);

        // Two octaves of noise break the mass into the clumps a cherry has.
        const cl = 0.62 * noise2(x / clumpX, y / clumpY) + 0.38 * noise2(x / (clumpX * 0.45), y / (clumpY * 0.5));
        const cov = clamp(cov0 * (0.5 + cl), 0, 1);

        // Ragged rim. Gaps deep in the crown fall back to the deepest blossom
        // tone, so they read as shadow instead of black specks.
        if (cov < 0.55 && rng() > cov * 1.5) {
          if (cov0 > 0.6 && grid.kind(x, y) !== K_WOOD) putLeaf(x, y, G_BLOCK, ramp[7], 0.74, haze);
          continue;
        }

        const h = clamp((y - (cy - ry)) / (2 * ry), 0, 1);
        // thin the underside into wisps
        if (h > 0.72 && rng() < (h - 0.72) * 2.2 * (1.3 - cov)) continue;

        // Let limbs show through between clusters.
        if (rx >= 16 && (cov < 0.5 || cl < 0.3) && grid.kind(x, y) === K_WOOD) {
          grid.at(x, y)!.bg = haze;
          continue;
        }

        // Light from the upper left; the mass shades what hangs below it.
        let shade = 1.1 + h * 5.2 + ((x - cx) / Math.max(rx, 1)) * 0.7 + (1 - cov) * 2 + (0.5 - cl) * 2.8 + rand(-1.05, 1.05);
        const fu = field(x, y + wob - 1.6);
        if (fu > f * 1.1) shade += 1.6;
        else if (fu < f * 0.85) shade -= 1.4;

        const idx = clamp(Math.floor(shade), 0, 7);
        const base = ramp[idx];
        let glyph = G_BLOCK;
        let color = base;
        let bg = haze;
        let shadeCov = cov > 0.62 ? 1 : cov > 0.42 ? 0.74 : cov > 0.24 ? 0.48 : 0.24;

        // Blossoms ride on top of the mass, densest at the rim.
        if (rng() < 0.06 + 0.16 * cl + 0.14 * (1 - cov)) {
          glyph = bloom();
          shadeCov = 1;
          bg = mix(haze, base, cov * 0.85);
          color = idx <= 2 ? ramp[idx + 3] : ramp[idx - 3];
          if (idx > 2 && rng() < 0.35) color = brighten(color);
        }

        putLeaf(x, y, glyph, color, shadeCov, bg);
        if ((cov < 0.55 || fu > f * 1.1) && rng() < 0.5) sources.push([x, y]);
      }
    }
  };

  // Weeping cherry: strands of blossom hanging from the crown.
  const genCurtain = (cx: number, rx: number): void => {
    const floorY = gh - 2;
    for (let x = Math.floor(cx - rx * 1.05); x <= Math.floor(cx + rx * 1.05); x++) {
      if (x < 0 || x >= gw || rng() < 0.25) continue;
      let y0 = -1;
      for (let y = gh - 2; y >= 0; y--) {
        if (foliage.kind(x, y) === K_CANOPY) {
          y0 = y;
          break;
        }
      }
      if (y0 < 0) continue;
      const frac = Math.min(Math.abs(x - cx) / rx, 1);
      const len = (floorY - y0) * (0.25 + 0.65 * Math.pow(frac, 0.8)) * rand(0.55, 1);
      for (let k = 1; k <= Math.floor(len); k++) {
        const y = y0 + k;
        if (y >= gh - 1 || grid.kind(x, y) === K_WOOD) break;
        const t = k / Math.max(len, 1);
        if (rng() < t * 0.45) continue;
        const idx = clamp(Math.floor(1.5 + t * 3.5 + rand(-1, 1)), 0, 7);
        const bg = rowBg[y];
        if (rng() < 0.22) strands.set(x, y, { glyph: bloom(), color: ramp[idx], bg, cov: 1, kind: K_CANOPY, sky: true });
        else strands.set(x, y, { glyph: G_BLOCK, color: ramp[idx], bg, cov: t < 0.55 ? 0.48 : 0.24, kind: K_CANOPY, sky: true });
        if (rng() < 0.15) sources.push([x, y]);
      }
    }
  };

  // ---- ground ---------------------------------------------------------------
  // A carpet of grass: every column is solid from the ground up to its own
  // height, dark at the root and lighter toward the tip, taller in clumps. It
  // is drawn after the trunk so it grows in front of the base of the log.
  const genGround = (cx: number, rx: number): void => {
    const y = gh - 1;
    const rows = clamp(Math.round(gh * 0.09), 2, 4);
    const shade = (k: number, of: number): Rgb =>
      mix(GRASS_DARK, GRASS, clamp((of <= 1 ? 0.5 : k / (of - 1)) * 0.75 + rng() * 0.3, 0, 1));

    for (let x = 0; x < gw; x++) {
      const dx = (x - cx) / (rx * 1.25);
      const p = Math.exp(-dx * dx * 2.2);
      const clump = noise2(x * 0.17, 7.3) * 0.7 + noise2(x * 0.5, 3.1) * 0.3;
      const height = 1 + (rows - 0.4) * clump * (0.5 + rng() * 0.7);
      const full = Math.floor(height);
      const frac = height - full;

      for (let k = 0; k < full; k++) put(x, y - k, G_BLOCK, shade(k, full), K_GROUND);

      // the tip fades out with a partly covered cell, or a single blade
      if (y - full >= 0) {
        const tip = (glyph: number, cov: number): void =>
          grid.set(x, y - full, { glyph, color: shade(full, full + 1), bg: rowBg[y - full], cov, kind: K_GROUND, sky: true });
        if (rng() < 0.3) tip(G_BLADE, 1);
        else if (frac > 0.25) tip(G_BLOCK, frac > 0.66 ? 0.74 : frac > 0.4 ? 0.48 : 0.24);
      }

      // fallen petals resting on the grass, thickest round the roots
      if (rng() < p * 0.3) {
        const row = Math.floor(rng() * Math.min(full, 2));
        const under = grid.at(x, y - row)?.color ?? rowBg[y];
        put(x, y - row, rng() < 0.4 ? bloom() : G_DOT, ramp[1 + Math.floor(rng() * 3)], K_GROUND, 1, under);
      }
    }
  };

  // ---- assemble the tree ----------------------------------------------------
  const spec = SPECS[form];
  const ground = gh - 1;
  const topPad = gh < 20 ? 1 : clamp(gh * 0.06, 1, 4);
  // Sized as one shape, in column widths, so proportions hold at any window shape.
  const avail = Math.max(ground - topPad, 5) * ar;
  const tall = Math.min(avail, gw * 0.95);
  const crown = tall * pickIn(spec.crown);
  const wide = 1 + 0.3 * clamp((gw / tall - 2) / 2, 0, 1);
  const width = Math.min(gw * spec.maxw, tall * pickIn(spec.spread) * wide);

  const rx = Math.max(width * 0.5, 5);
  const ry = Math.max((crown * 0.5) / ar, 2.2);

  // Real trees lean: the crown sits off to one side of the roots.
  const mid = gw * 0.5 + rand(-1, 1) * Math.min(1.5, gw * 0.02);
  const lean = rand(-1, 1) * spec.lean * rx;
  const yTop = ground - tall / ar;
  const cx = mid + lean * 0.5;
  const cy = yTop + ry;

  let fy = cy + ry * 0.95;
  fy = Math.min(fy + (gh - 2 - fy) * 0.15, gh - 3);
  const trunkW = Math.max(tall * 0.042, 1);
  const limbW = Math.max(trunkW * 0.62, 0.7);
  const bx = mid - lean * 0.5;
  const tx = cx - lean * 0.2 + rand(-1, 1) * Math.max(rx * 0.03, 0.4);

  genTrunk(bx, tx, fy, trunkW);
  genGround(cx, rx); // after the trunk, so the grass grows in front of it

  // Limbs fan across the crown: centre ones reach highest, outer ones spread
  // wide before turning up.
  const dome = pickIn(spec.dome);
  const lift = pickIn(spec.lift);
  const limbs = rx < 12 ? 3 : 4 + Math.floor(rng() * 2);
  const addTip = (x: number, y: number): void => {
    if (tips.length < 24) tips.push([x, y]);
  };
  for (let i = 0; i < limbs; i++) {
    const s = clamp(((i + 0.5) / limbs) * 2 - 1 + rand(-0.14, 0.14), -0.95, 0.95);
    const p0: Point = [tx + s * trunkW * 0.5, fy + rand(-0.3, 0.6)];
    const p1: Point = [cx + s * rx * 0.72 + rand(-0.05, 0.05) * rx, cy - ry * (lift + dome * (1 - s * s)) + rand(-0.12, 0.12) * ry];
    const q: Point = [p0[0] + (p1[0] - p0[0]) * 0.6, p0[1] - (p0[1] - p1[1]) * (spec.bend + rand(-0.08, 0.08))];
    genLimb(p0, q, p1, limbW, limbW * 0.35, Math.abs(s) < 0.4 ? WOOD_M : WOOD_L);
    addTip(p1[0], p1[1]);

    // each limb throws one twig off its outer half
    const side = Math.abs(s) < 0.2 ? (rng() < 0.5 ? -1 : 1) : s < 0 ? -1 : 1;
    const b0 = quadBez(p0, q, p1, rand(0.55, 0.75));
    const b1: Point = [clamp(b0[0] + side * rx * rand(0.18, 0.3), cx - rx * 0.85, cx + rx * 0.85), b0[1] - ry * rand(0.2, 0.45)];
    const bq: Point = [b0[0] + (b1[0] - b0[0]) * 0.6, b0[1] - (b0[1] - b1[1]) * 0.2];
    genLimb(b0, bq, b1, limbW * 0.45, limbW * 0.2, WOOD_L);
    addTip(b1[0], b1[1]);
  }

  // The canopy grows out of the limbs: a core blob, a puff at every tip, and a
  // few low clumps so the underside hangs in wisps.
  const lim = Math.max(yTop - ry * 0.15, 0);
  const addBlob = (x: number, y: number, brx: number, bry: number): void => {
    if (blobs.length >= 32) return;
    blobs.push({ x, y: y - bry < lim ? lim + bry : y, rx: brx, ry: bry });
  };
  addBlob(cx, cy + ry * 0.05, rx * 0.52, ry * 0.58);
  for (const [px, py] of tips) {
    if (blobs.length >= 28) break;
    addBlob(px + rand(-0.8, 0.8), py - rand(0, 0.25) * ry, rx * rand(0.24, 0.32), ry * rand(0.36, 0.48));
  }
  for (let i = 0; i < 4; i++) {
    const s = ((i + 0.5) / 4) * 2 - 1;
    addBlob(cx + (s * 0.7 + rand(-0.08, 0.08)) * rx, cy + rand(0.35, 0.55) * ry, rx * rand(0.18, 0.26), ry * rand(0.26, 0.36));
  }

  genCanopy(cx, rx, ry);
  if (form === "shidare") genCurtain(cx, rx);
  return sources;
}
