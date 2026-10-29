import type { Grid } from "./grid";
import { drawGrid } from "./render";
import type { Wind } from "./wind";

export interface SwayOptions {
  /** "hang": strands fixed at the top, free at the bottom. "mass": a body that sways as one. "grow": blades fixed at the bottom, free at the top (grass). */
  mode: "hang" | "mass" | "grow";
  /** Swing in cells: how far a hanging strand's tip can move, or how hard a poke shoves a mass. */
  swing: number;
  /** Random ripples per second while the wind blows; 0 for none. They pop up at random spots on the layer. */
  ambient?: number;
  /** Speed of ripples: 1 is normal, less is slower and more drawn out. */
  tempo?: number;
  /** How far a ripple reaches sideways, in px (it fades off about 3.5x farther vertically). */
  radius?: number;
}

// Parts of the tree that move live on their own layer: the blossom clusters,
// and the weeping cherry's hanging strands. Each frame a layer is drawn a band
// of rows at a time, every column shifted sideways by its own amount.
//
// The layer is sampled from an ImageBitmap and drawn straight onto the screen
// canvas. Drawing it from a second, cached canvas (or from the canvas itself)
// was several times slower in Chrome.
export class SwayLayer {
  private scratch: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;
  private ready = false;
  private buildId = 0;
  private bitmap: ImageBitmap | null = null; // immutable copy of the pixels: much cheaper to sample
  private mask = new Uint8Array(0); // which cells hold pixels
  private cols = 0;
  private anchor = new Float32Array(0); // hanging layers: where each column hangs from, smoothed
  private runBottom = new Int16Array(0); // growing layers: for each pixel, the row its blade is rooted in
  private runHeight = new Uint8Array(0); // ...and how tall that blade is, in rows
  private rowHas = new Uint8Array(0); // which rows hold any pixels, so empty bands are not drawn
  private x0 = 0;
  private x1 = -1;
  private y0 = 0;
  private y1 = -1;
  private cw = 1;
  private ch = 1;
  private dpr = 1;
  private mode: SwayOptions["mode"] = "mass";
  private swing = 2;
  private ambient = 0;
  private tempo = 1;
  private nextAmbient = 0;
  private reach = 40; // rows over which a strand reaches full swing
  private offsets = new Int16Array(0);
  private pokes: { x: number; y: number; t: number; amp: number; dir: number; radius: number }[] = [];
  private now = 0;
  private radius = 90; // how far a poke is felt sideways, in px

  build(grid: Grid, cw: number, ch: number, dpr: number, opts: SwayOptions): void {
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    this.mode = opts.mode;
    this.swing = opts.swing;
    this.ambient = opts.ambient ?? 0;
    this.tempo = opts.tempo ?? 1;
    this.nextAmbient = 0.4;
    this.radius = opts.radius ?? Math.max(90, cw * 14);
    this.pokes.length = 0;
    this.ready = false;
    this.bitmap?.close();
    this.bitmap = null;
    this.cols = grid.w;
    this.mask = new Uint8Array(grid.w * grid.h);
    const first = new Int16Array(grid.w).fill(-1);
    this.runBottom = new Int16Array(grid.w * grid.h);
    this.runHeight = new Uint8Array(grid.w * grid.h);
    this.rowHas = new Uint8Array(grid.h);
    this.x0 = grid.w;
    this.x1 = -1;
    this.y0 = grid.h;
    this.y1 = -1;

    for (let x = 0; x < grid.w; x++) {
      for (let y = 0; y < grid.h; y++) {
        if (!grid.cells[y * grid.w + x]) continue;
        this.mask[y * grid.w + x] = 1;
        this.rowHas[y] = 1;
        if (first[x] < 0) first[x] = y;
        this.x0 = Math.min(this.x0, x);
        this.x1 = Math.max(this.x1, x);
        this.y0 = Math.min(this.y0, y);
        this.y1 = Math.max(this.y1, y);
      }
    }
    if (this.x1 < 0) return;

    // Grass: every blade is a run of pixels in a column. Its root is the bottom of the run, and it sways by its own height,
    // so a one-pixel blade moves as much (for its size) as a tall one and the whole meadow waves together.
    if (opts.mode === "grow") {
      for (let x = this.x0; x <= this.x1; x++) {
        let y = grid.h - 1;
        while (y >= 0) {
          if (!this.mask[y * grid.w + x]) {
            y--;
            continue;
          }
          const bottom = y;
          let top = y;
          while (top - 1 >= 0 && this.mask[(top - 1) * grid.w + x]) top--;
          const height = Math.min(bottom - top + 1, 255);
          for (let r = top; r <= bottom; r++) {
            this.runBottom[r * grid.w + x] = bottom;
            this.runHeight[r * grid.w + x] = height;
          }
          y = top - 1;
        }
      }
    }

    // Each column hangs from a slightly different row. Using that directly
    // would give every column its own shift and cost one draw call per column
    // per row; a moving average keeps long runs of columns moving together.
    this.anchor = new Float32Array(grid.w).fill(this.y0);
    for (let x = this.x0; x <= this.x1; x++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(this.x0, x - 14); k <= Math.min(this.x1, x + 14); k++) {
        if (first[k] >= 0) {
          sum += first[k];
          n++;
        }
      }
      if (n) this.anchor[x] = sum / n;
    }

    // one scratch canvas, reused between regrows to avoid allocation churn
    const canvas = (this.scratch ??= document.createElement("canvas"));
    canvas.width = Math.round(grid.w * cw * dpr);
    canvas.height = Math.round(grid.h * ch * dpr);
    const ctx = (this.scratchCtx ??= canvas.getContext("2d", { willReadFrequently: true })!);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid(ctx, grid, cw, ch);
    this.ready = true;
    // Go through raw pixels so the bitmap is backed by plain memory and is
    // uploaded once, instead of living on whichever side the canvas did.
    const token = ++this.buildId;
    void createImageBitmap(ctx.getImageData(0, 0, canvas.width, canvas.height)).then((bitmap) => {
      if (this.buildId === token) this.bitmap = bitmap;
      else bitmap.close();
    });
    this.reach = opts.mode === "grow" ? 5 : Math.max(12, (this.y1 - this.y0) * 0.9);
    this.offsets = new Int16Array(this.x1 - this.x0 + 2);
  }

  /** Release the bitmap; the layer draws nothing afterwards until it is built again. */
  dispose(): void {
    this.bitmap?.close();
    this.bitmap = null;
    this.ready = false;
    this.buildId++;
  }

  /** Is this screen point on this layer? */
  hit(x: number, y: number): boolean {
    if (!this.ready) return false;
    const col = Math.floor(x / this.cw);
    if (col < this.x0 || col > this.x1) return false;
    const row = y / this.ch;
    if (this.mode === "hang") return row >= this.anchor[col] && row <= this.y1 + 1;
    return !!this.mask[Math.floor(row) * this.cols + col];
  }

  /** Strike the layer at a point: a ripple spreads out from it and dies away. `radius` is its reach in px. */
  poke(x: number, y: number, amp = 1, radius = this.radius): void {
    if (!this.ready) return;
    if (this.pokes.length >= 6) this.pokes.shift();
    this.pokes.push({ x, y, t: this.now, amp, dir: Math.random() < 0.5 ? -1 : 1, radius });
  }

  draw(ctx: CanvasRenderingContext2D, t: number, wind: Wind): void {
    const dt = Math.min(t - this.now, 0.1);
    this.now = t;
    this.pokes = this.pokes.filter((p) => (t - p.t) * this.tempo < 2.6);
    if (!this.ready) return; // nothing on this layer for this tree
    if (this.ambient > 0 && wind.enabled) this.stir(dt, wind);
    // Until the bitmap is ready (a frame or two after a regrow) fall back to the canvas.
    const src: CanvasImageSource | null = this.bitmap ?? this.scratch;
    if (!src) return;
    const { cw, ch, dpr, x0, x1, reach, offsets } = this;
    const hang = this.mode === "hang";
    const grow = this.mode === "grow";
    const amp = this.swing * cw; // widest swing of a strand tip, in px
    const step = Math.max(1, Math.round(cw * 0.5)); // shifts come in small steps: smooth, but pixels stay crisp
    const band = Math.max(1, Math.round(8 / ch)); // rows drawn together
    const gust = wind.enabled ? 0.75 + 1.4 * wind.strength : 0; // a breeze always stirs them; gusts stir them more
    const lean = Math.max(-1, Math.min(1, wind.x / 130));

    for (let y = this.y0; y <= this.y1; y += band) {
      const rows = Math.min(band, this.y1 + 1 - y);
      let any = false;
      for (let r = 0; r < rows; r++) if (this.rowHas[y + r]) any = true;
      if (!any) continue; // nothing on these rows (grass has a gap between the ground and the top of the rock)
      const yMid = y + (rows - 1) / 2;

      // shift for every column of this band
      for (let x = x0; x <= x1; x++) {
        let shift = 0;

        let weight = 1;
        if (hang) {
          const a = this.anchor[x];
          if (yMid > a) {
            const d = Math.min((yMid - a) / reach, 1.2);
            const k = Math.pow(d, 1.35); // the free end swings much more than the root
            // The phase runs down the strand, so a ripple travels toward the tip
            // and each strand bends into an S instead of sliding as a stick.
            const wave = Math.sin(t * 1.8 - d * 6.5 + x * 0.045) * 0.85 + Math.sin(t * 3.1 - d * 11 + x * 0.09) * 0.3;
            shift += amp * k * (wave * gust + lean * 1.2);
            weight = Math.min(1, d / 0.3);
          } else {
            weight = 0;
          }
        }
        if (grow) {
          // the topmost pixel of this column in this band (if any) decides how the column moves
          let row = -1;
          for (let r = 0; r < rows; r++) {
            if (this.mask[(y + r) * this.cols + x]) {
              row = y + r;
              break;
            }
          }
          if (row >= 0) {
            const i = row * this.cols + x;
            const h = this.runHeight[i];
            const d = (this.runBottom[i] + 1 - (row + 0.5)) / h; // 0 at the root, up to 1 at the tip (a one-pixel blade is halfway)
            // one slow swell rolls over the whole meadow (every blade moves with it), with a quicker flutter on top
            const wave = Math.sin(t * 1.6 + x * 0.03) * 0.85 + Math.sin(t * 3.3 + x * 0.11) * 0.25;
            shift += amp * Math.pow(d, 1.1) * (wave * gust * 0.7 + lean * 0.9);
            weight = Math.min(1, d / 0.35);
          } else {
            weight = 0;
          }
        }
        if (this.pokes.length) shift += this.pokeShift(x, yMid, weight, t);
        offsets[x - x0] = Math.round(shift / step) * step;
      }
      offsets[x1 - x0 + 1] = 32767; // sentinel closes the last run

      // draw runs of columns that share a shift in one call
      let start = x0;
      let current = offsets[0];
      for (let x = x0 + 1; x <= x1 + 1; x++) {
        const o = offsets[x - x0];
        if (o === current) continue;
        // Where the next run has moved away from this one it leaves a seam.
        // Stretching this run across the gap, with the pixels that come next,
        // closes it; where they move together the next draw simply covers it.
        const gap = x > x1 ? 0 : Math.max(0, o - current);
        ctx.drawImage(
          src,
          start * cw * dpr, y * ch * dpr, ((x - start) * cw + gap) * dpr, rows * ch * dpr,
          start * cw + current, y * ch, (x - start) * cw + gap, rows * ch,
        );
        start = x;
        current = o;
      }
    }
  }

  // Now and then a ripple starts at a random spot on the layer, as if a puff of
  // air had caught that bit of blossom. Gusts make them come more often.
  private stir(dt: number, wind: Wind): void {
    this.nextAmbient -= dt;
    if (this.nextAmbient > 0) return;
    this.nextAmbient = (0.5 + Math.random()) / (this.ambient * (0.6 + 1.6 * wind.strength));
    for (let tries = 0; tries < 24; tries++) {
      const col = this.x0 + Math.floor(Math.random() * (this.x1 - this.x0 + 1));
      const row = this.y0 + Math.floor(Math.random() * (this.y1 - this.y0 + 1));
      if (!this.mask[row * this.cols + col]) continue;
      this.poke((col + 0.5) * this.cw, (row + 0.5) * this.ch, 1.3 + Math.random() * 0.9);
      return;
    }
  }

  // Sideways push from every recent poke at a column and height. It arrives
  // later the farther away it is, so it rolls outward (and down the strands),
  // swings back and forth and fades. `weight` keeps the root of a strand still.
  private pokeShift(x: number, yMid: number, weight: number, t: number): number {
    const px = (x + 0.5) * this.cw;
    const py = yMid * this.ch;
    let sum = 0;
    for (const p of this.pokes) {
      const dx = px - p.x;
      const dy = py - p.y;
      const u = (t - p.t) * this.tempo - Math.abs(dx) / 450 - Math.abs(dy) / 380;
      if (u <= 0) continue;
      const spatial = Math.exp(-(dx * dx) / (p.radius * p.radius) - Math.abs(dy) / (p.radius * 3.55));
      sum += p.dir * p.amp * this.swing * this.cw * spatial * Math.exp(-u * 1.7) * Math.sin(u * 9);
    }
    return sum * weight;
  }
}
