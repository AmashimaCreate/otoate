/** A small, self-contained, gesture-activated acoustic guitar voice. */
export class GuitarAudio {
  constructor() {
    this.context = null;
    this.output = null;
    this.voices = [];
    this.buffers = new Map();
    this.maxVoices = 8;
    this.generation = 0;
  }

  async play(midi, { muted = false, volume = 0.5 } = {}) {
    if (muted || !Number.isFinite(midi) || midi < 21 || midi > 108) return false;
    const generation = this.generation;
    const context = await this._activate();
    if (!context || generation !== this.generation) return false;
    return this._pluck(midi, volume, context.currentTime + 0.006);
  }

  async chord(midis, { muted = false, volume = 0.5 } = {}) {
    if (muted || !Array.isArray(midis)) return false;
    const notes = midis.filter(n => Number.isFinite(n) && n >= 21 && n <= 108).slice(0, 8);
    if (!notes.length) return false;
    const generation = this.generation;
    const context = await this._activate();
    if (!context || generation !== this.generation) return false;
    const start = context.currentTime + 0.008;
    const level = this._volume(volume) / Math.sqrt(Math.max(1, notes.length * 0.7));
    let played = false;
    notes.forEach((note, i) => {
      played = this._pluck(note, level, start + i * 0.018) || played;
    });
    return played;
  }

  stop() {
    // Also cancel a play request which is still awaiting browser activation.
    this.generation += 1;
    for (const voice of [...this.voices]) this._release(voice);
  }

  _volume(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  }

  async _activate() {
    try {
      if (!this.context || this.context.state === 'closed') {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return null;
        const context = new AudioContext({ latencyHint: 'interactive' });
        this.context = context;
        this.buffers.clear();

        const highpass = context.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 48;
        highpass.Q.value = 0.5;
        const body = context.createBiquadFilter();
        body.type = 'lowshelf';
        body.frequency.value = 240;
        body.gain.value = 2.5;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -13;
        compressor.knee.value = 18;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.006;
        compressor.release.value = 0.14;
        highpass.connect(body);
        body.connect(compressor);
        compressor.connect(context.destination);
        this.output = highpass;
      }
      if (this.context.state !== 'running') await this.context.resume();
      return this.context.state === 'running' ? this.context : null;
    } catch {
      // Audio is an enhancement; denied permissions or unavailable devices
      // must never prevent the exercise from continuing.
      return null;
    }
  }

  _pluck(midi, volume, when) {
    const level = this._volume(volume);
    if (!level || !this.context || !this.output) return false;
    let source;
    let gain;
    try {
      while (this.voices.length >= this.maxVoices) this._release(this.voices[0]);
      const context = this.context;
      const buffer = this._buffer(midi);
      source = context.createBufferSource();
      gain = context.createGain();
      source.buffer = buffer;
      const start = Math.max(when, context.currentTime + 0.002);
      // A short attack avoids clicks while preserving the pick transient.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level * 0.78, start + 0.004);
      gain.gain.setValueAtTime(level * 0.78, start + buffer.duration - 0.085);
      gain.gain.linearRampToValueAtTime(0, start + buffer.duration - 0.005);
      source.connect(gain);
      gain.connect(this.output);
      const voice = { source, gain, start, level: level * 0.78, released: false };
      source.onended = () => {
        this.voices = this.voices.filter(item => item !== voice);
        source.disconnect();
        gain.disconnect();
      };
      this.voices.push(voice);
      source.start(start);
      return true;
    } catch {
      if (source) {
        this.voices = this.voices.filter(voice => voice.source !== source);
        try { source.disconnect(); } catch { /* Already disconnected. */ }
      }
      if (gain) try { gain.disconnect(); } catch { /* Already disconnected. */ }
      return false;
    }
  }

  _release(voice) {
    if (!voice || voice.released) return;
    voice.released = true;
    this.voices = this.voices.filter(item => item !== voice);
    try {
      const now = this.context.currentTime;
      const parameter = voice.gain.gain;
      if (typeof parameter.cancelAndHoldAtTime === 'function') {
        parameter.cancelAndHoldAtTime(now);
      } else {
        parameter.cancelScheduledValues(now);
        const attackProgress = Math.max(0, Math.min(1, (now - voice.start) / 0.004));
        parameter.setValueAtTime(voice.level * attackProgress, now);
      }
      parameter.linearRampToValueAtTime(0, now + 0.018);
      voice.source.stop(now + 0.022);
    } catch {
      try { voice.source.disconnect(); voice.gain.disconnect(); } catch { /* Closed context. */ }
    }
  }

  _buffer(midi) {
    const key = String(midi);
    if (this.buffers.has(key)) {
      const cached = this.buffers.get(key);
      this.buffers.delete(key);
      this.buffers.set(key, cached);
      return cached;
    }
    const sampleRate = this.context.sampleRate;
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const duration = Math.max(2.2, Math.min(4.1, 3.65 - (midi - 40) * 0.025));
    const buffer = this.context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
    const samples = buffer.getChannelData(0);

    // Fractional-delay Karplus–Strong string. The averaging filter contributes
    // half a sample of delay, accounted for here to keep fretted notes in tune.
    const delay = sampleRate / frequency - 0.5;
    const length = Math.ceil(delay) + 2;
    const ring = new Float32Array(length);
    let seed = (Math.round(midi * 7919) + 123456789) >>> 0;
    const noise = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2147483648 - 1;
    };
    let smooth = 0;
    let mean = 0;
    for (let i = 0; i < length; i += 1) {
      smooth = smooth * 0.42 + noise() * 0.58;
      // A little fundamental gives the warm body of a softly picked string.
      ring[i] = smooth * 0.7 + Math.sin(i * Math.PI * 2 / delay) * 0.24;
      mean += ring[i];
    }
    mean /= length;
    for (let i = 0; i < length; i += 1) ring[i] -= mean;

    const feedback = Math.exp(-4.6 / (frequency * duration));
    let write = 0;
    let previousDelayed = 0;
    let dc = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      let read = write - delay;
      if (read < 0) read += length;
      const index = Math.floor(read);
      const fraction = read - index;
      const delayed = ring[index] * (1 - fraction) + ring[(index + 1) % length] * fraction;
      const value = (delayed + previousDelayed) * 0.5 * feedback;
      previousDelayed = delayed;
      ring[write] = value;
      write = (write + 1) % length;
      dc += (value - dc) * 0.002;
      samples[i] = value - dc;
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    const normalize = 0.76 / Math.max(0.2, peak);
    const fadeSamples = Math.floor(sampleRate * 0.08);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] *= normalize * Math.min(1, (samples.length - 1 - i) / fadeSamples);
    }
    this.buffers.set(key, buffer);
    if (this.buffers.size > 24) this.buffers.delete(this.buffers.keys().next().value);
    return buffer;
  }
}
