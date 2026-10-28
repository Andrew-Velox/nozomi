// Procedural wind: looping noise through a band-pass filter that opens up with
// the breeze. No audio files, nothing is loaded until sound is switched on.
export class Audio {
  private ctx: AudioContext | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private level = 0;
  enabled = false;

  toggle(): boolean {
    return this.set(!this.enabled);
  }

  /** Switch the sound on or off. Browsers only let it start after a click or key press. */
  set(on: boolean): boolean {
    this.enabled = on;
    if (on) this.start();
    this.ramp(on ? 1 : 0);
    return on;
  }

  /** Try again to start the audio engine after a user gesture, if sound was asked for earlier. */
  resume(): void {
    if (this.enabled && this.ctx?.state === "suspended") void this.ctx.resume();
  }

  /** Stop everything and release the audio engine. */
  destroy(): void {
    this.enabled = false;
    void this.ctx?.close();
    this.ctx = this.filter = this.gain = this.rainGain = null;
  }

  setWind(strength: number): void {
    if (!this.ctx || !this.filter || !this.gain || !this.enabled) return;
    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(280 + strength * 900, now, 0.4);
    this.gain.gain.setTargetAtTime((0.035 + strength * 0.11) * this.level, now, 0.4);
  }

  /** Rain sound, 0..1: a hiss of filtered noise that follows the weather. */
  setRain(level: number): void {
    if (!this.ctx || !this.rainGain) return;
    this.rainGain.gain.setTargetAtTime(level * 0.05 * this.level, this.ctx.currentTime, 0.6);
  }

  /** A soft wind-chime note, played when the tree is touched. */
  chime(): void {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const notes = [659, 784, 880, 988, 1175];
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = notes[Math.floor(Math.random() * notes.length)];
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.05, now + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    osc.connect(env).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 1.7);
  }

  private ramp(level: number): void {
    this.level = level;
    if (this.ctx && this.gain) this.gain.gain.setTargetAtTime(0.045 * level, this.ctx.currentTime, 0.5);
  }

  private start(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const length = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; // brown-ish noise
        data[i] = last * 5;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = "bandpass";
      this.filter.Q.value = 0.6;
      this.filter.frequency.value = 400;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      source.connect(this.filter).connect(this.gain).connect(this.ctx.destination);
      source.start();

      // rain: white noise with the lows and the very highs taken off
      const white = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const wd = white.getChannelData(0);
      for (let i = 0; i < length; i++) wd[i] = Math.random() * 2 - 1;
      const rain = this.ctx.createBufferSource();
      rain.buffer = white;
      rain.loop = true;
      const high = this.ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 1200;
      const low = this.ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 7000;
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;
      rain.connect(high).connect(low).connect(this.rainGain).connect(this.ctx.destination);
      rain.start();
    }
    void this.ctx.resume();
  }
}
