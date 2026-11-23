/**
 * サウンド（WebAudio による完全合成 / 外部ファイル不要）
 * 初回のユーザー操作で初期化する。
 */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.noiseBuffer = null;
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (this.master) {
      this.master.gain.value = this.enabled ? 0.5 : 0;
    }
  }

  /** ユーザー操作時に呼ぶ */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.5 : 0;
      this.master.connect(this.ctx.destination);
      this._buildNoise();
    } catch (e) {
      this.ctx = null;
    }
  }

  _buildNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    this.noiseBuffer = buf;
  }

  _tone({ freq = 440, dur = 0.15, type = 'sine', gain = 0.3, slide = 0, delay = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.12, gain = 0.25, freq = 1200, q = 1, type = 'bandpass', delay = 0 }) {
    if (!this.ctx || !this.enabled || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  hit(type = 'clear') {
    if (!this.ctx) return;
    switch (type) {
      case 'smash':
        this._noise({ dur: 0.16, gain: 0.5, freq: 1800, q: 0.8 });
        this._tone({ freq: 180, dur: 0.22, type: 'triangle', gain: 0.4, slide: -120 });
        this._tone({ freq: 90, dur: 0.3, type: 'sine', gain: 0.32, slide: -40 });
        break;
      case 'drive':
        this._noise({ dur: 0.09, gain: 0.34, freq: 2600, q: 1.2 });
        this._tone({ freq: 420, dur: 0.08, type: 'square', gain: 0.12, slide: -160 });
        break;
      case 'drop':
        this._noise({ dur: 0.07, gain: 0.16, freq: 3200, q: 2 });
        this._tone({ freq: 720, dur: 0.09, type: 'sine', gain: 0.12, slide: -220 });
        break;
      default:
        this._noise({ dur: 0.1, gain: 0.28, freq: 1500, q: 1 });
        this._tone({ freq: 520, dur: 0.11, type: 'triangle', gain: 0.16, slide: -180 });
    }
  }

  net() {
    this._noise({ dur: 0.14, gain: 0.2, freq: 700, q: 3 });
    this._tone({ freq: 160, dur: 0.18, type: 'sine', gain: 0.12, slide: -60 });
  }

  land() {
    this._noise({ dur: 0.12, gain: 0.14, freq: 480, q: 1.5, type: 'lowpass' });
  }

  levelUp() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this._tone({ freq: f, dur: 0.22, type: 'triangle', gain: 0.22, delay: i * 0.075 });
    });
  }

  point() {
    this._tone({ freq: 880, dur: 0.1, type: 'sine', gain: 0.16 });
    this._tone({ freq: 1320, dur: 0.12, type: 'sine', gain: 0.12, delay: 0.06 });
  }

  miss() {
    this._tone({ freq: 300, dur: 0.3, type: 'sawtooth', gain: 0.12, slide: -180 });
  }

  ui() {
    this._tone({ freq: 660, dur: 0.06, type: 'sine', gain: 0.1 });
  }

  swing() {
    this._noise({ dur: 0.1, gain: 0.1, freq: 900, q: 0.7, type: 'highpass' });
  }
}
