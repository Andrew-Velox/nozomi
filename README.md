# Sakura

A procedurally grown cherry blossom tree with petals drifting down on the wind,
in the blocky cell style of [csakura](https://github.com/realstrawhat/csakura).
Plain TypeScript + Canvas 2D, **no runtime dependencies** (~10 KB gzipped JS).
The tree is baked once onto an offscreen canvas; only the petals are drawn each frame.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Controls

Everything is in the bar at the bottom: Ambient, an fps menu, Hide UI, a Gust button, a petal
counter, dropdowns for weather, tree form and blossom colour, and switches for Detail, Wind, Rain and
Sound. The keyboard works too:

| Key | Does |
| --- | --- |
| click / tap | shake blossom loose from the crown and send a gust through the air (drag to sweep petals); on the weeping strands and the blossom it also sends a ripple rolling through them |
| `space` | gust of wind |
| `f` | Ambient mode: fullscreen, and the controls fade away after a couple of idle seconds (move to bring them back, `Esc` to leave) |
| `h` | hide / show the interface |
| `r` | regrow the tree (a new shape every time) |
| `s` | tree form: yoshino, bush, shidare (weeping), random |
| `c` / `C` | next / previous blossom colour (12 palettes) |
| `d` | detail mode: a fully branched pixel tree |
| `p` / `P` | more / fewer petals |
| `a` | wind on / off (off: no wind, strands hang still, petals fall straight) |
| `w` / `W` | more / less wind |
| `e` / `E` | next / previous weather: clear, sunset, moonlight, overcast, mist |
| `y` | rain on / off, on top of any weather |
| `m` | synthesised sound: wind and rain, plus a chime on click |

The frame-rate menu (24 / 30 / 45 / 60) caps how often the scene is drawn, which keeps it light
when it is used as a wallpaper. Settings persist between visits.

## How it works

- `tree.ts` – cell mode. A trunk of tapered slices, limbs drawn as curves, then a canopy grown
  from a field of blobs placed at the limb tips, broken into clumps with value noise, shaded
  from the upper left and dotted with blossoms. Partial block coverage makes edges taper smoothly.
  Each form (yoshino / bush / shidare) draws its proportions, lean and limbs from ranges.
- `treehd.ts` – detail mode. Branches grown by space colonisation (attraction points fill the
  crown, the tree grows toward them), thickness from a pipe model, blossom as layered bundles.
- `curtain.ts` – the weeping cherry's hanging strands are a separate layer, redrawn each frame a row
  at a time with a wind-driven sideways shift that grows toward the loose ends, so they sway; clicking or dragging across them adds a decaying ripple that rolls outward and down.
- `weather.ts` – each weather is a "look" (tint, sky veil, light, clouds, fog, rain, wind and petal-fall
  multipliers) drawn as overlays on the sky behind the tree (the tree, grass and petals are drawn on top, so they
  stay clear in every weather); changing weather eases every number, so nothing is regrown. `rain.ts` adds streaks that lean with the wind and splash in the grass.
- `petals.ts` / `wind.ts` – petals fall from blossom cells with sway and tumble, catch a wandering
  wind plus gusts, lie on the ground for a few seconds and fade.
- `grid.ts` / `render.ts` – the tree is a grid of cells painted as solid blocks and tiny glyphs.
