// Prototype 0: proves the pipeline (sim -> pixel renderer -> one HTML file).
// Placeholder map, NOT real Minneapolis yet. Click to start an outbreak anywhere. R resets.
import { createWorld, rng, step, count, World } from './sim/outbreak';

const W = 480; // internal resolution (pixels), upscaled with hard edges
const H = 270;
const CELL = 2; // each sim cell = 2x2 pixels
const GW = W / CELL;
const GH = (H - 12) / CELL; // leave a 12 px hint strip at the bottom

const canvas = document.getElementById('screen') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

// 4x4 Bayer matrix: ordered dithering, the "printed" pixel texture.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

const PAL = {
  space: [5, 6, 10],
  ground: [18, 20, 28],
  water: [10, 22, 44],
  living: [235, 228, 210],
  dead: [120, 230, 90],
  fallen: [110, 30, 30],
};

function placeholderCity(seed: number): World {
  const w = createWorld(GW, GH);
  const r = rng(seed);
  for (let y = 0; y < GH; y++) {
    // A winding river through the middle, with two bridges.
    const riverX = Math.round(GW * 0.55 + Math.sin(y / 9) * 8);
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const inRiver = Math.abs(x - riverX) <= 3;
      const bridge = y === Math.round(GH * 0.3) || y === Math.round(GH * 0.72);
      if (inRiver && !bridge) {
        w.land[i] = 0;
        continue;
      }
      // Dense downtown blob, suburbs fading out, a grid of streets.
      const dx = (x - GW * 0.4) / GW;
      const dy = (y - GH * 0.45) / GH;
      const density = Math.exp(-(dx * dx + dy * dy) * 9);
      const street = x % 6 === 0 || y % 6 === 0 ? 0.35 : 1;
      w.healthy[i] = Math.round(density * street * (60 + r() * 60));
    }
  }
  return w;
}

let world = placeholderCity(2009);
let tick = 0;
const startPop = count(world.healthy);

function seedOutbreak(cx: number, cy: number) {
  const i = cy * GW + cx;
  if (world.land[i]) world.infected[i] += 20;
}

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const cx = Math.floor((((e.clientX - rect.left) / rect.width) * W) / CELL);
  const cy = Math.floor((((e.clientY - rect.top) / rect.height) * H) / CELL);
  if (cy < GH) seedOutbreak(cx, cy);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') {
    world = placeholderCity(2009);
    tick = 0;
  }
});

const img = ctx.createImageData(W, H);

function put(px: number, py: number, c: number[]) {
  const o = (py * W + px) * 4;
  img.data[o] = c[0];
  img.data[o + 1] = c[1];
  img.data[o + 2] = c[2];
  img.data[o + 3] = 255;
}

function draw() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, PAL.space);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx;
      for (let sy = 0; sy < CELL; sy++) {
        for (let sx = 0; sx < CELL; sx++) {
          const px = gx * CELL + sx;
          const py = gy * CELL + sy;
          const t = BAYER[(py % 4) * 4 + (px % 4)];
          let c = world.land[i] ? PAL.ground : PAL.water;
          if (world.land[i]) {
            const h = Math.min(1, world.healthy[i] / 120);
            const z = Math.min(1, world.infected[i] / 40);
            const f = Math.min(1, world.fallen[i] / 60);
            if (z > t) c = PAL.dead;
            else if (h > t) c = PAL.living;
            else if (f > t * 2) c = PAL.fallen;
          }
          put(px, py, c);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#8a8f9c';
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  const alive = Math.round((count(world.healthy) / startPop) * 100);
  ctx.fillText(
    `LAST PASS  proto 0  |  click: start outbreak  R: reset  |  living ${alive}%  tick ${tick}  |  placeholder map`,
    4,
    H - 10,
  );
}

let last = 0;
function frame(now: number) {
  if (now - last > 90) {
    world = step(world);
    tick++;
    last = now;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
