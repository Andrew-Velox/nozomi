import "./style.css";
import { css } from "./color";
import { icon, WEATHER_ICON } from "./icons";
import { createSakura, FORMS_OF, PALETTES, TREE_DEFAULTS, TREES, WEATHERS, type FormOption, type TreeOption, type Weather } from "./index";
import { makeRamp } from "./palettes";

// The app is the control bar, the keyboard and a saved settings object around one Sakura scene.
// Everything the scene does goes through the same public API the npm package offers.

const STORAGE_KEY = "sakura:v2";
const FPS_CHOICES = [24, 30, 45, 60];

interface Options {
  tree: TreeOption;
  palette: string; // the cherry's blossom colour
  style: FormOption; // the cherry's form
  bonsaiPalette: string; // the bonsai's leaf colour
  bonsaiStyle: FormOption; // the bonsai's style
  detail: boolean;
  density: number; // 1..10
  wind: number; // 0..10
  windOn: boolean;
  weather: Weather;
  rain: boolean;
  fps: number;
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

function loadOptions(): Options {
  const fallback: Options = { tree: "sakura", palette: "sakura", style: "yoshino", bonsaiPalette: TREE_DEFAULTS.bonsai.palette, bonsaiStyle: TREE_DEFAULTS.bonsai.form, detail: false, density: reducedMotion ? 2 : 5, wind: 3, windOn: true, weather: "clear", rain: false, fps: 60 };
  try {
    const o = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      tree: (TREES as readonly string[]).includes(o.tree) ? o.tree : fallback.tree,
      palette: (PALETTES as readonly string[]).includes(o.palette) ? o.palette : fallback.palette,
      style: FORMS_OF.sakura.includes(o.style) ? o.style : fallback.style,
      bonsaiPalette: (PALETTES as readonly string[]).includes(o.bonsaiPalette) ? o.bonsaiPalette : fallback.bonsaiPalette,
      bonsaiStyle: FORMS_OF.bonsai.includes(o.bonsaiStyle) ? o.bonsaiStyle : fallback.bonsaiStyle,
      detail: !!o.detail,
      density: clamp(Number(o.density) || fallback.density, 1, 10),
      wind: clamp(Number.isFinite(Number(o.wind)) ? Number(o.wind) : fallback.wind, 0, 10),
      windOn: o.windOn !== false,
      weather: (WEATHERS as readonly string[]).includes(o.weather) ? o.weather : fallback.weather,
      rain: o.rain === true || o.weather === "rain", // rain used to be a weather of its own
      fps: FPS_CHOICES.includes(o.fps) ? o.fps : fallback.fps,
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

const $ = (id: string): HTMLElement => document.getElementById(id)!;

// Each tree remembers its own colour and style, so switching back finds the other one as you left it.
const curPalette = (): string => (opts.tree === "bonsai" ? opts.bonsaiPalette : opts.palette);
const curStyle = (): FormOption => (opts.tree === "bonsai" ? opts.bonsaiStyle : opts.style);
const LEAF_FIRST = ["pine", "juniper", "matcha", "mint", "maple", "autumn", "gold"];
const palettesFor = (tree: TreeOption): readonly (typeof PALETTES)[number][] =>
  tree === "bonsai" ? [...LEAF_FIRST, ...PALETTES.filter((n) => !LEAF_FIRST.includes(n))] as (typeof PALETTES)[number][] : PALETTES;

const sakura = createSakura($("stage"), {
  tree: opts.tree,
  palette: curPalette() as (typeof PALETTES)[number],
  form: curStyle(),
  detail: opts.detail,
  petals: opts.density,
  wind: opts.windOn ? opts.wind : false,
  weather: opts.weather,
  rain: opts.rain,
  fps: opts.fps,
  touchAction: "none", // a finger sweeps petals instead of scrolling the page
});

// a handle for poking at the scene from the console while developing (not in the built app)
if (import.meta.env.DEV) (window as unknown as { sakura: typeof sakura }).sakura = sakura;

// --- controls --------------------------------------------------------------

const cap = (text: string): string => text[0].toUpperCase() + text.slice(1);
let ambient = false;

document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
  el.innerHTML = icon(el.dataset.icon!);
});

const toast = $("toast");
let toastTimer = 0;
function say(text: string): void {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1400);
}

const hint = $("hint");
const dismissHint = (): void => hint.classList.add("gone");
window.setTimeout(dismissHint, 14000);

const setSwitch = (id: string, on: boolean): void => $(id).setAttribute("aria-checked", String(on));

const TREE_TEXT: Record<TreeOption, { kanji: string; name: string; alt: string; palette: string; leaves: string }> = {
  sakura: { kanji: "桜", name: "Sakura", alt: "A cherry blossom tree with petals falling around it", palette: "Blossom colour", leaves: "Petals" },
  bonsai: { kanji: "盆栽", name: "Bonsai", alt: "A bonsai tree in a pot on a wooden table, with leaves falling", palette: "Leaf colour", leaves: "Leaves" },
};

function syncUi(): void {
  const text = TREE_TEXT[opts.tree];
  $("tree-label").textContent = text.name;
  $("tree-icon").innerHTML = icon(opts.tree === "bonsai" ? "bonsai" : "flower");
  $("brand-kanji").textContent = text.kanji;
  $("brand-name").textContent = text.name;
  $("stage").setAttribute("aria-label", text.alt);
  $("btn-palette").title = `${text.palette} (C)`;
  document.title = text.name;
  $("sw-detail").hidden = opts.tree === "bonsai"; // the bonsai is always drawn in fine pixels
  $("style-label").textContent = cap(curStyle());
  $("palette-label").textContent = cap(curPalette());
  $("swatch").style.background = css(makeRamp(curPalette())[3]);
  $("weather-label").textContent = cap(opts.weather);
  $("weather-icon").innerHTML = icon(WEATHER_ICON[opts.weather]);
  setSwitch("sw-detail", opts.detail);
  setSwitch("sw-wind", opts.windOn);
  setSwitch("sw-rain", opts.rain);
  setSwitch("sw-sound", sakura.options.sound);
  $("btn-ambient").classList.toggle("on", ambient);
}

function regrow(): void {
  sakura.regrow();
}

function setTree(tree: TreeOption): void {
  if (tree === opts.tree) return;
  opts.tree = tree;
  save();
  syncUi();
  sakura.set({ tree, palette: curPalette() as (typeof PALETTES)[number], form: curStyle() }); // a new tree, in the colours and style it had
  say(TREE_TEXT[tree].name);
}

function setStyle(style: FormOption): void {
  if (opts.tree === "bonsai") opts.bonsaiStyle = style;
  else opts.style = style;
  save();
  syncUi();
  sakura.set({ form: style }); // a new tree
}

function cycleStyle(): void {
  const forms = FORMS_OF[opts.tree];
  setStyle(forms[(forms.indexOf(curStyle()) + 1) % forms.length] as FormOption);
}

function setPalette(name: string): void {
  if (opts.tree === "bonsai") opts.bonsaiPalette = name;
  else opts.palette = name;
  save();
  syncUi();
  sakura.set({ palette: name as (typeof PALETTES)[number] }); // the same tree in new colours
}

function cyclePalette(step: number): void {
  const list = palettesFor(opts.tree);
  const i = list.indexOf(curPalette() as (typeof PALETTES)[number]);
  setPalette(list[(i + step + list.length) % list.length]);
  say(cap(curPalette()));
}

function setWeather(weather: Weather): void {
  opts.weather = weather;
  save();
  syncUi();
  sakura.set({ weather });
}

function cycleWeather(step: number): void {
  const i = WEATHERS.indexOf(opts.weather);
  setWeather(WEATHERS[(i + step + WEATHERS.length) % WEATHERS.length]);
  say(cap(opts.weather));
}

function toggleRain(): void {
  opts.rain = !opts.rain;
  sakura.set({ rain: opts.rain });
  save();
  syncUi();
  say(opts.rain ? "Rain on" : "Rain off");
}

function setFps(fps: number): void {
  opts.fps = fps;
  sakura.set({ fps });
  save();
  syncUi();
}

function toggleDetail(): void {
  opts.detail = !opts.detail;
  save();
  syncUi();
  sakura.set({ detail: opts.detail });
}

function toggleSound(): void {
  sakura.set({ sound: !sakura.options.sound });
  syncUi();
}

function changeDensity(delta: number): void {
  opts.density = clamp(opts.density + delta, 1, 10);
  sakura.set({ petals: opts.density });
  save();
  say(`${TREE_TEXT[opts.tree].leaves} ${opts.density}`);
}

function toggleWind(): void {
  opts.windOn = !opts.windOn;
  sakura.set({ wind: opts.windOn ? opts.wind : false });
  save();
  syncUi();
  say(opts.windOn ? "Wind on" : "Wind off");
}

function changeWind(delta: number): void {
  opts.wind = clamp(opts.wind + delta, 0, 10);
  sakura.set({ wind: opts.windOn ? opts.wind : false });
  save();
  say(`Wind ${opts.wind}`);
}

const gust = (): void => {
  if (!opts.windOn) say("Wind is off");
  sakura.gust();
  dismissHint();
};

// The controls minimise into a round button (a bar across the bottom would cover the tree on a
// phone). They start minimised on a narrow screen and open on a wide one.
const narrow = (): boolean => matchMedia("(max-width: 720px)").matches;
let minimised = narrow();

// On a phone the open panel tucks itself away again a few seconds after the last touch, and
// stays while a dropdown is open.
const AUTO_MINIMISE_MS = 6000;
let autoTimer = 0;
function armAutoMinimise(): void {
  clearTimeout(autoTimer);
  if (minimised || !narrow()) return;
  autoTimer = window.setTimeout(() => {
    if (document.querySelector(".menu:not([hidden])")) armAutoMinimise();
    else setMinimised(true);
  }, AUTO_MINIMISE_MS);
}

function setMinimised(value: boolean): void {
  minimised = value;
  document.body.classList.toggle("controls-min", value);
  $("btn-menu").setAttribute("aria-expanded", String(!value));
  closeMenus();
  armAutoMinimise();
  if (!value) showBar();
}

// On a wide screen the bar slides away a few seconds after you stop using it, so it never sits
// over the grass, and comes back when the pointer goes near the bottom edge. It stays while you are
// using it: hovering it, focus inside it, or a menu open. (A phone has the panel above instead.)
const REVEAL_ZONE = 90; // px from the bottom edge that bring the bar back
const HIDE_AT_START_MS = 4500;
const HIDE_AFTER_LEAVING_MS = 1500;
let hideTimer = 0;
let nearBottom = false;

const barBusy = (): boolean =>
  nearBottom ||
  $("bar").matches(":hover") ||
  $("bar").contains(document.activeElement) ||
  !!document.querySelector(".menu:not([hidden])");

function showBar(): void {
  document.body.classList.remove("bar-hidden");
  armHideBar(HIDE_AFTER_LEAVING_MS);
}

function armHideBar(delay: number): void {
  clearTimeout(hideTimer);
  if (narrow() || minimised) return;
  hideTimer = window.setTimeout(() => {
    if (barBusy()) armHideBar(HIDE_AFTER_LEAVING_MS);
    else document.body.classList.add("bar-hidden");
  }, delay);
}

addEventListener(
  "pointermove",
  (e) => {
    if (narrow()) return;
    const near = e.clientY > innerHeight - REVEAL_ZONE;
    if (near) showBar();
    else if (nearBottom) armHideBar(HIDE_AFTER_LEAVING_MS); // just left the bottom edge
    nearBottom = near;
  },
  { passive: true },
);
document.addEventListener("mouseleave", () => {
  nearBottom = false;
  armHideBar(HIDE_AFTER_LEAVING_MS);
});
matchMedia("(max-width: 720px)").addEventListener("change", () => {
  document.body.classList.remove("bar-hidden"); // crossing between phone and desktop layouts starts fresh
  armHideBar(HIDE_AT_START_MS);
});

// Ambient mode: fullscreen, and the controls fade away when nothing moves.
let idleTimer = 0;
function wake(): void {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  if (ambient) idleTimer = window.setTimeout(() => document.body.classList.add("idle"), 2400);
}

function setAmbient(on: boolean): void {
  ambient = on;
  if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  syncUi();
  wake();
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && ambient) setAmbient(false); // left with Esc
});
for (const type of ["pointermove", "pointerdown", "keydown"]) addEventListener(type, wake, { passive: true });

// Dropdowns: a button with a menu beside it that opens upward.
interface MenuItem {
  label: string;
  active: boolean;
  swatch?: string;
  pick: () => void;
}

function closeMenus(): void {
  document.querySelectorAll<HTMLElement>(".menu").forEach((menu) => {
    menu.hidden = true;
    menu.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}

function attachMenu(buttonId: string, items: () => MenuItem[]): void {
  const button = $(buttonId);
  const menu = button.nextElementSibling as HTMLElement;
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = !menu.hidden;
    closeMenus();
    if (wasOpen) return;
    menu.replaceChildren(
      ...items().map((item) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `btn menu-item${item.active ? " on" : ""}`;
        if (item.swatch) {
          const dot = document.createElement("i");
          dot.className = "swatch";
          dot.style.background = item.swatch;
          row.append(dot);
        }
        row.append(item.label);
        const tick = document.createElement("span");
        tick.className = "tick";
        tick.innerHTML = icon("check");
        row.append(tick);
        row.addEventListener("click", () => {
          item.pick();
          closeMenus();
        });
        return row;
      }),
    );
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
  });
}

attachMenu("btn-fps", () => FPS_CHOICES.map((fps) => ({ label: `Limit to ${fps} fps`, active: fps === opts.fps, pick: () => setFps(fps) })));
attachMenu("btn-weather", () => WEATHERS.map((w) => ({ label: cap(w), active: w === opts.weather, pick: () => setWeather(w) })));
attachMenu("btn-tree", () => TREES.map((tree) => ({ label: TREE_TEXT[tree].name, active: tree === opts.tree, pick: () => setTree(tree) })));
attachMenu("btn-style", () => FORMS_OF[opts.tree].map((st) => ({ label: cap(st), active: st === curStyle(), pick: () => setStyle(st as FormOption) })));
attachMenu("btn-palette", () =>
  palettesFor(opts.tree).map((name) => ({ label: cap(name), active: name === curPalette(), swatch: css(makeRamp(name)[3]), pick: () => setPalette(name) })),
);
document.addEventListener("click", closeMenus);

$("btn-ambient").addEventListener("click", () => setAmbient(!ambient));
$("bar").addEventListener("pointerdown", armAutoMinimise);
$("btn-collapse").addEventListener("click", () => setMinimised(true));
// The menu button sits in the bottom right corner and can be dragged anywhere; it remembers where.
const fab = $("btn-menu");
const FAB_KEY = "sakura:fab";
const FAB_MARGIN = 8;
const FAB_SIZE = 48; // its width while hidden, when it cannot be measured
let fabMoved = false; // a drag must not count as a tap

function placeFab(fx: number, fy: number): void {
  const room = (total: number, size: number): number => Math.max(0, total - size - FAB_MARGIN * 2);
  fab.style.left = `${FAB_MARGIN + clamp(fx, 0, 1) * room(innerWidth, fab.offsetWidth || FAB_SIZE)}px`;
  fab.style.top = `${FAB_MARGIN + clamp(fy, 0, 1) * room(innerHeight, fab.offsetHeight || FAB_SIZE)}px`;
  fab.style.right = "auto";
  fab.style.bottom = "auto";
}

function restoreFab(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(FAB_KEY) ?? "null");
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) placeFab(saved.x, saved.y);
  } catch {
    // storage can be blocked: stay in the corner
  }
}

fab.addEventListener("pointerdown", (e) => {
  const start = { x: e.clientX, y: e.clientY };
  const box = fab.getBoundingClientRect();
  fab.setPointerCapture(e.pointerId);
  fabMoved = false;

  const move = (ev: PointerEvent): void => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (!fabMoved && Math.hypot(dx, dy) < 6) return; // still a tap
    fabMoved = true;
    fab.classList.add("dragging");
    const roomX = Math.max(1, innerWidth - box.width - FAB_MARGIN * 2);
    const roomY = Math.max(1, innerHeight - box.height - FAB_MARGIN * 2);
    placeFab((box.left + dx - FAB_MARGIN) / roomX, (box.top + dy - FAB_MARGIN) / roomY);
  };
  const end = (): void => {
    fab.removeEventListener("pointermove", move);
    fab.removeEventListener("pointerup", end);
    fab.removeEventListener("pointercancel", end);
    fab.classList.remove("dragging");
    if (!fabMoved) return;
    const r = fab.getBoundingClientRect();
    try {
      localStorage.setItem(
        FAB_KEY,
        JSON.stringify({
          x: (r.left - FAB_MARGIN) / Math.max(1, innerWidth - r.width - FAB_MARGIN * 2),
          y: (r.top - FAB_MARGIN) / Math.max(1, innerHeight - r.height - FAB_MARGIN * 2),
        }),
      );
    } catch {
      // ignore
    }
  };
  fab.addEventListener("pointermove", move);
  fab.addEventListener("pointerup", end);
  fab.addEventListener("pointercancel", end);
});

fab.addEventListener("click", () => {
  if (fabMoved) {
    fabMoved = false; // that was the end of a drag, not a tap
    return;
  }
  setMinimised(false);
});
addEventListener("resize", restoreFab);
restoreFab();
$("btn-gust").addEventListener("click", gust);
$("sw-detail").addEventListener("click", toggleDetail);
$("sw-wind").addEventListener("click", toggleWind);
$("sw-rain").addEventListener("click", toggleRain);
$("sw-sound").addEventListener("click", toggleSound);

addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case " ":
      e.preventDefault();
      gust();
      break;
    case "Escape": closeMenus(); break;
    case "f": case "F": setAmbient(!ambient); break;
    case "r": case "R": regrow(); break;
    case "c": cyclePalette(1); break;
    case "C": cyclePalette(-1); break;
    case "s": case "S": cycleStyle(); break;
    case "t": case "T": setTree(opts.tree === "sakura" ? "bonsai" : "sakura"); break;
    case "d": case "D": if (opts.tree === "sakura") toggleDetail(); break;
    case "p": case "+": case "=": changeDensity(1); break;
    case "P": case "-": changeDensity(-1); break;
    case "a": case "A": toggleWind(); break;
    case "w": changeWind(1); break;
    case "W": changeWind(-1); break;
    case "e": cycleWeather(1); break;
    case "E": cycleWeather(-1); break;
    case "y": case "Y": toggleRain(); break;
    case "m": case "M": toggleSound(); break;
  }
});

// Tapping the tree tucks the panel away on a phone, and the first touch retires the hint. The
// scene handles the rest of the interaction itself.
sakura.canvas.addEventListener("pointerdown", () => {
  if (narrow() && !minimised) setMinimised(true);
  dismissHint();
});

// The fps button shows the frame rate you are really getting; its menu sets the limit.
window.setInterval(() => {
  if (!document.hidden && sakura.fps > 0) $("fps-label").textContent = `${Math.round(sakura.fps)} fps`;
}, 500);

setMinimised(minimised);
syncUi();
armHideBar(HIDE_AT_START_MS);

// The GitHub link shows how many stars the repository has. GitHub allows only 60 anonymous requests an
// hour, so the count is kept for an hour; if it cannot be fetched the number is left out rather than guessed.
const REPO = "Andrew-Velox/nozomi";
const STARS_KEY = "sakura:stars";
const STARS_FRESH_MS = 60 * 60 * 1000;

function formatStars(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "")}k`;
}

function showStars(n: number): void {
  $("gh-count").textContent = formatStars(n);
  $("gh-stars").hidden = false;
  $("gh-link").setAttribute("aria-label", `View the source on GitHub, ${n} ${n === 1 ? "star" : "stars"}`);
}

async function loadStars(): Promise<void> {
  let cached: { n: number; t: number } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(STARS_KEY) ?? "null");
  } catch {
    // storage can be blocked
  }
  if (cached && Number.isFinite(cached.n)) showStars(cached.n);
  if (cached && Date.now() - cached.t < STARS_FRESH_MS) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return; // rate limited or not found: keep whatever is showing
    const n = (await res.json()).stargazers_count;
    if (typeof n !== "number") return;
    showStars(n);
    try {
      localStorage.setItem(STARS_KEY, JSON.stringify({ n, t: Date.now() }));
    } catch {
      // ignore
    }
  } catch {
    // offline: keep whatever is showing
  }
}
void loadStars();
