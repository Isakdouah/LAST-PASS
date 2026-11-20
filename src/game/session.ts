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
import { eventsBetween, WorldEvent } from './world';
import { createHeroStates, escapeAt, escapeChance, heroById, HeroState, HEROES, setRouter } from './heroes';
import { rng } from '../sim/outbreak';

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

// Where the roads are, on the same 10 m grid (built on first use): routes prefer them.
let roadGrid: Uint8Array | null = null;
function roads(): Uint8Array {
  if (roadGrid) return roadGrid;
  const W = GW * OCC, H = GH * OCC;
  const g = new Uint8Array(W * H);
  const r = det.roads;
  for (let k = 0; k < r.count; k++) {
    const half = Math.max(0.6, r.meta[k] / 2 / 10); // half the road width, in 10 m squares
    const o = r.off[k], n = r.off[k + 1] - o;
    for (let j = 0; j + 1 < n; j++) {
      const ax = r.xy[(o + j) * 2] * OCC, ay = r.xy[(o + j) * 2 + 1] * OCC;
      const bx = r.xy[(o + j + 1) * 2] * OCC, by = r.xy[(o + j + 1) * 2 + 1] * OCC;
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
      for (let s2 = 0; s2 <= steps; s2++) {
        const x = ax + ((bx - ax) * s2) / steps, y = ay + ((by - ay) * s2) / steps;
        const h = Math.ceil(half);
        for (let dy = -h; dy <= h; dy++)
          for (let dx = -h; dx <= h; dx++) {
            const X = Math.floor(x + dx), Y = Math.floor(y + dy);
            if (X >= 0 && Y >= 0 && X < W && Y < H) g[Y * W + X] = 1;
          }
      }
    }
  }
  return (roadGrid = g);
}
/** A street route between two points (map cells): A* over the 10 m building grid, keeping
 *  away from walls, then straightened where there is a clear line. Vehicles never cut
 *  through buildings (see heroes.test.ts). */
export function streetPath(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const W = GW * OCC, H = GH * OCC;
  const pad = 6 * OCC;
  const X0 = Math.max(0, Math.floor(Math.min(a.x, b.x) * OCC) - pad), Y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) * OCC) - pad);
  const X1 = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) * OCC) + pad), Y1 = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) * OCC) + pad);
  const bw = X1 - X0 + 1, bh = Y1 - Y0 + 1;
  const wall = (X: number, Y: number) => occ[Y * W + X] === 1;
  const rg = roads();
  // Cost of standing on a square: walls are impossible, squares next to walls cost more.
  const cost = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const X = x + X0, Y = y + Y0;
      if (wall(X, Y)) {
        cost[y * bw + x] = -1;
        continue;
      }
      let near = 0;
      for (let d = 1; d <= 2; d++)
        if (wall(Math.max(0, X - d), Y) || wall(Math.min(W - 1, X + d), Y) || wall(X, Math.max(0, Y - d)) || wall(X, Math.min(H - 1, Y + d))) near = Math.max(near, 3 - d);
      cost[y * bw + x] = (rg[Y * W + X] ? 1 : 4) + near * 2;
    }
  // The street network is the biggest connected open area in the box; courtyards and
  // backyards closed in by buildings are not roads. Snap both ends onto the network.
  const comp = new Int32Array(bw * bh).fill(-1);
  let best = -1, bestSize = 0;
  for (let i0 = 0, c = 0; i0 < bw * bh; i0++) {
    if (cost[i0] < 0 || comp[i0] >= 0) continue;
    const stack = [i0];
    comp[i0] = c;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % bw, y = (i / bw) | 0;
      if (x > 0 && cost[i - 1] >= 0 && comp[i - 1] < 0) (comp[i - 1] = c), stack.push(i - 1);
      if (x < bw - 1 && cost[i + 1] >= 0 && comp[i + 1] < 0) (comp[i + 1] = c), stack.push(i + 1);
      if (y > 0 && cost[i - bw] >= 0 && comp[i - bw] < 0) (comp[i - bw] = c), stack.push(i - bw);
      if (y < bh - 1 && cost[i + bw] >= 0 && comp[i + bw] < 0) (comp[i + bw] = c), stack.push(i + bw);
    }
    if (size > bestSize) (bestSize = size), (best = c);
    c++;
  }
  const free = (cx: number, cy: number) => {
    // Nearest square of the street network to a point.
    const bx = Math.floor(cx * OCC) - X0, by = Math.floor(cy * OCC) - Y0;
    for (let r = 0; r < 60; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = bx + dx, y = by + dy;
          if (x >= 0 && y >= 0 && x < bw && y < bh && comp[y * bw + x] === best && rg[(y + Y0) * W + x + X0]) return y * bw + x;
        }
    return Math.max(0, Math.min(bw * bh - 1, by * bw + bx));
  };
  const s0 = free(a.x, a.y), s1 = free(b.x, b.y);
  const g = new Float64Array(bw * bh).fill(Infinity);
  const done = new Uint8Array(bw * bh);
  const from = new Int32Array(bw * bh).fill(-1);
  const heap: number[] = [], prio: number[] = [];
  const push = (i: number, p: number) => {
    heap.push(i);
    prio.push(p);
    let k = heap.length - 1;
    while (k > 0) {
      const u = (k - 1) >> 1;
      if (prio[u] <= prio[k]) break;
      [heap[u], heap[k]] = [heap[k], heap[u]];
      [prio[u], prio[k]] = [prio[k], prio[u]];
      k = u;
    }
  };
  const pop = () => {
    const top = heap[0];
    const li = heap.pop()!, lp = prio.pop()!;
    if (heap.length) {
      heap[0] = li;
      prio[0] = lp;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && prio[l] < prio[m]) m = l;
        if (r < heap.length && prio[r] < prio[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        [prio[m], prio[k]] = [prio[k], prio[m]];
        k = m;
      }
    }
    return top;
  };
  const tx = s1 % bw, ty = Math.floor(s1 / bw);
  const hgt = (i: number) => Math.hypot((i % bw) - tx, Math.floor(i / bw) - ty);
  g[s0] = 0;
  push(s0, hgt(s0));
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === s1) break;
    const x = i % bw, y = Math.floor(i / bw);
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const j = ny * bw + nx;
      if (cost[j] < 0) continue;
      if (dx && dy && (cost[y * bw + nx] < 0 || cost[ny * bw + x] < 0)) continue; // no squeezing past corners
      const ng = g[i] + cost[j] * (dx && dy ? 1.414 : 1);
      if (ng < g[j]) {
        g[j] = ng;
        from[j] = i;
        push(j, ng + hgt(j));
      }
    }
  }
  if (from[s1] < 0 && s1 !== s0) return [a, b]; // no way through: keep the straight line
  const raw: number[] = [];
  for (let i = s1; i >= 0 && raw.length < 100000; i = from[i]) raw.push(i);
  raw.reverse();
  const pt = (i: number) => ({ x: ((i % bw) + X0 + 0.5) / OCC, y: (Math.floor(i / bw) + Y0 + 0.5) / OCC });
  // Straighten: keep a point only when the straight line past it would touch a wall.
  const clear = (p: { x: number; y: number }, q: { x: number; y: number }) => {
    const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) * OCC * 2);
    for (let k = 0; k <= n; k++) {
      const x = p.x + ((q.x - p.x) * k) / n, y = p.y + ((q.y - p.y) * k) / n;
      const X = Math.floor(x * OCC) - X0, Y = Math.floor(y * OCC) - Y0;
      if (X < 0 || Y < 0 || X >= bw || Y >= bh || cost[Y * bw + X] < 0 || cost[Y * bw + X] > 3) return false;
    }
    return true;
  };
  const out = [pt(raw[0])];
  let k = 0;
  while (k < raw.length - 1) {
    let j = k + 1;
    while (j + 1 < raw.length && clear(pt(raw[k]), pt(raw[j + 1]))) j++;
    out.push(pt(raw[j]));
    k = j;
  }
  return out;
}
setRouter((pts) => {
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const leg = streetPath(pts[i - 1], pts[i]);
    out.push(...(i === 1 ? leg : leg.slice(1)));
  }
  return out;
});

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
  /** World news waiting to be heard, and the ones already heard (newest last). */
  heroes: HeroState[] = createHeroStates();
  /** Tests can fix the dice for close calls (0 = always escape, 1 = never). */
  luck: (() => number) | null = null;
  newsQueue: WorldEvent[] = [];
  news: WorldEvent[] = [];
  nextNews = 0;
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
    this.newsQueue = [];
    this.news = [];
    this.heroes = createHeroStates();
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
    const hs = this.heroState(group.id);
    if (hs && group.warnedAt === this.tick) {
      hs.helpedAt = this.tick;
      hs.log.push({ t: this.t, text: `${localTime(this.t)} You warned them. They listened.` });
    }
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
    const from = this.radio.patchFrom;
    const convoys = this.radio.convoys.length;
    const reply = patch(this.radio, this.world, from, group, this.tick * 17 + 3);
    if (this.radio.convoys.length > convoys)
      for (const g of [from, group]) {
        const hs = this.heroState(g.id);
        if (hs) {
          hs.helpedAt = this.tick;
          hs.log.push({ t: this.t, text: `${localTime(this.t)} You patched ${from.name} and ${group.name} together. Help is coming.` });
        }
      }
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
      const hs = this.heroState(g.id);
      if (hs && hs.escapeStart >= 0 && !hs.arrived) {
        // On the road: they are moving, not standing and fighting.
        g.status = 'calm';
        g.silent = false;
        return;
      }
      if (g.status === 'overrun' && statusBefore[k] !== 'overrun' && g.kind !== 'broadcast' && !g.fate) {
        if (hs && !hs.dead && this.closeCall(g, hs)) return;
        this.lossLog.push(`${localTime(this.t)} ${g.name} overrun`);
        g.fate = `lost around ${localTime(this.t)}`;
        if (hs) {
          hs.dead = true;
          hs.log.push({ t: this.t, text: `${localTime(this.t)} No contact. Last seen near their block.` });
        }
      }
    });
    this.moveHeroes();
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

  heroState(id: string): HeroState | undefined {
    return this.heroes.find((h) => h.id === id);
  }

  /** Plot armour: the dead reach a hero. If they have close calls left, the maths may turn it
   *  into a narrow escape: they run for it along their escape route, and it costs them something. */
  private closeCall(g: Group, hs: HeroState): boolean {
    const hero = heroById(hs.id)!;
    const w = this.world;
    const i = Math.floor(g.y) * GW + Math.floor(g.x);
    let dead = 0, living = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const j = i + dy * GW + dx;
        dead += w.infected[j] || 0;
        living += w.healthy[j] || 0;
      }
    const p = escapeChance({
      left: hs.left,
      helpedAgo: hs.helpedAt < 0 ? Infinity : this.tick - hs.helpedAt,
      vehicle: true,
      trust: g.trust,
      pressure: dead / Math.max(1, dead + living),
    });
    const roll = this.luck ? this.luck() : rng(this.tick * 7717 + HEROES.indexOf(hero) * 131 + 17)();
    if (p <= 0 || roll > p) return false;
    const n = hs.closeCallsUsed;
    hs.left--;
    hs.closeCallsUsed++;
    hs.pending = hero.after[Math.min(n, hero.after.length - 1)];
    hs.log.push({ t: this.t, text: `${localTime(this.t)} Close call. ${hero.costs[Math.min(n, hero.costs.length - 1)]}` });
    if (hs.id === 'walt' && n === 0) g.trust = Math.max(0, g.trust - 0.1); // weak handheld: harder to reach
    g.status = 'calm';
    g.silent = false;
    if (hs.escapeStart < 0) {
      // Off they go, with as many as the vehicle holds.
      hs.escapeStart = this.tick;
      const ride = Math.min(hero.escape.seats, living);
      hs.riders = ride;
      for (let dy = -1; dy <= 1 && ride > 0; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * GW + dx;
          const take = Math.min(w.healthy[j] || 0, ride / 9);
          w.healthy[j] -= take;
        }
      hs.log.push({ t: this.t, text: `${localTime(this.t)} Left by ${hero.escape.label}, heading for ${hero.escape.to}.` });
    } else if (hs.arrived) {
      // Already out: the close call happens where they are, and they hold on.
      w.infected[i] *= 0.5;
    }
    return true;
  }

  /** Heroes on the road move along their route; on arrival their riders join the block they reach. */
  private moveHeroes() {
    for (const hs of this.heroes) {
      if (hs.escapeStart < 0 || hs.arrived || hs.dead) continue;
      const g = this.radio.groups.find((x) => x.id === hs.id);
      const hero = heroById(hs.id);
      if (!g || !hero) continue;
      const at = escapeAt(hero, (this.tick - hs.escapeStart) * TICK);
      g.x = at.x;
      g.y = at.y;
      if (at.arrived) {
        hs.arrived = true;
        const j = Math.floor(at.y) * GW + Math.floor(at.x);
        this.world.healthy[j] += hs.riders + 1;
        this.world.armed[j] += 1;
        this.world.guard[j] = 1;
        hs.log.push({ t: this.t, text: `${localTime(this.t)} Arrived: ${hero.escape.to}, with ${Math.round(hs.riders)} people.` });
      }
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
    if (this.mode === 'play') this.newsQueue.push(...eventsBetween(this.t, this.t + gameDt));
    this.t += gameDt;
    // World news comes in one item at a time, so nothing scrolls past unread.
    if (this.newsQueue.length && now > this.nextNews && now > this.nextTalk) {
      const e = this.newsQueue.shift()!;
      this.news.push(e);
      this.say(e.source, e.text, 9);
      this.nextNews = now + 10000;
    }
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
      const hs = this.heroState(group.id);
      if (hs && hs.pending) {
        this.talk(group, hs.pending);
        hs.pending = '';
      } else {
        const before = group.known;
        this.talk(group, nextLine(this.radio, this.world, group, pass));
        if (hs && !before) hs.log.push({ t: this.t, text: `${localTime(this.t)} Pass ${pass + 1}: first heard on ${group.freq.toFixed(2)} MHz.` });
      }
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
