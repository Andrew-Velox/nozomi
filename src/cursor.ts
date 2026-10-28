import { css, mix, type Rgb } from "./color";

// A rounded arrowhead pointer drawn in the blossom palette: a pale tint of the lightest
// blossom tone for the fill, the palette's own colour for the edge and a soft dark shadow behind
// it, so it reads on any sky. The hotspot is the tip.
const ARROW = "M5 5 L27 14 L15.5 16.5 L13 28 Z";
const SHADOW = "rgba(52,30,28,0.55)";

export function cursorFor(ramp: Rgb[]): string {
  const fill = css(mix(ramp[0], [255, 255, 255], 0.7));
  const edge = css(ramp[4]);
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>" +
    `<path d='${ARROW}' transform='translate(-1.2 2)' fill='${SHADOW}' stroke='${SHADOW}' stroke-width='3.4' stroke-linejoin='round'/>` +
    `<path d='${ARROW}' fill='${fill}' stroke='${edge}' stroke-width='3' stroke-linejoin='round'/>` +
    "</svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 5 5, pointer`;
}
