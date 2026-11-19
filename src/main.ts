// Prototype 1: the outbreak on the real Twin Cities (OpenStreetMap data).
// Click the map to start an outbreak. R resets. Space pauses.
import mapFile from './data/minneapolis.json';
import { loadMap, MapFile } from './map/loadMap';
import { count, step, World } from './sim/outbreak';

const W = 480; // internal resolution, upscaled with hard pixel edges
const H = 270;
const MX = 4; // map position on screen (1 sim cell = 1 pixel)
const MY = 4;

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

function cloneWorld(w: World): World {
  return { ...w, healthy: w.healthy.slice(), infected: w.infected.slice(), fallen: w.fallen.slice() };
}

// 4x4 Bayer matrix for ordered dithering.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

type RGB = [number, number, number];
const PAL: Record<string, RGB> = {
  space: [6, 7, 12],
  ground: [16, 18, 26],
  built: [30, 32, 42],
  water: [9, 20, 42],
  minor: [38, 38, 44],
  major: [120, 70, 30], // sodium orange, dimmed
  living: [232, 226, 208],
  dead: [118, 226, 88],
  fallen: [120, 28, 28],
  ink: [140, 146, 160],
  inkBright: [210, 214, 222],
};

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * W) - MX;
  const y = Math.floor(((e.clientY - r.top) / r.height) * H) - MY;
  if (x < 0 || y < 0 || x >= GW || y >= GH) return;
  const i = y * GW + x;
  if (world.land[i]) world.infected[i] += 10;
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') {
    world = cloneWorld(city.world);
    tick = 0;
  }
  if (e.key === ' ') paused = !paused;
});

const img = ctx.createImageData(W, H);
function put(x: number, y: number, c: RGB) {
  const o = (y * W + x) * 4;
  img.data[o] = c[0];
  img.data[o + 1] = c[1];
  img.data[o + 2] = c[2];
  img.data[o + 3] = 255;
}

function draw() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, PAL.space);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const px = x + MX;
      const py = y + MY;
      const t = BAYER[(py % 4) * 4 + (px % 4)];
      let c: RGB;
      if (!world.land[i]) c = PAL.water;
      else {
        c = city.buildings[i] / 255 > t * 0.8 ? PAL.built : PAL.ground;
        if (city.roadMinor[i] && t < 0.5) c = PAL.minor;
        if (city.roadMajor[i]) c = PAL.major;
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
  ctx.putImageData(img, 0, 0);

  // Side panel (placeholder console).
  const sx = MX + GW + 8;
  const alive = count(world.healthy);
  const dead = count(world.infected);
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  const lines: [string, RGB][] = [
    ['LAST PASS', PAL.inkBright],
    ['prototype 1', PAL.ink],
    ['', PAL.ink],
    ['TWIN CITIES', PAL.inkBright],
    ['Minneapolis', PAL.ink],
    ['St Paul', PAL.ink],
    ['', PAL.ink],
    [`living  ${Math.round((alive / startPop) * 100)}%`, PAL.inkBright],
    [`${Math.round(alive).toLocaleString('en-US')}`, PAL.ink],
    [`turned  ${Math.round(dead).toLocaleString('en-US')}`, PAL.dead],
    [`tick    ${tick}${paused ? ' (paused)' : ''}`, PAL.ink],
    ['', PAL.ink],
    ['click: outbreak', PAL.ink],
    ['space: pause', PAL.ink],
    ['R: reset', PAL.ink],
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

let last = 0;
function frame(now: number) {
  if (!paused && now - last > 80) {
    world = step(world);
    tick++;
    last = now;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
