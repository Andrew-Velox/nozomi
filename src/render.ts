import { css, mix } from "./color";
import { G_BLADE, G_DOT, G_LINE, G_TUFT, type Grid } from "./grid";

function glyph(ctx: CanvasRenderingContext2D, g: number, x: number, y: number, w: number, h: number): void {
  const u = Math.max(1, Math.round(w / 6));
  const cx = Math.round(x + w / 2 - u / 2);
  const cy = Math.round(y + h / 2 - u / 2);
  switch (g) {
    case 0: // plus
      ctx.fillRect(cx, cy, u, u);
      ctx.fillRect(cx - u, cy, u, u);
      ctx.fillRect(cx + u, cy, u, u);
      ctx.fillRect(cx, cy - u, u, u);
      ctx.fillRect(cx, cy + u, u, u);
      break;
    case 1: // x
      ctx.fillRect(cx, cy, u, u);
      ctx.fillRect(cx - u, cy - u, u, u);
      ctx.fillRect(cx + u, cy - u, u, u);
      ctx.fillRect(cx - u, cy + u, u, u);
      ctx.fillRect(cx + u, cy + u, u, u);
      break;
    case 2: // ring
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) ctx.fillRect(cx + dx * u, cy + dy * u, u, u);
      break;
    case 3: // wide cross
      ctx.fillRect(cx - u * 2, cy, u * 5, u);
      ctx.fillRect(cx, cy - u, u, u * 3);
      break;
    case G_DOT:
      ctx.fillRect(cx, cy, u, u);
      break;
    case G_TUFT: // three chunky blades of different heights
      ctx.fillRect(cx - u * 3, y + h * 0.5, u * 2, h * 0.5);
      ctx.fillRect(cx - u, y + h * 0.2, u * 2, h * 0.8);
      ctx.fillRect(cx + u, y + h * 0.42, u * 2, h * 0.58);
      break;
    case G_BLADE:
      ctx.fillRect(cx - u, y + h * 0.4, u * 2, h * 0.6);
      ctx.fillRect(cx, y + h * 0.25, u, h * 0.3);
      break;
    case G_LINE:
      ctx.fillRect(x, y + h - u, w, u);
      break;
  }
}

/** Paint the whole grid once; the tree never changes between frames. */
export function drawGrid(ctx: CanvasRenderingContext2D, grid: Grid, cw: number, ch: number): void {
  for (let gy = 0; gy < grid.h; gy++) {
    for (let gx = 0; gx < grid.w; gx++) {
      const cell = grid.cells[gy * grid.w + gx];
      if (!cell) continue;
      const x = gx * cw;
      const y = gy * ch;
      if (cell.glyph < 0) {
        ctx.fillStyle = css(mix(cell.bg, cell.color, cell.cov));
        ctx.fillRect(x, y, cw + 1, ch + 1);
        continue;
      }
      ctx.fillStyle = css(cell.bg);
      ctx.fillRect(x, y, cw + 1, ch + 1);
      ctx.fillStyle = css(cell.color);
      glyph(ctx, cell.glyph, x, y, cw, ch);
    }
  }
}
