// Prototype 3: smooth zoom from the whole Twin Cities down to the street, drag to follow
// the spread, and people who fight back (guns, police stations, groups making a stand).
// Click = start an outbreak. Scroll = zoom (toward the cursor). Drag = move the map.
import mapFile from './data/minneapolis.json';
import { loadMap, MapFile, Place } from './map/loadMap';
import { count, step, World } from './sim/outbreak';
import { Agent, enterStreet, Kind, leaveStreet, newAgent, stepStreet, Street } from './sim/street';

const W = 480; // internal resolution, upscaled with hard pixel edges
const H = 270;
const MX = 4; // map view position and size on screen
const MY = 4;
const VIEW_W = 360;
const VIEW_H = 260;
const MIN_Z = 1; // pixels per map cell: 1 = whole map visible
const MAX_Z = 14;
const AGENT_Z = 3; // from this zoom on, people are simulated one by one
const MAX_AGENTS = 3500;

const canvas = document.getElementById('screen') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const city = loadMap(mapFile as unknown as MapFile);
const GW = city.width;
const GH = city.height;
// Real size of one cell, from the map's bounding box (degrees to km at this latitude).
const [west, south, east, north] = (mapFile as unknown as MapFile).bbox;
const KM_PER_CELL = ((east - west) * 111.32 * Math.cos((((south + north) / 2) * Math.PI) / 180)) / GW;

let world: World = cloneWorld(city.world);
const startPop = count(world.healthy);
let tick = 0;
let paused = false;
let street: Street | null = null;

// Camera: top-left corner in map cells, zoom in pixels per cell (eased toward a target).
const cam = { x: 0, y: 0, z: MIN_Z, targetZ: MIN_Z, anchorSX: VIEW_W / 2, anchorSY: VIEW_H / 2 };

function cloneWorld(w: World): World {
  return {
    ...w,
    healthy: w.healthy.slice(),
    infected: w.infected.slice(),
    fallen: w.fallen.slice(),
    armed: w.armed.slice(),
    ammo: w.ammo.slice(),
  };
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
  armed: [120, 180, 255],
  flash: [255, 240, 140],
  dead: [118, 226, 88],
  fallen: [120, 28, 28],
  police: [70, 120, 255],
  fire: [230, 60, 40],
  hospital: [240, 240, 240],
  ink: [140, 146, 160],
  inkBright: [210, 214, 222],
};

// ---------- camera ----------
function clampCam() {
  const vw = VIEW_W / cam.z;
  const vh = VIEW_H / cam.z;
  cam.x = vw >= GW ? (GW - vw) / 2 : Math.max(0, Math.min(GW - vw, cam.x));
  cam.y = vh >= GH ? (GH - vh) / 2 : Math.max(0, Math.min(GH - vh, cam.y));
}

function screenToView(e: MouseEvent) {
  const r = canvas.getBoundingClientRect();
  return { sx: ((e.clientX - r.left) / r.width) * W - MX, sy: ((e.clientY - r.top) / r.height) * H - MY };
}

function inView(sx: number, sy: number) {
  return sx >= 0 && sy >= 0 && sx < VIEW_W && sy < VIEW_H;
}

let drag: { sx: number; sy: number; moved: boolean } | null = null;
canvas.addEventListener('mousedown', (e) => {
  const v = screenToView(e);
  if (inView(v.sx, v.sy)) drag = { ...v, moved: false };
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const v = screenToView(e);
  const dx = v.sx - drag.sx;
  const dy = v.sy - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 2) return;
  drag.moved = true;
  cam.x -= dx / cam.z;
  cam.y -= dy / cam.z;
  drag.sx = v.sx;
  drag.sy = v.sy;
  clampCam();
});
window.addEventListener('mouseup', (e) => {
  if (drag && !drag.moved) startOutbreak(screenToView(e));
  drag = null;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const v = screenToView(e);
    if (!inView(v.sx, v.sy)) return;
    cam.anchorSX = v.sx;
    cam.anchorSY = v.sy;
    const factor = Math.exp(-e.deltaY * 0.0025);
    cam.targetZ = Math.max(MIN_Z, Math.min(MAX_Z, cam.targetZ * factor));
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
  if (e.key === '+' || e.key === '=') cam.targetZ = Math.min(MAX_Z, cam.targetZ * 1.5);
  if (e.key === '-') cam.targetZ = Math.max(MIN_Z, cam.targetZ / 1.5);
});

function startOutbreak(v: { sx: number; sy: number }) {
  if (!inView(v.sx, v.sy)) return;
  const x = cam.x + v.sx / cam.z;
  const y = cam.y + v.sy / cam.z;
  if (street && x >= street.x0 && y >= street.y0 && x < street.x0 + street.w && y < street.y0 + street.h) {
    for (let k = 0; k < 5; k++) street.agents.push(newAgent(x + Math.random() * 0.3, y + Math.random() * 0.3, Kind.Dead));
  } else {
    const i = Math.floor(y) * GW + Math.floor(x);
    if (world.land[i]) world.infected[i] += 25; // smaller outbreaks are often put down by the block
  }
}

function easeZoom() {
  if (Math.abs(cam.targetZ - cam.z) < 0.001) return;
  // Keep the map point under the cursor fixed while zooming.
  const ax = cam.x + cam.anchorSX / cam.z;
  const ay = cam.y + cam.anchorSY / cam.z;
  cam.z += (cam.targetZ - cam.z) * 0.2;
  cam.x = ax - cam.anchorSX / cam.z;
  cam.y = ay - cam.anchorSY / cam.z;
  clampCam();
}

// ---------- street zone: individuals near the camera ----------
function updateZone() {
  if (cam.z < AGENT_Z) {
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
    street.w * street.h < vw * vh * 4;
  if (fits) return;
  if (street) leaveStreet(street, world);
  const mx = Math.ceil(vw * 0.3);
  const my = Math.ceil(vh * 0.3);
  const x0 = Math.max(0, Math.floor(cam.x) - mx);
  const y0 = Math.max(0, Math.floor(cam.y) - my);
  const x1 = Math.min(GW, Math.ceil(cam.x + vw) + mx);
  const y1 = Math.min(GH, Math.ceil(cam.y + vh) + my);
  street = enterStreet(world, x0, y0, x1 - x0, y1 - y0, MAX_AGENTS, tick + 1);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * GW + x;
      world.healthy[i] = 0;
      world.infected[i] = 0;
      world.armed[i] = 0;
      world.ammo[i] = 0;
    }
}

// ---------- drawing ----------
const img = ctx.createImageData(W, H);
function put(x: number, y: number, c: RGB) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  img.data[o] = c[0];
  img.data[o + 1] = c[1];
  img.data[o + 2] = c[2];
  img.data[o + 3] = 255;
}

function drawMap() {
  const z = cam.z;
  const detail = z >= 4;
  for (let py = 0; py < VIEW_H; py++) {
    const fy = cam.y + py / z;
    const cy = Math.floor(fy);
    for (let px = 0; px < VIEW_W; px++) {
      const fx = cam.x + px / z;
      const cx = Math.floor(fx);
      const sx = px + MX;
      const sy = py + MY;
      if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) {
        put(sx, sy, PAL.space);
        continue;
      }
      const i = cy * GW + cx;
      const t = BAYER[(sy % 4) * 4 + (sx % 4)];
      let c: RGB;
      if (!world.land[i]) c = PAL.water;
      else if (detail) {
        // Inside a cell: buildings as blocks, roads as lines through the middle.
        const lx = fx - cx;
        const ly = fy - cy;
        const b = city.buildings[i] / 255;
        c = PAL.ground;
        if (b > 0.15 && lx > 0.15 && ly > 0.15 && lx < 0.85 && ly < 0.85 && b > t * 0.6) c = PAL.roof;
        // Roads: a centre spot plus an arm toward each neighbouring road cell, so streets connect.
        const rk = city.roadMajor[i] ? 2 : city.roadMinor[i] ? 1 : 0;
        if (rk) {
          const w = rk === 2 ? 0.2 : Math.max(0.5 / z, 0.07);
          const onX = Math.abs(ly - 0.5) < w; // on a horizontal line through the middle
          const onY = Math.abs(lx - 0.5) < w;
          const road = (j: number) => city.roadMajor[j] || city.roadMinor[j];
          const nb = [i - 1, i + 1, i - GW, i + GW].filter((j) => j >= 0 && j < GW * GH && road(j)).length;
          let hit = (onX && onY) || (rk === 2 && nb >= 3); // inside a wide road band: fill the whole cell
          if (onX && lx < 0.5 && cx > 0 && road(i - 1)) hit = true;
          if (onX && lx >= 0.5 && cx < GW - 1 && road(i + 1)) hit = true;
          if (onY && ly < 0.5 && cy > 0 && road(i - GW)) hit = true;
          if (onY && ly >= 0.5 && cy < GH - 1 && road(i + GW)) hit = true;
          if (hit) c = rk === 2 ? PAL.major : PAL.minor;
        }
      } else {
        c = city.buildings[i] / 255 > t * 0.8 ? PAL.built : PAL.ground;
        if (city.roadMinor[i] && t < 0.5) c = PAL.minor;
        if (city.roadMajor[i]) c = PAL.major;
      }
      // Crowds from the city numbers (outside the street zone, or when zoomed out).
      if (world.land[i]) {
        const per = z * z; // pixels per cell: spread the dots out when zoomed in
        const zz = Math.min(1, (world.infected[i] / 10) * Math.min(1, 4 / per));
        const hh = Math.min(0.75, (world.healthy[i] / 28) * Math.min(1, 4 / per));
        const ff = Math.min(1, (world.fallen[i] / 10) * Math.min(1, 4 / per));
        if (zz > t) c = PAL.dead;
        else if (hh > t) c = world.armed[i] > world.healthy[i] * 0.5 ? PAL.armed : PAL.living;
        else if (ff > t) c = PAL.fallen;
      }
      put(sx, sy, c);
    }
  }
}

function drawAgents(s: Street) {
  const size = cam.z >= 9 ? 2 : 1;
  const dot = (a: Agent, c: RGB) => {
    const px = Math.floor((a.x - cam.x) * cam.z);
    const py = Math.floor((a.y - cam.y) * cam.z);
    if (px < 0 || py < 0 || px >= VIEW_W || py >= VIEW_H) return;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) put(px + MX + dx, py + MY + dy, c);
    if (a.flash > 0) put(px + MX + size, py + MY - 1, PAL.flash);
  };
  for (const a of s.agents) if (a.kind === Kind.Fallen) dot(a, PAL.fallen);
  for (const a of s.agents)
    if (a.kind === Kind.Living) dot(a, a.ammo > 0 ? PAL.armed : a.fear > 0.3 ? PAL.scared : PAL.living);
  for (const a of s.agents) if (a.kind === Kind.Dead) dot(a, PAL.dead);
}

function drawPlaces(places: Place[]) {
  for (const p of places) {
    const px = Math.floor((p.x + 0.5 - cam.x) * cam.z) + MX;
    const py = Math.floor((p.y + 0.5 - cam.y) * cam.z) + MY;
    if (px < MX || py < MY || px >= MX + VIEW_W || py >= MY + VIEW_H) continue;
    const c = PAL[p.kind];
    if (p.kind === 'hospital') {
      for (let k = -2; k <= 2; k++) {
        put(px + k, py, c);
        put(px, py + k, c);
      }
    } else {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(px + dx, py + dy, c);
    }
  }
}

function panel() {
  const sx = MX + VIEW_W + 8;
  let alive = count(world.healthy);
  let dead = count(world.infected);
  let armed = count(world.armed);
  let ammo = count(world.ammo);
  if (street) {
    for (const a of street.agents) {
      if (a.kind === Kind.Living) alive += street.scale;
      if (a.kind === Kind.Dead) dead += street.scale;
      if (a.kind === Kind.Living && a.ammo > 0) {
        armed += street.scale;
        ammo += a.ammo * street.scale;
      }
    }
  }
  const viewKm = (VIEW_W / cam.z) * KM_PER_CELL;
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  const lines: [string, RGB][] = [
    ['LAST PASS', PAL.inkBright],
    ['prototype 3', PAL.ink],
    ['', PAL.ink],
    ['TWIN CITIES', PAL.inkBright],
    [`view ${viewKm < 10 ? viewKm.toFixed(1) : viewKm.toFixed(0)} km wide`, PAL.ink],
    [street ? `1 dot = ${street.scale.toFixed(0)} people` : 'crowds (estimate)', PAL.ink],
    ['', PAL.ink],
    [`living  ${Math.round((alive / startPop) * 100)}%`, PAL.inkBright],
    [`${Math.round(alive).toLocaleString('en-US')}`, PAL.ink],
    [`turned  ${Math.round(dead).toLocaleString('en-US')}`, PAL.dead],
    [`armed   ${Math.round(armed).toLocaleString('en-US')}`, PAL.armed],
    [`rounds  ${Math.round(ammo / 1000).toLocaleString('en-US')}k`, PAL.armed],
    [`tick    ${tick}${paused ? ' (paused)' : ''}`, PAL.ink],
    ['', PAL.ink],
    ['click: outbreak', PAL.ink],
    ['scroll: zoom', PAL.ink],
    ['drag: move map', PAL.ink],
    ['space: pause  R: reset', PAL.ink],
  ];
  lines.forEach(([s, c], k) => {
    ctx.fillStyle = `rgb(${c.join(',')})`;
    ctx.fillText(s, sx, MY + k * 10);
  });
  const legend: [string, RGB][] = [
    ['police', PAL.police],
    ['fire station', PAL.fire],
    ['hospital', PAL.hospital],
  ];
  legend.forEach(([s, c], k) => {
    ctx.fillStyle = `rgb(${c.join(',')})`;
    ctx.fillRect(sx, MY + 193 + k * 10, 5, 5);
    ctx.fillStyle = `rgb(${PAL.ink.join(',')})`;
    ctx.fillText(s, sx + 9, MY + 191 + k * 10);
  });
  ctx.fillText('map (c) OpenStreetMap', sx, MY + 228);
  ctx.fillText('contributors', sx, MY + 238);
  ctx.fillText('numbers are estimates', sx, MY + 251);
}

function draw() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, PAL.space);
  drawMap();
  if (street) drawAgents(street);
  drawPlaces(city.places);
  ctx.putImageData(img, 0, 0);
  panel();
}

// ---------- main loop ----------
let last = 0;
function frame(now: number) {
  easeZoom();
  updateZone();
  if (!paused) {
    if (now - last > 80) {
      world = step(world);
      tick++;
      last = now;
      if (street) {
        // The dead flowing in from outside the zone become individuals where they arrive.
        const s = street;
        for (let y = s.y0; y < s.y0 + s.h; y++)
          for (let x = s.x0; x < s.x0 + s.w; x++) {
            const i = y * GW + x;
            let k = Math.floor(world.infected[i] / s.scale + Math.random());
            while (k-- > 0) s.agents.push(newAgent(x + Math.random(), y + Math.random(), Kind.Dead));
            world.infected[i] = 0;
          }
      }
    }
    if (street) stepStreet(street, world, tick * 7919 + Math.floor(now));
  }
  draw();
  requestAnimationFrame(frame);
}
clampCam();
requestAnimationFrame(frame);

// For automatic screenshot checks: lets a test script read the current state.
(window as unknown as { lastPass: object }).lastPass = { street: () => street, cam: () => cam };
