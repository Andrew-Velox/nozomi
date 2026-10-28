import type { Rgb } from "./color";

export const K_NONE = 0;
export const K_WOOD = 1;
export const K_CANOPY = 2;
export const K_GROUND = 3;

/** Glyph -1 is a solid block blended toward the background by `cov`. */
export const G_BLOCK = -1;
export const G_DOT = 4;
export const G_TUFT = 5;
export const G_BLADE = 6;
export const G_LINE = 7;
// 0..3 are the four blossom shapes

export interface Cell {
  color: Rgb;
  bg: Rgb;
  cov: number;
  glyph: number;
  kind: number;
  /** The cell's background is just the sky: draw nothing behind it, and fade partial cells into what is there. */
  sky?: boolean;
}

export class Grid {
  readonly cells: (Cell | null)[];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = new Array(w * h).fill(null);
  }

  set(x: number, y: number, cell: Cell): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.cells[y * this.w + x] = cell;
  }

  at(x: number, y: number): Cell | null {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.cells[y * this.w + x];
  }

  kind(x: number, y: number): number {
    return this.at(x, y)?.kind ?? K_NONE;
  }
}
