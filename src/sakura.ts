import { Audio } from "./audio";
import { BONSAI_STYLES, growBonsai, type BonsaiForm } from "./bonsai";
import { css, hex, mix, type Rgb } from "./color";
import { cursorFor } from "./cursor";
import { Grid } from "./grid";
import { PALETTE_NAMES, makeRamp, type PaletteName } from "./palettes";
import { Petals, type PetalWorld } from "./petals";
import { Rain } from "./rain";
import { drawGrid } from "./render";
import { mulberry32 } from "./rng";
import { SwayLayer } from "./sway";
import { growCellTree, type Form, type Point } from "./tree";
import { growDetailTree } from "./treehd";
import { WEATHERS, WeatherFx, type Weather } from "./weather";
import { Wind } from "./wind";

export const TREES = ["sakura", "bonsai"] as const;
export type TreeOption = (typeof TREES)[number];
/** The kinds of cherry. */
export const FORMS = ["yoshino", "bush", "shidare", "random"] as const;
/** The styles of bonsai. */
export const BONSAI_FORMS = [...BONSAI_STYLES, "random"] as const;
export type FormOption = (typeof FORMS)[number] | (typeof BONSAI_FORMS)[number];
export { PALETTE_NAMES as PALETTES, WEATHERS };
export type { PaletteName, Weather };

/** The forms that go with each tree. */
export const FORMS_OF: Readonly<Record<TreeOption, readonly string[]>> = { sakura: FORMS, bonsai: BONSAI_FORMS };

/** What a tree starts with: its first form, and leaf or blossom colours to suit it. */
export const TREE_DEFAULTS: Readonly<Record<TreeOption, { form: FormOption; palette: PaletteName }>> = {
  sakura: { form: "yoshino", palette: "sakura" },
  bonsai: { form: "moyogi", palette: "pine" },
};

/** Everything you can set. Every field is optional; what you leave out keeps its default. */
export interface SakuraOptions {
  /** Which tree: `"sakura"` (a cherry in blossom) or `"bonsai"` (a tree growing from a mossy rock). Default `"sakura"`. */
  tree?: TreeOption;
  /** Blossom or leaf colour. Default `"sakura"` for the cherry, `"pine"` for the bonsai. See `PALETTES`. */
  palette?: PaletteName;
  /**
   * The cherry: `"yoshino"` (spreading), `"bush"` (a full cloud), `"shidare"` (weeping) or `"random"`.
   * The bonsai: `"moyogi"` (S-curved), `"chokkan"` (straight), `"shakan"` (slanting), `"fukinagashi"` (windswept), `"sokan"` (twin trunk),
   * `"hokidachi"` (broom), `"ishitsuki"` (on a stone), `"hankengai"` (semi-cascade), `"kengai"` (cascade), `"bunjin"` (tall and thin) or `"random"`.
   * Default: the first of the tree's own list. A form that does not belong to the tree is ignored.
   */
  form?: FormOption;
  /** `true` draws a finely branched pixel tree, `false` the blocky cell style. The bonsai is always drawn finely. Default `false`. */
  detail?: boolean;
  /** How many petals, 1 to 10. Default 5 (2 for people who prefer reduced motion). */
  petals?: number;
  /** Wind strength 0 to 10, or `false` for dead still air. Default 3. */
  wind?: number | false;
  /** The sky: `"clear"`, `"sunset"`, `"moonlight"`, `"overcast"` or `"mist"`. Default `"clear"`. */
  weather?: Weather;
  /** Rain falling through the weather. Default `false`. */
  rain?: boolean;
  /** `"sky"` draws its own night sky; `"transparent"` draws only the tree, petals and rain over your page. Default `"sky"`. */
  background?: "sky" | "transparent";
  /** Draw at most this many frames per second, 5 to 60. Default 60. */
  fps?: number;
  /** The same seed grows the same tree. Default: a random one. */
  seed?: number;
  /** Wind and rain sound, plus a chime on click. Browsers only allow it after a click or key press. Default `false`. */
  sound?: boolean;
  /** Clicking or dragging on the scene shakes the blossom. Default `true`. Turn it off to let clicks through. */
  interactive?: boolean;
  /** Use the arrowhead cursor in the blossom colour over the scene. Default `true`. */
  cursor?: boolean;
}

/** Options that only matter when the scene is created. */
export interface SakuraCreateOptions extends SakuraOptions {
  /** Fill the whole window (position: fixed) instead of the container. Default: true when the container is `document.body`. */
  fixed?: boolean;
  /** `z-index` of the canvas. Default: -1 when fixed, otherwise unset. */
  zIndex?: number;
  /** CSS `touch-action` of the canvas. Default `"pan-y"`, so a finger can still scroll the page. */
  touchAction?: string;
  /** Calm the wind and use fewer petals for people who ask their system for reduced motion. Default `true`. */
  respectReducedMotion?: boolean;
}

/** The options as the scene is using them right now. */
export type ResolvedOptions = Required<SakuraOptions>;

// the night sky behind each tree: plum for the cherry, a cool slate for the bonsai
const BACKDROP = {
  sakura: { top: hex("#1a1322"), bot: hex("#110d17") },
  bonsai: { top: hex("#121c25"), bot: hex("#0a1017") },
};
const CLICK_RADIUS = 45; // reach of the ripple a click sends through the blossom, in px
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const newSeed = (): number => (Math.random() * 1e9) | 0;
const includes = (list: readonly string[], value: unknown): boolean => typeof value === "string" && list.includes(value);

export const DEFAULTS: Readonly<ResolvedOptions> = {
  tree: "sakura",
  palette: "sakura",
  form: "yoshino",
  detail: false,
  petals: 5,
  wind: 3,
  weather: "clear",
  rain: false,
  background: "sky",
  fps: 60,
  seed: 0, // replaced by a random seed at creation
  sound: false,
  interactive: true,
  cursor: true,
};

// Merge new options into the current ones, ignoring anything that is not valid.
function merge(base: ResolvedOptions, o: SakuraOptions): ResolvedOptions {
  const next = { ...base };
  if (includes(TREES, o.tree)) next.tree = o.tree!;
  const swapped = next.tree !== base.tree;
  // a new tree starts with its own colours and its own first form, unless you say otherwise
  if (swapped) {
    next.palette = TREE_DEFAULTS[next.tree].palette;
    next.form = TREE_DEFAULTS[next.tree].form;
  }
  if (includes(PALETTE_NAMES, o.palette)) next.palette = o.palette!;
  if (includes(FORMS_OF[next.tree], o.form)) next.form = o.form!;
  if (o.detail !== undefined) next.detail = !!o.detail;
  if (Number.isFinite(o.petals)) next.petals = clamp(Math.round(o.petals!), 1, 10);
  if (o.wind === false) next.wind = false;
  else if (Number.isFinite(o.wind)) next.wind = clamp(o.wind as number, 0, 10);
  if (includes(WEATHERS, o.weather)) next.weather = o.weather!;
  if (o.rain !== undefined) next.rain = !!o.rain;
  if (o.background === "sky" || o.background === "transparent") next.background = o.background;
  if (Number.isFinite(o.fps)) next.fps = clamp(Math.round(o.fps!), 5, 60);
  if (Number.isFinite(o.seed)) next.seed = o.seed!;
  if (o.sound !== undefined) next.sound = !!o.sound;
  if (o.interactive !== undefined) next.interactive = !!o.interactive;
  if (o.cursor !== undefined) next.cursor = !!o.cursor;
  return next;
}

/**
 * A growing tree (a cherry in blossom, or a bonsai) drawn on a canvas inside `container`.
 * Create one with {@link createSakura}.
 */
export class Sakura {
  /** The canvas the scene is drawn on. */
  readonly canvas: HTMLCanvasElement;
  /** The element it lives in. */
  readonly container: HTMLElement;

  private opts: ResolvedOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly treeCanvas = document.createElement("canvas");
  private readonly treeCtx = this.treeCanvas.getContext("2d")!; // transparent: the sky changes behind it
  private readonly bgCanvas = document.createElement("canvas"); // sky and stars
  private readonly bgCtx = this.bgCanvas.getContext("2d", { alpha: false })!;
  private readonly wind = new Wind();
  private readonly audio = new Audio();
  private readonly world: PetalWorld = { w: 1, h: 1, groundY: 1, u: 2, scale: 1, sources: [], colors: [], faded: "#b08aa6" };
  private readonly petals: Petals;
  private readonly weatherFx = new WeatherFx();
  private readonly rain = new Rain();
  private readonly leaves = new SwayLayer(); // blossom clusters
  private readonly curtain = new SwayLayer(); // weeping strands

  private ramp: Rgb[];
  private cellW = 9;
  private cellH = 16;
  private w = 0;
  private h = 0;
  private readonly fixed: boolean;
  private restoreContainerPosition: string | null = null;

  private raf = 0;
  private paused = false;
  private visible = true;
  private destroyed = false;
  private lastFrame = 0;
  private pending = 0;
  private frames = 0;
  private fpsSince = 0;
  private measuredFps = 0;

  private pointer: Point | null = null;
  private lastBrush = 0;
  private lastLeafBrush = 0;
  private resizeTimer = 0;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly visibilityObserver: IntersectionObserver | null;

  constructor(container: HTMLElement | string, options: SakuraCreateOptions = {}) {
    if (typeof document === "undefined") throw new Error("Sakura needs a browser: call createSakura() on the client.");
    const el = typeof container === "string" ? document.querySelector<HTMLElement>(container) : container;
    if (!el) throw new Error(`Sakura: container not found (${String(container)})`);
    this.container = el;

    const reduced = options.respectReducedMotion !== false && typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.wind.calm = reduced ? 0.4 : 1;
    this.opts = merge({ ...DEFAULTS, petals: reduced ? 2 : DEFAULTS.petals, seed: newSeed() }, options);
    this.ramp = makeRamp(this.opts.palette);

    this.fixed = options.fixed ?? (el === document.body || el === document.documentElement);
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
    const style = this.canvas.style;
    style.position = this.fixed ? "fixed" : "absolute";
    style.inset = "0";
    style.width = "100%";
    style.height = "100%";
    style.display = "block";
    style.imageRendering = "pixelated";
    style.touchAction = options.touchAction ?? "pan-y";
    if (options.zIndex !== undefined) style.zIndex = String(options.zIndex);
    else if (this.fixed) style.zIndex = "-1";
    if (!this.fixed && getComputedStyle(el).position === "static") {
      this.restoreContainerPosition = el.style.position;
      el.style.position = "relative"; // the canvas is positioned inside it
    }
    el.appendChild(this.canvas);

    this.petals = new Petals(this.world, this.wind);
    this.applyWind();
    this.weatherFx.set(this.opts.weather, this.opts.rain);
    this.applyInteractive();
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.endDrag);
    this.canvas.addEventListener("pointercancel", this.endDrag);

    // follow the size of the container, or of the window when the scene fills it
    if (!this.fixed && typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(el);
    } else {
      this.resizeObserver = null;
      addEventListener("resize", this.onResize);
    }
    // stop drawing while the scene is scrolled out of view
    if (typeof IntersectionObserver === "function") {
      this.visibilityObserver = new IntersectionObserver((entries) => {
        this.visible = entries[entries.length - 1].isIntersecting;
        this.sync();
      });
      this.visibilityObserver.observe(this.canvas);
    } else {
      this.visibilityObserver = null;
    }

    this.layout();
    if (this.opts.sound) this.audio.set(true);
    this.sync();
  }

  /** The options as the scene is using them now (a copy). */
  get options(): Readonly<ResolvedOptions> {
    return { ...this.opts };
  }

  /** The frame rate being drawn right now, measured twice a second. */
  get fps(): number {
    return this.measuredFps;
  }

  /**
   * Change any options. Changing `form` grows a new tree (unless you also pass a `seed`), and
   * changing `detail` redraws the tree in the other style; everything else updates in place.
   */
  set(options: SakuraOptions): this {
    if (this.destroyed) return this;
    const prev = this.opts;
    const next = merge(prev, options);
    this.opts = next;
    const seedGiven = Number.isFinite(options.seed) && next.seed !== prev.seed;

    if (next.palette !== prev.palette) {
      this.ramp = makeRamp(next.palette);
      this.applyInteractive(); // the cursor follows the palette
    }
    if (next.wind !== prev.wind) this.applyWind();
    if (next.weather !== prev.weather || next.rain !== prev.rain) this.weatherFx.set(next.weather, next.rain);
    if (next.petals !== prev.petals) this.setPetalCount();
    if (next.interactive !== prev.interactive || next.cursor !== prev.cursor) this.applyInteractive();
    if (next.sound !== prev.sound) this.audio.set(next.sound);

    if (next.tree !== prev.tree) {
      if (!seedGiven) this.opts.seed = newSeed();
      this.layout(); // another kind of tree: a different grid, grown from scratch
    } else if (next.detail !== prev.detail && next.tree === "sakura") {
      this.layout(); // a different cell size: grow again on a new grid, same seed
    } else if (next.form !== prev.form || seedGiven) {
      if (!seedGiven) this.opts.seed = newSeed();
      this.grow();
      this.petals.scatter();
    } else if (next.palette !== prev.palette) {
      this.grow(); // same seed: the same tree in new colours
    }
    return this;
  }

  /** Grow a new tree. Pass a seed to get the same tree again. */
  regrow(seed?: number): this {
    if (this.destroyed) return this;
    this.opts.seed = seed !== undefined && Number.isFinite(seed) ? seed : newSeed();
    this.grow();
    this.petals.scatter();
    return this;
  }

  /** Send a gust through the tree. `strength` is the peak wind in pixels per second (default 140). Does nothing while the wind is off. */
  gust(strength?: number): this {
    this.wind.trigger(strength);
    return this;
  }

  /** Stop drawing until `resume()` is called. */
  pause(): this {
    this.paused = true;
    this.sync();
    return this;
  }

  resume(): this {
    this.paused = false;
    this.sync();
    return this;
  }

  /** The current picture as an image. */
  screenshot(type = "image/png", quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) =>
      this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Sakura: could not capture the canvas"))), type, quality),
    );
  }

  /** Stop everything and remove the canvas. The instance cannot be used afterwards. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.resizeTimer);
    this.resizeObserver?.disconnect();
    this.visibilityObserver?.disconnect();
    if (!this.resizeObserver) removeEventListener("resize", this.onResize);
    this.audio.destroy();
    this.leaves.dispose();
    this.curtain.dispose();
    this.canvas.remove();
    if (this.restoreContainerPosition !== null) this.container.style.position = this.restoreContainerPosition;
  }

  // --- internals ---------------------------------------------------------------

  private sync(): void {
    const shouldRun = !this.paused && this.visible && !this.destroyed;
    if (shouldRun && !this.raf) {
      this.lastFrame = performance.now();
      this.fpsSince = this.lastFrame;
      this.frames = 0;
      this.raf = requestAnimationFrame(this.frame);
    } else if (!shouldRun && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private applyWind(): void {
    this.wind.enabled = this.opts.wind !== false;
    if (this.opts.wind !== false) this.wind.level = this.opts.wind;
  }

  private applyInteractive(): void {
    const { interactive, cursor } = this.opts;
    this.canvas.style.pointerEvents = interactive ? "auto" : "none";
    this.canvas.style.cursor = interactive && cursor ? cursorFor(this.ramp) : "";
  }

  private setPetalCount(): void {
    this.petals.target = clamp(Math.round((this.w * this.opts.petals) / 36), 16, 800);
  }

  /** Drawn in single pixels: the cherry in detail mode, and always the bonsai. */
  private get fine(): boolean {
    return this.opts.detail || this.opts.tree === "bonsai";
  }

  private measure(): [number, number] {
    if (this.fixed) return [innerWidth, innerHeight];
    return [this.container.clientWidth, this.container.clientHeight];
  }

  private readonly onResize = (): void => {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      const [w, h] = this.measure();
      if (!this.destroyed && (w !== this.w || h !== this.h)) this.layout();
    }, 150);
  };

  private paintBackdrop(w: number, h: number, rng: () => number): void {
    const g = this.bgCtx;
    const { top, bot } = BACKDROP[this.opts.tree];
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, css(top));
    bg.addColorStop(1, css(bot));
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    // a faint pink haze behind the crown and a scatter of dim stars
    const glow = g.createRadialGradient(w / 2, h * 0.38, 0, w / 2, h * 0.38, Math.max(w, h) * 0.5);
    glow.addColorStop(0, css(mix(top, this.ramp[3], 0.1)));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 0.9;
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
    for (let i = 0; i < Math.round((w * h) / 9000); i++) {
      g.fillStyle = `rgba(255, 232, 244, ${0.1 + rng() * 0.3})`;
      g.fillRect(Math.floor(rng() * w), Math.floor(rng() * h * 0.7), 1, 1);
    }
  }

  /** Grow a tree on the current grid and bake it into the offscreen canvas. */
  private grow(): void {
    const { w, h, cellW, cellH, ramp } = this;
    if (w < 2 || h < 2) return;
    const rng = mulberry32(this.opts.seed);
    // round up so the grid covers the whole area: no empty strip under the grass
    const cols = Math.max(Math.ceil(w / cellW), 20);
    const rows = Math.max(Math.ceil(h / cellH), 12);
    const grid = new Grid(cols, rows);
    const foliage = new Grid(cols, rows);
    const strands = new Grid(cols, rows);

    const { top: bgTop, bot: bgBot } = BACKDROP[this.opts.tree];
    let groundRow = grid.h - 1;
    let sources: Point[];

    this.paintBackdrop(w, h, mulberry32(this.opts.seed ^ 0x9e3779b9));
    this.treeCtx.clearRect(0, 0, w, h);
    if (this.opts.tree === "bonsai") {
      const style = this.opts.form === "random" ? BONSAI_STYLES[Math.floor(rng() * BONSAI_STYLES.length)] : (this.opts.form as BonsaiForm);
      const grown = growBonsai({ grid, foliage, ramp, rng }, style);
      sources = grown.sources;
      groundRow = grown.groundRow;
    } else {
      const sakuraForms: Form[] = ["yoshino", "bush", "shidare"];
      const form: Form = this.opts.form === "random" ? (rng() < 0.45 ? "yoshino" : rng() < 0.55 ? "bush" : "shidare") : sakuraForms.includes(this.opts.form as Form) ? (this.opts.form as Form) : "yoshino";
      if (this.opts.detail) {
        sources = growDetailTree({ grid, foliage, strands, ramp, bgBottom: bgBot, rng }, form);
      } else {
        const rowBg: Rgb[] = [];
        const rowHaze: Rgb[] = [];
        for (let y = 0; y < grid.h; y++) {
          const bg = mix(bgTop, bgBot, (y + 0.5) / grid.h);
          rowBg.push(bg);
          // Partial canopy cells fade toward this, not the raw backdrop: blending
          // a tint straight into dark plum bleeds the hue out to grey.
          rowHaze.push(mix(bg, ramp[6], 0.22));
        }
        sources = growCellTree({ grid, foliage, strands, ramp, rowBg, rowHaze, aspect: cellH / cellW, rng }, form);
      }
    }
    drawGrid(this.treeCtx, grid, cellW, cellH);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const bonsai = this.opts.tree === "bonsai";
    this.leaves.build(foliage, cellW, cellH, dpr, { mode: "mass", swing: bonsai ? 0.8 : 1, ambient: bonsai ? 0.8 : 1.0, tempo: 0.6 });
    this.curtain.build(strands, cellW, cellH, dpr, { mode: "hang", swing: this.fine ? 5 : 2.2 });

    const world = this.world;
    world.w = w;
    world.h = h;
    world.groundY = Math.min(groundRow * cellH, h - 2);
    world.sources = sources.map(([x, y]) => [(x + 0.5) * cellW, (y + 0.5) * cellH]);
    // blossom drifts in pale tones; a bonsai drops leaves in its own mid greens
    world.colors = ramp.slice(bonsai ? 2 : 0, bonsai ? 6 : 4).map(css);
    world.faded = css(mix(bgBot, ramp[bonsai ? 5 : 2], 0.7));
  }

  private layout(): void {
    const [w, h] = this.measure();
    if (w < 2 || h < 2) return; // hidden or not laid out yet; the resize observer calls again
    this.w = w;
    this.h = h;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const c of [this.canvas, this.treeCanvas, this.bgCanvas]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    for (const g of [this.ctx, this.treeCtx, this.bgCtx]) g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const world = this.world;
    if (this.fine) {
      // square pixels, fine enough for the branching to read at any size
      this.cellW = this.cellH = clamp(Math.round(Math.min(w, h * 1.6) / (this.opts.tree === "bonsai" ? 400 : 320)), 2, 6);
      world.u = Math.max(1, Math.round(this.cellW / 2));
    } else {
      this.cellW = clamp(Math.round(Math.min(w / 110, h / (46 * 1.78))), 5, 9);
      this.cellH = Math.round(this.cellW * 1.78);
      world.u = Math.max(2, Math.round(this.cellW / 4));
    }
    world.scale = clamp(h / 760, 0.6, 1.5);
    this.setPetalCount();
    this.grow();
    this.petals.scatter();
  }

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    this.pending += Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    if (this.pending < 1 / (this.opts.fps + 2)) return; // frame-rate cap (also tames high refresh displays)
    const dt = Math.min(this.pending, 1 / 20);
    this.pending = 0;
    if (this.w < 2) return;

    const { ctx, w, h, wind, world } = this;
    const fx = this.weatherFx;
    fx.update(dt);
    const look = fx.look;
    wind.boost = look.windMul;
    this.petals.fallMul = look.fall;
    wind.update(dt);
    this.petals.update(dt);
    this.rain.update(dt, look.rain, world.w, world.groundY, world.scale, wind);
    this.audio.setWind(wind.strength);
    this.audio.setRain(look.rain);

    const t = now / 1000;
    if (this.opts.background === "sky") {
      // The weather lives in the sky: it is drawn on the background first, and the
      // tree, grass and petals go on top of it untouched.
      ctx.drawImage(this.bgCanvas, 0, 0, w, h);
      fx.drawGrade(ctx, w, h, t);
      fx.drawVignette(ctx, w, h);
    } else {
      ctx.clearRect(0, 0, w, h); // transparent: the page shows through
    }
    ctx.drawImage(this.treeCanvas, 0, 0, w, h);
    this.leaves.draw(ctx, t, wind);
    this.curtain.draw(ctx, t, wind);
    this.petals.draw(ctx);
    this.rain.draw(ctx, wind, look.rain);

    this.frames++;
    if (now - this.fpsSince >= 500) {
      this.measuredFps = (this.frames * 1000) / (now - this.fpsSince);
      this.frames = 0;
      this.fpsSince = now;
    }
  };

  // Click or tap the tree to shake blossom loose and send a gust through the air; drag to sweep petals along.
  private local(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.audio.resume(); // a click is the gesture browsers want before they allow sound
    const [x, y] = this.local(e);
    this.pointer = [x, y];
    if (this.curtain.hit(x, y)) this.curtain.poke(x, y);
    if (this.leaves.hit(x, y)) this.leaves.poke(x, y, 1.6, CLICK_RADIUS);
    this.petals.shed(x, y, 140, 36);
    this.petals.impulse(x, y, 160 * this.world.scale, 150);
    this.audio.chime();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.pointer) return;
    const [x, y] = this.local(e);
    const dx = x - this.pointer[0];
    const dy = y - this.pointer[1];
    const now = performance.now() / 1000;
    // brushing a hand through the strands sets them swinging
    if (now - this.lastBrush > 0.09 && Math.hypot(dx, dy) > 3 && this.curtain.hit(x, y)) {
      this.lastBrush = now;
      this.curtain.poke(x, y, 0.5);
    }
    if (now - this.lastLeafBrush > 0.09 && Math.hypot(dx, dy) > 3 && this.leaves.hit(x, y)) {
      this.lastLeafBrush = now;
      this.leaves.poke(x, y, 0.8, CLICK_RADIUS);
    }
    this.petals.shed(x, y, 60, 2);
    this.petals.impulse(x, y, 90 * this.world.scale, Math.min(120, Math.hypot(dx, dy) * 6));
    this.pointer = [x, y];
  };

  private readonly endDrag = (): void => {
    this.pointer = null;
  };
}

/** Grow a cherry blossom tree inside `container` (an element or a CSS selector). */
export function createSakura(container: HTMLElement | string, options?: SakuraCreateOptions): Sakura {
  // checked here, before the class builds its canvases, so a server gets this message and not "document is not defined"
  if (typeof document === "undefined") throw new Error("Sakura needs a browser: call createSakura() on the client, for example inside an effect or onMount.");
  return new Sakura(container, options);
}
