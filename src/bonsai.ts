import { hex, mix, type Rgb } from "./color";
import { G_BLOCK, K_CANOPY, K_GROUND, K_WOOD, type Grid } from "./grid";
import { noise2 } from "./noise";
import type { Rng } from "./rng";
import type { Point } from "./tree";

// A bonsai in single pixels: a trunk drawn along a designed curve (each classic style has its own),
// branches that carry flat pads of foliage, and a glazed pot with soil and moss on a wooden table.
// The wood goes in `grid`, the foliage in `foliage` (so it can sway), and the pot and table are
// part of the ground.

export type BonsaiForm = "moyogi" | "chokkan" | "shakan" | "kengai" | "bunjin";
export const BONSAI_STYLES: readonly BonsaiForm[] = ["moyogi", "chokkan", "shakan", "kengai", "bunjin"];

export interface BonsaiEnv {
  grid: Grid; // square cells: one cell is one pixel
  foliage: Grid; // the pads of leaves go here so they can sway
  ramp: Rgb[]; // leaf colours, 0 lightest to 7 deepest
  rng: Rng;
}

export interface BonsaiResult {
  sources: Point[]; // where leaves can fall from, in cells
  groundRow: number; // the row leaves come to rest on (the table top)
}

const BARK = ["#271a13", "#46321f", "#6d4d36", "#977655"].map(hex);
const DEAD = ["#8d7e6d", "#b5a791", "#d9cdb7"].map(hex); // bleached deadwood
const POT = { dark: hex("#1c2733"), mid: hex("#33495e"), light: hex("#58788f"), rim: hex("#86a6bd"), rimDark: hex("#4a667d") };
const SOIL = ["#241b15", "#33271f", "#46372b"].map(hex);
const MOSS = ["#2b5233", "#417542", "#62994f", "#8fc067"].map(hex);
const STONE = ["#6b6b72", "#8e8e95", "#b4b4b9"].map(hex);
const TABLE_TOP = ["#7a5b3b", "#8c6c47", "#a38158"].map(hex);
const TABLE_FACE = ["#3b2a1a", "#4d3722", "#614630"].map(hex);
const STAND = ["#1f1712", "#33261d", "#54402f"].map(hex);

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

// A uniform Catmull-Rom curve through the points, sampled n + 1 times.
function spline(pts: Point[], n: number): Point[] {
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const segs = pts.length - 1;
  const cr = (a: number, b: number, c: number, d: number, t: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const f = (i / n) * segs;
    const s = Math.min(Math.floor(f), segs - 1);
    const t = f - s;
    const [p0, p1, p2, p3] = [P[s], P[s + 1], P[s + 2], P[s + 3]];
    out.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
  }
  return out;
}

function quad(a: Point, q: Point, b: Point, n: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * q[0] + t * t * b[0], u * u * a[1] + 2 * u * t * q[1] + t * t * b[1]]);
  }
  return out;
}

interface Style {
  /** The trunk's path as (sideways, up) in tree heights from the roots. */
  path: [number, number][];
  branches: number;
  t0: number; // first and last branch, as a share of the trunk's length
  t1: number;
  reach: number; // the longest branch, in tree heights
  trunk: number; // thickness at the base, in tree heights
  taper: number; // how much thinner the top is, 0 to 1
  pad: number; // size of the foliage pads
  apex: number; // size of the top pad
  droop: number; // how far the low branches sag at the tip
  shari: boolean; // a strip of bleached deadwood down the trunk
}

const STYLES: Record<BonsaiForm, Style> = {
  // informal upright: the classic S-shaped trunk
  moyogi: {
    path: [[0, 0], [0.1, 0.18], [-0.07, 0.42], [0.08, 0.68], [-0.01, 0.98]],
    branches: 6, t0: 0.3, t1: 0.82, reach: 0.34, trunk: 0.036, taper: 0.8, pad: 1, apex: 1, droop: 0.14, shari: true,
  },
  // formal upright: straight and tapering, branches in tiers
  chokkan: {
    path: [[0, 0], [0.006, 0.33], [-0.006, 0.66], [0.004, 0.98]],
    branches: 7, t0: 0.26, t1: 0.84, reach: 0.31, trunk: 0.038, taper: 0.82, pad: 0.95, apex: 1, droop: 0.12, shari: false,
  },
  // slanting: leans hard to one side, as if bent by the wind
  shakan: {
    path: [[0, 0], [0.05, 0.27], [0.15, 0.53], [0.27, 0.77], [0.38, 0.95]],
    branches: 6, t0: 0.25, t1: 0.86, reach: 0.33, trunk: 0.038, taper: 0.8, pad: 1, apex: 1.05, droop: 0.13, shari: true,
  },
  // cascade: grows up, then pours over the edge of the pot
  kengai: {
    path: [[0, 0], [0.03, 0.3], [0.13, 0.55], [0.27, 0.6], [0.38, 0.4], [0.4, 0.1], [0.37, -0.2]],
    branches: 8, t0: 0.2, t1: 0.95, reach: 0.25, trunk: 0.036, taper: 0.7, pad: 0.95, apex: 1.1, droop: 0.1, shari: false,
  },
  // literati: tall, thin and bare, with foliage only near the top
  bunjin: {
    path: [[0, 0], [-0.06, 0.22], [0.05, 0.46], [-0.07, 0.72], [0.02, 0.98]],
    branches: 5, t0: 0.46, t1: 0.9, reach: 0.25, trunk: 0.027, taper: 0.7, pad: 0.95, apex: 1.15, droop: 0.06, shari: false,
  },
};

export function growBonsai(env: BonsaiEnv, form: BonsaiForm): BonsaiResult {
  const { grid, foliage, ramp, rng } = env;
  const W = grid.w;
  const H = grid.h;
  const spec = STYLES[form];
  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const sources: Point[] = [];
  const seed = rng() * 500;
  const dir = rng() < 0.5 ? -1 : 1; // which way the tree leans, or the cascade falls

  const put = (x: number, y: number, c: Rgb, kind: number): void => {
    grid.set(x, y, { glyph: G_BLOCK, color: c, bg: c, cov: 1, kind });
  };

  // ---- the table, stand and pot: sizes -------------------------------------
  const tableH = clamp(Math.round(H * 0.075), 6, 18);
  const surfaceY = H - tableH; // the first row of the table
  const topPlaneH = Math.max(3, Math.round(tableH * 0.5)); // the top of the table, seen at a slant
  const potBase = surfaceY + Math.round(topPlaneH * 0.5); // the row the pot (or its stand) stands on
  const avail = potBase - Math.max(3, Math.round(H * 0.04));
  const totalH = Math.min(avail, W * 1.0);
  const cascade = form === "kengai";
  const standH = cascade ? Math.round(totalH * 0.2) : 0;
  const potH = Math.max(6, Math.round(totalH * 0.125));
  const potW = Math.min(Math.round(potH * (cascade ? 3.3 : 3.9)), Math.round(W * 0.5));
  const treeH = cascade ? totalH * 0.8 : totalH - potH - standH;
  const cx0 = W / 2;
  // A leaning tree or a cascade pulls the picture to one side: the pot moves the other way, so the whole thing stays centred.
  const pull = form === "shakan" ? 0.13 : cascade ? 0.09 : 0;
  const cxp = cx0 - dir * treeH * pull; // the middle of the pot
  const bx = cxp - dir * (form === "shakan" ? potW * 0.1 : cascade ? potW * 0.2 : 0); // where the trunk leaves the soil
  const potBottom = standH ? potBase - standH - 1 : potBase;
  const y0 = potBottom - potH + 1; // the top of the pot's rim

  // ---- table ----------------------------------------------------------------
  for (let y = surfaceY; y < H; y++) {
    const top = y < surfaceY + topPlaneH;
    for (let x = 0; x < W; x++) {
      const grain = noise2(x * 0.035 + seed, y * (top ? 1.8 : 1.2) + seed);
      let c: Rgb;
      if (top) {
        c = TABLE_TOP[grain > 0.62 ? 2 : grain > 0.3 ? 1 : 0];
        if (y === surfaceY) c = mix(c, [255, 255, 255], 0.08); // the far edge catches light
      } else if (y === surfaceY + topPlaneH) {
        c = TABLE_TOP[2]; // the near edge
      } else {
        c = TABLE_FACE[grain > 0.66 ? 2 : grain > 0.33 ? 1 : 0];
        c = mix(c, [0, 0, 0], (y - surfaceY - topPlaneH) / (tableH * 2.4)); // darker toward the floor
      }
      put(x, y, c, K_GROUND);
    }
  }

  // ---- a soft shadow under the pot ----------------------------------------
  const shadowW = potW * 0.62 + (standH ? potW * 0.2 : 0);
  for (let y = surfaceY; y < surfaceY + topPlaneH; y++) {
    for (let x = Math.floor(cxp - shadowW - 4); x <= Math.ceil(cxp + shadowW + 4); x++) {
      const dx = (x - cxp) / (shadowW + 4);
      const dy = (y - (potBase - 0.5)) / (topPlaneH * 0.9);
      const a = 1 - (dx * dx + dy * dy);
      const cell = grid.at(x, y);
      if (a > 0 && cell) put(x, y, mix(cell.color, [0, 0, 0], a * 0.5), K_GROUND);
    }
  }

  // ---- stand (for the cascade) ----------------------------------------------
  // a slim plinth under a thin slab, so the cascade has room to fall beside it
  if (standH) {
    const slabH = Math.max(2, Math.round(standH * 0.12));
    for (let y = potBase - standH; y <= potBase; y++) {
      const slab = y < potBase - standH + slabH;
      const sw = potW * (slab ? 0.56 : 0.36);
      const foot = y > potBase - Math.max(2, Math.round(standH * 0.1));
      const w2 = foot ? sw * 1.18 : sw;
      for (let x = Math.ceil(cxp - w2); x <= Math.floor(cxp + w2); x++) {
        const u = (x - (cxp - w2)) / (w2 * 2);
        let c = STAND[1];
        if (y === potBase - standH) c = STAND[2];
        else if (slab) c = u > 0.9 ? STAND[0] : STAND[1];
        else if (u < 0.07) c = STAND[2];
        else if (u > 0.88) c = STAND[0];
        else if (noise2(x * 0.5 + seed, y * 0.06) > 0.7) c = mix(c, STAND[0], 0.5); // a little grain
        put(x, y, c, K_GROUND);
      }
    }
  }

  // ---- the pot --------------------------------------------------------------
  const left = cxp - potW / 2;
  const right = cxp + potW / 2;
  const rimH = Math.max(2, Math.round(potH * 0.2));
  const feetH = Math.max(1, Math.round(potH * 0.13));
  for (let y = y0; y <= potBottom; y++) {
    const row = (y - y0) / Math.max(potH - 1, 1);
    const inRim = y < y0 + rimH;
    const inset = inRim ? 0 : potW * 0.035 + potW * 0.04 * row;
    const l = Math.ceil(left + inset);
    const r = Math.floor(right - inset);
    const onFeet = y > potBottom - feetH;
    for (let x = l; x <= r; x++) {
      const u = (x - l) / Math.max(r - l, 1);
      if (onFeet && !(u < 0.2 || u > 0.8)) continue; // the gap between the feet
      let c: Rgb;
      if (inRim) {
        c = y === y0 ? POT.rim : y === y0 + rimH - 1 ? POT.rimDark : POT.light;
        if (u > 0.88) c = mix(c, POT.dark, 0.5);
      } else {
        c = u < 0.07 ? POT.light : u < 0.26 ? mix(POT.light, POT.mid, 0.55) : u > 0.86 ? POT.dark : u > 0.7 ? mix(POT.mid, POT.dark, 0.5) : POT.mid;
        if (u > 0.11 && u < 0.135 && row > 0.3 && row < 0.78) c = POT.rim; // a streak of glaze
        c = mix(c, POT.dark, row * 0.35);
        if (row > 0.82 && !onFeet) c = mix(c, [0, 0, 0], 0.15);
      }
      put(x, y, c, K_GROUND);
    }
  }

  // ---- soil, moss and a few stones -----------------------------------------
  const sl = Math.ceil(left + potW * 0.05);
  const sr = Math.floor(right - potW * 0.05);
  for (let x = sl; x <= sr; x++) {
    const edge = Math.min(x - sl, sr - x) / Math.max(potW * 0.12, 1);
    const mound = Math.round((1.2 + noise2(x * 0.16 + seed, 1.7) * 2.4) * smooth(edge + 0.25));
    for (let k = 0; k <= mound + 1; k++) {
      const y = y0 + 1 - k;
      const top = k >= mound;
      const m = noise2(x * 0.22 + seed, y * 0.5 + 9) + (rng() - 0.5) * 0.25;
      let c = SOIL[Math.floor(rng() * 3)];
      if (top && m > 0.38) c = MOSS[clamp(Math.floor((m - 0.38) * 7 + rng() * 1.5), 0, 3)];
      else if (k >= mound - 1 && m > 0.55) c = MOSS[1];
      put(x, y, c, K_GROUND);
    }
  }
  for (let i = 0; i < 3 + Math.round(potW / 40); i++) {
    const sx = Math.round(lerp(sl + 3, sr - 3, rng()));
    if (Math.abs(sx - bx) < potH * 0.8) continue; // not on the roots
    const sw = Math.round(rand(1.5, 3));
    for (let k = 0; k < sw; k++) put(sx + k, y0 - 1, STONE[k === 0 ? 2 : 1], K_GROUND);
    for (let k = 0; k < sw + 1; k++) put(sx + k - 0, y0, STONE[0], K_GROUND);
  }

  // ---- wood -----------------------------------------------------------------
  // Light comes from the upper left, so a limb is light on its upper left and dark on its lower right.
  const radMap = new Float32Array(W * H);
  const lightX = -0.6;
  const lightY = -0.8;

  interface Brush {
    vertical: boolean; // bark runs along the limb: down a trunk, across a branch
    shari?: { from: number; to: number; side: number };
  }

  const soilLine = y0 + 1; // wood stops here above the pot: below it is the pot itself (a cascade may hang down beside it)
  const stamp = (x: number, y: number, r: number, u: number, b: Brush): void => {
    const rr = Math.max(r, 0.55);
    for (let py = Math.floor(y - rr); py <= Math.ceil(y + rr); py++) {
      for (let px = Math.floor(x - rr); px <= Math.ceil(x + rr); px++) {
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        if (py > soilLine && px >= left - 1 && px <= right + 1 && py <= potBottom) continue;
        const dx = px + 0.5 - x;
        const dy = py + 0.5 - y;
        if (dx * dx + dy * dy > rr * rr) continue;
        const i = py * W + px;
        if (grid.kind(px, py) === K_WOOD && radMap[i] > rr * 1.35) continue; // part of a thicker limb
        radMap[i] = Math.max(radMap[i], rr);

        const lit = (dx * lightX + dy * lightY) / rr;
        let tone = rr < 1 ? 1 : lit > 0.45 ? 3 : lit > -0.05 ? 2 : lit > -0.55 ? 1 : 0;
        if (rr >= 1.8) {
          const n = b.vertical ? noise2(px * 0.8 + seed, py * 0.13 + seed) : noise2(px * 0.13 + seed, py * 0.8 + seed);
          if (n > 0.72) tone = Math.max(0, tone - 1);
          else if (n < 0.2) tone = Math.min(3, tone + 1);
        }
        let c = BARK[tone];
        const sh = b.shari;
        if (sh && u > sh.from && u < sh.to && rr > 2.5) {
          const along = smooth(Math.min((u - sh.from) / 0.08, (sh.to - u) / 0.08)); // tapers at both ends
          const wob = (noise2(py * 0.09 + seed, 3.7) - 0.5) * 0.4;
          const centre = -0.28 * sh.side + wob;
          const half = 0.2 * along;
          if (Math.abs(dx / rr - centre) < half && lit > -0.6) c = DEAD[clamp(tone - 1, 0, 2)];
        }
        put(px, py, c, K_WOOD);
      }
    }
  };

  const stroke = (pts: Point[], rad: (u: number) => number, b: Brush): void => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    if (total < 1e-3) return;
    const n = Math.max(1, Math.ceil(total / 0.45));
    let seg = 0;
    for (let k = 0; k <= n; k++) {
      const d = (total * k) / n;
      while (seg < pts.length - 2 && cum[seg + 1] < d) seg++;
      const f = (d - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-6);
      const x = lerp(pts[seg][0], pts[seg + 1][0], f);
      const y = lerp(pts[seg][1], pts[seg + 1][1], f);
      stamp(x, y, rad(d / total), d / total, b);
    }
  };

  // The trunk follows the style's path, mirrored to the side the tree leans.
  const base: Point = [bx, y0];
  let path = spec.path;
  if (cascade) {
    // up out of the soil, a short crest, then over the rim and down past the stand, outside the pot
    const out = (cxp + dir * potW * 0.72 - bx) * dir / treeH; // how far out the fall is, in tree heights
    path = [[0, 0], [0.025, 0.17], [0.1, 0.36], [out * 0.55, 0.44], [out * 0.92, 0.3], [out, 0.05], [out + 0.015, -0.18], [out - 0.01, -0.38]];
  }
  const ctrl: Point[] = path.map(([dx, up]) => [base[0] + dir * dx * treeH + (dx === 0 && up === 0 ? 0 : rand(-0.004, 0.004) * treeH), base[1] - up * treeH * 0.88]);
  const trunk = spline(ctrl, 90);
  const trunkR = Math.max(1.6, treeH * spec.trunk);
  const radiusAt = (u: number): number => Math.max(0.8, trunkR * (1 - spec.taper * Math.pow(u, 0.6)) * (1 + 0.5 * Math.exp(-u * 22)));
  const trunkAt = (u: number): Point => trunk[clamp(Math.round(u * (trunk.length - 1)), 0, trunk.length - 1)];

  // surface roots spreading over the soil
  const nRoots = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < nRoots; i++) {
    const side = i % 2 ? 1 : -1;
    const len = trunkR * rand(1.3, 2.3) * (i < 2 ? 1 : 0.75);
    const sx = base[0] + side * trunkR * 0.3;
    const pts: Point[] = [
      [sx, base[1] - trunkR * 0.5],
      [sx + side * len * 0.55, base[1] - trunkR * 0.05 + rand(-0.5, 0.5)],
      [sx + side * len, y0 + 0.8],
    ];
    stroke(spline(pts, 12), (u) => trunkR * lerp(0.6, 0.15, u), { vertical: false });
  }
  stroke(trunk, radiusAt, { vertical: true, shari: spec.shari ? { from: rand(0.06, 0.16), to: rand(0.45, 0.6), side: -dir } : undefined });

  // ---- branches and foliage pads --------------------------------------------
  interface Pad {
    x: number;
    y: number;
    rx: number;
    ry: number;
  }
  const pads: Pad[] = [];
  const crownR = treeH * spec.reach;
  let side = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < spec.branches; i++) {
    const f = spec.branches === 1 ? 0.5 : i / (spec.branches - 1);
    const t = lerp(spec.t0, spec.t1, f) + rand(-0.02, 0.02);
    const [tx, ty] = trunkAt(t);
    side = -side;
    // a conical outline: low branches reach far, high ones are short
    let L = crownR * (1 - 0.74 * smooth((t - 0.2) / 0.8)) * rand(0.88, 1.12);
    if (form === "shakan") L *= side === dir ? 1.22 : 0.72; // the long limbs hang on the downhill side
    if (cascade) L *= 0.55 + 0.7 * (1 - Math.abs(t - 0.45)); // a tree that pours over the pot keeps its branches short
    if (form === "bunjin") L *= 0.8 + 0.4 * rng();
    const phi = lerp(-0.12, 0.34, t) + rand(-0.06, 0.06); // elevation of the tip
    const r0 = Math.max(1, radiusAt(t) * 0.6);
    const p0: Point = [tx + side * radiusAt(t) * 0.5, ty];
    const p1: Point = [p0[0] + side * L * Math.cos(phi), p0[1] - L * Math.sin(phi) + L * spec.droop * (1 - t)];
    const q: Point = [lerp(p0[0], p1[0], 0.5), Math.min(p0[1], p1[1]) - L * 0.12];
    const path = quad(p0, q, p1, 28);
    stroke(path, (u) => lerp(r0, Math.max(0.7, r0 * 0.3), u), { vertical: false });

    // pads: one at the tip, a smaller one partway along, tied on by a twig
    const rx = clamp(L * 0.58 * spec.pad, treeH * 0.05, treeH * 0.2);
    const tip: Pad = { x: p1[0], y: p1[1] - rx * 0.12, rx, ry: rx * rand(0.38, 0.46) };
    pads.push(tip);
    if (L > treeH * 0.13) {
      const m = path[Math.round(path.length * 0.55)];
      const mp: Pad = { x: m[0], y: m[1] - rx * 0.3, rx: rx * 0.72, ry: rx * 0.3 };
      pads.push(mp);
      stroke([path[Math.round(path.length * 0.4)], [mp.x, mp.y + mp.ry * 0.6]], () => 0.8, { vertical: true });
    }
  }
  // the top of the tree
  const top = trunk[trunk.length - 1];
  const apexR = Math.max(treeH * 0.11 * spec.apex, 5);
  const apexLean = form === "shakan" ? dir * apexR * 0.15 : 0;
  pads.push({ x: top[0] + apexLean, y: top[1] - apexR * (cascade ? -0.05 : 0.18), rx: apexR, ry: apexR * (cascade ? 0.62 : 0.52) });
  if (cascade) {
    // a second mass where the trunk crests, before it falls
    const crest = trunkAt(0.42);
    pads.push({ x: crest[0], y: crest[1] - apexR * 0.4, rx: apexR * 1.15, ry: apexR * 0.5 });
  }

  // Upper pads first, so a lower one sits in front of the one above it.
  pads.sort((a, b) => a.y - b.y);
  const hi = ramp.length - 1;
  const leaf = (c: number): Rgb => ramp[clamp(Math.round(c), 0, hi)];
  const edgeSeed = seed + 31;

  const drawPad = (pad: Pad): void => {
    const { x: cx, y: cy } = pad;
    const rx = Math.max(pad.rx, 3);
    const ry = Math.max(pad.ry, 2);
    // a pad is a row of lobes: a scalloped top and a flatter underside
    const n = clamp(Math.round(rx / (ry * 0.95)), 3, 8);
    const lobes: { x: number; y: number; rx: number; ry: number }[] = [];
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) * 2 - 1;
      lobes.push({
        x: cx + u * rx * 0.66 + rand(-0.04, 0.04) * rx,
        y: cy - ry * (0.2 * (1 - u * u) + rand(-0.06, 0.16)),
        rx: rx * rand(0.34, 0.44),
        ry: ry * (0.62 + 0.3 * (1 - u * u) + rand(0, 0.14)),
      });
    }
    const x0 = Math.floor(cx - rx * 1.15);
    const x1 = Math.ceil(cx + rx * 1.15);
    const y0p = Math.floor(cy - ry * 1.6);
    const y1p = Math.ceil(cy + ry * 1.1);
    const bw = x1 - x0 + 1;
    const bh = y1p - y0p + 1;
    const mask = new Uint8Array(bw * bh);
    const inMask = (x: number, y: number): boolean => x >= x0 && x <= x1 && y >= y0p && y <= y1p && mask[(y - y0p) * bw + (x - x0)] === 1;

    for (let y = y0p; y <= y1p; y++) {
      for (let x = x0; x <= x1; x++) {
        const edge = 1 + (noise2(x * 0.5 + edgeSeed, y * 0.5) - 0.5) * 0.55;
        let hit = false;
        for (const l of lobes) {
          const dx = (x + 0.5 - l.x) / l.rx;
          const dy = (y + 0.5 - l.y) / (y + 0.5 > l.y ? l.ry * 0.68 : l.ry);
          if (dx * dx + dy * dy < edge) {
            hit = true;
            break;
          }
        }
        if (hit) mask[(y - y0p) * bw + (x - x0)] = 1;
      }
    }

    // where this pad sits over an earlier one, the one behind goes into shadow just beneath its lower edge
    for (let y = y0p; y <= y1p; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inMask(x, y) || inMask(x, y + 1)) continue;
        for (let k = 1; k <= 3; k++) {
          const behind = foliage.at(x, y + k);
          if (behind && !inMask(x, y + k)) foliage.set(x, y + k, { ...behind, color: mix(behind.color, ramp[hi], 0.6 - k * 0.1), bg: mix(behind.color, ramp[hi], 0.6 - k * 0.1) });
        }
      }
    }

    for (let y = y0p; y <= y1p; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inMask(x, y)) continue;
        const u = (x + 0.5 - cx) / rx;
        const v = (y + 0.5 - cy) / ry;
        const lit = -(u * 0.35 + v * 0.55); // 1 at the upper left, -1 at the lower right
        let idx = 3.2 - lit * 2.3 + (noise2(x * 0.38 + edgeSeed, y * 0.5) - 0.5) * 2.2 + (noise2(x * 1.1 + edgeSeed, y * 1.1) - 0.5) * 0.7;
        const open = !inMask(x, y - 1);
        const under = !inMask(x, y + 1) || !inMask(x, y + 2);
        if (open) idx -= 1.1; // the top edge catches the light
        if (under) idx += 1.5; // the underside is in shade
        const r = rng();
        if (r < 0.04) idx -= 1.3; // single bright leaves
        else if (r < 0.065) idx += 1.1;
        else if (r < 0.072 && !open && !under) idx = hi; // a dark gap
        foliage.set(x, y, { glyph: G_BLOCK, color: leaf(idx), bg: leaf(idx), cov: 1, kind: K_CANOPY });
        if (!inMask(x, y + 1) && rng() < 0.05) sources.push([x, y + 1]);
      }
    }
  };
  for (const pad of pads) drawPad(pad);

  // Keep the shower of leaves modest and spread out.
  while (sources.length > 500) sources.splice(Math.floor(rng() * sources.length), 1);

  return { sources, groundRow: Math.min(H - 1, surfaceY + Math.round(topPlaneH * 0.8)) };
}
