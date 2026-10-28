import type { Grid } from "./grid";
import { drawGrid } from "./render";
import type { Wind } from "./wind";

// The weeping cherry's hanging strands live on their own layer so they can
// move. Each frame the layer is drawn a band of rows at a time, every column
// shifted sideways by an amount that grows with its distance below where the
// strand hangs from: the top stays put, the loose end swings, and a ripple
// travels down each strand.
//
// The strands are sampled from an ImageBitmap and drawn straight onto the
// screen canvas. Drawing them from a second, cached canvas (or from the
// canvas itself) was several times slower in Chrome.
export class Curtain {
  private scratch: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;
  private hasStrands = false;
  private buildId = 0;
  private bitmap: ImageBitmap | null = null; // immutable copy of the strands: much cheaper to sample
  private anchor = new Float32Array(0); // smoothed, so neighbouring columns share a shift
  private x0 = 0;
  private x1 = -1;
  private y0 = 0;
  private y1 = -1;
  private cw = 1;
  private ch = 1;
  private dpr = 1;
  private maxShift = 2; // widest swing, in cells
  private reach = 40; // rows over which a strand reaches full swing
  private offsets = new Int16Array(0);
  private pokes: { x: number; y: number; t: number; amp: number; dir: number }[] = [];
  private now = 0;
  private radius = 90; // how far a poke is felt sideways, in px

  build(grid: Grid, cw: number, ch: number, dpr: number, maxShift: number): void {
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    this.maxShift = maxShift;
    this.radius = Math.max(90, cw * 14);
    this.pokes.length = 0;
    this.hasStrands = false;
    this.bitmap?.close();
    this.bitmap = null;
    this.buildId++;
    const first = new Int16Array(grid.w).fill(-1);
    this.x0 = grid.w;
    this.x1 = -1;
    this.y0 = grid.h;
    this.y1 = -1;

    for (let x = 0; x < grid.w; x++) {
      for (let y = 0; y < grid.h; y++) {
        if (!grid.cells[y * grid.w + x]) continue;
        if (first[x] < 0) first[x] = y;
        this.x0 = Math.min(this.x0, x);
        this.x1 = Math.max(this.x1, x);
        this.y0 = Math.min(this.y0, y);
        this.y1 = Math.max(this.y1, y);
      }
    }
    if (this.x1 < 0) return;

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
    this.hasStrands = true;
    // Go through raw pixels so the bitmap is backed by plain memory and is
    // uploaded once, instead of living on whichever side the canvas did.
    const token = ++this.buildId;
    void createImageBitmap(ctx.getImageData(0, 0, canvas.width, canvas.height)).then((bitmap) => {
      if (this.buildId === token) this.bitmap = bitmap;
      else bitmap.close();
    });
    this.reach = Math.max(12, (this.y1 - this.y0) * 0.9);
    this.offsets = new Int16Array(this.x1 - this.x0 + 2);
  }

  /** Is this screen point on the hanging strands? */
  hit(x: number, y: number): boolean {
    if (!this.hasStrands) return false;
    const col = Math.floor(x / this.cw);
    if (col < this.x0 || col > this.x1) return false;
    const row = y / this.ch;
    return row >= this.anchor[col] && row <= this.y1 + 1;
  }

  /** Strike the strands at a point: a ripple spreads out from it and dies away. */
  poke(x: number, y: number, amp = 1): void {
    if (!this.hasStrands) return;
    if (this.pokes.length >= 6) this.pokes.shift();
    this.pokes.push({ x, y, t: this.now, amp, dir: Math.random() < 0.5 ? -1 : 1 });
  }

  draw(ctx: CanvasRenderingContext2D, t: number, wind: Wind): void {
    this.now = t;
    this.pokes = this.pokes.filter((p) => t - p.t < 2.6);
    const src = this.bitmap;
    if (!src || !this.hasStrands) return; // no strands on this tree, or the bitmap isn't ready yet
    const { cw, ch, dpr, x0, x1, reach, offsets } = this;
    const amp = this.maxShift * cw; // widest swing, in px
    const step = Math.max(1, Math.round(cw * 0.5)); // shifts come in small steps: smooth, but pixels stay crisp
    const band = Math.max(1, Math.round(8 / ch)); // rows drawn together
    const gust = wind.enabled ? 0.75 + 1.4 * wind.strength : 0; // a breeze always stirs them; gusts stir them more
    const lean = Math.max(-1, Math.min(1, wind.x / 130));

    for (let y = this.y0; y <= this.y1; y += band) {
      const rows = Math.min(band, this.y1 + 1 - y);
      const yMid = y + (rows - 1) / 2;

      // shift for every column of this band
      for (let x = x0; x <= x1; x++) {
        const a = this.anchor[x];
        if (yMid <= a) {
          offsets[x - x0] = 0;
          continue;
        }
        const d = Math.min((yMid - a) / reach, 1.2);
        const k = Math.pow(d, 1.35); // the free end swings much more than the root
        // The phase runs down the strand, so a ripple travels toward the tip
        // and each strand bends into an S instead of sliding as a stick.
        const wave =
          Math.sin(t * 1.8 - d * 6.5 + x * 0.045) * 0.85 +
          Math.sin(t * 3.1 - d * 11 + x * 0.09) * 0.3;
        let shift = amp * k * (wave * gust + lean * 1.2);
        if (this.pokes.length) shift += this.pokeShift(x, yMid, Math.min(1, d / 0.3), t);
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

  // Sideways push from every recent poke at a column and height. It arrives
  // later the farther away it is, so it rolls outward and down the strands,
  // swings back and forth and fades. `hang` keeps the root of a strand still.
  private pokeShift(x: number, yMid: number, hang: number, t: number): number {
    const px = (x + 0.5) * this.cw;
    const py = yMid * this.ch;
    let sum = 0;
    for (const p of this.pokes) {
      const dx = px - p.x;
      const dy = py - p.y;
      const u = t - p.t - Math.abs(dx) / 450 - Math.abs(dy) / 380;
      if (u <= 0) continue;
      const spatial = Math.exp(-(dx * dx) / (this.radius * this.radius) - Math.abs(dy) / 320);
      sum += p.dir * p.amp * this.maxShift * this.cw * spatial * Math.exp(-u * 1.7) * Math.sin(u * 9);
    }
    return sum * hang;
  }
}
