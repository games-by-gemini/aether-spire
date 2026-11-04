// Procedural Web Audio API sound effects & ambient synth for Aether Spire.
// Starts only on the player's first gesture and pauses when the tab/window hides.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.paused = false;
    this.ambientGain = null;
    this.started = false;
  }

  unlock() {
    if (this.muted) return;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.startAmbient();
      }
      if (this.ctx.state === "suspended" && !this.paused) {
        this.ctx.resume().catch(() => {});
      }
      this.started = true;
    } catch {
      // Ignore audio initialization errors on restricted devices
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.ambientGain && this.ctx) {
      this.ambientGain.gain.setTargetAtTime(
        this.muted || this.paused ? 0 : 0.035,
        this.ctx.currentTime,
        0.08
      );
    }
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (!this.ctx) return;
    if (this.paused) {
      this.ctx.suspend().catch(() => {});
    } else if (!this.muted) {
      this.ctx.resume().catch(() => {});
    }
  }

  startAmbient() {
    if (!this.ctx) return;
    try {
      const master = this.ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.035;
      master.connect(this.ctx.destination);
      this.ambientGain = master;

      const freqs = [110, 164.81, 220, 329.63];
      for (const f of freqs) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        g.gain.value = 0.25;
        osc.connect(g);
        g.connect(master);
        osc.start();
      }
    } catch {
      // Ignore
    }
  }

  playTone(freq, duration = 0.14, type = "sine", volume = 0.12, slideTo = null) {
    if (this.muted || this.paused || !this.ctx || this.ctx.state !== "running") return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
      }
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Ignore
    }
  }

  jump() {
    this.playTone(260, 0.16, "triangle", 0.12, 520);
  }

  dash() {
    this.playTone(440, 0.18, "sawtooth", 0.09, 180);
  }

  boost() {
    this.playTone(330, 0.28, "triangle", 0.14, 880);
  }

  shard(index = 0) {
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    const base = scale[index % scale.length];
    this.playTone(base, 0.18, "sine", 0.14, base * 1.25);
  }

  checkpoint() {
    this.playTone(440, 0.2, "triangle", 0.13, 554.37);
    setTimeout(() => this.playTone(659.25, 0.28, "sine", 0.14, 880), 90);
  }

  stageClear() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      setTimeout(() => this.playTone(n, 0.26, "triangle", 0.15, n * 1.05), i * 85);
    });
  }

  fall() {
    this.playTone(240, 0.3, "sawtooth", 0.1, 90);
  }
}
