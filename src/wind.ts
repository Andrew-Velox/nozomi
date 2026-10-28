import { noise2 } from "./noise";

// A breeze that wanders, with the occasional gust. Speeds are in css px/s and
// positive x blows to the right.
export class Wind {
  /** 0..10, the knob the interface exposes. */
  level = 3;
  /** Weather multiplies the wind: storms blow harder, mist is still. */
  boost = 1;
  /** Master switch: when off the air is dead still. */
  enabled = true;
  /** Scales everything down for reduced-motion users. */
  calm = 1;
  /** Current horizontal speed. */
  x = 0;
  /** 0..1 overall effort, used for the wind sound. */
  strength = 0;

  private t = 0;
  private gust = 0;
  private gustAge = 0;
  private gustDuration = 0;
  private gustPeak = 0;
  private nextGust = 8 + Math.random() * 8;

  update(dt: number): void {
    this.t += dt;
    if (!this.enabled) {
      this.x = this.strength = this.gust = 0;
      this.gustDuration = 0;
      return;
    }
    this.nextGust -= dt;
    if (this.nextGust <= 0) {
      this.trigger(60 + Math.random() * 60);
      this.nextGust = 12 + Math.random() * 14;
    }
    if (this.gustDuration > 0) {
      this.gustAge += dt;
      if (this.gustAge >= this.gustDuration) {
        this.gustDuration = this.gust = 0;
      } else {
        const phase = Math.sin((Math.PI * this.gustAge) / this.gustDuration);
        this.gust = phase * phase * this.gustPeak;
      }
    }
    const base = (noise2(this.t * 0.08, 3.1) * 1.2 - 0.25) * 18 * this.level * this.calm * this.boost;
    this.x = base + this.gust;
    this.strength = Math.min(1, Math.abs(this.x) / 130);
  }

  /** Start a gust now; `peak` is in px/s. */
  trigger(peak = 140): void {
    if (!this.enabled || this.level <= 0) return;
    this.gustAge = 0;
    this.gustDuration = 2.5 + Math.random() * 2;
    this.gustPeak = peak * this.calm * this.boost * Math.max(0.5, this.level / 3);
  }
}
