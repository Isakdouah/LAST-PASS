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
function box(w: number, h: number, l: number, x: number, y: number, z: number, col: number): THREE.BufferGeometry {
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

/** One vehicle geometry, facing +z, wheels on y = 0, in real metres (scale it by VEHICLE_SCALE). */
export function vehicleGeometry(kind: VKind, col: number): THREE.BufferGeometry {
  const s = SIZE[kind];
  const parts: THREE.BufferGeometry[] = [];
  const wheels = (front: number, back: number) => {
    for (const z of [front, back]) for (const x of [-s.w / 2 + 0.1, s.w / 2 - 0.1]) parts.push(box(0.22, 0.6, 0.6, x, 0.3, z, 0x14141a));
  };
  if (kind === 'car') {
    parts.push(box(s.w, 0.7, s.l, 0, 0.55, 0, col)); // body
    parts.push(box(s.w - 0.2, 0.55, s.l * 0.5, 0, 1.17, -0.15, col)); // cabin
    parts.push(box(s.w - 0.16, 0.42, s.l * 0.08, 0, 1.12, s.l * 0.12, glass)); // windscreen
    parts.push(box(s.w - 0.16, 0.42, s.l * 0.06, 0, 1.12, -s.l * 0.41, glass)); // rear window
    wheels(s.l * 0.32, -s.l * 0.32);
  } else if (kind === 'pickup') {
    parts.push(box(s.w, 0.75, s.l, 0, 0.6, 0, col)); // body
    parts.push(box(s.w - 0.1, 0.7, 1.5, 0, 1.33, 0.55, col)); // cab
    parts.push(box(s.w - 0.14, 0.5, 0.1, 0, 1.38, 1.3, glass)); // windscreen
    parts.push(box(s.w - 0.3, 0.35, 2.0, 0, 0.9, -1.35, 0x1a1a1e)); // the empty bed
    wheels(s.l * 0.32, -s.l * 0.3);
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

/** A colour set for parked cars: muted 2009 paint under sodium light. */
export const CAR_COLOURS = [0x6a6e74, 0x2c3440, 0x8a1e1e, 0xb4b2aa, 0x2a3a2a, 0x1c1c22, 0x54402e, 0x3a4a6a, 0x9a9690];
