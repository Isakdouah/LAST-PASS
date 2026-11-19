// Prototype 2: city view + street view on the real Twin Cities (OpenStreetMap data).
// City: click = start an outbreak, scroll up (or Z) over a spot = zoom to street level.
// Street: individual people run from the dead. Scroll down (or Esc) = back to the city.
import mapFile from './data/minneapolis.json';
import { loadMap, MapFile } from './map/loadMap';
import { count, step, World } from './sim/outbreak';
import { Agent, enterStreet, Kind, leaveStreet, stepStreet, Street } from './sim/street';

const W = 480; // internal resolution, upscaled with hard pixel edges
const H = 270;
const MX = 4; // map area on screen
const MY = 4;
const VIEW_W = 360;
const VIEW_H = 260;
const ZOOM = 8; // street view: 1 map cell (about 80 m) = 8 pixels
const SW = VIEW_W / ZOOM; // street view size in cells
const SH = Math.floor(VIEW_H / ZOOM);

const canvas = document.getElementById('screen') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const city = loadMap(mapFile as unknown as MapFile);
const GW = city.width;
const GH = city.height;
let world: World = cloneWorld(city.world);
const startPop = count(world.healthy);
let tick = 0;
let paused = false;
let street: Street | null = null;
let hover = { x: GW / 2, y: GH / 2 };

function cloneWorld(w: World): World {
  return { ...w, road: w.road, healthy: w.healthy.slice(), infected: w.infected.slice(), fallen: w.fallen.slice() };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

type RGB = [number, number, number];
const PAL: Record<string, RGB> = {
  space: [6, 7, 12],
  ground: [16, 18, 26],
  built: [30, 32, 42],
  roof: [44, 46, 58],
  water: [9, 20, 42],
  minor: [38, 38, 44],
  major: [120, 70, 30],
  living: [232, 226, 208],
  scared: [255, 196, 120],
  dead: [118, 226, 88],
  fallen: [120, 28, 28],
  ink: [140, 146, 160],
  inkBright: [210, 214, 222],
};

/** Mouse position in map cells (both views use map-cell coordinates). */
function mouseCell(e: MouseEvent) {
  const r = canvas.getBoundingClientRect();
  const sx = ((e.clientX - r.left) / r.width) * W - MX;
  const sy = ((e.clientY - r.top) / r.height) * H - MY;
  if (sx < 0 || sy < 0 || sx >= VIEW_W || sy >= VIEW_H) return null;
  if (street) return { x: street.x0 + sx / ZOOM, y: street.y0 + sy / ZOOM };
  return { x: sx, y: sy };
}

function zoomIn(cx: number, cy: number) {
  if (street) return;
  const x0 = Math.max(0, Math.min(GW - SW, Math.round(cx - SW / 2)));
  const y0 = Math.max(0, Math.min(GH - SH, Math.round(cy - SH / 2)));
  street = enterStreet(world, x0, y0, SW, SH, 3000, tick + 1);
  // The people in this area now live as individuals; clear their city numbers.
  for (let y = y0; y < y0 + SH; y++)
    for (let x = x0; x < x0 + SW; x++) {
      world.healthy[y * GW + x] = 0;
      world.infected[y * GW + x] = 0;
    }
}

function zoomOut() {
  if (!street) return;
  leaveStreet(street, world);
  street = null;
}

canvas.addEventListener('mousemove', (e) => {
  const c = mouseCell(e);
  if (c && !street) hover = c;
});
canvas.addEventListener('click', (e) => {
  const c = mouseCell(e);
  if (!c) return;
  if (street) {
    for (let k = 0; k < 5; k++)
      street.agents.push({ x: c.x + Math.random() * 0.3, y: c.y + Math.random() * 0.3, vx: 0, vy: 0, kind: Kind.Dead, fear: 0 });
  } else {
    const i = Math.floor(c.y) * GW + Math.floor(c.x);
    if (world.land[i]) world.infected[i] += 10;
  }
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const c = mouseCell(e);
    if (e.deltaY < 0 && c) zoomIn(c.x, c.y);
    if (e.deltaY > 0) zoomOut();
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') {
    street = null;
    world = cloneWorld(city.world);
    tick = 0;
  }
  if (e.key === ' ') paused = !paused;
  if (e.key === 'z' || e.key === 'Z') {
    if (street) zoomOut();
    else zoomIn(hover.x, hover.y);
  }
  if (e.key === 'Escape') zoomOut();
});

const img = ctx.createImageData(W, H);
function put(x: number, y: number, c: RGB) {
  const o = (y * W + x) * 4;
  img.data[o] = c[0];
  img.data[o + 1] = c[1];
  img.data[o + 2] = c[2];
  img.data[o + 3] = 255;
}

function groundColor(i: number, t: number): RGB {
  if (!world.land[i]) return PAL.water;
  let c = city.buildings[i] / 255 > t * 0.8 ? PAL.built : PAL.ground;
  if (city.roadMinor[i] && t < 0.5) c = PAL.minor;
  if (city.roadMajor[i]) c = PAL.major;
  return c;
}

function drawCity() {
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const px = x + MX;
      const py = y + MY;
      const t = BAYER[(py % 4) * 4 + (px % 4)];
      let c = groundColor(i, t);
      if (world.land[i]) {
        const z = Math.min(1, world.infected[i] / 10);
        const h = Math.min(0.75, world.healthy[i] / 28);
        const f = Math.min(1, world.fallen[i] / 10);
        if (z > t) c = PAL.dead;
        else if (h > t) c = PAL.living;
        else if (f > t) c = PAL.fallen;
      }
      put(px, py, c);
    }
  }
  // Outline of the street view you would zoom into.
  const x0 = Math.max(0, Math.min(GW - SW, Math.round(hover.x - SW / 2)));
  const y0 = Math.max(0, Math.min(GH - SH, Math.round(hover.y - SH / 2)));
  for (let x = 0; x < SW; x++) {
    put(MX + x0 + x, MY + y0, PAL.inkBright);
    put(MX + x0 + x, MY + y0 + SH - 1, PAL.inkBright);
  }
  for (let y = 0; y < SH; y++) {
    put(MX + x0, MY + y0 + y, PAL.inkBright);
    put(MX + x0 + SW - 1, MY + y0 + y, PAL.inkBright);
  }
}

function drawStreet(s: Street) {
  for (let py = 0; py < SH * ZOOM; py++) {
    for (let px = 0; px < VIEW_W; px++) {
      const cx = s.x0 + Math.floor(px / ZOOM);
      const cy = s.y0 + Math.floor(py / ZOOM);
      const i = cy * GW + cx;
      const t = BAYER[(py % 4) * 4 + (px % 4)];
      let c: RGB = PAL.ground;
      if (!world.land[i]) c = PAL.water;
      else {
        // Inside a cell: buildings as blocks, roads as lines through the middle.
        const lx = px % ZOOM;
        const ly = py % ZOOM;
        const b = city.buildings[i] / 255;
        if (b > 0.15 && lx > 1 && ly > 1 && lx < 7 && ly < 7 && b > t * 0.6) c = PAL.roof;
        if (city.roadMinor[i] && (lx === 4 || ly === 4)) c = PAL.minor;
        if (city.roadMajor[i] && ((lx >= 3 && lx <= 5) || (ly >= 3 && ly <= 5))) c = PAL.major;
      }
      put(px + MX, py + MY, c);
    }
  }
  const dot = (a: Agent, c: RGB) => {
    const px = Math.floor((a.x - s.x0) * ZOOM);
    const py = Math.floor((a.y - s.y0) * ZOOM);
    if (px >= 0 && py >= 0 && px < VIEW_W && py < SH * ZOOM) put(px + MX, py + MY, c);
  };
  for (const a of s.agents) if (a.kind === Kind.Fallen) dot(a, PAL.fallen);
  for (const a of s.agents) if (a.kind === Kind.Living) dot(a, a.fear > 0.3 ? PAL.scared : PAL.living);
  for (const a of s.agents) if (a.kind === Kind.Dead) dot(a, PAL.dead);
}

function panel() {
  const sx = MX + VIEW_W + 8;
  let alive = count(world.healthy);
  let dead = count(world.infected);
  if (street) {
    for (const a of street.agents) {
      if (a.kind === Kind.Living) alive += street.scale;
      if (a.kind === Kind.Dead) dead += street.scale;
    }
  }
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  const lines: [string, RGB][] = [
    ['LAST PASS', PAL.inkBright],
    ['prototype 2', PAL.ink],
    ['', PAL.ink],
    [street ? 'STREET LEVEL' : 'TWIN CITIES', PAL.inkBright],
    [street ? `1 dot = ${street.scale.toFixed(0)} people` : 'Minneapolis + St Paul', PAL.ink],
    ['', PAL.ink],
    [`living  ${Math.round((alive / startPop) * 100)}%`, PAL.inkBright],
    [`${Math.round(alive).toLocaleString('en-US')}`, PAL.ink],
    [`turned  ${Math.round(dead).toLocaleString('en-US')}`, PAL.dead],
    [`tick    ${tick}${paused ? ' (paused)' : ''}`, PAL.ink],
    ['', PAL.ink],
    ['click: outbreak', PAL.ink],
    [street ? 'scroll down: city' : 'scroll up: street', PAL.ink],
    ['Z: zoom  Esc: out', PAL.ink],
    ['space: pause  R: reset', PAL.ink],
  ];
  lines.forEach(([s, c], k) => {
    ctx.fillStyle = `rgb(${c.join(',')})`;
    ctx.fillText(s, sx, MY + k * 10);
  });
  ctx.fillStyle = `rgb(${PAL.ink.join(',')})`;
  ctx.fillText('map data', sx, MY + 200);
  ctx.fillText('(c) OpenStreetMap', sx, MY + 210);
  ctx.fillText('contributors', sx, MY + 220);
  ctx.fillText('people: estimate', sx, MY + 236);
}

function draw() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, PAL.space);
  if (street) drawStreet(street);
  else drawCity();
  ctx.putImageData(img, 0, 0);
  panel();
}

let last = 0;
function frame(now: number) {
  if (!paused) {
    if (now - last > 80) {
      world = step(world);
      tick++;
      last = now;
      if (street) {
        // The dead flowing in from outside the view become individuals where they arrive.
        const s = street;
        for (let y = s.y0; y < s.y0 + s.h; y++)
          for (let x = s.x0; x < s.x0 + s.w; x++) {
            const i = y * GW + x;
            let k = Math.floor(world.infected[i] / s.scale + Math.random());
            while (k-- > 0) s.agents.push({ x: x + Math.random(), y: y + Math.random(), vx: 0, vy: 0, kind: Kind.Dead, fear: 0 });
            world.infected[i] = 0;
          }
      }
    }
    if (street) stepStreet(street, world, tick * 7919 + Math.floor(now));
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
