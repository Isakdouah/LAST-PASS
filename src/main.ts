// Last Pass, rough draft 1: one night over Minneapolis, 16 October 2009.
// You are the last astronaut in orbit. Six passes over the city. While it is under you,
// look through the telescope (zoom all the way to the street) and use the radio.
// Between passes, the far side of the Earth: results show up next time.
import mapFile from './data/minneapolis.json';
import detailFile from './data/detail.json';
import { Sound } from './audio';
import {
  fmt,
  realSeconds,
  inWindow,
  localTime,
  MPLS,
  nightOver,
  passIndex,
  PASSES,
  rateAt,
  subPoint,
  untilWindow,
  windowLeft,
} from './game/clock';
import { createRadio, DIAL, Group, nextLine, patch, Radio, stepRadio, tuned, warn } from './game/radio';
import { DetailFile, loadDetail, query, Shapes } from './map/detail';
import { loadMap, MapFile } from './map/loadMap';
import { cleanPlaces, NamedPlace } from './map/places';
import { createFires, Fires, stepFires } from './sim/fire';
import { count, step, World } from './sim/outbreak';
import { Agent, enterStreet, Kind, leaveStreet, newAgent, Role, stepStreet, Street } from './sim/street';
import { BAYER, LIST, PAL, RGB, thermalOf } from './render/palette';
import { drawOrbit, OrbitView, project } from './render/orbit';

// ---------- screen ----------
const W = 480;
const H = 270;
const MX = 4;
const MY = 4;
const VIEW_W = 360;
const VIEW_H = 262;
const PX = MX + VIEW_W + 6; // side panel
const MIN_Z = 1; // pixels per map cell: 1 = whole Twin Cities
const MAX_Z = 120; // about 240 m across: one dot is one person
const DETAIL_Z = 9; // from here on: real building outlines in 3D
const AGENT_Z = 3; // from here on: people simulated one by one
const MAX_AGENTS = 2500;
const TILT = 0.6; // how tall buildings look (screen px per px of height)
const TICK = 60; // game seconds per city-wide simulation step (tuned: see docs/tuning.md)
const M_PER_CELL = 79;

const canvas = document.getElementById('screen') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
ctx.imageSmoothingEnabled = false;
// Keep the 16:9 picture whole on any window: the biggest fit, centred.
function fit() {
  const k = Math.min(window.innerWidth / W, window.innerHeight / H);
  const s = k >= 2 ? Math.floor(k) : k; // whole-number scaling when big enough (sharper pixels)
  canvas.style.width = `${Math.floor(W * s)}px`;
  canvas.style.height = `${Math.floor(H * s)}px`;
}
fit();
window.addEventListener('resize', fit);

// ---------- data ----------
const places: NamedPlace[] = cleanPlaces((detailFile as unknown as DetailFile).places);
const city = loadMap(mapFile as unknown as MapFile, places);
const det = loadDetail(detailFile as unknown as DetailFile);
const GW = city.width;
const GH = city.height;
const policeCells = new Set(places.filter((p) => p.kind === 'police').map((p) => Math.floor(p.y) * GW + Math.floor(p.x)));
const fireStations = places.filter((p) => p.kind === 'fire').map((p) => Math.floor(p.y) * GW + Math.floor(p.x));
const KM_PER_CELL = M_PER_CELL / 1000;

// Where buildings stand, about 10 m per square: people walk around them, walls stop bullets.
const OCC = 8;
const occ = (() => {
  const c = document.createElement('canvas');
  c.width = GW * OCC;
  c.height = GH * OCC;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  const s = det.buildings;
  for (let k = 0; k < s.count; k++) {
    if (s.meta[k] < 4) continue; // sheds and garages do not block
    const o = s.off[k] * 2;
    const n = s.off[k + 1] - s.off[k];
    g.beginPath();
    for (let j = 0; j < n; j++) g.lineTo(s.xy[o + j * 2] * OCC, s.xy[o + j * 2 + 1] * OCC);
    g.fill();
  }
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 160 ? 1 : 0;
  return out;
})();
const blocked = (x: number, y: number) => {
  const X = Math.floor(x * OCC), Y = Math.floor(y * OCC);
  return X >= 0 && Y >= 0 && X < GW * OCC && Y < GH * OCC && occ[Y * GW * OCC + X] === 1;
};
function freeSpot(x: number, y: number): [number, number] {
  let px = x + Math.random(), py = y + Math.random();
  for (let k = 0; k < 6 && blocked(px, py); k++) (px = x + Math.random()), (py = y + Math.random());
  return [px, py];
}

// ---------- state ----------
type Mode = 'title' | 'play' | 'sandbox' | 'end';
let mode: Mode = 'title';
let world: World;
let fires: Fires;
let radio: Radio;
let street: Street | null = null;
let t = 0; // game seconds since 19:40
let acc = 0;
let tick = 0;
let paused = false;
let sandboxRate = 6;
let view: 'orbit' | 'city' = 'orbit';
let thermal = false;
let compare = false;
let lastPhoto: Uint8Array | null = null; // overrun cells at the end of the last pass
let wasWindow = false;
let startPop = 1;
let subtitle = { text: '', until: 0, who: '' };
let nextTalk = 0;
let lossLog: string[] = [];
const sound = new Sound();

interface Smoke {
  x: number;
  y: number;
  alt: number;
  age: number;
  life: number;
}
let smoke: Smoke[] = [];

const cam = { x: 0, y: 0, z: MIN_Z, targetZ: MIN_Z, anchorSX: VIEW_W / 2, anchorSY: VIEW_H / 2 };

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

function reset(m: Mode) {
  mode = m;
  world = cloneWorld(city.world);
  fires = createFires(city.buildings);
  radio = createRadio();
  street = null;
  t = 0;
  acc = 0;
  tick = 0;
  smoke = [];
  lastPhoto = null;
  lossLog = [];
  startPop = count(world.healthy);
  compare = false;
  if (m === 'play') {
    // Patient zero was brought into HCMC this afternoon; a transfer went to Fairview Riverside.
    seed(96.8, 121.8, 40);
    seed(122.2, 126.5, 12);
    // Contacts live where people are: move each to the busiest block within ~250 m,
    // and put staff and patients into the hospital (homes-only population misses them).
    for (const g of radio.groups) {
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
    // The stars' blocks start a little readier than most (their own stories; placeholders).
    for (const g of radio.groups)
      if (g.kind === 'star' || g.kind === 'bus')
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const i = (Math.floor(g.y) + dy) * GW + Math.floor(g.x) + dx;
            world.guard[i] = 1;
            world.armed[i] += 2; // a few neighbours with guns, some shells
            world.ammo[i] += 100;
          }
    view = 'orbit';
    cam.z = cam.targetZ = MIN_Z;
    say('', 'Friday 16 October 2009, 19:40 in Minneapolis. The station comes over the city at 20:00. Scroll in to look, tune the radio to listen.', 9);
  } else if (m === 'sandbox') {
    view = 'city';
    cam.z = cam.targetZ = MIN_Z;
    say('', 'Sandbox: click anywhere to start an outbreak. 1-4 change speed.', 6);
  }
  clampCam();
}

function seed(x: number, y: number, n: number) {
  const i = Math.floor(y) * GW + Math.floor(x);
  if (world.land[i]) world.infected[i] += n;
}

// ---------- camera ----------
function clampCam() {
  const vw = VIEW_W / cam.z;
  const vh = VIEW_H / cam.z;
  cam.x = vw >= GW ? (GW - vw) / 2 : Math.max(0, Math.min(GW - vw, cam.x));
  cam.y = vh >= GH ? (GH - vh) / 2 : Math.max(0, Math.min(GH - vh, cam.y));
}
function screenPos(e: MouseEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}
const inView = (x: number, y: number) => x >= MX && y >= MY && x < MX + VIEW_W && y < MY + VIEW_H;
const canLook = () => mode === 'sandbox' || (mode === 'play' && inWindow(t));

let drag: { x: number; y: number; moved: boolean } | null = null;
canvas.addEventListener('mousedown', (e) => {
  sound.start();
  const p = screenPos(e);
  if (inView(p.x, p.y)) drag = { ...p, moved: false };
  else panelClick(p.x, p.y);
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const p = screenPos(e);
  const dx = p.x - drag.x;
  const dy = p.y - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 2) return;
  drag.moved = true;
  if (view === 'city') {
    cam.x -= dx / cam.z;
    cam.y -= dy / cam.z;
    clampCam();
  }
  drag.x = p.x;
  drag.y = p.y;
});
window.addEventListener('mouseup', (e) => {
  if (drag && !drag.moved && view === 'city' && mode === 'sandbox') {
    const p = screenPos(e);
    const x = cam.x + (p.x - MX) / cam.z;
    const y = cam.y + (p.y - MY) / cam.z;
    if (street && x >= street.x0 && y >= street.y0 && x < street.x0 + street.w && y < street.y0 + street.h) {
      for (let k = 0; k < 5; k++) street.agents.push(newAgent(x + Math.random() * 0.1, y + Math.random() * 0.1, Kind.Dead));
    } else seed(x, y, 25);
  }
  drag = null;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    sound.start();
    const p = screenPos(e);
    if (p.x >= PX && p.y > 60 && p.y < 110) {
      tune(e.deltaY < 0 ? 0.02 : -0.02);
      return;
    }
    if (!inView(p.x, p.y) || mode === 'title' || mode === 'end') return;
    if (view === 'orbit') {
      if (e.deltaY < 0) {
        if (canLook()) {
          view = 'city';
          cam.z = cam.targetZ = MIN_Z;
          clampCam();
        } else say('', `Minneapolis is below the horizon. Next pass in ${fmt(realSeconds(t, t + untilWindow(t)))}.`, 3);
      }
      return;
    }
    cam.anchorSX = p.x - MX;
    cam.anchorSY = p.y - MY;
    const factor = Math.exp(-e.deltaY * 0.0025);
    if (cam.targetZ <= MIN_Z * 1.01 && factor < 1) {
      leaveCity();
      return;
    }
    cam.targetZ = Math.max(MIN_Z, Math.min(MAX_Z, cam.targetZ * factor));
  },
  { passive: false },
);

function tune(df: number) {
  radio.freq = Math.round(Math.max(DIAL.min, Math.min(DIAL.max, radio.freq + df)) * 100) / 100;
  nextTalk = 0;
  sound.hush();
}

window.addEventListener('keydown', (e) => {
  sound.start();
  const k = e.key;
  if (mode === 'title') {
    if (k === 'Enter') reset('play');
    if (k === 's' || k === 'S') reset('sandbox');
    return;
  }
  if (mode === 'end') {
    if (k === 'Enter') reset('play');
    if (k === 'Escape') mode = 'title';
    return;
  }
  if (k === 'Escape') {
    sound.hush();
    mode = 'title';
    return;
  }
  if (k === ' ') paused = !paused;
  if (k === 't' || k === 'T') thermal = !thermal;
  if (k === 'c' || k === 'C') compare = !compare;
  if (k === 'm' || k === 'M') {
    sound.muted = !sound.muted;
    if (sound.muted) sound.hush();
  }
  if (k === 'ArrowRight') tune(e.shiftKey ? 0.5 : 0.02);
  if (k === 'ArrowLeft') tune(e.shiftKey ? -0.5 : -0.02);
  if (k === 'ArrowUp') tune(0.5);
  if (k === 'ArrowDown') tune(-0.5);
  if (k === 'w' || k === 'W') doWarn();
  if (k === 'p' || k === 'P') doPatch();
  if (k === '+' || k === '=') cam.targetZ = Math.min(MAX_Z, cam.targetZ * 1.5);
  if (k === '-') cam.targetZ = Math.max(MIN_Z, cam.targetZ / 1.5);
  if (mode === 'sandbox') {
    if (k === 'r' || k === 'R') reset('sandbox');
    if (k >= '1' && k <= '4') sandboxRate = [3, 6, 15, 40][Number(k) - 1];
  }
});

function panelClick(x: number, y: number) {
  // Click a contact to tune to it.
  const known = radio.groups.filter((g) => g.known);
  const i = Math.floor((y - CONTACTS_Y) / 9);
  if (x >= PX && i >= 0 && i < known.length) {
    radio.freq = known[i].freq;
    nextTalk = 0;
  }
}

// ---------- radio verbs ----------
function radioUp(): boolean {
  return mode === 'sandbox' || inWindow(t);
}
function say(who: string, text: string, secs = 7) {
  subtitle = { text, until: performance.now() + secs * 1000, who };
}
function syncStreetFirst() {
  // Radio actions change the city numbers; fold the street back in first.
  if (street) {
    leaveStreet(street, world);
    street = null;
  }
}
function doWarn() {
  const { group, signal } = tuned(radio);
  if (!radioUp()) return say('', 'No line of sight. The radio only reaches Minneapolis during a pass.', 3);
  if (!group || signal < 0.75) return say('', 'Tune to someone first (arrow keys or the mouse wheel over the dial).', 3);
  syncStreetFirst();
  const reply = warn(radio, world, group, tick, tick * 31 + 7);
  talk(group, reply);
}
function doPatch() {
  const { group, signal } = tuned(radio);
  if (!radioUp()) return say('', 'No line of sight. The radio only reaches Minneapolis during a pass.', 3);
  if (!group || signal < 0.75) return say('', 'Tune to someone first.', 3);
  if (!radio.patchFrom) {
    radio.patchFrom = group;
    return say('', `Patch: holding ${group.name}. Tune to a second channel and press P again.`, 5);
  }
  syncStreetFirst();
  const reply = patch(radio, world, radio.patchFrom, group, tick * 17 + 3);
  radio.patchFrom = null;
  talk(group, reply);
}
function talk(g: Group, text: string) {
  say(g.who, text, 4 + text.length / 16);
  sound.say(text, g.pitch, g.rate);
  nextTalk = performance.now() + (4 + text.length / 16) * 1000 + 3000;
}

// ---------- simulation ----------
function cityStep() {
  const before = world.fallen.slice();
  world = step(world);
  const fighting = new Float32Array(world.fallen.length);
  for (let i = 0; i < fighting.length; i++) fighting[i] = world.fallen[i] - before[i];
  stepFires(fires, world, fighting, fireStations, tick * 13 + 5);
  const statusBefore = radio.groups.map((g) => g.status);
  stepRadio(radio, world, tick);
  radio.groups.forEach((g, k) => {
    if (g.status === 'overrun' && statusBefore[k] !== 'overrun' && g.kind !== 'broadcast' && !g.fate)
      lossLog.push(`${localTime(t)} ${g.name} overrun`), (g.fate = `lost around ${localTime(t)}`);
  });
  tick++;
  if (street) {
    // People and the dead arriving from outside the street zone become individuals there.
    const s = street;
    for (let y = s.y0; y < s.y0 + s.h; y++)
      for (let x = s.x0; x < s.x0 + s.w; x++) {
        const i = y * GW + x;
        let k = Math.floor(world.infected[i] / s.scale + Math.random());
        while (k-- > 0) s.agents.push(newAgent(...freeSpot(x, y), Kind.Dead));
        const h = world.healthy[i];
        if (h > 0) {
          const ammoEach = world.armed[i] > 0 ? world.ammo[i] / world.armed[i] : 0;
          let n = Math.floor(h / s.scale + Math.random());
          while (n-- > 0) {
            const armed = Math.random() < world.armed[i] / h;
            s.agents.push(newAgent(...freeSpot(x, y), Kind.Living, armed ? Math.max(1, Math.round(ammoEach)) : 0));
          }
        }
        world.infected[i] = 0;
        world.healthy[i] = 0;
        world.armed[i] = 0;
        world.ammo[i] = 0;
      }
  }
}

function updateZone() {
  if (view !== 'city' || cam.z < AGENT_Z) {
    if (street) {
      leaveStreet(street, world);
      street = null;
    }
    return;
  }
  const vw = VIEW_W / cam.z;
  const vh = VIEW_H / cam.z;
  const fits =
    street &&
    cam.x >= street.x0 &&
    cam.y >= street.y0 &&
    cam.x + vw <= street.x0 + street.w &&
    cam.y + vh <= street.y0 + street.h &&
    street.w * street.h <= (vw + 6) * (vh + 6) * 2.5;
  if (fits) return;
  if (street) leaveStreet(street, world);
  const mx = Math.ceil(vw * 0.3) + 1;
  const my = Math.ceil(vh * 0.3) + 1;
  const x0 = Math.max(0, Math.floor(cam.x) - mx);
  const y0 = Math.max(0, Math.floor(cam.y) - my);
  const x1 = Math.min(GW, Math.ceil(cam.x + vw) + mx);
  const y1 = Math.min(GH, Math.ceil(cam.y + vh) + my);
  street = enterStreet(world, x0, y0, x1 - x0, y1 - y0, MAX_AGENTS, tick + 1, policeCells, blocked);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * GW + x;
      world.healthy[i] = 0;
      world.infected[i] = 0;
      world.armed[i] = 0;
      world.ammo[i] = 0;
    }
}

function leaveCity() {
  if (street) {
    leaveStreet(street, world);
    street = null;
  }
  view = 'orbit';
}

function takePhoto() {
  lastPhoto = new Uint8Array(GW * GH);
  for (let i = 0; i < lastPhoto.length; i++) lastPhoto[i] = world.infected[i] > Math.max(2, world.healthy[i]) ? 1 : 0;
}

// ---------- drawing helpers ----------
const img = ctx.createImageData(W, H);
function put(x: number, y: number, c: RGB) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  img.data[o] = c[0];
  img.data[o + 1] = c[1];
  img.data[o + 2] = c[2];
  img.data[o + 3] = 255;
}
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const sx = (x: number) => MX + (x - cam.x) * cam.z;
const sy = (y: number) => MY + (y - cam.y) * cam.z;
const cellAt = (x: number, y: number) => Math.floor(y) * GW + Math.floor(x);
const isDark = (i: number) => world.infected[i] > 3 && world.infected[i] > world.healthy[i] * 0.8;
const hashI = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

// Palette snapping: every map pixel becomes one of the fixed colours.
const snapCache = new Int16Array(32768).fill(-1);
const EXACT = new Map<number, number>(LIST.map((c, k) => [(c[0] << 16) | (c[1] << 8) | c[2], k] as [number, number]));
// Blended edge pixels snap only to the base map colours (never to blood, smoke or people).
const BASE = ['ground', 'asphalt', 'lit', 'park', 'water', 'roof', 'roofDark', 'wallA', 'wallB', 'built', 'shadow', 'fire', 'fireHot', 'space'].map((n) => LIST.indexOf(PAL[n as keyof typeof PAL]));
function nearest(r: number, g: number, b: number): number {
  const ex = EXACT.get((r << 16) | (g << 8) | b);
  if (ex !== undefined) return ex;
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  const c = snapCache[key];
  if (c >= 0) return c;
  let best = 0;
  let bd = Infinity;
  for (const k of BASE) {
    const p = LIST[k];
    const d = (p[0] - r) ** 2 * 0.3 + (p[1] - g) ** 2 * 0.5 + (p[2] - b) ** 2 * 0.2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  snapCache[key] = best;
  return best;
}
const THERMAL = LIST.map((c) => thermalOf(c));
const idx = (c: RGB) => LIST.indexOf(c);
const GROUNDISH = new Set([idx(PAL.ground), idx(PAL.asphalt), idx(PAL.lit), idx(PAL.park), idx(PAL.built)]);
const LIGHTS = new Set([idx(PAL.lit), idx(PAL.window), idx(PAL.waterLit)]);
const DARKER = LIST.map((c, k) => (LIGHTS.has(k) ? nearest(c[0] * 0.35, c[1] * 0.35, c[2] * 0.4) : k));

// ---------- the city: far zoom (one pixel per cell or more) ----------
function rasterMap() {
  const z = cam.z;
  for (let py = 0; py < VIEW_H; py++) {
    const fy = cam.y + py / z;
    const cy = Math.floor(fy);
    for (let px = 0; px < VIEW_W; px++) {
      const fx = cam.x + px / z;
      const cx = Math.floor(fx);
      const X = px + MX;
      const Y = py + MY;
      if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) {
        put(X, Y, PAL.space);
        continue;
      }
      const i = cy * GW + cx;
      const tb = BAYER[(Y % 4) * 4 + (X % 4)];
      let c: RGB;
      if (!world.land[i]) c = PAL.water;
      else {
        c = city.buildings[i] / 255 > tb * 0.8 ? PAL.built : PAL.ground;
        if (city.roadMinor[i] && tb < 0.5) c = PAL.asphalt;
        if (city.roadMajor[i]) c = PAL.lit;
        const per = z * z;
        const zz = Math.min(1, (world.infected[i] / 10) * Math.min(1, 4 / per));
        const hh = Math.min(0.75, (world.healthy[i] / 28) * Math.min(1, 4 / per));
        const ff = Math.min(0.9, world.fallen[i] / 15);
        if (zz > tb) c = PAL.dead;
        else if (hh > tb) c = world.armed[i] > world.healthy[i] * 0.5 ? PAL.armed : PAL.living;
        else if (ff > tb) c = PAL.blood;
        const f = fires.fire[i];
        if (f > 0 && f > tb * 0.9) c = (tb + performance.now() / 300) % 1 > 0.5 ? PAL.fire : PAL.fireHot;
      }
      put(X, Y, c);
    }
  }
}

// ---------- the city: close zoom (real outlines, 3D buildings) ----------
function path(s: Shapes, k: number, lift = 0) {
  const o = s.off[k] * 2;
  const n = s.off[k + 1] - s.off[k];
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    const X = sx(s.xy[o + j * 2]);
    const Y = sy(s.xy[o + j * 2 + 1]) - lift;
    if (j === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  }
}
function visibleBox() {
  return { x0: cam.x - 1, y0: cam.y - 1, x1: cam.x + VIEW_W / cam.z + 1, y1: cam.y + VIEW_H / cam.z + 4 };
}
function vectorGround() {
  const b = visibleBox();
  ctx.fillStyle = css(PAL.ground);
  ctx.fillRect(MX, MY, VIEW_W, VIEW_H);
  ctx.fillStyle = css(PAL.park);
  for (const k of query(det.parks, b.x0, b.y0, b.x1, b.y1)) if (!det.parks.meta[k]) (path(det.parks, k), ctx.fill());
  const water = query(det.water, b.x0, b.y0, b.x1, b.y1);
  ctx.fillStyle = css(PAL.water);
  for (const k of water) if (!det.water.meta[k]) (path(det.water, k), ctx.fill());
  ctx.fillStyle = css(PAL.ground);
  for (const k of water) if (det.water.meta[k]) (path(det.water, k), ctx.fill());
  // Roads: widest last so main streets read on top; big roads carry sodium light.
  const roads = query(det.roads, b.x0, b.y0, b.x1, b.y1).sort((a, c) => det.roads.meta[a] - det.roads.meta[c]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const k of roads) {
    const wm = det.roads.meta[k];
    ctx.lineWidth = Math.max(1, (wm / M_PER_CELL) * cam.z);
    ctx.strokeStyle = css(wm >= 13 ? PAL.lit : PAL.asphalt);
    path(det.roads, k);
    ctx.stroke();
  }
  // Blood where people fell.
  if (street && cam.z > 20) {
    ctx.fillStyle = css(PAL.blood);
    const r = Math.max(1, Math.round(cam.z / 40));
    for (const p of street.blood) ctx.fillRect(Math.round(sx(p.x)) - r, Math.round(sy(p.y)), r * 2 + 1, r + 1);
  }
}

function drawBuildings() {
  const s = det.buildings;
  const b = visibleBox();
  const ids = query(s, b.x0, b.y0, b.x1, b.y1 + 2);
  ids.sort((a, c) => s.box[a * 4 + 3] - s.box[c * 4 + 3]);
  const z = cam.z;
  const now = performance.now();
  for (const k of ids) {
    const hp = (s.meta[k] / M_PER_CELL) * z * TILT;
    const o = s.off[k] * 2;
    const n = s.off[k + 1] - s.off[k];
    const ci = cellAt((s.box[k * 4] + s.box[k * 4 + 2]) / 2, (s.box[k * 4 + 1] + s.box[k * 4 + 3]) / 2);
    const fire = fires.fire[ci] ?? 0;
    const dark = isDark(ci);
    if (hp >= 1) {
      let area = 0;
      for (let j = 0; j < n - 1; j++) area += s.xy[o + j * 2] * s.xy[o + j * 2 + 3] - s.xy[o + j * 2 + 2] * s.xy[o + j * 2 + 1];
      const sign = area > 0 ? 1 : -1;
      for (let j = 0; j < n - 1; j++) {
        const ax = sx(s.xy[o + j * 2]), ay = sy(s.xy[o + j * 2 + 1]);
        const bx = sx(s.xy[o + j * 2 + 2]), by = sy(s.xy[o + j * 2 + 3]);
        const nx = (by - ay) * sign;
        const ny = -(bx - ax) * sign;
        if (ny <= 0) continue; // faces away from us
        ctx.fillStyle = css(fire > 0.5 && hashI(k + j) < fire * 0.5 ? PAL.fire : nx > 0 ? PAL.wallA : PAL.wallB);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx, by - hp);
        ctx.lineTo(ax, ay - hp);
        ctx.fill();
        // Lit windows on taller walls (out when the power is gone).
        if (!dark && hp > 5 && Math.abs(bx - ax) > 3) {
          ctx.fillStyle = css(PAL.window);
          const rows = Math.floor(hp / 3);
          const cols = Math.floor(Math.abs(bx - ax) / 3);
          for (let rr = 1; rr < rows; rr++)
            for (let cc = 1; cc < cols; cc++)
              if (hashI(k * 131 + rr * 17 + cc) < 0.18) {
                const f = cc / cols;
                ctx.fillRect(Math.round(ax + (bx - ax) * f), Math.round(ay + (by - ay) * f - rr * 3), 1, 1);
              }
        }
      }
    }
    path(s, k, hp);
    ctx.fillStyle = css(fire > 0.3 ? ((now / 250 + k) % 2 < 1 ? PAL.fire : PAL.fireHot) : dark ? PAL.roofDark : PAL.roof);
    ctx.fill();
    if (fire > 0.3 && z > 12) {
      // Flames licking up off the roof.
      const n2 = Math.min(6, Math.ceil(fire * 4));
      for (let f = 0; f < n2; f++) {
        const j = Math.floor(hashI(k * 7 + f) * (n - 1));
        const fx = sx(s.xy[o + j * 2]);
        const fy = sy(s.xy[o + j * 2 + 1]) - hp;
        const fl = 1 + ((now / 90 + f * 3 + k) % 4);
        ctx.fillStyle = css(f % 2 ? PAL.fireHot : PAL.fire);
        ctx.fillRect(Math.round(fx), Math.round(fy - fl * z / 30), Math.max(1, Math.round(z / 40)), Math.max(1, Math.round((fl * z) / 30)));
      }
    }
  }
}

// ---------- people ----------
function drawAgents(s: Street) {
  const z = cam.z;
  const size = z >= 60 ? 3 : z >= 25 ? 2 : 1;
  const now = performance.now();
  const sprite = (a: Agent, body: RGB, head: RGB) => {
    const X = Math.round(sx(a.x));
    const Y = Math.round(sy(a.y));
    if (X < MX - 4 || Y < MY - 6 || X > MX + VIEW_W + 4 || Y > MY + VIEW_H + 6) return;
    if (size === 1) {
      ctx.fillStyle = css(body);
      ctx.fillRect(X, Y, 1, 1);
      return;
    }
    const moving = Math.abs(a.vx) + Math.abs(a.vy) > 0;
    const frame = moving ? Math.floor(now / 120 + a.x * 50) % 2 : 0;
    ctx.fillStyle = css(PAL.shadow);
    if (size === 2) {
      ctx.fillRect(X, Y + 1, 2, 1);
      ctx.fillStyle = css(body);
      ctx.fillRect(X, Y - 2, 1, 3);
      ctx.fillStyle = css(head);
      ctx.fillRect(X, Y - 3, 1, 1);
      return;
    }
    // 3x5 person: head, body, legs that move, and a gun if they have one.
    ctx.fillRect(X - 1, Y + 1, 4, 1);
    ctx.fillStyle = css(head);
    ctx.fillRect(X, Y - 4, 1, 1);
    ctx.fillStyle = css(body);
    ctx.fillRect(X - 1, Y - 3, 3, 2);
    if (a.kind === Kind.Dead) {
      // Arms out, reaching.
      const dir = Math.cos(a.face) >= 0 ? 1 : -1;
      ctx.fillRect(X + dir * 2, Y - 3, 1, 1);
    }
    ctx.fillRect(frame ? X - 1 : X, Y - 1, 1, 2);
    ctx.fillRect(frame ? X + 1 : X, Y - 1, 1, 2);
    if (a.kind === Kind.Living && a.ammo > 0) {
      ctx.fillStyle = css(PAL.steel);
      ctx.fillRect(X + Math.round(Math.cos(a.face) * 2), Y - 2 + Math.round(Math.sin(a.face)), 1, 1);
    }
  };
  // The fallen first (on the ground), then the living, then the dead on top.
  for (const a of s.agents)
    if (a.kind === Kind.Fallen) {
      const X = Math.round(sx(a.x)), Y = Math.round(sy(a.y));
      ctx.fillStyle = css(PAL.bloodDark);
      ctx.fillRect(X - (size > 1 ? 1 : 0), Y, size, 1);
    }
  for (const a of s.agents)
    if (a.kind === Kind.Living) {
      const body = a.role === Role.Police ? PAL.police : a.ammo > 0 ? PAL.armed : a.fear > 0.5 ? PAL.scared : PAL.living;
      sprite(a, body, a.role === Role.Police ? PAL.armed : PAL.living);
    }
  for (const a of s.agents) if (a.kind === Kind.Dead) sprite(a, PAL.dead, PAL.deadDark);
  // Bullets: bright streaks. Muzzle flashes. Impacts.
  ctx.fillStyle = css(PAL.tracer);
  const lift = size > 1 ? 2 : 0;
  for (const b of s.bullets) {
    // A pixel-exact streak from where the bullet was to where it is.
    let x0 = Math.round(sx(b.px)), y0 = Math.round(sy(b.py)) - lift;
    const x1 = Math.round(sx(b.x)), y1 = Math.round(sy(b.y)) - lift;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), stx = x0 < x1 ? 1 : -1, sty = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 400; n++) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) (err += dy), (x0 += stx);
      if (e2 <= dx) (err += dx), (y0 += sty);
    }
  }
  ctx.fillStyle = css(PAL.flash);
  for (const a of s.agents)
    if (a.flash > 0 && a.kind === Kind.Living) {
      const X = Math.round(sx(a.x) + Math.cos(a.face) * (size + 1));
      const Y = Math.round(sy(a.y) + Math.sin(a.face) * (size + 1)) - (size > 1 ? 2 : 0);
      ctx.fillRect(X - (size > 2 ? 1 : 0), Y - (size > 2 ? 1 : 0), size > 2 ? 2 : 1, size > 2 ? 2 : 1);
    }
  ctx.fillStyle = css(PAL.smokeLight);
  for (const p of s.puffs) ctx.fillRect(Math.round(sx(p.x)), Math.round(sy(p.y)) - 1, size > 2 ? 2 : 1, 1);
}

// ---------- smoke ----------
function updateSmoke(gameDt: number) {
  const b = visibleBox();
  const want = 900;
  for (let y = Math.max(0, Math.floor(b.y0)); y < Math.min(GH, b.y1 + 6); y++)
    for (let x = Math.max(0, Math.floor(b.x0) - 6); x < Math.min(GW, b.x1); x++) {
      const f = fires.fire[y * GW + x];
      if (f > 0.25 && smoke.length < want && Math.random() < f * 0.8 * Math.min(1, gameDt))
      {
        // Born at a random point of its life, so a plume is already standing when you look.
        const life = 40 + Math.random() * 50;
        const age = smoke.length < want / 2 ? Math.random() * life * 0.7 : 0;
        smoke.push({ x: x + Math.random() + (2.2 * age) / M_PER_CELL, y: y + Math.random(), alt: 5 + 3.5 * age, age, life });
      }
    }
  for (const p of smoke) {
    p.age += gameDt;
    p.alt += 3.5 * gameDt;
    p.x += (2.2 * gameDt) / M_PER_CELL; // wind from the west
  }
  smoke = smoke.filter((p) => p.age < p.life);
}

// ---------- final pass over the map pixels ----------
function finishMap() {
  const data = ctx.getImageData(MX, MY, VIEW_W, VIEW_H);
  const d = data.data;
  const z = cam.z;
  const smokeIdx = idx(PAL.smoke), smokeL = idx(PAL.smokeLight), bloodI = idx(PAL.blood), markI = idx(PAL.fire);
  const buf = new Int16Array(VIEW_W * VIEW_H);
  for (let py = 0; py < VIEW_H; py++) {
    const cy = Math.floor(cam.y + py / z);
    for (let px = 0; px < VIEW_W; px++) {
      const o = (py * VIEW_W + px) * 4;
      let k = nearest(d[o], d[o + 1], d[o + 2]);
      if (view === 'city') {
        const cx = Math.floor(cam.x + px / z);
        if (cx >= 0 && cy >= 0 && cx < GW && cy < GH) {
          const i = cy * GW + cx;
          const tb = BAYER[((py + MY) % 4) * 4 + ((px + MX) % 4)];
          if (isDark(i)) k = DARKER[k];
          // Blood on the streets where many fell (city-wide numbers).
          if (z >= DETAIL_Z && GROUNDISH.has(k) && Math.min(0.35, world.fallen[i] / 120) > tb) k = bloodI;
          if (compare && lastPhoto && !lastPhoto[i] && world.infected[i] > Math.max(2, world.healthy[i]) && tb < 0.4) k = markI;
        }
      }
      buf[py * VIEW_W + px] = k;
    }
  }
  // Smoke: dithered puffs that grow and thin out as they rise and drift east.
  if (view === 'city')
    for (const p of smoke) {
      const fade = 1 - p.age / p.life;
      const r = Math.max(0.6, ((6 + p.age * 0.9) / M_PER_CELL) * z);
      const X = (p.x - cam.x) * z;
      const Y = (p.y - cam.y) * z - (p.alt / M_PER_CELL) * z * TILT;
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const qx = Math.round(X + dx), qy = Math.round(Y + dy);
          if (qx < 0 || qy < 0 || qx >= VIEW_W || qy >= VIEW_H) continue;
          const tb = BAYER[((qy + MY) % 4) * 4 + ((qx + MX) % 4)];
          if (fade * 0.75 > tb && (dx * dx + dy * dy) < r * r * (0.5 + fade * 0.5)) buf[qy * VIEW_W + qx] = dy < -r / 3 ? smokeL : smokeIdx;
        }
    }
  for (let q = 0; q < buf.length; q++) {
    const c = thermal ? THERMAL[buf[q]] : LIST[buf[q]];
    d[q * 4] = c[0];
    d[q * 4 + 1] = c[1];
    d[q * 4 + 2] = c[2];
    d[q * 4 + 3] = 255;
  }
  ctx.putImageData(data, MX, MY);
}

// ---------- markers and labels (drawn after the pixel pass, crisp) ----------
function drawMarkers() {
  ctx.save();
  ctx.beginPath();
  ctx.rect(MX, MY, VIEW_W, VIEW_H);
  ctx.clip();
  ctx.font = '8px monospace';
  ctx.textBaseline = 'bottom';
  const z = cam.z;
  for (const p of places) {
    const X = Math.round(sx(p.x + 0.5 * 0)), Y = Math.round(sy(p.y));
    if (X < MX || Y < MY || X >= MX + VIEW_W || Y >= MY + VIEW_H) continue;
    const c = p.kind === 'police' ? PAL.police : p.kind === 'fire' ? PAL.fire : PAL.hospital;
    ctx.fillStyle = css(c);
    if (p.kind === 'hospital') {
      ctx.fillRect(X - 2, Y, 5, 1);
      ctx.fillRect(X, Y - 2, 1, 5);
    } else ctx.fillRect(X - 1, Y - 1, 3, 3);
    if (z >= 14 && p.name) {
      ctx.fillStyle = css(PAL.ink);
      ctx.fillText(p.name, X + 4, Y - 1);
    }
  }
  // Your contacts on the map: yellow diamonds with their names.
  for (const g of radio.groups) {
    if (!g.known || g.kind === 'broadcast') continue;
    const X = Math.round(sx(g.x)), Y = Math.round(sy(g.y));
    if (X < MX || Y < MY || X >= MX + VIEW_W || Y >= MY + VIEW_H) continue;
    ctx.fillStyle = css(g.silent ? PAL.ink : PAL.mark);
    ctx.fillRect(X - 1, Y - 3, 3, 1);
    ctx.fillRect(X - 2, Y - 2, 5, 1);
    ctx.fillRect(X - 1, Y - 1, 3, 1);
    ctx.fillText(g.name, X + 4, Y - 1);
  }
  for (const c of radio.convoys) {
    const X = Math.round(sx(c.x)), Y = Math.round(sy(c.y));
    ctx.fillStyle = css(c.bus ? PAL.mark : c.armed > 0 ? PAL.police : PAL.living);
    ctx.fillRect(X - 1, Y - 1, 3, 3);
  }
  ctx.restore();
}

// ---------- side panel and subtitles ----------
const CONTACTS_Y = 128;
function text(s: string, x: number, y: number, c: RGB = PAL.ink) {
  ctx.fillStyle = css(c);
  ctx.fillText(s, x, y);
}
function panel() {
  ctx.fillStyle = css(PAL.space);
  ctx.fillRect(PX - 2, 0, W - PX + 2, H);
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  let y = MY;
  const line = (s: string, c: RGB = PAL.ink) => {
    text(s, PX, y, c);
    y += 9;
  };
  line('LAST PASS', PAL.inkBright);
  if (mode === 'play') {
    line(`${localTime(t)} CDT  pass ${Math.min(PASSES, passIndex(t) + 1)}/${PASSES}`);
    if (inWindow(t)) line(`IN SIGHT  ${fmt(realSeconds(t, t + windowLeft(t)))} left`, PAL.mark);
    else line(`far side  next ${fmt(realSeconds(t, t + untilWindow(t)))}`, PAL.ink);
  } else {
    line(`sandbox  x${sandboxRate}`);
    line(`${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, '0')} of game time`);
  }
  const viewKm = (VIEW_W / cam.z) * KM_PER_CELL;
  line(view === 'orbit' ? 'view: from orbit' : `view: ${viewKm < 1 ? Math.round(viewKm * 1000) + ' m' : viewKm.toFixed(1) + ' km'}${thermal ? ' THERMAL' : ''}`);
  y += 2;
  // Radio dial.
  const { group, signal } = tuned(radio);
  const up = radioUp();
  line(`RADIO ${radio.freq.toFixed(2)} MHz`, PAL.inkBright);
  ctx.fillStyle = css(PAL.built);
  ctx.fillRect(PX, y, 104, 5);
  for (const g of radio.groups) {
    if (!g.known) continue;
    ctx.fillStyle = css(PAL.mark);
    ctx.fillRect(PX + Math.round(((g.freq - DIAL.min) / (DIAL.max - DIAL.min)) * 103), y + 3, 1, 2);
  }
  ctx.fillStyle = css(PAL.fire);
  ctx.fillRect(PX + Math.round(((radio.freq - DIAL.min) / (DIAL.max - DIAL.min)) * 103), y, 1, 5);
  y += 7;
  const bars = up && group ? Math.round(signal * 5) : 0;
  for (let b = 0; b < 5; b++) {
    ctx.fillStyle = css(b < bars ? PAL.dead : PAL.built);
    ctx.fillRect(PX + b * 4, y + 6 - b, 3, 2 + b);
  }
  text(up ? (group && signal > 0.75 ? (group.known ? group.name : 'a voice...') : group && signal > 0.2 ? 'something faint...' : 'static') : 'no line of sight', PX + 24, y, up ? PAL.inkBright : PAL.ink);
  y += 11;
  if (radio.patchFrom) line(`patch: ${radio.patchFrom.name}`, PAL.mark);
  // Contacts.
  y = CONTACTS_Y - 10;
  line('CONTACTS', PAL.inkBright);
  for (const g of radio.groups.filter((gg) => gg.known)) {
    const c = g.silent ? PAL.ink : g.status === 'calm' ? PAL.living : g.status === 'contact' ? PAL.scared : PAL.fire;
    const st = g.silent ? 'silent' : g.kind === 'broadcast' ? '' : g.status;
    text(`${g.name.slice(0, 13).padEnd(13)} ${st}`, PX, y, c);
    y += 9;
  }
  // City numbers.
  let alive = count(world.healthy);
  let dead = count(world.infected);
  if (street)
    for (const a of street.agents) {
      if (a.kind === Kind.Living) alive += street.scale;
      if (a.kind === Kind.Dead) dead += street.scale;
    }
  y = 200;
  text(`living ${Math.round((alive / startPop) * 100)}%`, PX, y, PAL.inkBright);
  text(`turned ${Math.round(dead / 1000)}k`, PX + 56, y, PAL.dead);
  y += 11;
  const hint =
    mode === 'sandbox'
      ? ['click: outbreak', '1-4: speed  R: reset', 'wheel: zoom  drag', '<- ->: tune radio', 'W warn  P patch']
      : ['wheel: zoom  drag', '<- ->: tune radio', 'W: warn  P: patch', 'T thermal C compare'];
  for (const h of hint) (text(h, PX, y), (y += 9));
  text('(c) OpenStreetMap', PX, H - 10, PAL.ink);
}

function wrap(s: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if ((cur + ' ' + w).trim().length > max) {
      out.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
// One quiet hint strip at the top of the view, depending on where you are in the night.
function hintText(): string {
  if (mode === 'sandbox') return '';
  const known = radio.groups.filter((g) => g.known);
  if (view === 'orbit')
    return inWindow(t) ? 'Minneapolis is in sight. Scroll in on the yellow cross to look.' : 'Far side of the Earth. What you did shows up next pass.';
  if (known.length === 0) return 'Radio: Up/Down tune fast, Left/Right fine. Hams use 146.52.';
  if (radio.stats.patches === 0 && known.every((g) => g.warnedAt < 0) && radio.stats.warnRight + radio.stats.warnWrong === 0)
    return 'W warns who you are tuned to. They decide if they believe you.';
  if (!known.some((g) => g.kind === 'police')) return 'Police talk around 155 MHz. P + P patches two channels.';
  if (cam.z < 40) return 'Zoom all the way in to see people fight. T: thermal camera.';
  return '';
}
function drawHint() {
  const h = hintText();
  if (!h) return;
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(MX, MY, VIEW_W, 11);
  text(h, MX + 3, MY + 2, PAL.mark);
}
function drawSubtitle() {
  if (performance.now() > subtitle.until || !subtitle.text) return;
  const lines = wrap(subtitle.text, 70).slice(0, 4);
  const h = lines.length * 9 + 4;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(MX, MY + VIEW_H - h, VIEW_W, h);
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  lines.forEach((l, k) => text(l, MX + 3, MY + VIEW_H - h + 2 + k * 9, PAL.inkBright));
}

// ---------- screens ----------
function orbitState(): OrbitView {
  let lit = 0, fire = 0, cells = 0;
  for (let i = 0; i < world.healthy.length; i += 7) {
    if (!world.land[i]) continue;
    cells++;
    if (!isDark(i)) lit++;
    if (fires.fire[i] > 0) fire++;
  }
  const utc = (19 + 40 / 60 + 5 + t / 3600) % 24; // CDT = UTC-5
  return { sub: subPoint(t), utc, cityLight: lit / Math.max(1, cells), cityFire: Math.min(1, (fire / Math.max(1, cells)) * 20) };
}
function drawOrbitView() {
  const v = orbitState();
  drawOrbit(put, MX, MY, VIEW_W, VIEW_H, v, performance.now() / 1000);
  ctx.putImageData(img, 0, 0, MX, MY, VIEW_W, VIEW_H);
  const m = project(v, VIEW_W, VIEW_H, MPLS.lat, MPLS.lon);
  ctx.font = '8px monospace';
  ctx.textBaseline = 'bottom';
  if (m.visible && m.y > 0 && m.y < VIEW_H) {
    const X = Math.round(m.x) + MX, Y = Math.round(m.y) + MY;
    ctx.fillStyle = css(inWindow(t) ? PAL.mark : PAL.ink);
    ctx.fillRect(X - 7, Y, 4, 1);
    ctx.fillRect(X + 4, Y, 4, 1);
    ctx.fillRect(X, Y - 6, 1, 4);
    ctx.fillRect(X, Y + 3, 1, 4);
    text('MINNEAPOLIS', X + 6, Y - 3, inWindow(t) ? PAL.mark : PAL.ink);
  }
  // Where the station is heading.
  ctx.fillStyle = css(PAL.inkBright);
  for (let k = 1; k < 30; k++) {
    const s = subPoint(t + k * 30);
    const p = project(v, VIEW_W, VIEW_H, s.lat, s.lon);
    if (p.visible && k % 2) ctx.fillRect(Math.round(p.x) + MX, Math.round(p.y) + MY, 1, 1);
  }
}

function titleScreen() {
  const v: OrbitView = { sub: { lat: 38, lon: -100 }, utc: 1.5, cityLight: 1, cityFire: 0 };
  drawOrbit(put, 0, 0, W, H, v, performance.now() / 1000);
  ctx.putImageData(img, 0, 0);
  ctx.font = '16px monospace';
  ctx.textBaseline = 'top';
  text('LAST PASS', 24, 30, PAL.inkBright);
  ctx.font = '8px monospace';
  text('Minneapolis. Friday 16 October 2009. One night, six passes.', 24, 52, PAL.ink);
  text('You are the last one up here. You cannot move anyone.', 24, 64, PAL.ink);
  text('You can look, listen, speak, and connect people.', 24, 74, PAL.ink);
  text('[Enter] play the night        [S] sandbox', 24, 96, PAL.mark);
  text('Headphones on. Rough draft: names, voices and lines are placeholders.', 24, H - 30, PAL.ink);
  text('Map data (c) OpenStreetMap contributors (ODbL). Numbers are estimates.', 24, H - 20, PAL.ink);
}

function endScreen() {
  ctx.fillStyle = css(PAL.space);
  ctx.fillRect(0, 0, W, H);
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  let alive = count(world.healthy), dead = count(world.infected), fallen = count(world.fallen);
  let y = 16;
  const line = (s: string, c: RGB = PAL.ink, dy = 10) => {
    text(s, 24, y, c);
    y += dy;
  };
  ctx.font = '16px monospace';
  line('DAWN. The station drifts away.', PAL.inkBright, 24);
  ctx.font = '8px monospace';
  line(`Living: ${Math.round(alive).toLocaleString('en-US')} of ${Math.round(startPop).toLocaleString('en-US')} (${Math.round((alive / startPop) * 100)}%)`, PAL.living);
  line(`Turned: ${Math.round(dead).toLocaleString('en-US')}    Fallen: ${Math.round(fallen).toLocaleString('en-US')}`, PAL.dead, 16);
  line('The people you talked to:', PAL.inkBright);
  for (const g of radio.groups) {
    if (g.kind === 'broadcast') continue;
    const fate = !g.known ? 'never heard from' : g.silent || g.status === 'overrun' ? g.fate || 'lost' : g.status === 'contact' ? 'still fighting at dawn' : 'alive at dawn';
    line(`  ${g.name.padEnd(20)} ${fate}`, g.kind === 'star' || g.kind === 'bus' ? PAL.mark : PAL.ink);
  }
  y += 6;
  const s = radio.stats;
  line(`Your calls: ${s.warnRight} warnings came true, ${s.warnWrong} were false alarms, ${s.refused} times they did not trust you.`);
  line(`Patches: ${s.patches}.  People moved because of you: ${Math.round(s.moved)}.`);
  y += 6;
  line('[Enter] play the night again    [Esc] menu', PAL.mark);
}

// ---------- main loop ----------
let lastFrame = performance.now();
function frame(now: number) {
  const realDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (mode === 'title') {
    titleScreen();
  } else if (mode === 'end') {
    endScreen();
  } else {
    simulate(realDt, now);
    render(now);
  }
  requestAnimationFrame(frame);
}

function simulate(realDt: number, now: number) {
  if (paused) return;
  const rate = mode === 'play' ? rateAt(t) : sandboxRate;
  const gameDt = realDt * rate;
  t += gameDt;
  acc += gameDt;
  let n = 0;
  while (acc >= TICK && n++ < 25) {
    cityStep();
    acc -= TICK;
  }
  if (acc > TICK) acc = 0;
  if (mode === 'play') {
    const open = inWindow(t);
    if (open && !wasWindow) say('', `Pass ${passIndex(t) + 1} of ${PASSES}: Minneapolis is coming over the horizon. ${passIndex(t) === 0 ? 'Scroll in to look.' : ''}`, 6);
    if (!open && wasWindow) {
      takePhoto();
      sound.hush();
      if (view === 'city') leaveCity();
      say('', `Lost line of sight. Next pass in ${fmt(realSeconds(t, t + untilWindow(t)))}. Press C next pass to compare with this photo.`, 6);
    }
    wasWindow = open;
    if (nightOver(t)) {
      sound.hush();
      sound.setStatic(0);
      mode = 'end';
      return;
    }
  }
  easeZoom();
  updateZone();
  if (street && view === 'city') {
    stepStreet(street, world, tick * 7919 + Math.floor(now), Math.min(0.3, gameDt), blocked);
    if (street.shots) sound.shot(Math.min(1, cam.z / 40) * Math.min(1, street.shots / 2));
  }
  if (view === 'city') updateSmoke(gameDt);
  // Radio: static, and voices when tuned in during a pass.
  const { group, signal } = tuned(radio);
  const up = radioUp();
  sound.setStatic(up ? 1 - signal * 0.8 : 0.35);
  if (up && group && signal > 0.75 && now > nextTalk) {
    const pass = mode === 'play' ? passIndex(t) : Math.min(5, Math.floor(tick / 60));
    talk(group, nextLine(radio, world, group, pass));
  }
}

function easeZoom() {
  if (Math.abs(cam.targetZ - cam.z) < 0.001) return;
  const ax = cam.x + cam.anchorSX / cam.z;
  const ay = cam.y + cam.anchorSY / cam.z;
  cam.z += (cam.targetZ - cam.z) * 0.2;
  cam.x = ax - cam.anchorSX / cam.z;
  cam.y = ay - cam.anchorSY / cam.z;
  clampCam();
}

function render(_now: number) {
  ctx.fillStyle = css(PAL.space);
  ctx.fillRect(0, 0, W, H);
  if (view === 'orbit') {
    drawOrbitView();
  } else {
    if (cam.z < DETAIL_Z) {
      rasterMap();
      ctx.putImageData(img, 0, 0, MX, MY, VIEW_W, VIEW_H);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(MX, MY, VIEW_W, VIEW_H);
    ctx.clip();
    if (cam.z >= DETAIL_Z) vectorGround();
    if (street) drawAgents(street);
    if (cam.z >= DETAIL_Z) drawBuildings();
    ctx.restore();
    finishMap();
    drawMarkers();
  }
  panel();
  drawHint();
  drawSubtitle();
  if (paused) text('PAUSED', MX + VIEW_W / 2 - 14, MY + 4, PAL.mark);
}

reset('play');
mode = 'title';
requestAnimationFrame(frame);

// For automatic checks (screenshots, tests): read state and jump around.
(window as unknown as { lastPass: object }).lastPass = {
  street: () => street,
  cam: () => cam,
  state: () => ({ mode, view, t: localTime(t), tick, inWindow: inWindow(t), thermal, freq: radio.freq }),
  start: (m: Mode) => reset(m),
  jump: (seconds: number) => {
    // Fast-forward the city (no street zone) to a game time.
    if (street) leaveCity();
    while (t < seconds) {
      t += TICK;
      cityStep();
    }
    wasWindow = inWindow(t);
  },
  look: (x: number, y: number, z: number) => {
    view = 'city';
    cam.z = cam.targetZ = z;
    cam.x = x - VIEW_W / z / 2;
    cam.y = y - VIEW_H / z / 2;
    clampCam();
  },
  key: (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k })),
  setFreq: (f: number) => (radio.freq = f),
  fires: () => fires,
  /** The cell where the living and the dead are most evenly matched (the front line). */
  front: () => {
    let best = 0, bi = 0;
    for (let i = 0; i < world.healthy.length; i++) {
      const v = Math.min(world.healthy[i], world.infected[i]);
      if (v > best) (best = v), (bi = i);
    }
    return { x: (bi % GW) + 0.5, y: Math.floor(bi / GW) + 0.5, v: best };
  },
};
