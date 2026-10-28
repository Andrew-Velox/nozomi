import "./style.css";
import { Audio } from "./audio";
import { css, hex, mix, type Rgb } from "./color";
import { Grid } from "./grid";
import { PALETTE_NAMES, makeRamp } from "./palettes";
import { Petals, type PetalWorld } from "./petals";
import { Rain } from "./rain";
import { drawGrid } from "./render";
import { mulberry32 } from "./rng";
import { SwayLayer } from "./sway";
import { growCellTree, type Form, type Point } from "./tree";
import { growDetailTree } from "./treehd";
import { WEATHERS, WeatherFx, type Weather } from "./weather";
import { Wind } from "./wind";

type Style = Form | "random";
const STYLES: Style[] = ["yoshino", "bush", "shidare", "random"];
// reach of the ripple a click sends through the blossom, in px; the random ones are wider
const CLICK_RADIUS = 45;
const STORAGE_KEY = "sakura:v2";
const BG_TOP = hex("#1a1322");
const BG_BOT = hex("#110d17");

interface Options {
  palette: string;
  style: Style;
  detail: boolean;
  density: number; // 1..10
  wind: number; // 0..10
  windOn: boolean;
  weather: Weather;
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

function loadOptions(): Options {
  const fallback: Options = { palette: "sakura", style: "yoshino", detail: false, density: reducedMotion ? 2 : 5, wind: 3, windOn: true, weather: "clear" };
  try {
    const o = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      palette: PALETTE_NAMES.includes(o.palette) ? o.palette : fallback.palette,
      style: STYLES.includes(o.style) ? o.style : fallback.style,
      detail: !!o.detail,
      density: clamp(Number(o.density) || fallback.density, 1, 10),
      wind: clamp(Number.isFinite(Number(o.wind)) ? Number(o.wind) : fallback.wind, 0, 10),
      windOn: o.windOn !== false,
      weather: WEATHERS.includes(o.weather) ? o.weather : fallback.weather,
    };
  } catch {
    return fallback; // storage can be blocked
  }
}

const opts = loadOptions();
function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    // ignore
  }
}

// --- scene state -----------------------------------------------------------

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
const treeCanvas = document.createElement("canvas");
const treeCtx = treeCanvas.getContext("2d")!; // transparent: the sky changes behind it
const bgCanvas = document.createElement("canvas"); // sky and stars
const bgCtx = bgCanvas.getContext("2d", { alpha: false })!;

const wind = new Wind();
wind.level = opts.wind;
wind.enabled = opts.windOn;
wind.calm = reducedMotion ? 0.4 : 1;
const audio = new Audio();

const world: PetalWorld = { w: 1, h: 1, groundY: 1, u: 2, scale: 1, sources: [], colors: [], faded: "#b08aa6" };
const petals = new Petals(world, wind);
const weatherFx = new WeatherFx();
weatherFx.set(opts.weather);
const rain = new Rain();
const leaves = new SwayLayer(); // blossom clusters
const curtain = new SwayLayer(); // weeping strands

let ramp: Rgb[] = makeRamp(opts.palette);
let seed = (Math.random() * 1e9) | 0;
let cellW = 9;
let cellH = 16;

function setPetalCount(w: number): void {
  petals.target = clamp(Math.round((w * opts.density) / 36), 16, 800);
}

function paintBackdrop(w: number, h: number, rng: () => number): void {
  const bg = bgCtx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, css(BG_TOP));
  bg.addColorStop(1, css(BG_BOT));
  bgCtx.fillStyle = bg;
  bgCtx.fillRect(0, 0, w, h);

  // a faint pink haze behind the crown and a scatter of dim stars
  const glow = bgCtx.createRadialGradient(w / 2, h * 0.38, 0, w / 2, h * 0.38, Math.max(w, h) * 0.5);
  glow.addColorStop(0, css(mix(BG_TOP, ramp[3], 0.1)));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  bgCtx.globalAlpha = 0.9;
  bgCtx.fillStyle = glow;
  bgCtx.fillRect(0, 0, w, h);
  bgCtx.globalAlpha = 1;
  for (let i = 0; i < Math.round((w * h) / 9000); i++) {
    bgCtx.fillStyle = `rgba(255, 232, 244, ${0.1 + rng() * 0.3})`;
    bgCtx.fillRect(Math.floor(rng() * w), Math.floor(rng() * h * 0.7), 1, 1);
  }
}

/** Grow a new tree on the current grid and bake it into the offscreen canvas. */
function grow(): void {
  const w = innerWidth;
  const h = innerHeight;
  const rng = mulberry32(seed);
  // round up so the grid covers the whole window: no empty strip under the grass
  const cols = Math.max(Math.ceil(w / cellW), 20);
  const rows = Math.max(Math.ceil(h / cellH), 12);
  const grid = new Grid(cols, rows);
  const foliage = new Grid(cols, rows);
  const strands = new Grid(cols, rows);

  let form: Form = opts.style === "random" ? (rng() < 0.45 ? "yoshino" : rng() < 0.55 ? "bush" : "shidare") : opts.style;
  let sources: Point[];

  paintBackdrop(w, h, mulberry32(seed ^ 0x9e3779b9));
  treeCtx.clearRect(0, 0, w, h);
  if (opts.detail) {
    sources = growDetailTree({ grid, foliage, strands, ramp, bgBottom: BG_BOT, rng }, form);
  } else {
    const rowBg: Rgb[] = [];
    const rowHaze: Rgb[] = [];
    for (let y = 0; y < grid.h; y++) {
      const bg = mix(BG_TOP, BG_BOT, (y + 0.5) / grid.h);
      rowBg.push(bg);
      // Partial canopy cells fade toward this, not the raw backdrop: blending
      // a tint straight into dark plum bleeds the hue out to grey.
      rowHaze.push(mix(bg, ramp[6], 0.22));
    }
    sources = growCellTree({ grid, foliage, strands, ramp, rowBg, rowHaze, aspect: cellH / cellW, rng }, form);
  }
  drawGrid(treeCtx, grid, cellW, cellH);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  leaves.build(foliage, cellW, cellH, dpr, { mode: "mass", swing: 1, ambient: 1.0, tempo: 0.6 });
  curtain.build(strands, cellW, cellH, dpr, { mode: "hang", swing: opts.detail ? 5 : 2.2 });

  world.w = w;
  world.h = h;
  world.groundY = Math.min((grid.h - 1) * cellH, h - 2);
  world.sources = sources.map(([x, y]) => [(x + 0.5) * cellW, (y + 0.5) * cellH]);
  recolor();
}

function recolor(): void {
  world.colors = ramp.slice(0, 4).map(css);
  world.faded = css(mix(BG_BOT, ramp[2], 0.7));
}

function layout(): void {
  const w = innerWidth;
  const h = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  for (const c of [canvas, treeCanvas, bgCanvas]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  treeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (opts.detail) {
    // square pixels, fine enough for the branching to read at any size
    cellW = cellH = clamp(Math.round(Math.min(w, h * 1.6) / 320), 2, 6);
    world.u = Math.max(1, Math.round(cellW / 2));
  } else {
    cellW = clamp(Math.round(Math.min(w / 110, h / (46 * 1.78))), 5, 9);
    cellH = Math.round(cellW * 1.78);
    world.u = Math.max(2, Math.round(cellW / 4));
  }
  world.scale = clamp(h / 760, 0.6, 1.5);
  setPetalCount(w);
  grow();
  petals.scatter();
}

// --- controls --------------------------------------------------------------

const toast = document.getElementById("toast")!;
let toastTimer = 0;
function say(text: string): void {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1400);
}

const hint = document.getElementById("hint")!;
const dismissHint = (): void => hint.classList.add("gone");
window.setTimeout(dismissHint, 14000);

const labels = {
  style: document.getElementById("style-label")!,
  palette: document.getElementById("palette-label")!,
  detail: document.getElementById("detail-label")!,
  sound: document.getElementById("sound-label")!,
  wind: document.getElementById("wind-label")!,
  weather: document.getElementById("weather-label")!,
};
const swatch = document.getElementById("swatch")!;
const detailButton = document.getElementById("btn-detail")!;
const soundButton = document.getElementById("btn-sound")!;
const windButton = document.getElementById("btn-wind")!;

function syncUi(): void {
  labels.style.textContent = opts.style;
  labels.palette.textContent = opts.palette;
  labels.detail.textContent = opts.detail ? "on" : "off";
  detailButton.setAttribute("aria-pressed", String(opts.detail));
  labels.wind.textContent = opts.windOn ? "on" : "off";
  windButton.setAttribute("aria-pressed", String(opts.windOn));
  labels.weather.textContent = opts.weather;
  swatch.style.background = css(ramp[3]);
}

function regrow(): void {
  seed = (Math.random() * 1e9) | 0;
  grow();
  petals.scatter();
}

function cycleStyle(): void {
  opts.style = STYLES[(STYLES.indexOf(opts.style) + 1) % STYLES.length];
  save();
  syncUi();
  regrow();
}

function cyclePalette(step: number): void {
  const i = PALETTE_NAMES.indexOf(opts.palette);
  opts.palette = PALETTE_NAMES[(i + step + PALETTE_NAMES.length) % PALETTE_NAMES.length];
  ramp = makeRamp(opts.palette);
  save();
  syncUi();
  grow(); // same seed: the same tree, new colours
  say(opts.palette);
}

function toggleDetail(): void {
  opts.detail = !opts.detail;
  save();
  syncUi();
  layout();
}

function cycleWeather(step: number): void {
  const i = WEATHERS.indexOf(opts.weather);
  opts.weather = WEATHERS[(i + step + WEATHERS.length) % WEATHERS.length];
  weatherFx.set(opts.weather);
  save();
  syncUi();
  say(opts.weather);
}

function toggleSound(): void {
  const on = audio.toggle();
  labels.sound.textContent = on ? "on" : "off";
  soundButton.setAttribute("aria-pressed", String(on));
}

function changeDensity(delta: number): void {
  opts.density = clamp(opts.density + delta, 1, 10);
  setPetalCount(innerWidth);
  save();
  say(`petals ${opts.density}`);
}

function toggleWind(): void {
  opts.windOn = !opts.windOn;
  wind.enabled = opts.windOn;
  save();
  syncUi();
  say(opts.windOn ? "wind on" : "wind off");
}

function changeWind(delta: number): void {
  opts.wind = clamp(opts.wind + delta, 0, 10);
  wind.level = opts.wind;
  save();
  say(`wind ${opts.wind}`);
}

const gust = (): void => {
  if (!opts.windOn) say("wind is off");
  wind.trigger();
  dismissHint();
};

document.getElementById("btn-style")!.addEventListener("click", cycleStyle);
document.getElementById("btn-palette")!.addEventListener("click", () => cyclePalette(1));
detailButton.addEventListener("click", toggleDetail);
soundButton.addEventListener("click", toggleSound);
windButton.addEventListener("click", toggleWind);
document.getElementById("btn-weather")!.addEventListener("click", () => cycleWeather(1));
document.getElementById("btn-hide")!.addEventListener("click", () => document.body.classList.toggle("ui-hidden"));

addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case " ":
      e.preventDefault();
      gust();
      break;
    case "r": case "R": regrow(); break;
    case "c": cyclePalette(1); break;
    case "C": cyclePalette(-1); break;
    case "s": case "S": cycleStyle(); break;
    case "d": case "D": toggleDetail(); break;
    case "p": changeDensity(1); break;
    case "P": changeDensity(-1); break;
    case "a": case "A": toggleWind(); break;
    case "e": cycleWeather(1); break;
    case "E": cycleWeather(-1); break;
    case "w": changeWind(1); break;
    case "W": changeWind(-1); break;
    case "m": case "M": toggleSound(); break;
    case "h": case "H": document.body.classList.toggle("ui-hidden"); break;
  }
});

// Click or tap the tree to shake blossom loose and send a gust through the air;
// drag to sweep petals along.
let pointer: Point | null = null;
let lastBrush = 0;
let lastLeafBrush = 0;
const clock = (): number => performance.now() / 1000;
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointer = [e.clientX, e.clientY];
  if (curtain.hit(e.clientX, e.clientY)) curtain.poke(e.clientX, e.clientY);
  if (leaves.hit(e.clientX, e.clientY)) leaves.poke(e.clientX, e.clientY, 1.6, CLICK_RADIUS);
  petals.shed(e.clientX, e.clientY, 140, 36);
  petals.impulse(e.clientX, e.clientY, 160 * world.scale, 150);
  audio.chime();
  dismissHint();
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointer) return;
  const dx = e.clientX - pointer[0];
  const dy = e.clientY - pointer[1];
  // brushing a hand through the strands sets them swinging
  if (clock() - lastBrush > 0.09 && Math.hypot(dx, dy) > 3 && curtain.hit(e.clientX, e.clientY)) {
    lastBrush = clock();
    curtain.poke(e.clientX, e.clientY, 0.5);
  }
  if (clock() - lastLeafBrush > 0.09 && Math.hypot(dx, dy) > 3 && leaves.hit(e.clientX, e.clientY)) {
    lastLeafBrush = clock();
    leaves.poke(e.clientX, e.clientY, 0.8, CLICK_RADIUS);
  }
  petals.shed(e.clientX, e.clientY, 60, 2);
  petals.impulse(e.clientX, e.clientY, 90 * world.scale, Math.min(120, Math.hypot(dx, dy) * 6));
  pointer = [e.clientX, e.clientY];
});
const endDrag = (): void => {
  pointer = null;
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

let resizeTimer = 0;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(layout, 150);
});

// --- frame loop ------------------------------------------------------------

const FRAME = 1 / 62;
let last = performance.now();
let pending = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  pending += Math.min((now - last) / 1000, 0.1);
  last = now;
  if (pending < FRAME) return; // cap at ~60fps on high refresh displays
  const dt = Math.min(pending, 1 / 20);
  pending = 0;

  weatherFx.update(dt);
  const look = weatherFx.look;
  wind.boost = look.windMul;
  petals.fallMul = look.fall;
  wind.update(dt);
  petals.update(dt);
  rain.update(dt, look.rain, world.w, world.groundY, world.scale, wind);
  audio.setWind(wind.strength);
  audio.setRain(look.rain);

  const w = innerWidth;
  const h = innerHeight;
  // The weather lives in the sky: it is drawn on the background first, and the
  // tree, grass and petals go on top of it untouched.
  ctx.drawImage(bgCanvas, 0, 0, w, h);
  weatherFx.drawGrade(ctx, w, h, now / 1000);
  weatherFx.drawVignette(ctx, w, h);
  ctx.drawImage(treeCanvas, 0, 0, w, h);
  leaves.draw(ctx, now / 1000, wind);
  curtain.draw(ctx, now / 1000, wind);
  petals.draw(ctx);
  rain.draw(ctx, wind, look.rain);
}

syncUi();
layout();
requestAnimationFrame(frame);
