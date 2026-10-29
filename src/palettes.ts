import { hex, mix, type Rgb } from "./color";

// light, mid and deep anchors; the eight-step ramp is interpolated from them.
const ANCHORS = {
  sakura: ["#ffe6f2", "#fb74b2", "#8f2a5a"],
  blush: ["#fff0f3", "#f08ea6", "#8c3a52"],
  rose: ["#ffd9e2", "#f2587e", "#7a1f3a"],
  peach: ["#ffeadb", "#f29a70", "#8a3d1e"],
  coral: ["#ffe2da", "#f26b52", "#7c2418"],
  gold: ["#fff4d2", "#e0ae4c", "#74500f"],
  lavender: ["#f2e8ff", "#a98be0", "#4b3290"],
  violet: ["#f1e0ff", "#9a58dc", "#4a1a86"],
  sky: ["#e4f2ff", "#5aa4ee", "#1f4f86"],
  mint: ["#e2fff0", "#4cc796", "#1a6a48"],
  matcha: ["#eaf6d4", "#86b848", "#35591a"],
  white: ["#ffffff", "#f3b6cd", "#a04b6c"],
  // leaf colours, for the bonsai
  pine: ["#e6f6d8", "#5c9e4a", "#1c4424"],
  juniper: ["#e0f5ee", "#4f9e86", "#164a3e"],
  maple: ["#ffe3d3", "#e5532f", "#66150f"],
  autumn: ["#fff0c8", "#e89a2b", "#733a0c"],
} satisfies Record<string, [string, string, string]>;

export type PaletteName = keyof typeof ANCHORS;
export const PALETTE_NAMES = Object.keys(ANCHORS) as PaletteName[];

/** Eight tones, 0 lightest to 7 deepest. */
export function makeRamp(name: string): Rgb[] {
  const anchors = (ANCHORS as Record<string, [string, string, string]>)[name] ?? ANCHORS.sakura;
  const [light, mid, deep] = anchors.map(hex);
  return Array.from({ length: 8 }, (_, i) => {
    const t = i / 7;
    return t < 0.5 ? mix(light, mid, t / 0.5) : mix(mid, deep, (t - 0.5) / 0.5);
  });
}
