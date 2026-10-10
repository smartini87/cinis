// audio.js – sämtliche Klänge werden zur Laufzeit per WebAudio synthetisiert (Oszillatoren + Rauschen).
// Der AudioContext entsteht erst bei der ersten Nutzerinteraktion (Autoplay-Richtlinien der Browser).

const MUTE_KEY = 'cinis.muted';

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.last = {};          // Drosselung: letzter Abspielzeitpunkt je Klang
    this.ambient = null;     // Wind-/Feuerrauschen im Hintergrund
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
    const unlock = () => {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    // Eine Sekunde weißes Rauschen als Quelle für Geräusche
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbient();
  }

  toggle() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* Einstellung wird dann nur für diese Sitzung gemerkt */
    }
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- Bausteine
  /** Ton mit Hüllkurve und optionalem Tonhöhenverlauf. */
  tone(freq, dur, { type = 'sine', vol = 0.3, slide = null, delay = 0, attack = 0.005 } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Gefiltertes Rauschen (Schläge, Splitter, Wind). */
  noise(dur, { vol = 0.3, freq = 1000, q = 1, type = 'bandpass', slide = null, delay = 0, attack = 0.003 } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Dauerhaftes, leises Windrauschen; nachts lauter. */
  startAmbient() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = c.createGain();
    g.gain.value = 0.02;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.ambient = { gain: g, filter: f };
  }

  /** Atmosphäre an Tageszeit anpassen (0 = Tag, 1 = Nacht). */
  setAmbience(dark) {
    if (!this.ambient) return;
    const t = this.ctx.currentTime;
    this.ambient.gain.gain.setTargetAtTime(0.015 + dark * 0.05, t, 0.5);
    this.ambient.filter.frequency.setTargetAtTime(300 + dark * 250, t, 0.5);
  }

  // ---------------------------------------------------------------- Klangbibliothek
  play(name, vol = 1) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < 0.045) return; // gleiche Klänge nicht stapeln
    this.last[name] = now;
    const v = (x) => x * vol;
    switch (name) {
      case 'click':
        this.tone(660, 0.06, { type: 'triangle', vol: v(0.15) });
        break;
      case 'error':
        this.tone(220, 0.09, { type: 'square', vol: v(0.08) });
        this.tone(160, 0.12, { type: 'square', vol: v(0.08), delay: 0.09 });
        break;
      case 'chop':
        this.noise(0.08, { vol: v(0.35), freq: 900, q: 2 });
        this.tone(130, 0.08, { vol: v(0.25), slide: 80 });
        break;
      case 'mine':
        this.noise(0.05, { vol: v(0.25), freq: 3000, type: 'highpass' });
        this.tone(1250 + Math.random() * 200, 0.12, { type: 'triangle', vol: v(0.12) });
        break;
      case 'pick':
        this.tone(520, 0.08, { vol: v(0.18), slide: 760 });
        break;
      case 'water':
        this.noise(0.18, { vol: v(0.2), freq: 500, slide: 1400, q: 3 });
        break;
      case 'deposit':
        this.tone(523, 0.08, { type: 'triangle', vol: v(0.12) });
        this.tone(784, 0.12, { type: 'triangle', vol: v(0.12), delay: 0.07 });
        break;
      case 'build':
        this.tone(90, 0.18, { vol: v(0.4), slide: 55 });
        this.noise(0.2, { vol: v(0.25), freq: 700, type: 'lowpass' });
        break;
      case 'gate':
        // knarrende Torflügel
        this.tone(140, 0.22, { type: 'sawtooth', vol: v(0.05), slide: 95 });
        this.noise(0.12, { vol: v(0.08), freq: 900, q: 4 });
        break;
      case 'demolish':
        this.noise(0.35, { vol: v(0.35), freq: 500, type: 'lowpass', slide: 150 });
        break;
      case 'swing':
        this.noise(0.12, { vol: v(0.18), freq: 1800, slide: 600, q: 3 });
        break;
      case 'hit':
        this.noise(0.1, { vol: v(0.25), freq: 1600, slide: 500, q: 2 });
        this.tone(150, 0.09, { vol: v(0.3), slide: 70 });
        break;
      case 'hurt':
        this.tone(240, 0.16, { type: 'square', vol: v(0.12), slide: 110 });
        break;
      case 'death':
        this.tone(300, 0.7, { type: 'sawtooth', vol: v(0.15), slide: 55 });
        break;
      case 'enemyDie':
        this.noise(0.3, { vol: v(0.25), freq: 450, type: 'lowpass', slide: 120 });
        this.tone(190, 0.25, { type: 'sawtooth', vol: v(0.08), slide: 50 });
        break;
      case 'claw':
        this.noise(0.06, { vol: v(0.2), freq: 2200, q: 4 });
        break;
      case 'smash':
        this.tone(65, 0.3, { vol: v(0.45), slide: 40 });
        this.noise(0.25, { vol: v(0.3), freq: 350, type: 'lowpass' });
        break;
      case 'bolt':
        this.tone(950, 0.09, { type: 'triangle', vol: v(0.12), slide: 280 });
        this.noise(0.05, { vol: v(0.12), freq: 2500, q: 2 });
        break;
      case 'horn':
        // Cornu: tiefes Blechblasinstrument mit langsamem Einschwingen
        this.tone(147, 1.6, { type: 'sawtooth', vol: v(0.09), attack: 0.25 });
        this.tone(220, 1.6, { type: 'sawtooth', vol: v(0.06), attack: 0.3 });
        this.tone(110, 1.2, { type: 'sawtooth', vol: v(0.06), attack: 0.3, delay: 1.5 });
        break;
      case 'bell':
        this.tone(880, 1.6, { vol: v(0.12) });
        this.tone(1320, 1.2, { vol: v(0.06) });
        this.tone(660, 1.8, { vol: v(0.08), delay: 0.35 });
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) this.tone(i % 2 ? 450 : 600, 0.12, { type: 'square', vol: v(0.07), delay: i * 0.14 });
        break;
      case 'collapse':
        this.noise(0.9, { vol: v(0.4), freq: 400, type: 'lowpass', slide: 80 });
        this.tone(60, 0.6, { vol: v(0.35), slide: 30 });
        break;
      case 'arrive':
        this.tone(440, 0.15, { type: 'triangle', vol: v(0.1) });
        this.tone(554, 0.15, { type: 'triangle', vol: v(0.1), delay: 0.12 });
        this.tone(659, 0.25, { type: 'triangle', vol: v(0.1), delay: 0.24 });
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', vol: v(0.14), delay: i * 0.18 }));
        this.tone(1047, 1.4, { vol: v(0.1), delay: 0.75 });
        break;
      case 'defeat':
        [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.6, { type: 'sawtooth', vol: v(0.07), delay: i * 0.3 }));
        break;
    }
  }
}
