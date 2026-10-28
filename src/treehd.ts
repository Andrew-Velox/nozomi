import { mix, type Rgb } from "./color";
import { G_BLOCK, K_CANOPY, K_GROUND, K_WOOD, type Grid } from "./grid";
import { noise2 } from "./noise";
import type { Rng } from "./rng";
import { GRASS, GRASS_DARK, WOOD_D, WOOD_L, WOOD_M, type Form, type Point } from "./tree";

export interface HdEnv {
  grid: Grid; // square cells: one cell is one pixel
  foliage: Grid; // blossom goes here so it can sway
  strands: Grid; // weeping strands go here so they can sway
  ramp: Rgb[];
  bgBottom: Rgb;
  rng: Rng;
}

interface Node {
  x: number;
  y: number;
  parent: number;
  kids: number;
  r: number;
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

interface HdSpec {
  rx: [number, number]; // crown half-width over tree height
  ry: [number, number];
  bundle: [number, number]; // blossom bundle radius over tree height
  gap: number; // spacing between bundles, in bundle radii
}

const SPECS: Record<Form, HdSpec> = {
  yoshino: { rx: [0.85, 1.05], ry: [0.27, 0.33], bundle: [0.05, 0.07], gap: 1.15 },
  bush: { rx: [0.78, 0.92], ry: [0.34, 0.4], bundle: [0.055, 0.075], gap: 0.85 },
  shidare: { rx: [0.7, 0.85], ry: [0.24, 0.3], bundle: [0.05, 0.065], gap: 1.0 },
};

/**
 * A fully branched tree in single pixels. Branches come from space colonisation:
 * the crown is filled with attraction points and the tree grows toward them a
 * node at a time, each point dropped once a branch reaches it. Branches
 * competing for those points is what gives the heavy limbs that fork and taper
 * into fine twigs.
 */
export function growDetailTree(env: HdEnv, form: Form): Point[] {
  const { grid, ramp, rng } = env;
  const W = grid.w;
  const H = grid.h;
  const spec = SPECS[form];
  const sources: Point[] = [];
  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const range = (r: [number, number]): number => rand(r[0], r[1]);

  const px = (x: number, y: number, color: Rgb, kind: number): void => {
    (kind === K_CANOPY ? env.foliage : grid).set(x, y, { glyph: G_BLOCK, color, bg: color, cov: 1, kind });
  };

  const ground = H - 1;
  const pad = Math.max(2, H * 0.05);
  const tall = Math.min(H - 1 - pad, W * 0.72);
  const rx = Math.min(tall * range(spec.rx), W * 0.46);
  const ry = tall * range(spec.ry);
  const top = ground - tall;
  const cy = top + ry;
  const cx = W / 2 + rand(-1, 1) * rx * 0.08;
  const trunkTop = cy + ry * 0.9;
  const bx = W / 2;
  const tx = cx * 0.85 + bx * 0.15;

  // ---- skeleton -------------------------------------------------------------
  const nodes: Node[] = [];
  const step = Math.max(2.4, tall * 0.016);
  let dI = Math.max(tall * 0.28, 20); // how far a node can sense a point
  const dK = step * 2.2; // a point this close to a node is reached
  const bucket = dI;
  const buckets = new Map<number, number[]>();
  const key = (bxI: number, byI: number): number => bxI * 100003 + byI;
  const addNode = (x: number, y: number, parent: number): number => {
    nodes.push({ x, y, parent, kids: 0, r: 0 });
    const i = nodes.length - 1;
    if (parent >= 0) nodes[parent].kids++;
    const k = key(Math.floor(x / bucket), Math.floor(y / bucket));
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
    return i;
  };

  // trunk: a gently bent chain from the roots to where it forks
  const trunkSteps = Math.max(2, Math.round((ground - 1 - trunkTop) / step));
  const bend = rand(-1, 1) * tall * 0.03;
  let last = -1;
  for (let i = 0; i <= trunkSteps; i++) {
    const t = i / trunkSteps;
    last = addNode(bx + (tx - bx) * t + Math.sin(t * Math.PI) * bend, ground - 1 - (ground - 1 - trunkTop) * t, last);
  }

  const attractors: Point[] = [];
  const count = clamp(Math.round(rx * ry * 0.12), 300, 1800);
  while (attractors.length < count) {
    const x = rand(-1, 1);
    const y = rand(-1, 1);
    if (x * x + y * y <= 1) attractors.push([cx + x * rx, cy + y * ry]);
  }

  let alive = attractors;
  let stalled = 0;
  for (let iter = 0; iter < 260 && alive.length && nodes.length < 3500; iter++) {
    const pull = new Map<number, [number, number]>();
    const keep: Point[] = [];
    const reach = Math.ceil(dI / bucket);
    for (const a of alive) {
      const abx = Math.floor(a[0] / bucket);
      const aby = Math.floor(a[1] / bucket);
      let best = -1;
      let bestD = dI * dI;
      for (let gx = abx - reach; gx <= abx + reach; gx++) {
        for (let gy = aby - reach; gy <= aby + reach; gy++) {
          const list = buckets.get(key(gx, gy));
          if (!list) continue;
          for (const ni of list) {
            const d = (nodes[ni].x - a[0]) ** 2 + (nodes[ni].y - a[1]) ** 2;
            if (d < bestD) {
              bestD = d;
              best = ni;
            }
          }
        }
      }
      if (best < 0) {
        keep.push(a);
        continue;
      }
      if (bestD < dK * dK) continue; // reached
      keep.push(a);
      const d = Math.sqrt(bestD);
      const p = pull.get(best) ?? [0, 0];
      p[0] += (a[0] - nodes[best].x) / d;
      p[1] += (a[1] - nodes[best].y) / d;
      pull.set(best, p);
    }
    alive = keep;

    if (pull.size === 0) {
      // nothing in range yet: the fork is far below the crown, so reach further
      if (++stalled > 4) break;
      dI *= 1.5;
      continue;
    }
    for (const [ni, p] of pull) {
      const len = Math.hypot(p[0], p[1]);
      let dx = len > 1e-3 ? p[0] / len : rand(-1, 1);
      let dy = len > 1e-3 ? p[1] / len : -1;
      dx += rand(-0.18, 0.18);
      dy += rand(-0.18, 0.18);
      const n = Math.hypot(dx, dy) || 1;
      const nx = nodes[ni].x + (dx / n) * step;
      const ny = nodes[ni].y + (dy / n) * step;
      if (nx > 1 && nx < W - 1 && ny > 1 && ny < ground - 1) addNode(nx, ny, ni);
    }
  }

  // ---- thickness: a parent carries what its children carry -----------------
  const power = 2.4;
  const raw = new Array<number>(nodes.length).fill(0);
  const sum = new Array<number>(nodes.length).fill(0);
  for (let i = nodes.length - 1; i >= 0; i--) {
    raw[i] = nodes[i].kids === 0 ? 1 : Math.pow(sum[i], 1 / power);
    if (nodes[i].parent >= 0) sum[nodes[i].parent] += Math.pow(raw[i], power);
  }
  const trunkR = clamp(tall * 0.034, 1.8, 8);
  const scale = trunkR / raw[0];
  for (let i = 0; i < nodes.length; i++) {
    const flare = i < trunkSteps ? 1 + 0.5 * Math.exp(-(i / trunkSteps) * 6) : 1;
    nodes[i].r = Math.max(0.55, raw[i] * scale) * flare;
  }

  // ---- wood -----------------------------------------------------------------
  // Light falls from the upper left, so a limb is dark on its lower right.
  const lightX = -0.6;
  const lightY = -0.8;
  for (const n of nodes) {
    if (n.parent < 0) continue;
    const a = nodes[n.parent];
    const dx = n.x - a.x;
    const dy = n.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const face = nx * lightX + ny * lightY >= 0 ? 1 : -1;
    const steps = Math.floor(len / 0.35) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      const rr = a.r + (n.r - a.r) * t;
      if (rr < 0.75) {
        px(x, y, rr < 0.5 ? WOOD_D : WOOD_M, K_WOOD);
        continue;
      }
      for (let py = Math.floor(y - rr); py <= Math.ceil(y + rr); py++) {
        for (let pxx = Math.floor(x - rr); pxx <= Math.ceil(x + rr); pxx++) {
          const ox = pxx + 0.5 - x;
          const oy = py + 0.5 - y;
          if (ox * ox + oy * oy > rr * rr) continue;
          const lit = ((ox * nx + oy * ny) / rr) * face;
          px(pxx, py, lit < -0.35 ? WOOD_D : lit > 0.35 ? WOOD_L : WOOD_M, K_WOOD);
        }
      }
    }
  }
  // cherry bark is ringed with short horizontal dashes
  for (const n of nodes) {
    if (n.r < 2.2 || rng() > 0.12) continue;
    const half = n.r * rand(0.25, 0.55);
    for (let x = Math.ceil(n.x - half); x <= Math.floor(n.x + half); x++)
      if (grid.kind(x, Math.floor(n.y)) === K_WOOD) px(x, n.y, WOOD_D, K_WOOD);
  }

  // ---- blossom --------------------------------------------------------------
  // Bundles of flowers layered dark, then mid, then light toward the light.
  // The dark left showing reads as the shadow under each cluster.
  const rb = clamp(tall * range(spec.bundle), 3, 14);
  const seed = rng() * 100;
  const blob = (bxC: number, byC: number, brx: number, bry: number, color: Rgb, emit: boolean): void => {
    for (let y = Math.floor(byC - bry - 1); y <= Math.ceil(byC + bry + 1); y++) {
      for (let x = Math.floor(bxC - brx - 1); x <= Math.ceil(bxC + brx + 1); x++) {
        const nx = (x - bxC) / brx;
        const ny = (y - byC) / bry;
        const edge = (noise2(x * 0.45 + seed, y * 0.45) - 0.5) * 0.8;
        if (nx * nx + ny * ny >= 1 + edge || y >= ground - 1) continue;
        px(x, y, color, K_CANOPY);
        if (emit && y > byC && rng() < 0.012) sources.push([x, y]);
      }
    }
  };

  const candidates = nodes.filter((n) => n.kids === 0 || (n.r < 1.3 && rng() < 0.15));
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const spots: Point[] = [];
  const minD = rb * spec.gap * 1.6;
  for (const n of candidates) {
    if (spots.length >= 140) break;
    if (spots.every((s) => Math.hypot(s[0] - n.x, s[1] - n.y) >= minD)) spots.push([n.x, n.y - rb * 0.3]);
  }
  spots.sort((a, b) => b[1] - a[1]); // lowest first, so upper bundles overlap them

  for (const [sx, sy] of spots) {
    const subs: [number, number, number][] = [
      [0, 0, 1],
      [rand(-0.8, -0.5) * rb, rand(0.1, 0.5) * rb, 0.62],
      [rand(0.5, 0.8) * rb, rand(0.1, 0.5) * rb, 0.62],
    ];
    for (const [ox, oy, s] of subs) {
      const cxB = sx + ox;
      const cyB = sy + oy;
      const w = rb * 1.25 * s;
      const h = rb * 0.85 * s;
      blob(cxB, cyB, w, h, ramp[5], true);
      blob(cxB - rb * 0.12 * s, cyB - rb * 0.24 * s, w * 0.82, h * 0.78, ramp[3], false);
      if (rng() < 0.75) blob(cxB - rb * 0.26 * s, cyB - rb * 0.4 * s, w * 0.55, h * 0.5, ramp[1], false);
      for (let k = 0; k < rb * 0.9 * s; k++) {
        const fx = cxB + rand(-1, 1) * w * 0.8;
        const fy = cyB + rand(-1, 0.6) * h * 0.8;
        if (env.foliage.kind(fx, fy) === K_CANOPY) px(fx, fy, rng() < 0.5 ? ramp[0] : ramp[2], K_CANOPY);
      }
    }
  }

  // weeping cherry: strands hanging from the underside of the crown
  if (form === "shidare") {
    for (let x = Math.floor(cx - rx * 1.05); x <= Math.floor(cx + rx * 1.05); x++) {
      if (rng() < 0.35) continue;
      let y0 = -1;
      for (let y = ground - 2; y >= 0; y--) {
        if (env.foliage.kind(x, y) === K_CANOPY) {
          y0 = y;
          break;
        }
      }
      if (y0 < 0) continue;
      const frac = Math.min(Math.abs(x - cx) / rx, 1);
      const len = (ground - y0) * (0.25 + 0.6 * Math.pow(frac, 0.8)) * rand(0.5, 1);
      for (let k = 1; k <= len; k++) {
        const t = k / len;
        if (rng() < t * 0.4 || grid.kind(x, y0 + k) === K_WOOD) continue;
        const c = ramp[clamp(Math.floor(2 + t * 3 + rand(-1, 1)), 0, 7)];
        env.strands.set(x, y0 + k, { glyph: G_BLOCK, color: c, bg: c, cov: 1, kind: K_CANOPY });
        if (rng() < 0.03) sources.push([x, y0 + k]);
      }
    }
  }

  // ---- ground ---------------------------------------------------------------
  // Grass in clumps: every column gets blades of its own height, dark at the
  // root and lighter toward the tip, taller in the clumps.
  const maxBlade = clamp(Math.round(tall * 0.05), 3, 9);
  for (let x = 0; x < W; x++) {
    const d = (x - cx) / (rx * 1.2);
    const p = Math.exp(-d * d * 2.2);
    const clump = noise2(x * 0.12, 5.1) * 0.7 + noise2(x * 0.4, 9.7) * 0.3;
    const h = Math.max(1, Math.round(1 + maxBlade * clump * (0.45 + rng() * 0.75)));
    for (let k = 0; k < h; k++) {
      const y = ground - k;
      const tip = h > 1 ? k / (h - 1) : 0;
      px(x, y, mix(GRASS_DARK, GRASS, clamp(tip * 0.9 + (rng() - 0.5) * 0.25 + 0.1, 0, 1)), K_GROUND);
    }
    if (rng() < p * 0.4) px(x, ground - Math.floor(rng() * 3), ramp[1 + Math.floor(rng() * 3)], K_GROUND);
  }
  return sources;
}
