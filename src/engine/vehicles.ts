// Vehicles, built from boxes in code, to one shared size contract (real 2009 sizes in metres),
// so a bus, a pickup and a person always sit right next to each other. People are drawn 2x
// life size so you can read them from orbit (FIG in city.ts); vehicles are drawn 1.5x so they
// still look bigger than the people beside them.
import * as THREE from 'three';

/** The size contract: length, width, height in metres (real-world, before drawing scale). */
export const SIZE = {
  person: { l: 0.4, w: 0.5, h: 1.75 },
  car: { l: 4.5, w: 1.75, h: 1.45 }, // a 2009 family sedan
  pickup: { l: 4.9, w: 1.75, h: 1.7 }, // a 1997 compact pickup
  bus: { l: 12.2, w: 2.6, h: 3.1 }, // a 40-foot city bus
  ambulance: { l: 6.4, w: 2.4, h: 2.8 }, // a box ambulance
};
export const VEHICLE_SCALE = 1.5;
export type VKind = 'car' | 'pickup' | 'bus' | 'ambulance';

const glass = 0x10141c;
/** Box with simple top light baked into vertex colours (top bright, sides darker, bottom dark). */
export function box(w: number, h: number, l: number, x: number, y: number, z: number, col: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(x, y, z);
  const n = g.attributes.normal as THREE.BufferAttribute;
  const c = new Float32Array(n.count * 3);
  const base = new THREE.Color(col);
  for (let i = 0; i < n.count; i++) {
    const k = n.getY(i) > 0.5 ? 1.0 : n.getY(i) < -0.5 ? 0.3 : 0.62 + 0.1 * n.getX(i) + 0.06 * n.getZ(i);
    c.set([base.r * k, base.g * k, base.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const P: number[] = [], C: number[] = [], I: number[] = [];
  for (const g of list) {
    const base = P.length / 3;
    const p = g.attributes.position as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) P.push(p.getX(i), p.getY(i), p.getZ(i)), C.push(c.getX(i), c.getY(i), c.getZ(i));
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) I.push(base + idx.getX(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  out.setIndex(I);
  return out;
}

/** Body styles of an ordinary car (same footprint, so the size contract and collisions hold):
 *  0 sedan, 1 hatchback, 2 station wagon, 3 SUV, 4 minivan. All common on a 2009 street. */
export const CAR_STYLES = 5;
const trimC = 0x26262a, lampC = 0xcfcab4, tailC = 0x5a1210, hubC = 0x8a8a88;

/** Lights, bumpers, grille, mirrors: what makes a box read as a car. `y` = light height. */
function carDetails(parts: THREE.BufferGeometry[], w: number, l: number, y: number, mirrorZ: number, mirrorY: number, col: number) {
  for (const z of [l / 2 - 0.06, -l / 2 + 0.06]) parts.push(box(w + 0.04, 0.18, 0.14, 0, 0.36, z, trimC)); // bumpers
  for (const sx of [-1, 1]) {
    parts.push(box(0.34, 0.14, 0.04, sx * (w / 2 - 0.3), y, l / 2 + 0.01, lampC)); // headlight
    parts.push(box(0.28, 0.16, 0.04, sx * (w / 2 - 0.24), y + 0.02, -l / 2 - 0.01, tailC)); // taillight
    parts.push(box(0.07, 0.09, 0.14, sx * (w / 2 + 0.03), mirrorY, mirrorZ, col)); // mirror
  }
  parts.push(box(0.56, 0.14, 0.04, 0, y - 0.04, l / 2 + 0.01, 0x18181c)); // grille
  parts.push(box(0.34, 0.1, 0.03, 0, 0.36, -l / 2 - 0.02, 0xd8d8c8)); // number plate
}

/** A cabin from z0 (front) to z1 (back), roof at `top`, with glass all round and pillars. */
function cabin(parts: THREE.BufferGeometry[], w: number, y0: number, top: number, z0: number, z1: number, col: number, pillars: number) {
  const L = z0 - z1, mid = (z0 + z1) / 2, H = top - y0;
  parts.push(box(w, H, L, 0, y0 + H / 2, mid, col)); // shell
  parts.push(box(w + 0.02, H * 0.62, L * 0.92, 0, y0 + H * 0.45, mid, glass)); // side glass band
  parts.push(box(w - 0.1, H * 0.62, 0.04, 0, y0 + H * 0.45, z0 + 0.01, glass)); // windscreen
  parts.push(box(w - 0.1, H * 0.55, 0.04, 0, y0 + H * 0.45, z1 - 0.01, glass)); // back glass
  for (let i = 1; i <= pillars; i++) parts.push(box(w + 0.04, H * 0.64, 0.08, 0, y0 + H * 0.45, z0 - (L * i) / (pillars + 1), col));
}

/** One vehicle geometry, facing +z, wheels on y = 0, in real metres (scale it by VEHICLE_SCALE). */
export function vehicleGeometry(kind: VKind, col: number, style = 0): THREE.BufferGeometry {
  const s = SIZE[kind];
  const parts: THREE.BufferGeometry[] = [];
  const wheels = (front: number, back: number, r = 0.3) => {
    for (const z of [front, back])
      for (const sx of [-1, 1]) {
        parts.push(box(0.22, r * 2, r * 2, sx * (s.w / 2 - 0.1), r, z, 0x14141a));
        parts.push(box(0.03, r, r, sx * (s.w / 2 + 0.01), r, z, hubC));
      }
  };
  if (kind === 'car') {
    const w = s.w, l = s.l;
    if (style === 3) {
      // SUV: tall body and a long boxy cabin.
      parts.push(box(w, 0.8, l, 0, 0.62, 0, col));
      cabin(parts, w - 0.12, 1.02, 1.72, l * 0.2, -l / 2 + 0.12, col, 2);
      parts.push(box(w - 0.3, 0.06, l * 0.5, 0, 1.75, -0.4, trimC)); // roof rails
      carDetails(parts, w, l, 0.82, l * 0.2 - 0.1, 1.1, col);
      wheels(l * 0.32, -l * 0.31, 0.36);
    } else if (style === 4) {
      // Minivan: one long box with a short sloping nose.
      parts.push(box(w, 0.65, l, 0, 0.55, 0, col));
      cabin(parts, w - 0.08, 0.88, 1.68, l * 0.3, -l / 2 + 0.06, col, 2);
      carDetails(parts, w, l, 0.72, l * 0.3 - 0.1, 1.0, col);
      wheels(l * 0.33, -l * 0.33);
    } else {
      parts.push(box(w, 0.66, l, 0, 0.53, 0, col)); // body
      // Sedan: cabin in the middle; hatchback: to the back; wagon: long, to the back.
      const z0 = style === 1 ? l * 0.14 : style === 2 ? l * 0.13 : l * 0.12;
      const z1 = style === 1 ? -l / 2 + 0.2 : style === 2 ? -l / 2 + 0.08 : -l * 0.32;
      cabin(parts, w - 0.18, 0.86, 1.42, z0, z1, col, style === 2 ? 2 : 1);
      carDetails(parts, w, l, 0.68, z0 - 0.1, 0.98, col);
      wheels(l * 0.32, -l * 0.32);
    }
  } else if (kind === 'pickup') {
    parts.push(box(s.w, 0.75, s.l, 0, 0.6, 0, col)); // body
    cabin(parts, s.w - 0.1, 0.98, 1.68, 1.3, -0.2, col, 0);
    parts.push(box(s.w - 0.3, 0.35, 2.0, 0, 0.9, -1.35, 0x1a1a1e)); // the empty bed
    carDetails(parts, s.w, s.l, 0.74, 1.2, 1.1, col);
    wheels(s.l * 0.32, -s.l * 0.3, 0.34);
  } else if (kind === 'bus') {
    parts.push(box(s.w, s.h - 0.4, s.l, 0, 0.4 + (s.h - 0.4) / 2, 0, col));
    parts.push(box(s.w + 0.02, 0.9, s.l - 1.2, 0, 2.05, -0.3, glass)); // window band
    parts.push(box(s.w - 0.1, 1.2, 0.08, 0, 1.9, s.l / 2, glass)); // windscreen
    parts.push(box(s.w - 0.6, 0.25, 0.1, 0, 2.78, s.l / 2 + 0.02, 0xf0c83c)); // route sign
    parts.push(box(s.w * 0.6, 0.3, 2.2, 0, s.h + 0.15, -1, 0x9a9a96)); // roof unit
    wheels(s.l * 0.3, -s.l * 0.22);
  } else {
    parts.push(box(s.w - 0.2, 1.3, 2.2, 0, 1.0, s.l / 2 - 1.1, col)); // cab
    parts.push(box(s.w, s.h - 0.35, s.l - 2.0, 0, 0.35 + (s.h - 0.35) / 2, -1.0, col)); // box
    parts.push(box(s.w + 0.02, 0.3, s.l - 2.2, 0, 1.6, -1.0, 0xc82a20)); // red stripe
    parts.push(box(s.w - 0.4, 0.5, 0.08, 0, 1.4, s.l / 2, glass)); // windscreen
    parts.push(box(1.0, 0.2, 0.3, 0, s.h + 0.1, 0.4, 0xe23a1e)); // light bar
    wheels(s.l * 0.33, -s.l * 0.3);
  }
  return merge(parts);
}

/** Lit head- and taillights for a car on the move (drawn unlit on top of the body's own). */
export function carLightsGeometry(): THREE.BufferGeometry {
  const s = SIZE.car, parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(box(0.36, 0.16, 0.05, sx * (s.w / 2 - 0.3), 0.7, s.l / 2 + 0.03, 0xfff6dc));
    parts.push(box(0.3, 0.18, 0.05, sx * (s.w / 2 - 0.24), 0.72, -s.l / 2 - 0.03, 0xff2a18));
  }
  const g = merge(parts);
  // Unlit: every face full brightness.
  const c = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) {
    const m = Math.max(c.getX(i), c.getY(i), c.getZ(i)) || 1;
    c.setXYZ(i, c.getX(i) / m, c.getY(i) / m, c.getZ(i) / m);
  }
  return g;
}

/** A colour set for parked cars: muted 2009 paint under sodium light. */
export const CAR_COLOURS = [0x6a6e74, 0x2c3440, 0x8a1e1e, 0xb4b2aa, 0x2a3a2a, 0x1c1c22, 0x54402e, 0x3a4a6a, 0x9a9690];
