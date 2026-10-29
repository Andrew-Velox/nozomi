# Sakura 桜 🌸

A calm, procedurally grown cherry blossom tree. Petals fall from the crown, drift on a wandering
wind, settle in the grass and fade. The tree is different every time you regrow it.

It is both an app you can open and a small package you can put on your own site (`npm i sakura-tree`).

Plain TypeScript and Canvas 2D, **no runtime dependencies**. The whole app is about 29 KB gzipped
(25 KB of it JavaScript), and the package on its own, without the control bar, is about 21 KB gzipped.

<p align="center">
  <img src="docs/demo.webp" alt="A 33 second tour of Sakura: a cherry blossom tree with wind, clicks, three kinds of cherry, blossom colours, weather, rain and cell mode" width="100%">
</p>

| Weeping cherry, moonlight and rain | Cell mode, sunset |
| --- | --- |
| ![A lavender weeping cherry in the rain](docs/preview-weeping-rain.jpg) | ![A peach bush cherry at sunset in the blocky cell style](docs/preview-cell-sunset.jpg) |

## Features

- **Two looks.** *Cell mode* is blocky, in the style of a terminal. *Detail mode* is a fully
  branched pixel tree whose limbs fork and taper into twigs.
- **Two trees.** A cherry in blossom, and a **bonsai**: a tree with a gnarled trunk and layered
  pads of leaves, growing from a mossy rock on grassy ground, with boulders and wild flowers. Switch between them with the Tree
  button or `t`. The wind, weather, rain, falling leaves and click ripples work the same on both.
- **Ten bonsai styles,** each with its own trunk, branching, rock and crown: moyogi (S-curved),
  chokkan (formal upright, in tiers), shakan (slanting), fukinagashi (windswept), sokan (twin trunk),
  hokidachi (a broom: a straight trunk under a round crown), ishitsuki (on a flat slab of stone, roots
  gripping it), hankengai (semi-cascade), kengai (a coiled, woven trunk that climbs in an S into a leaning crown, with a long branch falling down the rock) and bunjin (tall, thin,
  bare), or a random one.
- **Three kinds of cherry:** yoshino (spreading), bush (a full, rounded cloud) and shidare
  (weeping), or a random one on every regrow. No two trees are alike.
- **Alive.** Petals sway and tumble as they fall. Blossom clusters ripple at random spots, and the
  weeping strands wave. Click or drag on the tree to shake blossom loose and send ripples through it.
- **Wind** that wanders and gusts. Switch it off and the strands hang still and petals fall straight.
- **Weather** that stays in the sky: clear, sunset, moonlight, overcast and mist, plus a rain switch
  that works on top of any of them. The tree and grass stay crisp in every weather.
- **16 colours:** sakura pink to lavender, mint and gold for the blossom, and pine, juniper, maple and autumn leaves for the bonsai.
- **Ambient mode** for use as a wallpaper: fullscreen, with the controls fading away when idle, and a
  frame-rate limit (24 / 30 / 45 / 60, with a live fps readout) to keep it light.
- **Synthesised sound** (wind, rain and a soft chime on click). No audio files, and nothing loads
  until you switch it on.
- **Works on a phone.** The controls collapse into a small three-line menu button and open as a bottom panel.
- **A pointer that matches.** The cursor over the scene is a small arrowhead in the colour of the
  blossom you picked.
- Settings are remembered. It respects `prefers-reduced-motion`.

## Use it on your website

```bash
npm i sakura-tree
```

**In any element:**

```js
import { createSakura } from "sakura-tree";

const sakura = createSakura("#hero", { palette: "lavender", form: "shidare", weather: "moonlight" });
```

**As a page background** (only the tree, petals and rain are drawn, so your page shows through, and
clicks still reach your page):

```js
createSakura(document.body, { background: "transparent", interactive: false });
```

**As a web component:**

```html
<script type="module">import "sakura-tree/element";</script>

<sakura-tree palette="peach" form="bush" weather="sunset" rain style="height: 420px"></sakura-tree>
```

**From a script tag, with no build step:**

```html
<script src="https://unpkg.com/sakura-tree"></script>
<sakura-tree palette="sakura" detail></sakura-tree>

<!-- a bonsai, in maple leaves -->
<sakura-tree tree="bonsai" form="kengai" palette="maple"></sakura-tree>
```

Change anything later with `sakura.set({ palette: "mint", rain: true })`, or by changing the
attributes of the element. When you are done, `sakura.destroy()` removes it.

### Options

Every option is optional.

| Option | Default | What it does |
| --- | --- | --- |
| `tree` | `"sakura"` | `"sakura"` (a cherry in blossom) or `"bonsai"` (a tree on a mossy rock). Switching grows a new tree, with that tree's own colour and form unless you pass them too. |
| `palette` | `"sakura"` (`"pine"` for the bonsai) | Blossom or leaf colour: `sakura` `blush` `rose` `peach` `coral` `gold` `lavender` `violet` `sky` `mint` `matcha` `white` `pine` `juniper` `maple` `autumn`. |
| `form` | `"yoshino"` (`"moyogi"` for the bonsai) | The cherry: `yoshino`, `bush`, `shidare` (weeping) or `random`. The bonsai: `moyogi`, `chokkan`, `shakan`, `fukinagashi`, `sokan`, `hokidachi`, `ishitsuki`, `hankengai`, `kengai`, `bunjin` or `random`. Changing it grows a new tree. |
| `detail` | `false` | `true` for the finely branched pixel tree, `false` for the blocky cell style. (The bonsai is always drawn finely.) |
| `petals` | `5` | How many petals, 1 to 10. |
| `wind` | `3` | Wind strength, 0 to 10, or `false` for still air. |
| `weather` | `"clear"` | `clear`, `sunset`, `moonlight`, `overcast` or `mist`. |
| `rain` | `false` | Rain falling through the weather. |
| `background` | `"sky"` | `"sky"` draws its own night sky; `"transparent"` draws only the tree, petals and rain. |
| `fps` | `60` | Draw at most this many frames per second (5 to 60). |
| `seed` | random | The same seed grows the same tree. |
| `sound` | `false` | Wind and rain sound, and a chime on click. Browsers only allow it after a click or key press. |
| `interactive` | `true` | Clicking or dragging shakes the blossom. Turn it off to let clicks through to your page. |
| `cursor` | `true` | The arrowhead cursor in the blossom colour over the scene. |

When you create a scene you can also pass `fixed` (fill the whole window; the default when the
container is `document.body`), `zIndex`, `touchAction` (default `"pan-y"`, so a finger can still
scroll the page) and `respectReducedMotion` (default `true`).

### Methods

`set(options)` · `regrow(seed?)` · `gust(strength?)` · `pause()` · `resume()` ·
`screenshot()` (a PNG blob) · `destroy()` · and the read-only `options`, `fps`, `canvas` and `container`.

The scene stops drawing while it is scrolled out of view or the tab is hidden, follows the size of
its container, and uses fewer petals and calmer wind for people who prefer reduced motion. It needs a
browser, so create it on the client (in a framework, inside an effect or `onMount`). The package is
plain ES modules with TypeScript types, and `examples/` has a page for each way of using it
(`npm run build:lib` first).

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check and build the site into dist/
npm run preview   # serve the built site locally
npm run build:lib # build the npm package into lib/
```

Node 20 or newer is recommended.

## Controls

Everything is in the bar at the bottom: Ambient, a live fps readout (click it to limit the frame rate), Minimise, a Gust button, dropdowns for
weather, which tree, its style and its colour, and switches for Detail, Wind, Rain and Sound. Minimise tucks
the bar away into a three-line menu button in the bottom right corner; tap it to bring the bar back, or
drag it anywhere you like (it remembers where).

On a wide screen the bar also slides away a few seconds after you stop using it, so it never sits over
the grass. Move the pointer to the bottom edge to bring it back; it stays while you are hovering it or
a menu is open.

On a phone the controls start minimised so they never cover the tree. Tap the menu button to open
them as a panel across the bottom; it closes itself a few seconds after your last touch, and tapping
the tree tucks it away too.

![The control bar at the bottom of the screen](docs/preview-detail.jpg)

The keyboard works as well:

| Key | Does |
| --- | --- |
| click / tap | shake blossom loose and send a gust through the air; on the blossom and the weeping strands it also sends a ripple rolling through them. Drag to sweep petals along |
| `space` | gust of wind |
| `f` | Ambient mode: fullscreen, and the controls fade away after a couple of idle seconds (move to bring them back, `Esc` to leave) |
| `r` | regrow the tree (a new shape every time) |
| `t` | switch between the sakura and the bonsai |
| `s` | style of the current tree (cherry: yoshino, bush, shidare, random; bonsai: moyogi, chokkan, shakan, fukinagashi, sokan, hokidachi, ishitsuki, hankengai, kengai, bunjin, random) |
| `c` / `C` | next / previous blossom or leaf colour |
| `d` | detail mode on / off (the sakura only) |
| `p` / `P` | more / fewer petals (1 to 10) |
| `a` | wind on / off |
| `w` / `W` | more / less wind |
| `e` / `E` | next / previous weather |
| `y` | rain on / off |
| `m` | sound on / off |

## Deploy

It is a static site, so any static host works.

**Vercel:** import the repository. The Vite defaults are right (build command `npm run build`,
output directory `dist`).

The build uses relative asset paths (`base: "./"` in `vite.config.ts`), so the same output also works
when served from a sub-folder, such as GitHub Pages at `/<repo>/`.

## How it works

Everything is rule-based; nothing is a recorded animation.

| File | What it does |
| --- | --- |
| `src/tree.ts` | Cell mode. A trunk of tapered slices, limbs drawn as curves, then a canopy grown from a field of blobs at the limb tips, broken into clumps with value noise, shaded from the upper left and dotted with blossoms. Each form draws its proportions, lean and limbs from ranges. |
| `src/treehd.ts` | Detail mode. Branches grown by *space colonisation* (attraction points fill the crown and the tree grows toward them), thickness from a pipe model, blossom as layered bundles. |
| `src/bonsai.ts` | The bonsai. The trunk is drawn along a designed curve for each style (a Catmull-Rom spline through hand-set points); a few styles build their crowns differently: a fan of limbs under one round dome (hokidachi), a broad dome of packed pads over a twisting trunk on a stone slab (ishitsuki), a plaited three-strand trunk, a leaning tiered crown and a long hanging branch (kengai), thick at the roots and tapering, lit from the upper left with bark streaks and a strip of bleached deadwood. Branches arch out in a cone, each carrying flat pads of foliage built from scalloped lobes, shaded top to bottom, with the pad behind darkened where a lower one overlaps it. Then the ground: a layered, mossy rock that is low and broad, flat and slab-like or a tall pillar for the cascade, with grass drooping over it, small boulders, flowers, and grass and earth right across the bottom. |
| `src/grid.ts`, `src/render.ts` | The tree is a grid of cells painted once onto a transparent canvas. Cells on the outline fade into whatever sky is behind them. |
| `src/petals.ts`, `src/wind.ts` | Petals fall from the blossom with sway and tumble, catch a wandering wind plus gusts, lie on the ground for a few seconds and fade. |
| `src/sway.ts` | The moving parts of the tree live on their own layers: the blossom clusters (random local ripples) and the hanging strands (a wave that travels down each one). Each frame a layer is drawn a band of rows at a time, every column shifted sideways by its own amount. |
| `src/weather.ts`, `src/rain.ts` | Each weather is a "look" (tint, sky veil, light, clouds, fog, rain, wind and petal-fall multipliers) drawn as overlays on the sky behind the tree. Changing weather eases every number, so nothing is regrown. Rain streaks lean with the wind and splash in the grass. |
| `src/audio.ts` | Wind, rain and chimes, all synthesised with the Web Audio API. |
| `src/sakura.ts` | The engine. One `Sakura` class owns the canvas, the layout, the frame loop and the click handling, and nothing is global, so any number of scenes can share a page. It is what `createSakura()` returns, and the app below is built on it. |
| `src/index.ts`, `src/element.ts`, `src/cdn.ts` | The package: the API, the `<sakura-tree>` web component, and the one-file script-tag build. |
| `src/main.ts` | The app: the control bar, ambient mode, the keyboard and saved settings, all driving a scene through the same public API. |

## Credits

- **[csakura](https://github.com/realstrawhat/csakura)** by realstrawhat (MIT) is the inspiration
  for the look, and Sakura's tree generation follows its approach: tree forms drawn from ranges, a
  canopy grown from blobs at the limb tips, and space-colonisation branching in detail mode.
  The code here was written from scratch. Its licence notice is in [NOTICE.md](NOTICE.md).
- **[nagomi](https://github.com/msk1039/nagomi)** by Mayank Kadam inspired the idea of a calm,
  procedural scene with weather and a single control bar. No code from it is used.

## License

[MIT](LICENSE). Third-party notices are in [NOTICE.md](NOTICE.md).
