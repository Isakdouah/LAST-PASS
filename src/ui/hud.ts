// The quiet interface: sharp pixel-font text drawn by the browser on top of the 3D
// picture. Clock, radio, one hint line, subtitles, key help, map labels.
import { DIAL, tuned } from '../game/radio';
import type { Session } from '../game/session';
import { fmt, inWindow, localTime, passIndex, PASSES, realSeconds, untilWindow, windowLeft } from '../game/clock';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  root = $('hud');
  private clock: HTMLDivElement;
  private radio: HTMLDivElement;
  private hint: HTMLDivElement;
  private sub: HTMLDivElement;
  private keys: HTMLDivElement;
  private credit: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private labelsUsed = 0;
  private lines: { who: string; text: string; until: number }[] = [];
  private last = 0;
  screen: HTMLDivElement;
  fps: HTMLDivElement;

  constructor() {
    const mk = (id: string, cls = 'box') => {
      const d = document.createElement('div');
      d.id = id;
      d.className = cls;
      this.root.appendChild(d);
      return d;
    };
    this.clock = mk('clock');
    this.radio = mk('radio');
    this.hint = mk('hint');
    this.sub = mk('sub');
    this.keys = mk('keys');
    this.credit = mk('credit');
    this.fps = mk('fps', '');
    this.credit.innerHTML = 'Map data © OpenStreetMap contributors (ODbL) · place names + city lights: GeoNames (CC BY 4.0)';
    this.screen = document.createElement('div');
    this.screen.id = 'screenText';
    document.body.appendChild(this.screen);
  }

  say(who: string, text: string, secs = 7) {
    if (who && text.startsWith(who + ':')) text = text.slice(who.length + 1).trim(); // name only once
    this.lines.push({ who, text, until: performance.now() + secs * 1000 });
    if (this.lines.length > 2) this.lines.shift();
    this.renderSub();
  }
  clearSay() {
    this.lines = [];
    this.renderSub();
  }
  private renderSub() {
    const now = performance.now();
    this.lines = this.lines.filter((l) => l.until > now);
    this.sub.style.display = this.lines.length ? 'block' : 'none';
    this.sub.innerHTML = this.lines.map((l) => (l.who ? `<span class="who">${esc(l.who)}:</span> ` : '') + esc(l.text)).join('<br>');
  }

  show(on: boolean) {
    this.root.style.display = on ? 'block' : 'none';
  }

  /** Text panels; called every frame, redrawn ten times a second. */
  update(g: Session, info: { view: string; viewText: string; hint: string; keys: string; name: string }) {
    const now = performance.now();
    if (now - this.last < 100) return;
    this.last = now;
    this.renderSub();
    const t = g.t;
    let c = '';
    if (g.mode === 'play') {
      c += `<span class="bright">${localTime(t)} CDT</span> &nbsp;Friday 16 Oct 2009<br>`;
      c += `Pass ${Math.min(PASSES, passIndex(t) + 1)} of ${PASSES} over Minneapolis<br>`;
      c += inWindow(t)
        ? `<span class="mark">IN SIGHT · ${fmt(realSeconds(t, t + windowLeft(t)))} left</span>`
        : `Far side · next pass in ${fmt(realSeconds(t, t + untilWindow(t)))}`;
    } else {
      c += `<span class="mark">SANDBOX</span> ×${g.sandboxRate} · ${localTime(t)}<br>Click the ground to start an outbreak`;
    }
    const { alive, dead } = g.totals();
    c += `<br>Living <span class="bright">${Math.round((alive / g.startPop) * 100)}%</span> &nbsp;Turned <span class="dead">${Math.round(dead / 1000)}k</span>`;
    c += `<br><span>${info.viewText}</span>`;
    if (g.paused) c += `<br><span class="mark">PAUSED</span>`;
    this.clock.innerHTML = c;
    // Radio.
    const r = g.radio;
    const { group, signal } = tuned(r);
    const up = g.radioUp();
    const pos = (f: number) => (((f - DIAL.min) / (DIAL.max - DIAL.min)) * 100).toFixed(1) + '%';
    let h = `<span class="bright">RADIO</span> ${r.freq.toFixed(2)} MHz`;
    h += `<div id="dial">${r.groups.filter((x) => x.known).map((x) => `<i style="left:${pos(x.freq)}"></i>`).join('')}<b style="left:${pos(r.freq)}"></b></div>`;
    const bars = up && group ? Math.round(signal * 5) : 0;
    h += `<span class="bars">${[0, 1, 2, 3, 4].map((b) => `<i class="${b < bars ? 'on' : ''}" style="height:${4 + b * 3}px"></i>`).join('')}</span>`;
    h += up ? (group && signal > 0.75 ? `<span class="bright">${esc(group.known ? group.name : 'a voice...')}</span>` : group && signal > 0.2 ? 'something faint...' : 'static') : 'no line of sight';
    if (r.patchFrom) h += `<br><span class="mark">patch: ${esc(r.patchFrom.name)}</span>`;
    const known = r.groups.filter((x) => x.known);
    if (known.length) {
      h += `<br><br><span class="bright">CONTACTS</span>`;
      for (const x of known) {
        const cls = x.silent ? '' : x.status === 'calm' ? 'bright' : x.status === 'contact' ? 'scared' : 'fire';
        const st = x.silent ? 'silent' : x.kind === 'broadcast' ? '' : x.status;
        h += `<br><span class="${cls}">${esc(x.name)}</span> <span style="float:right" class="${cls}">${st}</span>`;
      }
    }
    this.radio.innerHTML = h;
    this.hint.style.display = info.hint ? 'block' : 'none';
    this.hint.textContent = info.hint;
    this.keys.innerHTML = info.keys;
  }

  /** Screen boxes of the visible panels, so map names keep out of them. */
  panels() {
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const d of [this.clock, this.radio, this.hint, this.sub, this.keys, this.credit]) {
      if (!d.textContent || d.offsetParent === null) continue;
      const r = d.getBoundingClientRect();
      if (r.width > 0) out.push({ x0: r.left - 4, y0: r.top - 4, x1: r.right + 4, y1: r.bottom + 4 });
    }
    return out;
  }
  /** Map labels: call begin, then label() for each, then end. */
  beginLabels() {
    this.labelsUsed = 0;
  }
  label(x: number, y: number, text: string, cls: string) {
    let d = this.labels[this.labelsUsed];
    if (!d) {
      d = document.createElement('div');
      this.root.appendChild(d);
      this.labels.push(d);
    }
    this.labelsUsed++;
    if (d.textContent !== text) d.textContent = text;
    d.className = 'label ' + cls;
    d.style.left = `${Math.round(x)}px`;
    d.style.top = `${Math.round(y)}px`;
    d.style.display = 'block';
  }
  endLabels() {
    for (let k = this.labelsUsed; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }
}

export function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
