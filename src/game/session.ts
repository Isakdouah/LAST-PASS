// One night over Minneapolis, without any drawing: the city numbers, fires, radio,
// the street zone near the camera, and the orbit clock. The 3D engine reads this.
// Story mode: the player never starts an outbreak. It arrives by script (an organ
// transfer brought a bitten patient into HCMC this afternoon); sandbox is a dev tool.
import mapFile from '../data/minneapolis.json';
import detailFile from '../data/detail.json';
import { inWindow, localTime, nightOver, passIndex, PASSES, rateAt, realSeconds, untilWindow, fmt } from './clock';
import { createRadio, Group, nextLine, patch, Radio, stepRadio, tuned, warn, DIAL } from './radio';
import { DetailFile, Detail, loadDetail } from '../map/detail';
import { CityMap, loadMap, MapFile } from '../map/loadMap';
import { cleanPlaces, NamedPlace } from '../map/places';
import { createFires, Fires, stepFires } from '../sim/fire';
import { count, step, World } from '../sim/outbreak';
import { enterStreet, Kind, leaveStreet, newAgent, stepStreet, Street } from '../sim/street';
import type { Sound } from '../audio';

export const TICK = 60; // game seconds per city-wide step (docs/tuning.md)
export const MAX_AGENTS = 2500;
/** Metres per map cell, east-west and north-south (the grid is not quite square). */
export const CELL_X = 78.7;
export const CELL_Y = 81.3;

export type Mode = 'title' | 'play' | 'sandbox' | 'end';
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Smoke {
  x: number;
  y: number;
  alt: number;
  age: number;
  life: number;
}

export const places: NamedPlace[] = cleanPlaces((detailFile as unknown as DetailFile).places);
export const city: CityMap = loadMap(mapFile as unknown as MapFile, places);
export const det: Detail = loadDetail(detailFile as unknown as DetailFile);
export const GW = city.width;
export const GH = city.height;
const policeCells = new Set(places.filter((p) => p.kind === 'police').map((p) => Math.floor(p.y) * GW + Math.floor(p.x)));
const fireStations = places.filter((p) => p.kind === 'fire').map((p) => Math.floor(p.y) * GW + Math.floor(p.x));

// Where buildings stand, about 10 m per square: people walk around them, walls stop bullets.
const OCC = 8;
const occ = (() => {
  const W = GW * OCC, H = GH * OCC;
  const out = new Uint8Array(W * H);
  const s = det.buildings;
  // Scanline fill of every building outline (no canvas needed, so tests can use it too).
  const xs: number[] = [];
  for (let k = 0; k < s.count; k++) {
    if (s.meta[k] < 4) continue; // sheds and garages do not block
    const o = s.off[k];
    const n = s.off[k + 1] - o;
    const y0 = Math.max(0, Math.floor(s.box[k * 4 + 1] * OCC));
    const y1 = Math.min(H - 1, Math.ceil(s.box[k * 4 + 3] * OCC));
    for (let Y = y0; Y <= y1; Y++) {
      const py = (Y + 0.5) / OCC;
      xs.length = 0;
      for (let j = 0; j < n; j++) {
        const ax = s.xy[(o + j) * 2], ay = s.xy[(o + j) * 2 + 1];
        const jn = (j + 1) % n;
        const bx = s.xy[(o + jn) * 2], by = s.xy[(o + jn) * 2 + 1];
        if (ay > py !== by > py) xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const X0 = Math.max(0, Math.ceil(xs[q] * OCC - 0.5));
        const X1 = Math.min(W - 1, Math.floor(xs[q + 1] * OCC - 0.5));
        for (let X = X0; X <= X1; X++) out[Y * W + X] = 1;
      }
    }
  }
  return out;
})();
export const blocked = (x: number, y: number) => {
  const X = Math.floor(x * OCC), Y = Math.floor(y * OCC);
  return X >= 0 && Y >= 0 && X < GW * OCC && Y < GH * OCC && occ[Y * GW * OCC + X] === 1;
};
function freeSpot(x: number, y: number): [number, number] {
  let px = x + Math.random(), py = y + Math.random();
  for (let k = 0; k < 6 && blocked(px, py); k++) (px = x + Math.random()), (py = y + Math.random());
  return [px, py];
}
const cellAt = (x: number, y: number) => Math.floor(y) * GW + Math.floor(x);

function cloneWorld(w: World): World {
  return {
    ...w,
    healthy: w.healthy.slice(),
    infected: w.infected.slice(),
    fallen: w.fallen.slice(),
    armed: w.armed.slice(),
    ammo: w.ammo.slice(),
    guard: w.guard.slice(),
  };
}

export class Session {
  mode: Mode = 'title';
  world!: World;
  fires!: Fires;
  radio!: Radio;
  street: Street | null = null;
  t = 0; // game seconds since 19:40
  acc = 0;
  tick = 0;
  paused = false;
  sandboxRate = 6;
  startPop = 1;
  lossLog: string[] = [];
  smoke: Smoke[] = [];
  lastPhoto: Uint8Array | null = null;
  wasWindow = false;
  nextTalk = 0;
  /** Subtitles and notices go out through this (the HUD shows them). */
  say: (who: string, text: string, secs?: number) => void = () => {};
  /** Called once when the window closes / opens. */
  onWindow: (open: boolean) => void = () => {};

  constructor(public sound: Sound) {
    this.reset('play');
    this.mode = 'title';
  }

  reset(m: Mode) {
    this.mode = m;
    this.world = cloneWorld(city.world);
    this.fires = createFires(city.buildings);
    this.radio = createRadio();
    this.street = null;
    this.t = this.acc = this.tick = 0;
    this.smoke = [];
    this.lastPhoto = null;
    this.lossLog = [];
    this.startPop = count(this.world.healthy);
    const world = this.world;
    if (m === 'play') {
      // Scripted, not the player: patient zero came in on an organ transfer to HCMC this
      // afternoon; a second patient was moved to Fairview Riverside.
      this.seed(96.8, 121.8, 40);
      this.seed(122.2, 126.5, 12);
      // Contacts live where people are: the busiest block within ~250 m; staff and
      // patients into the hospital (homes-only population misses them).
      for (const g of this.radio.groups) {
        if (g.kind === 'broadcast' || g.kind === 'police') continue;
        if (g.id === 'rosa') {
          world.healthy[cellAt(g.x, g.y)] += 60;
          continue;
        }
        let best = cellAt(g.x, g.y);
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const i = cellAt(g.x + dx, g.y + dy);
            if (world.land[i] && world.healthy[i] > world.healthy[best]) best = i;
          }
        g.x = (best % GW) + 0.5;
        g.y = Math.floor(best / GW) + 0.5;
      }
      for (const g of this.radio.groups)
        if (g.kind === 'star' || g.kind === 'bus')
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const i = (Math.floor(g.y) + dy) * GW + Math.floor(g.x) + dx;
              world.guard[i] = 1;
              world.armed[i] += 2;
              world.ammo[i] += 100;
            }
    }
    this.wasWindow = inWindow(this.t);
  }

  seed(x: number, y: number, n: number) {
    const i = cellAt(x, y);
    if (this.world.land[i]) this.world.infected[i] += n;
  }

  radioUp(): boolean {
    return this.mode === 'sandbox' || inWindow(this.t);
  }
  canLook(): boolean {
    return this.mode === 'sandbox' || (this.mode === 'play' && inWindow(this.t));
  }

  tune(df: number) {
    this.radio.freq = Math.round(Math.max(DIAL.min, Math.min(DIAL.max, this.radio.freq + df)) * 100) / 100;
    this.nextTalk = 0;
    this.sound.hush();
  }
  setFreq(f: number) {
    this.radio.freq = f;
    this.nextTalk = 0;
    this.sound.hush();
  }

  private syncStreetFirst() {
    if (this.street) {
      leaveStreet(this.street, this.world);
      this.street = null;
    }
  }
  doWarn() {
    const { group, signal } = tuned(this.radio);
    if (!this.radioUp()) return this.say('', 'No line of sight. The radio only reaches Minneapolis during a pass.', 3);
    if (!group || signal < 0.75) return this.say('', 'Tune to someone first (arrow keys, or the wheel over the radio).', 3);
    this.syncStreetFirst();
    this.talk(group, warn(this.radio, this.world, group, this.tick, this.tick * 31 + 7));
  }
  doPatch() {
    const { group, signal } = tuned(this.radio);
    if (!this.radioUp()) return this.say('', 'No line of sight. The radio only reaches Minneapolis during a pass.', 3);
    if (!group || signal < 0.75) return this.say('', 'Tune to someone first.', 3);
    if (!this.radio.patchFrom) {
      this.radio.patchFrom = group;
      return this.say('', `Patch: holding ${group.name}. Tune to a second channel and press P again.`, 5);
    }
    this.syncStreetFirst();
    const reply = patch(this.radio, this.world, this.radio.patchFrom, group, this.tick * 17 + 3);
    this.radio.patchFrom = null;
    this.talk(group, reply);
  }
  talk(g: Group, text: string) {
    this.say(g.who, text, 4 + text.length / 16);
    this.sound.say(text, g.pitch, g.rate);
    this.nextTalk = performance.now() + (4 + text.length / 16) * 1000 + 3000;
  }

  cityStep() {
    const world = this.world;
    const before = world.fallen.slice();
    this.world = step(world);
    const w = this.world;
    const fighting = new Float32Array(w.fallen.length);
    for (let i = 0; i < fighting.length; i++) fighting[i] = w.fallen[i] - before[i];
    stepFires(this.fires, w, fighting, fireStations, this.tick * 13 + 5);
    const statusBefore = this.radio.groups.map((g) => g.status);
    stepRadio(this.radio, w, this.tick);
    this.radio.groups.forEach((g, k) => {
      if (g.status === 'overrun' && statusBefore[k] !== 'overrun' && g.kind !== 'broadcast' && !g.fate) {
        this.lossLog.push(`${localTime(this.t)} ${g.name} overrun`);
        g.fate = `lost around ${localTime(this.t)}`;
      }
    });
    this.tick++;
    const s = this.street;
    if (s) {
      // People and the dead arriving from outside the zone become individuals there.
      for (let y = s.y0; y < s.y0 + s.h; y++)
        for (let x = s.x0; x < s.x0 + s.w; x++) {
          const i = y * GW + x;
          let k = Math.floor(w.infected[i] / s.scale + Math.random());
          while (k-- > 0) s.agents.push(newAgent(...freeSpot(x, y), Kind.Dead));
          const h = w.healthy[i];
          if (h > 0) {
            const ammoEach = w.armed[i] > 0 ? w.ammo[i] / w.armed[i] : 0;
            let n = Math.floor(h / s.scale + Math.random());
            while (n-- > 0) {
              const armed = Math.random() < w.armed[i] / h;
              s.agents.push(newAgent(...freeSpot(x, y), Kind.Living, armed ? Math.max(1, Math.round(ammoEach)) : 0));
            }
          }
          w.infected[i] = w.healthy[i] = w.armed[i] = w.ammo[i] = 0;
        }
    }
  }

  /** Keep individuals simulated inside `box` (map cells), or none when null. */
  setZone(box: Box | null) {
    if (!box) {
      this.syncStreetFirst();
      return;
    }
    const s = this.street;
    const vw = box.x1 - box.x0, vh = box.y1 - box.y0;
    if (s && box.x0 >= s.x0 && box.y0 >= s.y0 && box.x1 <= s.x0 + s.w && box.y1 <= s.y0 + s.h && s.w * s.h <= (vw + 6) * (vh + 6) * 2.5)
      return;
    if (s) leaveStreet(s, this.world);
    const mx = Math.ceil(vw * 0.3) + 1, my = Math.ceil(vh * 0.3) + 1;
    const x0 = Math.max(0, Math.floor(box.x0) - mx), y0 = Math.max(0, Math.floor(box.y0) - my);
    const x1 = Math.min(GW, Math.ceil(box.x1) + mx), y1 = Math.min(GH, Math.ceil(box.y1) + my);
    this.street = enterStreet(this.world, x0, y0, x1 - x0, y1 - y0, MAX_AGENTS, this.tick + 1, policeCells, blocked);
    const w = this.world;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * GW + x;
        w.healthy[i] = w.infected[i] = w.armed[i] = w.ammo[i] = 0;
      }
  }

  takePhoto() {
    const w = this.world;
    this.lastPhoto = new Uint8Array(GW * GH);
    for (let i = 0; i < this.lastPhoto.length; i++) this.lastPhoto[i] = w.infected[i] > Math.max(2, w.healthy[i]) ? 1 : 0;
  }

  /** Advance the night by one frame. `zone` = cells near the camera (or null). */
  simulate(realDt: number, now: number, zone: Box | null, streetVisible: boolean) {
    if (this.paused || this.mode === 'title' || this.mode === 'end') return;
    const rate = this.mode === 'play' ? rateAt(this.t) : this.sandboxRate;
    const gameDt = realDt * rate;
    this.t += gameDt;
    this.acc += gameDt;
    let n = 0;
    while (this.acc >= TICK && n++ < 25) {
      this.cityStep();
      this.acc -= TICK;
    }
    if (this.acc > TICK) this.acc = 0;
    if (this.mode === 'play') {
      const open = inWindow(this.t);
      if (open && !this.wasWindow) {
        this.say('', `Pass ${passIndex(this.t) + 1} of ${PASSES}: Minneapolis is coming over the horizon.`, 6);
        this.onWindow(true);
      }
      if (!open && this.wasWindow) {
        this.takePhoto();
        this.sound.hush();
        this.onWindow(false);
        this.say('', `Lost line of sight. Next pass in ${fmt(realSeconds(this.t, this.t + untilWindow(this.t)))}.`, 6);
      }
      this.wasWindow = open;
      if (nightOver(this.t)) {
        this.sound.hush();
        this.sound.setStatic(0);
        this.mode = 'end';
        return;
      }
    }
    this.setZone(this.canLook() ? zone : null);
    const s = this.street;
    if (s && streetVisible) {
      stepStreet(s, this.world, this.tick * 7919 + Math.floor(now), Math.min(0.3, gameDt), blocked);
    }
    this.updateSmoke(gameDt, zone);
    const { group, signal } = tuned(this.radio);
    const up = this.radioUp();
    this.sound.setStatic(up ? 1 - signal * 0.8 : 0.35);
    if (up && group && signal > 0.75 && now > this.nextTalk) {
      const pass = this.mode === 'play' ? passIndex(this.t) : Math.min(5, Math.floor(this.tick / 60));
      this.talk(group, nextLine(this.radio, this.world, group, pass));
    }
  }

  private updateSmoke(gameDt: number, b: Box | null) {
    if (!b) {
      this.smoke.length = 0;
      return;
    }
    const want = 1400;
    const smoke = this.smoke;
    for (let y = Math.max(0, Math.floor(b.y0) - 4); y < Math.min(GH, b.y1 + 6); y++)
      for (let x = Math.max(0, Math.floor(b.x0) - 8); x < Math.min(GW, b.x1 + 2); x++) {
        const f = this.fires.fire[y * GW + x];
        if (f > 0.25 && smoke.length < want && Math.random() < f * 0.8 * Math.min(1, gameDt)) {
          const life = 40 + Math.random() * 50;
          const age = smoke.length < want / 2 ? Math.random() * life * 0.7 : 0;
          smoke.push({ x: x + Math.random() + (2.2 * age) / CELL_X, y: y + Math.random(), alt: 5 + 3.5 * age, age, life });
        }
      }
    for (const p of smoke) {
      p.age += gameDt;
      p.alt += 3.5 * gameDt;
      p.x += (2.2 * gameDt) / CELL_X; // wind from the west
    }
    this.smoke = smoke.filter((p) => p.age < p.life);
  }

  /** Living and turned, counting the individuals in the street zone. */
  totals() {
    let alive = count(this.world.healthy);
    let dead = count(this.world.infected);
    const s = this.street;
    if (s)
      for (const a of s.agents) {
        if (a.kind === Kind.Living) alive += s.scale;
        if (a.kind === Kind.Dead) dead += s.scale;
      }
    return { alive, dead, fallen: count(this.world.fallen) };
  }

  isDark(i: number) {
    const w = this.world;
    return w.infected[i] > 3 && w.infected[i] > w.healthy[i] * 0.8;
  }
}
