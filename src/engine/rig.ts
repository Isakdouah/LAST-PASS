// Close-up people: near the camera every person is built from parts (head, body, two arms,
// two legs) that move: walking, running, the dead reaching, lunging, two bodies locked on
// the ground, the bitten shaking, the new dead getting up. Further out they stay the
// simple one-piece figures. The pose only shows what the simulation decided.
import * as THREE from 'three';
import { Agent, Kind, Role } from '../sim/street';
import { litBasic } from './lightfield';

const RISE = 1.2; // keep in step with street.ts

export interface Pose {
  /** Hip height (m), body pitch (+ = face down / forward), roll. */
  hip: number;
  pitch: number;
  roll: number;
  /** Torso bend at the hip (+ = forward). */
  bend: number;
  /** Arm and leg swings (- = forward), arm spread sideways. */
  armL: number;
  armR: number;
  legL: number;
  legR: number;
  spread: number;
}

const h = (n: number) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** What the body is doing, from the simulation state. */
export function poseOf(a: Agent, t: number): Pose {
  const ph = h(a.uid) * 6.28;
  const p: Pose = { hip: 0.85, pitch: 0, roll: 0, bend: 0, armL: 0, armR: 0, legL: 0, legR: 0, spread: 0.08 };
  const moving = Math.hypot(a.vx, a.vy) > 1e-5;
  const back = (): void => void ((p.hip = 0.14), (p.pitch = -Math.PI / 2));
  const front = (): void => void ((p.hip = 0.14), (p.pitch = Math.PI / 2));
  if (a.kind === Kind.Fallen) {
    if ((a.uid & 1) === 0) back();
    else front();
    p.spread = 0.6 + 0.5 * h(a.uid * 3);
    p.legL = 0.2;
    p.legR = -0.3;
    return p;
  }
  if (a.kind === Kind.Living) {
    if (a.turn >= 0) {
      // Bitten: on the ground, shaking. Harder near the end.
      back();
      const k = 0.15 + 0.5 * Math.max(0, 1 - a.turn / 8);
      const j = (n: number) => (h(Math.floor(t * 18) * 131 + a.uid * 7 + n) - 0.5) * 2 * k;
      p.roll = j(1) * 0.4;
      p.armL = -0.4 + j(2) * 1.5;
      p.armR = -0.4 + j(3) * 1.5;
      p.legL = j(4) * 1.2;
      p.legR = j(5) * 1.2;
      p.spread = 0.4 + j(6);
      return p;
    }
    if (a.held > 0) {
      // Held down: on their back, arms pushing it off, legs kicking.
      back();
      const f = t * 11 + ph;
      p.armL = -1.4 + Math.sin(f) * 0.35;
      p.armR = -1.4 + Math.sin(f + 1.7) * 0.35;
      p.legL = Math.sin(f * 1.3) * 0.6;
      p.legR = Math.sin(f * 1.3 + 2) * 0.6;
      p.roll = Math.sin(f * 0.7) * 0.15;
      return p;
    }
    const run = moving && a.fear > 0.3;
    const f = t * (run ? 11 : 6.5) + ph;
    const sw = moving ? (run ? 0.95 : 0.5) : 0;
    p.legL = Math.sin(f) * sw;
    p.legR = -p.legL;
    p.armL = -p.legL * 0.8;
    p.armR = p.legL * 0.8;
    if (run) p.bend = 0.25;
    if (moving) p.hip = 0.85 + Math.abs(Math.cos(f)) * 0.05;
    if (a.ammo > 0 && (a.flash > 0 || (!moving && a.fear > 0.5))) {
      // Aiming.
      p.armL = p.armR = -1.5;
      p.spread = -0.12;
    } else if (!moving && a.cooldown > 0 && a.weapon > 0) {
      // Swinging something.
      p.armR = -2.4 + (a.cooldown / 0.9) * 2.6;
    }
    return p;
  }
  // The dead.
  if (a.fresh >= 0 && a.fresh < RISE) {
    // Getting up: sitting, then standing.
    const k = a.fresh / RISE;
    p.hip = 0.14 + (0.85 - 0.14) * k * k;
    p.pitch = -Math.PI / 2 * (1 - k);
    p.bend = 0.6 * (1 - k);
    p.armL = p.armR = -0.8;
    return p;
  }
  if (a.down > 0) {
    front();
    p.spread = 0.5;
    return p;
  }
  if (a.hold) {
    // On top of someone, bent over them.
    p.hip = 0.45;
    p.pitch = 0.9;
    p.bend = 0.5;
    p.armL = -1.2 + Math.sin(t * 13 + ph) * 0.25;
    p.armR = -1.2 + Math.sin(t * 13 + ph + 2) * 0.25;
    p.legL = 1.3;
    p.legR = 1.1;
    p.roll = Math.sin(t * 9 + ph) * 0.12;
    return p;
  }
  if (a.lunge > 0) {
    // Mid-leap: flat out, arms first.
    p.hip = 0.95;
    p.pitch = 0.75;
    p.armL = p.armR = -2.4;
    p.legL = 0.6;
    p.legR = 0.9;
    return p;
  }
  if (a.lunge < 0) {
    // Stumbled after a miss.
    p.pitch = 0.5;
    p.hip = 0.6;
    p.armL = p.armR = -1.0;
    p.legL = 0.5;
    return p;
  }
  if (a.crawl) {
    front();
    const f = t * 4 + ph;
    p.armL = -2.6 + Math.sin(f) * 0.5;
    p.armR = -2.6 - Math.sin(f) * 0.5;
    p.spread = 0.3;
    return p;
  }
  const f = t * (moving ? 13 : 2) + ph;
  const sw = moving ? 1.0 : 0.05;
  p.legL = Math.sin(f) * sw;
  p.legR = -p.legL;
  p.bend = moving ? 0.35 : 0.15;
  p.roll = Math.sin(f * 0.5) * 0.1;
  p.armL = -1.25 + Math.sin(f * 0.9) * 0.25;
  p.armR = -1.25 + Math.cos(f * 0.8) * 0.25;
  p.spread = 0.2;
  if (moving) p.hip = 0.85 + Math.abs(Math.cos(f)) * 0.06;
  return p;
}

// Body sizes in metres (before the figure scale).
const LEG = 0.84, TORSO = 0.6, HEAD = 0.26, ARM = 0.62;
const SKIN = [0xe8c4a0, 0xd9a67e, 0xb07a52, 0x8a5a3a, 0x5e3a24, 0xf0d0b4];
const SHIRT = [0x7a7f88, 0x2a3550, 0x8c2a24, 0xdedad0, 0x4a5638, 0x1c1c1e, 0x4b2f6e, 0x6a4a32, 0x2f5f7a, 0xa8a090, 0x3a3a3a, 0xb04a2a];
const PANTS = [0x2c3e5c, 0x3a4a68, 0xb09a72, 0x1e1e22, 0x55585e, 0x4a3a2a];

function partGeo(up: boolean, w: number, l: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, l, d).toNonIndexed();
  g.translate(0, up ? l / 2 : -l / 2, 0);
  // Simple top light baked into vertex colours.
  const n = g.attributes.normal, c: number[] = [];
  for (let i = 0; i < n.count; i++) {
    const y = n.getY(i), x = n.getX(i), z = n.getZ(i);
    const v = y > 0.5 ? 1 : y < -0.5 ? 0.45 : 0.62 + 0.18 * Math.max(0, -0.6 * x - 0.8 * z);
    c.push(v, v, v);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}

const MAX = 500;
export class Rig {
  readonly meshes: THREE.InstancedMesh[];
  private n = 0;
  private m = new THREE.Matrix4();
  private root = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();
  private c = new THREE.Color();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene, shared: Record<string, THREE.IUniform>) {
    // Transparent pass like the other figures: the ground is drawn there first, without depth.
    const mat = litBasic(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }), shared, 0.75);
    const geos = [
      partGeo(true, 0.4, TORSO, 0.24), // 0 torso
      partGeo(true, HEAD * 0.85, HEAD, HEAD * 0.9), // 1 head
      partGeo(false, 0.12, ARM, 0.13), // 2 arm L
      partGeo(false, 0.12, ARM, 0.13), // 3 arm R
      partGeo(false, 0.16, LEG, 0.18), // 4 leg L
      partGeo(false, 0.16, LEG, 0.18), // 5 leg R
    ];
    this.meshes = geos.map((g) => {
      const im = new THREE.InstancedMesh(g, mat, MAX);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
      im.frustumCulled = false;
      im.renderOrder = 1;
      im.count = 0;
      scene.add(im);
      return im;
    });
  }

  begin() {
    this.n = 0;
  }
  get full() {
    return this.n >= MAX;
  }

  private put(part: number, mat: THREE.Matrix4, col: THREE.Color) {
    this.meshes[part].setMatrixAt(this.n, mat);
    this.meshes[part].setColorAt(this.n, col);
  }

  /** Add one person at local position `pos` (metres, ground y = 0). */
  add(a: Agent, pos: THREE.Vector3, yaw: number, fig: number, t: number, thermal: THREE.Color | null) {
    if (this.n >= MAX) return;
    const p = poseOf(a, t);
    const dead = a.kind === Kind.Dead;
    const u = a.uid;
    const skin = this.c.setHex(SKIN[Math.floor(h(u * 5) * SKIN.length)]);
    const sk = skin.clone(), sh = new THREE.Color(), pa = new THREE.Color();
    if (a.role === Role.Police) sh.setHex(0x1c2640), pa.setHex(0x1c2640);
    else if (a.role === Role.Hunter) sh.setHex(0xe0601a), pa.setHex(PANTS[Math.floor(h(u * 7) * PANTS.length)]);
    else sh.setHex(SHIRT[Math.floor(h(u * 3) * SHIRT.length)]), pa.setHex(PANTS[Math.floor(h(u * 7) * PANTS.length)]);
    if (dead) {
      // Grey-green skin, clothes darkened and bloodied: readable as one of the dead.
      sk.lerp(new THREE.Color(0x6f8a52), 0.75);
      sh.lerp(new THREE.Color(0x3a1a16), 0.45).multiplyScalar(0.8);
      pa.multiplyScalar(0.7);
    } else if (a.kind === Kind.Living && a.turn >= 0) sk.lerp(new THREE.Color(0x9aa08a), 0.5);
    if (a.kind === Kind.Fallen) sk.multiplyScalar(0.7), sh.multiplyScalar(0.6), pa.multiplyScalar(0.6);
    if (thermal) sk.copy(thermal), sh.copy(thermal).multiplyScalar(0.8), pa.copy(thermal).multiplyScalar(0.8);

    // Root: position, facing, scale, then the hip pivot with the body's pitch and roll.
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
    this.root.compose(pos, this.q, this.s.set(fig, fig, fig));
    this.tmp.makeTranslation(0, p.hip, 0);
    this.root.multiply(this.tmp);
    this.e.set(p.pitch, 0, p.roll, 'XZY');
    this.root.multiply(this.tmp.makeRotationFromEuler(this.e));
    // Legs from the hip.
    for (const [part, sw, x] of [
      [4, p.legL, -0.1],
      [5, p.legR, 0.1],
    ] as const) {
      this.m.copy(this.root).multiply(this.tmp.makeTranslation(x, 0, 0)).multiply(this.tmp2.makeRotationX(sw));
      this.put(part, this.m, pa);
    }
    // Torso bends at the hip; head and arms ride on it.
    const torso = this.m.copy(this.root).multiply(this.tmp.makeRotationX(p.bend)).clone();
    this.put(0, torso, sh);
    this.m.copy(torso).multiply(this.tmp.makeTranslation(0, TORSO + 0.02, 0.01));
    this.put(1, this.m, sk);
    for (const [part, sw, side] of [
      [2, p.armL, -1],
      [3, p.armR, 1],
    ] as const) {
      this.e.set(sw, 0, side * p.spread, 'ZXY');
      this.m.copy(torso).multiply(this.tmp.makeTranslation(side * 0.27, TORSO - 0.04, 0)).multiply(this.tmp2.makeRotationFromEuler(this.e));
      this.put(part, this.m, dead ? sk : sh); // the dead: sleeves torn off
    }
    this.n++;
  }

  end() {
    for (const im of this.meshes) {
      im.count = this.n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
