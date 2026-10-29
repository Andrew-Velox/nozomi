import { hex, mix, type Rgb } from "./color";
import { G_BLOCK, K_CANOPY, K_GROUND, K_WOOD, type Grid } from "./grid";
import { noise2 } from "./noise";
import type { Rng } from "./rng";
import type { Point } from "./tree";

// A bonsai in single pixels: a trunk drawn along a designed curve (each classic style has its own),
// branches that carry flat pads of foliage, and a mossy rock on grassy ground.
// The wood goes in `grid`, the foliage in `foliage` (so it can sway), and the rock and grass are
// part of the ground.

export type BonsaiForm =
  | "moyogi" // informal upright: an S-curved trunk
  | "chokkan" // formal upright: straight, in tiers
  | "shakan" // slanting
  | "fukinagashi" // windswept: everything streams to one side
  | "sokan" // twin trunk
  | "hokidachi" // broom: a straight trunk under a round crown
  | "ishitsuki" // on a slab of stone, with roots gripping it
  | "nejikan" // spiral: a thick trunk twisted like rope
  | "hankengai" // semi-cascade: a sweeping crown over thick roots
  | "kengai" // cascade
  | "bunjin"; // literati: tall, thin, bare
export const BONSAI_STYLES: readonly BonsaiForm[] = ["moyogi", "chokkan", "shakan", "fukinagashi", "sokan", "hokidachi", "ishitsuki", "nejikan", "hankengai", "kengai", "bunjin"];

export interface BonsaiEnv {
  grid: Grid; // square cells: one cell is one pixel
  foliage: Grid; // the pads of leaves go here so they can sway
  grass: Grid; // blades of grass and flowers go here so they can sway
  ramp: Rgb[]; // leaf colours, 0 lightest to 7 deepest
  rng: Rng;
}

export interface BonsaiResult {
  sources: Point[]; // where leaves can fall from, in cells
  groundRow: number; // the row leaves come to rest on (the grass)
}

const BARK = ["#271a13", "#46321f", "#6d4d36", "#977655"].map(hex);
const DEAD = ["#8d7e6d", "#b5a791", "#d9cdb7"].map(hex); // bleached deadwood

// stone for the rock the tree grows from, darkest to lightest
const ROCKS = {
  grey: ["#2f2f36", "#4a4a53", "#6c6c76", "#92929c", "#b9b9c1"].map(hex),
  sand: ["#3f352c", "#64533f", "#8a7458", "#b09a78", "#d3bf9e"].map(hex),
  dark: ["#1b1d23", "#2f323b", "#474b58", "#626877", "#848b9b"].map(hex),
};
type RockName = keyof typeof ROCKS;
const GRASS = ["#244a2e", "#33653a", "#4a8a45", "#6fae56", "#9ad06f"].map(hex);
const EARTH = ["#1f1712", "#2d221a", "#3f3025"].map(hex);
const FLOWERS = ["#ffffff", "#ffe27a", "#ffb7d5", "#c9b8ff"].map(hex);

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

/** What the tree grows from: a rock on grassy ground. */
interface Setting {
  rock: RockName;
  h: number; // height of the rock, as a share of the whole picture
  w: number; // width of the rock, in rock heights
  round: number; // 2 is a dome, higher is flat on top with steep sides
  height: number; // how much of the picture the tree itself may use (a cascade falls down the rock)
  pull: number; // how far the rock moves the other way from a leaning tree, in tree heights
  root: number; // how far the trunk leaves the middle of the rock, in rock widths (towards the lean)
  roots?: { n: number; thick: number; lift: number }; // the surface roots: how many, how thick (1 is the usual), how far they arch up off the rock
}

/** The trunk and its branches. */
interface Limb {
  path: [number, number][]; // the trunk's path as (sideways, up) in tree heights from the roots
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
  twist?: number; // plait this share of the trunk into rope (0 to 1); left out, some trees are and some are not
  fill?: number; // extra pads packed in beside each branch's own, 0 to 2
  elev?: [number, number]; // how high a branch tip rises, at the lowest and highest branch (radians)
  oneSide?: boolean; // every branch goes the way the tree leans (windswept)
  cone?: number; // how fast the branches get shorter going up, 0 to 1
  pointed?: boolean; // a narrow, upright top pad
}

interface Style {
  set: Setting;
  limb?: Limb;
}

const STYLES: Record<BonsaiForm, Style> = {
  // informal upright: the classic S-shaped trunk
  moyogi: {
    set: { rock: "grey", h: 0.16, w: 3.4, round: 2.8, height: 1, pull: 0, root: 0 },
    limb: {
      path: [[0, 0], [0.1, 0.18], [-0.07, 0.42], [0.08, 0.68], [-0.01, 0.98]],
      branches: 6, t0: 0.3, t1: 0.82, reach: 0.34, trunk: 0.036, taper: 0.8, pad: 1, apex: 1, droop: 0.14, shari: true,
    },
  },
  // formal upright: a straight, thick, tapering trunk and branches in even tiers, like a pine
  chokkan: {
    set: { rock: "sand", h: 0.17, w: 3.0, round: 2.6, height: 1, pull: 0, root: 0 },
    limb: {
      path: [[0, 0], [0.004, 0.33], [-0.004, 0.66], [0.003, 0.99]],
      branches: 9, t0: 0.2, t1: 0.86, reach: 0.31, trunk: 0.048, taper: 0.86, pad: 1.08, apex: 0.9, droop: 0.1, shari: false,
      fill: 1, cone: 0.86, pointed: true, elev: [-0.1, 0.3],
    },
  },
  // slanting: leans hard to one side, as if bent by the wind
  shakan: {
    set: { rock: "dark", h: 0.16, w: 3.2, round: 2.6, height: 1, pull: 0.13, root: 0.1 },
    limb: {
      path: [[0, 0], [0.05, 0.27], [0.15, 0.53], [0.27, 0.77], [0.38, 0.95]],
      branches: 7, t0: 0.25, t1: 0.88, reach: 0.34, trunk: 0.042, taper: 0.8, pad: 1.1, apex: 1.05, droop: 0.13, shari: true, fill: 1,
    },
  },
  // windswept: the trunk is bent and every branch streams the same way, as if from a gale
  fukinagashi: {
    set: { rock: "sand", h: 0.15, w: 3.4, round: 2.4, height: 1, pull: 0.15, root: 0.12 },
    limb: {
      path: [[0, 0], [0.04, 0.2], [-0.02, 0.4], [0.06, 0.62], [0.16, 0.8], [0.27, 0.9]],
      branches: 7, t0: 0.36, t1: 0.95, reach: 0.34, trunk: 0.044, taper: 0.8, pad: 0.82, apex: 0.85, droop: 0.0, shari: true,
      oneSide: true, elev: [0.0, 0.12], cone: 0.15,
    },
  },
  // twin trunk: two trunks from one root, a tall one and a shorter one leaning away
  sokan: {
    set: { rock: "grey", h: 0.15, w: 4.0, round: 3, height: 1, pull: 0, root: 0 },
    limb: {
      path: [[0, 0], [0.04, 0.22], [-0.02, 0.5], [0.05, 0.76], [0.01, 0.98]],
      branches: 6, t0: 0.32, t1: 0.84, reach: 0.3, trunk: 0.036, taper: 0.8, pad: 1, apex: 1, droop: 0.12, shari: true, fill: 1,
    },
  },
  // broom: a straight trunk that splits like a fan into a round crown
  hokidachi: {
    set: { rock: "dark", h: 0.16, w: 2.9, round: 2.2, height: 1, pull: 0, root: 0 },
  },
  // on a stone: thick, twisted, roots gripping the rock, under a broad crown
  ishitsuki: {
    set: { rock: "grey", h: 0.15, w: 4.6, round: 4.2, height: 1, pull: 0.06, root: 0.2 },
  },
  // spiral: a thick trunk twisted like rope, with big roots coiling over the rock
  nejikan: {
    set: { rock: "dark", h: 0.14, w: 3.8, round: 2.8, height: 1, pull: 0.08, root: -0.12, roots: { n: 10, thick: 1.6, lift: 0.5 } },
    limb: {
      path: [[0, 0], [0.08, 0.13], [-0.05, 0.28], [0.15, 0.43], [0.04, 0.58], [0.2, 0.72], [0.15, 0.86], [0.24, 0.97]],
      branches: 8, t0: 0.34, t1: 0.9, reach: 0.34, trunk: 0.07, taper: 0.62, pad: 1.05, apex: 1.05, droop: 0.12, shari: false, fill: 1, twist: 1, elev: [-0.06, 0.3],
    },
  },
  // semi-cascade: a twisted trunk and thick roots, under a long crown that sweeps out and down
  hankengai: {
    set: { rock: "sand", h: 0.2, w: 3.2, round: 2.8, height: 0.82, pull: 0.28, root: -0.3, roots: { n: 9, thick: 1.5, lift: 0.7 } },
  },
  // cascade: a woven, coiled trunk that climbs in an S into a leaning crown, with a long branch falling down the rock
  kengai: {
    set: { rock: "dark", h: 0.2, w: 2.3, round: 3.2, height: 0.78, pull: 0.2, root: -0.32 },
  },
  // literati: tall, thin and bare, with foliage only near the top
  bunjin: {
    set: { rock: "grey", h: 0.13, w: 3.0, round: 2.6, height: 1, pull: 0, root: 0 },
    limb: {
      path: [[0, 0], [-0.06, 0.22], [0.05, 0.46], [-0.07, 0.72], [0.02, 0.98]],
      branches: 5, t0: 0.46, t1: 0.9, reach: 0.25, trunk: 0.027, taper: 0.7, pad: 0.95, apex: 1.15, droop: 0.06, shari: false,
    },
  },
};

interface Pad {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

interface Crown {
  x: number;
  y: number;
  rx: number;
  ry: number; // for light across the whole crown, not just across each pad
}

/** `wild` is for the Random option: the trunk's whole path is invented afresh, with its own bends, coils and twist. */
export function growBonsai(env: BonsaiEnv, form: BonsaiForm, wild = false): BonsaiResult {
  const { grid, foliage, grass, ramp, rng } = env;
  const W = grid.w;
  const H = grid.h;
  const style = STYLES[form];
  const set = style.set;
  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const sources: Point[] = [];
  const seed = rng() * 500;
  const dir = rng() < 0.5 ? -1 : 1; // which way the tree leans, or the cascade falls

  const put = (x: number, y: number, c: Rgb, kind: number): void => {
    grid.set(x, y, { glyph: G_BLOCK, color: c, bg: c, cov: 1, kind });
  };
  // blades and flowers stand on their own layer, which sways in the wind
  const putGrass = (x: number, y: number, c: Rgb): void => {
    grass.set(x, y, { glyph: G_BLOCK, color: c, bg: c, cov: 1, kind: K_GROUND });
  };

  // ---- the ground and the rock: sizes ---------------------------------------
  const groundH = clamp(Math.round(H * 0.1), 7, 20);
  const groundTop = H - groundH; // the first row of the grass
  const footRow = groundTop + 2; // the row the rock stands on, sunk a little into the grass
  const avail = footRow - Math.max(3, Math.round(H * 0.04));
  const totalH = Math.min(avail, W * 1.0);
  const baseH = Math.max(6, Math.round(totalH * set.h));
  const baseW = Math.min(Math.round(baseH * set.w), Math.round(W * 0.7));
  const treeH = set.height < 1 ? totalH * set.height : totalH - baseH;
  const cx0 = W / 2;
  // A leaning tree or a cascade pulls the picture to one side: the rock moves the other way, so the whole thing stays centred.
  const cxp = cx0 - dir * treeH * set.pull; // the middle of the rock
  const bx = cxp + dir * baseW * set.root; // where the trunk leaves the rock
  const y0 = footRow - baseH + 1; // the top of the rock where the tree stands
  const left = cxp - baseW / 2;
  const right = cxp + baseW / 2;
  const palette = ROCKS[set.rock];

  // ---- the ground: grass over earth, right across ------------------------------
  for (let x = 0; x < W; x++) {
    const clump = noise2(x * 0.09 + seed, 5.1) * 0.7 + noise2(x * 0.4 + seed, 9.7) * 0.3;
    const gh = Math.max(2, Math.round(2 + clump * (groundH * 0.32) + rng() * 1.2)); // grass depth, taller in clumps
    for (let y = groundTop; y < H; y++) {
      const k = y - groundTop;
      let c: Rgb;
      if (k < gh) c = GRASS[clamp(Math.round(4 - (k / Math.max(gh - 1, 1)) * 3.2 + (rng() - 0.5) * 1.4), 0, 4)]; // dark at the root, light at the tip
      else {
        // below the grass it is still moss: a deep, mottled green, darker toward the bottom
        const e = noise2(x * 0.12 + seed, y * 0.6 + 3) * 0.7 + noise2(x * 0.5 + seed, y * 0.9) * 0.3;
        c = GRASS[e > 0.62 ? 2 : e > 0.36 ? 1 : 0];
        if (rng() < 0.05) c = GRASS[clamp(Math.round(e * 3) + 1, 0, 4)]; // flecks of lighter moss
        c = mix(c, EARTH[0], 0.3 + 0.3 * Math.min((k - gh) / (groundH * 1.4), 1)); // a trace of soil, so it reads as earth
      }
      put(x, y, c, K_GROUND);
    }
    // blades standing above the line
    if (rng() < 0.55) {
      const bh = 1 + Math.floor(rng() * (1 + clump * 3));
      for (let k = 1; k <= bh; k++) putGrass(x, groundTop - k, GRASS[clamp(2 + k, 0, 4)]);
    }
  }

  // ---- a rock: a body that is tall in the middle, grassy on top, layered and lit from the left -----------
  const rockTop = new Map<number, number>(); // the top edge of the main rock, so roots can follow it
  const rockBody = (mx: number, hw: number, h: number, round: number, mossy: number, record = false): void => {
    for (let x = Math.floor(mx - hw) - 1; x <= Math.ceil(mx + hw) + 1; x++) {
      const u = (x - mx) / hw;
      const au = Math.abs(u);
      if (au > 1) continue;
      const shape = Math.pow(1 - Math.pow(au, round), 0.55);
      const top = Math.round(footRow - h * shape + 1 - (noise2(x * 0.13 + seed, 2.2) - 0.5) * h * 0.14);
      if (record) rockTop.set(x, top);
      const bottom = footRow + 1;
      const capRows = 2 + (noise2(x * 0.2 + seed, 6.3) > 0.5 ? 1 : 0) + (au > 0.7 ? 1 : 0);
      for (let y = top; y <= bottom; y++) {
        const row = (y - top) / Math.max(bottom - top, 1);
        let c: Rgb;
        if (y < top + capRows) {
          const g = noise2(x * 0.3 + seed, y * 0.8 + 1);
          c = GRASS[clamp(Math.round(1 + g * 3 + (y === top ? 1 : 0) + (rng() - 0.5)), 0, 4)];
        } else {
          const strata = noise2(x * 0.06 + seed, y * 0.7 + 2) + Math.sin(y * 0.9 + noise2(x * 0.05, y * 0.2) * 5) * 0.12;
          let tone = clamp(Math.floor(strata * 4 + -u * 0.9 + 0.5 - row * 1.1), 0, 4);
          c = palette[tone];
          if (u > 0.8) c = mix(c, palette[0], 0.45); // the unlit right side
          // moss over nearly all of it: lit from the left, darker down the face and in the layer lines, with a little bare stone showing
          const m = noise2(x * 0.11 + seed, y * 0.3 + 7) + (rng() - 0.5) * 0.3;
          if (m > 0.14 - mossy) {
            const lines = Math.sin(y * 0.9 + noise2(x * 0.05, y * 0.2) * 5) < -0.55 ? 1 : 0; // the seams between layers sit in shade
            c = GRASS[clamp(Math.round(1.7 - u * 0.9 + m * 1.6 - row * 1.3 - lines + (rng() - 0.5) * 0.9), 0, 4)];
          }
        }
        put(x, y, c, K_GROUND);
      }
      // grass blades over the top, and tufts drooping over the shoulders
      if (rng() < 0.6) for (let k = 1; k <= 1 + Math.floor(rng() * 3); k++) putGrass(x, top - k, GRASS[clamp(2 + k, 0, 4)]);
    }
  };
  // a shadow on the grass either side of the rock
  for (let y = groundTop; y < groundTop + 4; y++) {
    for (let x = Math.floor(cxp - baseW * 0.65); x <= Math.ceil(cxp + baseW * 0.65); x++) {
      const dx = (x - cxp) / (baseW * 0.65);
      const a = (1 - dx * dx) * (1 - (y - groundTop) / 4);
      const cell = grid.at(x, y);
      if (a > 0 && cell) put(x, y, mix(cell.color, [0, 0, 0], a * 0.45), K_GROUND);
    }
  }
  // two small boulders keep it from looking planted
  for (const side of [-1, 1]) {
    if (rng() < 0.2) continue;
    const bw = baseW * rand(0.09, 0.15);
    const bhh = baseH * rand(0.25, 0.4);
    rockBody(cxp + side * baseW * rand(0.58, 0.8), bw, bhh, 2.2, 0.02);
  }
  rockBody(cxp, baseW / 2, baseH, set.round, 0.04, true);
  // grass growing round the foot of the rock, in front of it
  for (let x = Math.floor(left) - 4; x <= Math.ceil(right) + 4; x++) {
    if (rng() < 0.7) {
      const bh = 1 + Math.floor(rng() * 4);
      for (let k = 0; k < bh; k++) putGrass(x, footRow - k + 1, GRASS[clamp(1 + k, 0, 4)]);
    }
  }
  // little flowers
  for (let i = 0; i < Math.round(W / 22); i++) {
    const fx = Math.round(rand(0, W - 1));
    const fy = groundTop - 1 - Math.floor(rng() * 2);
    putGrass(fx, fy, FLOWERS[Math.floor(rng() * FLOWERS.length)]);
  }

  // ---- wood -----------------------------------------------------------------
  // Light comes from the upper left, so a limb is light on its upper left and dark on its lower right.
  const radMap = new Float32Array(W * H);
  // the row of the rock's surface at a column (the top of the rock, or the grass beyond its edge)
  const surfY = (x: number): number => rockTop.get(Math.round(x)) ?? groundTop;
  const lightX = -0.6;
  const lightY = -0.8;

  interface Brush {
    vertical: boolean; // bark runs along the limb: down a trunk, across a branch
    shari?: { from: number; to: number; side: number };
    rough?: number; // 0 smooth, 1 deeply furrowed (an old, gnarled trunk)
    clip?: number; // paint nothing below this row
    clipBase?: boolean; // the foot of a trunk stays on top of the rock
    moss?: number; // 0 to 1: moss growing on the upper, lit side of the wood
    mossUntil?: number; // ...only along the first part of the stroke (the foot of a trunk)
  }

  const soilLine = y0 + 2; // the foot of a trunk stops here: below it is the rock
  const stamp = (x: number, y: number, r: number, u: number, b: Brush): void => {
    const rr = Math.max(r, 0.55);
    for (let py = Math.floor(y - rr); py <= Math.ceil(y + rr); py++) {
      for (let px = Math.floor(x - rr); px <= Math.ceil(x + rr); px++) {
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        if (b.clip !== undefined && py > b.clip) continue;
        if (b.clipBase && u < 0.14 && py > soilLine) continue;
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
          const lo = 0.2 + 0.12 * (b.rough ?? 0);
          const hi2 = 0.72 - 0.1 * (b.rough ?? 0);
          if (n > hi2) tone = Math.max(0, tone - 1);
          else if (n < lo) tone = Math.min(3, tone + 1);
          if ((b.rough ?? 0) > 0.5 && rr > 3 && noise2(px * 0.35 + seed, py * 0.35 + 11) > 0.8) tone = Math.max(0, tone - 1); // knots
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
        if (b.moss && (b.mossUntil === undefined || u < b.mossUntil) && lit > -0.25) {
          const n = noise2(px * 0.3 + seed, py * 0.3 + 4) + (rng() - 0.5) * 0.25;
          if (n > 0.64 - b.moss * 0.4) c = GRASS[clamp(Math.round(1.6 + lit * 1.3 + (n - 0.5) * 2), 0, 4)];
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

  const base: Point = [bx, y0];
  const pads: Pad[] = [];
  let crown: Crown | null = null; // set for a tree whose crown is one dome rather than separate tiers
  let lowerFirst = false; // draw the lower pads first, so the upper ones sit on top of them (a dome)

  // A root runs out from the trunk lying on the rock: it follows the rock's surface, so it clings to it,
  // and where the rock slopes away it follows it down.
  const hug = (x0: number, side: number, len: number, r0: number, r1: number, wander: number, lift = 0): Point[] => {
    const n = Math.max(6, Math.round(len / 3));
    const pts: Point[] = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const x = x0 + side * len * f;
      const r = lerp(r0, r1, f);
      // a root may arch up off the rock between where it leaves the trunk and where it dives back in
      const arch = lift * Math.sin(Math.PI * Math.min(f * 1.15, 1));
      pts.push([x, surfY(x) - r * 0.35 - arch + (i === 0 ? 0 : (noise2(x * 0.2 + seed, 12) - 0.5) * wander)]);
    }
    return spline(pts, Math.max(12, n * 3));
  };

  // Some trees have thin roots, some thick, heaving ones that arch off the rock; some roots fork.
  const roots = set.roots
    ? wild ? { n: Math.round(rand(6, 12)), thick: rand(0.9, 1.9), lift: rand(0, 0.9) } : set.roots
    : wild ? { n: Math.round(rand(5, 11)), thick: rand(0.8, 1.9), lift: rand(0, 0.9) } : { n: 5 + Math.floor(rng() * 3), thick: rand(0.85, 1.3), lift: rng() < 0.25 ? rand(0.2, 0.6) : 0 };
  const surfaceRoots = (trunkR: number): void => {
    for (let i = 0; i < roots.n; i++) {
      const side = i % 2 ? 1 : -1;
      const len = trunkR * rand(1.7, 3.4) * (i < 2 ? 1.15 : 0.85) * (0.8 + 0.2 * roots.thick);
      const sx = base[0] + side * trunkR * rand(0.15, 0.5);
      const r0 = trunkR * 0.6 * roots.thick;
      const r1 = trunkR * 0.2;
      const lift = roots.lift * trunkR * rand(0.5, 1.2);
      const pts = hug(sx, side, len, r0, r1, 1.2 + roots.thick, lift);
      pts.unshift([sx, base[1] - trunkR * 0.5]);
      stroke(pts, (u) => r1 + (r0 - r1) * Math.pow(1 - u, 0.65), { vertical: false, rough: 0.6, moss: 0.55 });
      if (rng() < 0.55) {
        // a smaller root forks off partway along and goes its own way
        const at = pts[Math.round(pts.length * rand(0.3, 0.55))];
        const child = hug(at[0], side, len * rand(0.4, 0.65), r0 * 0.5, r1, 2 + roots.thick * 2, lift * rand(0, 1.3));
        stroke([at, ...child], (u) => r1 + (r0 * 0.5 - r1) * Math.pow(1 - u, 0.7), { vertical: false, rough: 0.6, moss: 0.5 });
      }
    }
  };

  // A trunk with its branches: grows the wood and adds the foliage pads it carries.
  const grow = (o: { ctrl: Point[]; limb: Limb; treeH: number; trunkR: number; leanDir: number; main: boolean; padMul?: number; skipTrunk?: boolean; twist?: number }): { trunk: Point[]; trunkAt: (u: number) => Point; radiusAt: (u: number) => number } => {
    const { limb, treeH: tH, trunkR, leanDir } = o;
    const trunk = spline(o.ctrl, 90);
    const radiusAt = (u: number): number => Math.max(0.8, trunkR * (1 - limb.taper * Math.pow(u, 0.6)) * (1 + 0.5 * Math.exp(-u * 22)));
    const trunkAt = (u: number): Point => trunk[clamp(Math.round(u * (trunk.length - 1)), 0, trunk.length - 1)];
    if (o.main) surfaceRoots(trunkR);
    const shari = limb.shari && o.main ? { from: rand(0.06, 0.16), to: rand(0.45, 0.6), side: -leanDir } : undefined;
    if (!o.skipTrunk) {
      if (o.twist && o.twist > 0) ropeStroke(trunk, radiusAt, o.twist, { vertical: true, clipBase: true, moss: 0.35, mossUntil: 0.08, rough: 0.9 }, { vertical: true, rough: 0.5, shari });
      else stroke(trunk, radiusAt, { vertical: true, clipBase: true, moss: 0.4, mossUntil: 0.07, rough: 0.3, shari });
    }

    const crownR = tH * limb.reach;
    const cone = limb.cone ?? 0.74;
    let side = rng() < 0.5 ? -1 : 1;
    const padMul = o.padMul ?? 1;
    for (let i = 0; i < limb.branches; i++) {
      const f = limb.branches === 1 ? 0.5 : i / (limb.branches - 1);
      const t = lerp(limb.t0, limb.t1, f) + rand(-0.02, 0.02);
      const [tx, ty] = trunkAt(t);
      side = limb.oneSide ? leanDir : -side;
      // a conical outline: low branches reach far, high ones are short
      let L = crownR * (1 - cone * smooth((t - 0.2) / 0.8)) * rand(0.88, 1.12);
      if (form === "shakan") L *= side === leanDir ? 1.22 : 0.72; // the long limbs hang on the downhill side
      if (form === "bunjin") L *= 0.8 + 0.4 * rng();
      if (limb.oneSide) L *= rand(0.6, 1.4); // a windswept tree's branches differ in length and angle, so they do not stack like rungs
      const [e0, e1] = limb.elev ?? [-0.12, 0.34];
      const phi = lerp(e0, e1, t) + rand(-0.06, 0.06) + (limb.oneSide ? rand(-0.22, 0.2) : 0); // elevation of the tip
      const r0 = Math.max(1, radiusAt(t) * 0.6);
      const p0: Point = [tx + side * radiusAt(t) * 0.5, ty];
      const p1: Point = [p0[0] + side * L * Math.cos(phi), p0[1] - L * Math.sin(phi) + L * limb.droop * (1 - t)];
      const q: Point = [lerp(p0[0], p1[0], 0.5), Math.min(p0[1], p1[1]) - L * 0.12];
      const path = quad(p0, q, p1, 28);
      stroke(path, (u) => lerp(r0, Math.max(0.7, r0 * 0.3), u), { vertical: false });

      // pads: one at the tip, a smaller one partway along (tied on by a twig), and optionally one in close
      const rx = clamp(L * 0.58 * limb.pad * padMul, tH * 0.05, tH * 0.2 * (limb.fill ? 1.15 : 1));
      pads.push({ x: p1[0], y: p1[1] - rx * 0.12, rx, ry: rx * rand(0.38, 0.46) });
      if (L > tH * 0.13) {
        const m = path[Math.round(path.length * 0.55)];
        const mp: Pad = { x: m[0], y: m[1] - rx * 0.3, rx: rx * 0.72, ry: rx * 0.3 };
        pads.push(mp);
        stroke([path[Math.round(path.length * 0.4)], [mp.x, mp.y + mp.ry * 0.6]], () => 0.8, { vertical: true });
      }
      if (limb.fill && L > tH * 0.1) {
        const m = path[Math.round(path.length * 0.28)];
        pads.push({ x: m[0], y: m[1] - rx * 0.22, rx: rx * 0.62, ry: rx * 0.3 });
      }
    }
    // the top of the tree
    const top = trunk[trunk.length - 1];
    const apexR = Math.max(tH * 0.11 * limb.apex, 5);
    const lean = form === "shakan" || form === "fukinagashi" ? leanDir * apexR * 0.15 : 0;
    pads.push({ x: top[0] + lean, y: top[1] - apexR * 0.18, rx: apexR * (limb.pointed ? 0.72 : 1), ry: apexR * (limb.pointed ? 0.7 : 0.52) });
    return { trunk, trunkAt, radiusAt };
  };

  // Every tree gets its own wobble on top of its style: a random extra S-curve along the trunk, and a random stretch of the
  // sideways swing, so two trees of one style never twist alike. A wild tree gets far more.
  const swing = wild ? rand(0.6, 1.8) : rand(0.8, 1.3);
  const waveA = wild ? rand(0.04, 0.13) : rand(0, 0.055);
  const waveF = rand(1.3, 3.6);
  const waveP = rand(0, Math.PI * 2);
  const ctrlOf = (path: [number, number][], tH: number, from: Point = base, mirror = dir): Point[] =>
    path.map(([dx, up]) => {
      const w = waveA * Math.sin(waveP + up * Math.PI * waveF) * Math.max(0, up * (1 - up) * 4);
      return [from[0] + mirror * (dx * swing + w) * tH + (dx === 0 && up === 0 ? 0 : rand(-0.004, 0.004) * tH), from[1] - up * tH * 0.88];
    });

  // An invented trunk: any number of bends, a lean, and now and then a low loop like a knot of rope.
  const randomPath = (): [number, number][] => {
    const n = 5 + Math.floor(rng() * 4);
    const lean = rand(-0.28, 0.32);
    const amp = rand(0.04, 0.17);
    const f = rand(1.1, 3.4);
    const ph = rand(0, Math.PI * 2);
    const pts: [number, number][] = [[0, 0]];
    const coil = rng() < 0.4;
    const lift = coil ? 0.2 : 0;
    if (coil) {
      const reach = rand(0.14, 0.3);
      pts.push([reach * 0.5, 0.03], [reach, 0.07], [reach * 1.2, 0.13], [reach * 0.8, 0.19], [reach * 0.4, 0.2]);
    }
    const x0 = coil ? pts[pts.length - 1][0] : 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const up = lift + t * (0.98 - lift);
      const x = x0 + lean * t * t + amp * (Math.sin(ph + t * Math.PI * f) * (0.35 + 0.65 * t) - Math.sin(ph) * 0.35);
      pts.push([x, up]);
    }
    return pts;
  };

  // A trunk plaited from three to five strands, each weaving in front of and behind the others, over the first `frac` of its length.
  const ropeN = 3 + Math.floor(rng() * (wild ? 3 : 2));
  const ropeRate = rand(0.24, wild ? 0.6 : 0.46);
  const ropeAmp = rand(0.45, wild ? 0.85 : 0.65);
  const ropeStroke = (trunk: Point[], radiusAt: (u: number) => number, frac: number, ropeBrush: Brush, restBrush: Brush): void => {
    const end = clamp(Math.round(trunk.length * frac), 3, trunk.length);
    for (let i = 0; i < end; i++) {
      const u = i / (trunk.length - 1);
      const r = radiusAt(u);
      const [x, y] = trunk[i];
      const [xa, ya] = trunk[Math.max(0, i - 1)];
      const [xb, yb] = trunk[Math.min(trunk.length - 1, i + 1)];
      const L = Math.hypot(xb - xa, yb - ya) || 1;
      const nx = -(yb - ya) / L;
      const ny = (xb - xa) / L;
      const strands = Array.from({ length: ropeN }, (_, k) => {
        const a = i * ropeRate + (k * Math.PI * 2) / ropeN;
        return { off: Math.sin(a) * r * ropeAmp, depth: Math.cos(a) };
      });
      strands.sort((a, b) => a.depth - b.depth);
      for (const st of strands) stamp(x + nx * st.off, y + ny * st.off, Math.max(r * (0.62 - 0.04 * ropeN + 0.08), 0.9), u, ropeBrush);
    }
    if (end < trunk.length - 3) stroke(trunk.slice(end - 2), (u) => radiusAt(lerp((end - 2) / (trunk.length - 1), 1, u)), restBrush);
  };

  // A tree that pours down a rock: pads hang along the fall.
  const cascadePads = (trunkAt: (u: number) => Point, from: number, to: number, count: number, size: number, tH: number): void => {
    for (let i = 0; i < count; i++) {
      const t = lerp(from, to, count === 1 ? 0 : i / (count - 1));
      const [tx, ty] = trunkAt(t);
      const out = i % 2 ? -dir : dir; // alternate sides of the falling trunk
      const rx = Math.max(tH * 0.05, tH * size * (1 - 0.55 * (i / Math.max(count - 1, 1))));
      const cx = tx + out * rx * 0.75;
      stroke([[tx, ty], [cx, ty - rx * 0.15]], () => 0.85, { vertical: false });
      pads.push({ x: cx, y: ty - rx * 0.2, rx, ry: rx * 0.42 });
    }
  };

  const limb = style.limb;

  if (limb && form !== "sokan") {
    // some trees are plaited into a rope along part or all of their trunk; a wild one more often
    const twist = limb.twist !== undefined && !wild ? limb.twist : rng() < (wild ? 0.65 : 0.22) ? rand(0.3, wild ? 1 : 0.7) : 0;
    grow({ ctrl: ctrlOf(wild ? randomPath() : limb.path, treeH), limb, treeH, trunkR: Math.max(1.6, treeH * limb.trunk * (twist ? 1.2 : 1)), leanDir: dir, main: true, twist });
  } else if (form === "sokan" && limb) {
    // two trunks from one root: the second is shorter and leans the other way
    const tr = Math.max(1.6, treeH * limb.trunk);
    grow({ ctrl: ctrlOf(limb.path, treeH, [base[0] - dir * baseW * 0.14, base[1]]), limb, treeH, trunkR: tr, leanDir: dir, main: true });
    const second: Limb = {
      path: [[0, 0], [-0.06, 0.2], [-0.15, 0.42], [-0.2, 0.68], [-0.19, 0.92]],
      branches: 5, t0: 0.38, t1: 0.86, reach: 0.26, trunk: 0.034, taper: 0.78, pad: 0.95, apex: 1, droop: 0.1, shari: false, fill: 1,
    };
    grow({ ctrl: ctrlOf(second.path, treeH * 0.86, [base[0] + dir * baseW * 0.14, base[1]], dir), limb: second, treeH: treeH * 0.86, trunkR: tr * 0.85, leanDir: -dir, main: false });
  } else if (form === "hokidachi") {
    // broom: a straight trunk that forks at about half height into branches radiating like a fan
    const trunkR = Math.max(2, treeH * 0.05);
    const ctrl = ctrlOf([[0, 0], [0.008, 0.2], [-0.006, 0.4], [0.004, 0.52]], treeH);
    const trunk = spline(ctrl, 60);
    const radiusAt = (u: number): number => Math.max(1.4, trunkR * (1 - 0.35 * Math.pow(u, 0.7)) * (1 + 0.5 * Math.exp(-u * 20)));
    surfaceRoots(trunkR);
    stroke(trunk, radiusAt, { vertical: true, clipBase: true, moss: 0.4, mossUntil: 0.07, rough: 0.5 });
    const fork = trunk[trunk.length - 1];
    const crownRx = treeH * 0.4;
    const crownRy = treeH * 0.3;
    const crownCy = fork[1] - crownRy * 0.75;
    crown = { x: fork[0], y: crownCy, rx: crownRx, ry: crownRy };
    lowerFirst = true;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = ((i / (n - 1)) * 2 - 1) * 1.25 + rand(-0.06, 0.06); // radians from vertical
      const start = trunk[Math.round((trunk.length - 1) * lerp(0.7, 1, Math.abs(Math.sin(i * 2.3)) * 0.9))];
      const reach = rand(0.78, 0.98);
      const tip: Point = [fork[0] + Math.sin(a) * crownRx * reach, crownCy - Math.cos(a) * crownRy * reach + crownRy * 0.12];
      // each limb leaves the trunk almost level, then curves up toward the rim of the crown
      const mid: Point = [lerp(start[0], tip[0], 0.7) + Math.sign(a) * rand(0, 5), lerp(start[1], tip[1], 0.25) - 2];
      const r0 = Math.max(1, radiusAt(1) * 0.55);
      stroke(quad(start, mid, tip, 24), (u) => lerp(r0, 0.7, u), { vertical: false });
      const rx = crownRx * rand(0.3, 0.38);
      pads.push({ x: tip[0], y: tip[1], rx, ry: rx * 0.58 });
    }
    // fill the dome: pads in three rows, packed so the crown reads as one round mass
    for (let row = 0; row < 3; row++) {
      const span = crownRx * (1 - row * 0.28);
      const cnt = 3 + (2 - row);
      for (let k = 0; k < cnt; k++) {
        const u = (k / (cnt - 1)) * 2 - 1;
        const rx = crownRx * rand(0.28, 0.36);
        pads.push({
          x: fork[0] + u * span * 0.8 + rand(-3, 3),
          y: crownCy - crownRy * (0.05 + row * 0.38) * (1 - 0.25 * u * u) + rand(-2, 2),
          rx,
          ry: rx * 0.6,
        });
      }
    }
  } else if (form === "ishitsuki") {
    // on a stone: a short, thick, twisting trunk and a very broad dome of foliage
    const trunkR = Math.max(3, treeH * 0.05);
    const path: [number, number][] = [[0, 0], [-0.03, 0.08], [0.05, 0.17], [0.0, 0.27], [0.09, 0.36], [0.13, 0.47]];
    const ctrl = ctrlOf(path, treeH);
    const trunk = spline(ctrl, 70);
    const radiusAt = (u: number): number => Math.max(1.6, trunkR * (1 - 0.55 * Math.pow(u, 0.7)) * (1 + 0.45 * Math.exp(-u * 24)));
    // roots that grip the stone: out across the top, following it, and down its sides
    const rootN = 8;
    for (let i = 0; i < rootN; i++) {
      const side = i % 2 ? 1 : -1;
      const reach = (baseW / 2) * rand(0.6, 1.05) * (i < 2 ? 1 : 0.78);
      const sx = base[0] + side * trunkR * rand(0.1, 0.5);
      const r0 = trunkR * 0.62;
      const r1 = trunkR * 0.18;
      const pts = hug(sx, side, reach, r0, r1, 1.6);
      pts.unshift([sx, base[1] - trunkR * 0.7]);
      stroke(pts, (u) => r1 + (r0 - r1) * Math.pow(1 - u, 0.65), { vertical: false, rough: 0.6, moss: 0.65 });
    }
    stroke(trunk, radiusAt, { vertical: true, clipBase: true, moss: 0.4, mossUntil: 0.1, rough: 1, shari: { from: 0.05, to: 0.6, side: -dir } });
    const top = trunk[trunk.length - 1];
    const crownRx = treeH * 0.52;
    const crownRy = treeH * 0.25;
    const cxC = lerp(top[0], cxp, 0.25);
    const cyC = top[1] - crownRy * 0.25;
    crown = { x: cxC, y: cyC, rx: crownRx, ry: crownRy };
    lowerFirst = true;
    // a couple of heavy limbs into the underside of the crown
    for (const s of [-1, 1]) {
      const start = trunk[Math.round((trunk.length - 1) * 0.8)];
      const tip: Point = [cxC + s * crownRx * 0.55, cyC + crownRy * 0.35];
      stroke(quad(start, [lerp(start[0], tip[0], 0.5), start[1] - 8], tip, 22), (u) => lerp(trunkR * 0.42, 0.9, u), { vertical: false, rough: 0.5 });
    }
    // pads packed into a broad dome, in loose rows with the edges drooping a little
    const rows = 4;
    for (let row = 0; row < rows; row++) {
      const span = crownRx * (1 - row * 0.16);
      const rx0 = crownRx * (0.2 - row * 0.012);
      const cnt = Math.max(3, Math.round((span * 2) / (rx0 * 1.05)));
      for (let k = 0; k < cnt; k++) {
        const u = (k / (cnt - 1)) * 2 - 1;
        const rx = rx0 * rand(0.85, 1.4);
        const droop = Math.pow(Math.abs(u), 2.4) * crownRy * 0.55;
        pads.push({
          x: cxC + u * span * 0.94 + rand(-0.25, 0.25) * rx,
          y: cyC + crownRy * (0.5 - row * 0.32) + droop + rand(-0.15, 0.15) * rx,
          rx,
          ry: rx * rand(0.62, 0.78),
        });
      }
    }
  } else if (form === "kengai") {
    // A coiled trunk: it runs out low across the top of the rock, loops back on itself like a knot of rope, then climbs in an
    // S into a leaning crown of tiers. One long branch swings out and falls past the edge of the rock.
    const tH = treeH;
    const trunkR = Math.max(3, tH * 0.062);
    const j = (): number => rand(-0.035, 0.035);
    const back = rand(0.5, 1.25); // how far the loop curls back
    const path: [number, number][] = [
      [0, 0], [0.1 + j(), 0.03], [0.22 + j(), 0.05], [0.34 + j(), 0.08], [0.43 + j(), 0.14], [0.37 * back + j(), 0.21], [0.29 * back + j(), 0.2],
      [0.35 + j(), 0.3], [0.47 + j(), 0.4], [0.43 + j(), 0.52], [0.51 + j(), 0.65], [0.48 + j(), 0.79], [0.53 + j(), 0.92],
    ];
    const trunk = spline(ctrlOf(path, tH), 220);
    const radiusAt = (u: number): number => Math.max(1.1, trunkR * (1 - 0.6 * Math.pow(u, 0.6)) * (1 + 0.45 * Math.exp(-u * 18)));
    const brush = { vertical: true, clipBase: true, moss: 0.35, mossUntil: 0.08, rough: 0.9 } as const;
    // the lower trunk is plaited from three strands, each weaving in front of and behind the others
    ropeStroke(trunk, radiusAt, rand(0.36, wild ? 0.9 : 0.55), brush, { vertical: true, rough: 0.5, shari: { from: 0.1, to: 0.45, side: -dir } });
    surfaceRoots(trunkR);
    // the crown: tiers of pads up the S, leaning like the trunk
    const crownLimb: Limb = {
      path: [], branches: 8, t0: 0.54, t1: 0.95, reach: 0.38, trunk: 0, taper: 0.6, pad: 1.25, apex: 1.25, droop: 0.12, shari: false, fill: 1, cone: 0.72, elev: [-0.06, 0.3],
    };
    grow({ ctrl: ctrlOf(path, tH), limb: crownLimb, treeH: tH, trunkR, leanDir: dir, main: false, skipTrunk: true });
    // the long branch that cascades: out to the side, then down the face of the rock
    const from = trunk[Math.round((trunk.length - 1) * rand(0.5, 0.6))];
    const endY = Math.min(footRow - 4, from[1] + tH * 0.5);
    const fall = spline(
      [from, [from[0] + dir * tH * 0.12, from[1] - tH * 0.02], [from[0] + dir * tH * 0.24, from[1] + tH * 0.06], [from[0] + dir * tH * 0.33, lerp(from[1], endY, 0.55)], [from[0] + dir * tH * 0.35, endY]],
      60,
    );
    stroke(fall, (u) => lerp(trunkR * 0.55, 1.1, Math.pow(u, 0.8)), { vertical: false, rough: 0.7 });
    const fallAt = (u: number): Point => fall[clamp(Math.round(u * (fall.length - 1)), 0, fall.length - 1)];
    cascadePads(fallAt, 0.25, 0.98, 6, 0.17, tH);
  } else if (form === "hankengai") {
    // A short, thick, twisted trunk on heaving roots, that arches over and sweeps out and down as one long crown.
    const tH = treeH;
    const trunkR = Math.max(3, tH * 0.062);
    const j = (): number => rand(-0.03, 0.03);
    const path: [number, number][] = [
      [0, 0], [-0.03 + j(), 0.1], [0.02 + j(), 0.2], [0.1 + j(), 0.3], [0.24 + j(), 0.37], [0.42 + j(), 0.36], [0.6 + j(), 0.27], [0.74 + j(), 0.12], [0.84 + j(), -0.06],
    ];
    const trunk = spline(ctrlOf(path, tH), 200);
    const radiusAt = (u: number): number => Math.max(1.3, trunkR * (1 - 0.72 * Math.pow(u, 0.55)) * (1 + 0.5 * Math.exp(-u * 20)));
    const trunkAt = (u: number): Point => trunk[clamp(Math.round(u * (trunk.length - 1)), 0, trunk.length - 1)];
    ropeStroke(trunk, radiusAt, rand(0.2, wild ? 0.8 : 0.55), { vertical: true, clipBase: true, moss: 0.35, mossUntil: 0.08, rough: 0.9 }, { vertical: false, rough: 0.6, shari: { from: 0.05, to: 0.3, side: -dir } });
    surfaceRoots(trunkR);
    // the crown rides the arch: flat pads along it, big near the roots and smaller toward the tip, sometimes in a second row above
    const dense = rand(0.75, 1.3);
    const n = 6 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const [tx, ty] = trunkAt(lerp(0.3, 0.97, f));
      const size = tH * 0.2 * (1 - 0.5 * f) * dense;
      const pad: Pad = { x: tx + rand(-0.2, 0.2) * size, y: ty - size * 0.35, rx: size, ry: size * 0.46 };
      stroke([[tx, ty], [pad.x, pad.y + pad.ry * 0.5]], () => 0.9, { vertical: true });
      pads.push(pad);
      if (rng() < 0.45 * dense) pads.push({ x: tx + rand(-0.4, 0.4) * size, y: ty - size * 0.95, rx: size * 0.8, ry: size * 0.38 });
      if (f > 0.4 && rng() < 0.4) pads.push({ x: tx + dir * size * 0.2, y: ty + size * 0.55, rx: size * 0.6, ry: size * 0.28 });
    }
    const end = trunkAt(0.99);
    pads.push({ x: end[0], y: end[1] - tH * 0.02, rx: tH * 0.12 * dense, ry: tH * 0.06 * dense });
  }

  // grass never grows over wood
  for (let i = 0; i < grass.cells.length; i++) if (grass.cells[i] && grid.cells[i]?.kind === K_WOOD) grass.cells[i] = null;

  // ---- foliage --------------------------------------------------------------
  // Upper pads first (so a lower one sits in front of the one above it); a dome goes the other way.
  pads.sort((a, b) => (lowerFirst ? b.y - a.y : a.y - b.y));
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
        let lit = -(u * 0.35 + v * 0.55); // 1 at the upper left, -1 at the lower right
        if (crown) lit = lit * 0.55 - (((x + 0.5 - crown.x) / crown.rx) * 0.3 + ((y + 0.5 - crown.y) / crown.ry) * 0.75) * 0.6; // light across the whole dome
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

  return { sources, groundRow: Math.min(H - 1, groundTop + 1) };
}
