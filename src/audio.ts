// Sound, all made in code (no files): radio static, gunshots, and the laptop's own
// text-to-speech voice for radio calls (PLACEHOLDER voices; works offline on Windows).
export class Sound {
  private ac: AudioContext | null = null;
  private staticGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private shotsThisSecond = 0;
  private lastSecond = 0;
  muted = false;

  /** Must be called from a key press or click (browsers block sound before that). */
  start(): void {
    if (this.ac) return;
    try {
      this.ac = new AudioContext();
    } catch {
      return;
    }
    const ac = this.ac;
    const len = ac.sampleRate * 2;
    this.noise = ac.createBuffer(1, len, ac.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1900;
    band.Q.value = 0.6;
    this.staticGain = ac.createGain();
    this.staticGain.gain.value = 0;
    src.connect(band).connect(this.staticGain).connect(ac.destination);
    src.start();
  }

  setStatic(level: number): void {
    if (!this.ac || !this.staticGain) return;
    this.staticGain.gain.setTargetAtTime(this.muted ? 0 : level * 0.08, this.ac.currentTime, 0.05);
  }

  shot(volume: number): void {
    const ac = this.ac;
    if (!ac || !this.noise || this.muted || volume <= 0.01) return;
    const sec = Math.floor(ac.currentTime * 4);
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      this.shotsThisSecond = 0;
    }
    if (this.shotsThisSecond++ > 5) return;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + Math.random() * 900;
    const gn = ac.createGain();
    const t = ac.currentTime;
    gn.gain.setValueAtTime(Math.min(0.5, volume * 0.5), t);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(lp).connect(gn).connect(ac.destination);
    src.start(t, Math.random(), 0.2);
  }

  say(text: string, pitch = 1, rate = 1): void {
    if (this.muted || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\[[^\]]*\]/g, ''));
    u.pitch = pitch;
    u.rate = rate;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  }

  hush(): void {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }
}
