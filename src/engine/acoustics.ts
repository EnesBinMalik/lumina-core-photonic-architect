/**
 * Crystal Acoustics & Optical Resonance Engine
 * 100% physical-modeling procedural Web Audio (Glass Harmonica, Brass Gears, High-Voltage Arcs, Bowed Strings).
 * Zero external audio files.
 */
export class CrystalAcousticsEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private droneGain: GainNode | null = null;
  private droneOscA: OscillatorNode | null = null;
  private droneOscB: OscillatorNode | null = null;
  private arcGain: GainNode | null = null;
  private arcFilter: BiquadFilterNode | null = null;
  private muted = false;
  private initialized = false;
  private noiseBuffer: AudioBuffer | null = null;

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.65;
    this.masterGain.connect(this.ctx.destination);

    // Procedural Cathedral / Observatory Impulse Response for authentic crystal acoustics
    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = this.buildObservatoryImpulse(2.1, 2.8);
    const reverbWet = this.ctx.createGain();
    reverbWet.gain.value = 0.28;
    this.reverbNode.connect(reverbWet);
    reverbWet.connect(this.masterGain);

    // Reusable micro-crackle noise buffer
    this.noiseBuffer = this.buildNoiseBuffer(1.0);

    // Continuous bowed-string & glass-harmonic combo resonance drone
    this.setupResonanceDrone();
    this.setupArcBeamLoop();

    this.initialized = true;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.65, this.ctx.currentTime, 0.04);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private buildObservatoryImpulse(duration: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const raw = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        lp = lp * 0.65 + raw * 0.35;
        data[i] = lp;
      }
    }
    return impulse;
  }

  private buildNoiseBuffer(duration: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  private setupResonanceDrone(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.setValueAtTime(0.0, now);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, now);
    filter.Q.setValueAtTime(2.5, now);

    this.droneOscA = this.ctx.createOscillator();
    this.droneOscA.type = 'sawtooth';
    this.droneOscA.frequency.setValueAtTime(110, now); // A2

    this.droneOscB = this.ctx.createOscillator();
    this.droneOscB.type = 'triangle';
    this.droneOscB.frequency.setValueAtTime(164.81, now); // E3 fifth

    this.droneOscA.connect(filter);
    this.droneOscB.connect(filter);
    filter.connect(this.droneGain);
    this.droneGain.connect(this.masterGain);
    if (this.reverbNode) this.droneGain.connect(this.reverbNode);

    this.droneOscA.start(now);
    this.droneOscB.start(now);
  }

  private setupArcBeamLoop(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    this.arcFilter = this.ctx.createBiquadFilter();
    this.arcFilter.type = 'bandpass';
    this.arcFilter.frequency.setValueAtTime(1800, now);
    this.arcFilter.Q.setValueAtTime(4.5, now);

    this.arcGain = this.ctx.createGain();
    this.arcGain.gain.setValueAtTime(0, now);

    src.connect(this.arcFilter);
    this.arcFilter.connect(this.arcGain);
    this.arcGain.connect(this.masterGain);
    if (this.reverbNode) this.arcGain.connect(this.reverbNode);
    src.start(now);
  }

  public updateContinuous(combo: number, beamActive: boolean, pitchRatio: number): void {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.droneGain && this.droneOscA && this.droneOscB) {
      const targetLevel = combo >= 2 ? Math.min(0.14, (combo - 1) * 0.018) : 0.0;
      this.droneGain.gain.setTargetAtTime(targetLevel, now, 0.25);
      const baseFreq = 110 * (combo >= 6 ? 1.122 : 1.0);
      this.droneOscA.frequency.setTargetAtTime(baseFreq, now, 0.3);
      this.droneOscB.frequency.setTargetAtTime(baseFreq * 1.5 * (0.98 + pitchRatio * 0.02), now, 0.3);
    }

    if (this.arcGain && this.arcFilter) {
      this.arcGain.gain.setTargetAtTime(beamActive ? 0.12 : 0.0, now, 0.03);
      this.arcFilter.frequency.setTargetAtTime(1400 * pitchRatio, now, 0.05);
    }
  }

  /**
   * Glass Harmonica / Crystal Goblet physical inharmonic partials (1.0, 2.756, 5.404)
   */
  public playCrystalHarmonic(fundamentalHz: number, duration = 0.75, gainAmount = 0.16): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const partials = [
      { mult: 1.0, amp: 1.0, decay: duration },
      { mult: 2.756, amp: 0.35, decay: duration * 0.65 },
      { mult: 5.404, amp: 0.14, decay: duration * 0.35 },
    ];

    for (const p of partials) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(fundamentalHz * p.mult, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(gainAmount * p.amp, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

      osc.connect(gain);
      gain.connect(this.masterGain);
      if (this.reverbNode) gain.connect(this.reverbNode);

      osc.start(now);
      osc.stop(now + p.decay + 0.04);
    }
  }

  public playSabreSlash(comboStep: number, pitchRatio: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Air-cutting crystal blade whoosh (bandpass sweep)
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3.2;
      bp.frequency.setValueAtTime(420 * pitchRatio, now);
      bp.frequency.exponentialRampToValueAtTime(2200 * pitchRatio, now + 0.12);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.18, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

      noise.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.24);
    }

    // Harmonic crystal edge ring
    const notes = [523.25, 587.33, 659.25];
    const hz = notes[comboStep % notes.length] * pitchRatio;
    this.playCrystalHarmonic(hz, 0.48, 0.11);
  }

  public playArmorCrack(pitchRatio: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Crisp brittle obsidian-glass fracture snap
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(2400, now);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.28, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      noise.connect(hp);
      hp.connect(g);
      g.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.16);
    }

    this.playCrystalHarmonic(784 * pitchRatio, 0.55, 0.14);
  }

  public playOpticalDetonation(combo: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Sub-harmonic optical implosion
    const sub = this.ctx.createOscillator();
    const subG = this.ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(145, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.42);
    subG.gain.setValueAtTime(0.32, now);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    sub.connect(subG);
    subG.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.48);

    // Ascending crystal goblet chord cascade
    const baseScale = [523.25, 659.25, 783.99, 1046.5];
    const comboLift = 1 + Math.min(combo, 8) * 0.03;
    baseScale.forEach((hz, idx) => {
      setTimeout(() => {
        this.playCrystalHarmonic(hz * comboLift, 0.95, 0.12);
      }, idx * 35);
    });
  }

  public playCrystalShatter(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const freqs = [1174.66, 1396.91, 1760.0, 2093.0, 2637.02];
    freqs.forEach((f, idx) => {
      setTimeout(() => {
        this.playCrystalHarmonic(f * (0.96 + Math.random() * 0.08), 0.7, 0.09);
      }, idx * 24);
    });
  }

  public playSpecularDash(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Glass-reflection ping + time-dilation sub drop
    this.playCrystalHarmonic(1567.98, 0.85, 0.15);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.35);
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  public playBrassGearTick(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Mechanical brass telescope detent click
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(290, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.045);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(920, now);
    filter.Q.setValueAtTime(5.0, now);

    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

    osc.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playWavelengthShift(pitchRatio: number): void {
    this.playBrassGearTick();
    this.playCrystalHarmonic(660 * pitchRatio, 0.42, 0.11);
  }

  public playVisorHit(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.25);
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
    this.playCrystalHarmonic(1864, 0.35, 0.08);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
