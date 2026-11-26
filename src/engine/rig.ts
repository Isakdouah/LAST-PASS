// Close-up people: near the camera every person is built from parts (head, body, two arms,
// two legs) that move: walking, running, the dead reaching, lunging, two bodies locked on
// the ground, the bitten shaking, the new dead getting up. Further out they stay the
// simple one-piece figures. The pose only shows what the simulation decided.
import * as THREE from 'three';
import { Agent, Gun, Kind, Role, WEAPONS } from '../sim/street';
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
  /** Knee bends (+ = shin swings back) and elbow bends (- = forearm comes forward). */
  kneeL: number;
  kneeR: number;
  elbowL: number;
  elbowR: number;
}

const h = (n: number) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** What the body is doing, from the simulation state. */
export function poseOf(a: Agent, t: number, gait?: number): Pose {
  const ph = h(a.uid) * 6.28;
  const p: Pose = { hip: 0.85, pitch: 0, roll: 0, bend: 0, armL: 0, armR: 0, legL: 0, legR: 0, spread: 0.08, kneeL: 0.05, kneeR: 0.05, elbowL: -0.2, elbowR: -0.2 };
  /** Steps: knees fold while a leg swings through, so feet land instead of sliding. */
  const stride = (f: number, sw: number, knee: number) => {
    p.legL = Math.sin(f) * sw;
    p.legR = -p.legL;
    p.kneeL = 0.08 + knee * Math.max(0, -Math.cos(f));
    p.kneeR = 0.08 + knee * Math.max(0, Math.cos(f));
  };
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
      p.legL = Math.sin(f * 1.3) * 0.6 - 0.3;
      p.legR = Math.sin(f * 1.3 + 2) * 0.6 - 0.3;
      p.kneeL = 0.9 + Math.sin(f * 1.3 + 1) * 0.6;
      p.kneeR = 0.9 + Math.sin(f * 1.3 + 3) * 0.6;
      p.elbowL = p.elbowR = -0.5;
      p.roll = Math.sin(f * 0.7) * 0.15;
      return p;
    }
    const run = moving && a.fear > 0.3;
    const f = gait ?? t * (run ? 11 : 6.5) + ph;
    const sw = moving ? (run ? 0.85 : 0.45) : 0;
    stride(f, sw, moving ? (run ? 1.5 : 0.7) : 0);
    p.armL = -p.legL * (run ? 1.1 : 0.7);
    p.armR = p.legL * (run ? 1.1 : 0.7);
    p.elbowL = p.elbowR = run ? -1.4 : -0.3;
    if (run) p.bend = 0.3;
    if (moving) p.hip = 0.83 + Math.abs(Math.cos(f)) * (run ? 0.07 : 0.035);
    else {
      // Standing about: weight on one leg, a slow sway.
      p.roll = Math.sin(t * 0.7 + ph) * 0.03;
      p.kneeL = h(a.uid * 11) > 0.5 ? 0.2 : 0.05;
      if (a.fear > 0.5) p.elbowL = p.elbowR = -0.9; // hands up near the chest
    }
    if (a.ammo > 0 && (a.flash > 0 || (!moving && a.fear > 0.5))) {
      // Aiming.
      p.armL = p.armR = -1.45;
      p.elbowL = -0.5;
      p.elbowR = -0.1;
      p.spread = -0.12;
      p.legL = -0.25;
      p.legR = 0.2;
      p.kneeL = 0.25;
    } else if (!moving && a.cooldown > 0 && a.weapon > 0) {
      // Swinging something.
      p.armR = -2.4 + (a.cooldown / 0.9) * 2.6;
      p.elbowR = -0.3;
      p.armL = -0.6;
      p.elbowL = -1.0;
      p.legL = -0.35;
      p.legR = 0.3;
      p.kneeL = 0.3;
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
    p.legL = p.legR = -1.4 * (1 - k);
    p.kneeL = p.kneeR = 2.2 * (1 - k);
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
    p.legL = -0.4;
    p.legR = -0.2;
    p.kneeL = 1.9;
    p.kneeR = 1.7;
    p.elbowL = p.elbowR = -0.6;
    p.roll = Math.sin(t * 9 + ph) * 0.12;
    return p;
  }
  if (a.lunge > 0) {
    // Mid-leap: flat out, arms first.
    p.hip = 0.95;
    p.pitch = 0.75;
    p.armL = p.armR = -2.4;
    p.elbowL = p.elbowR = -0.1;
    p.legL = 0.6;
    p.legR = 0.9;
    p.kneeL = 0.8;
    p.kneeR = 0.3;
    return p;
  }
  if (a.lunge < 0) {
    // Stumbled after a miss.
    p.pitch = 0.5;
    p.hip = 0.6;
    p.armL = p.armR = -1.0;
    p.legL = -0.6;
    p.legR = 0.3;
    p.kneeL = 0.9;
    return p;
  }
  if (a.crawl) {
    front();
    const f = t * 4 + ph;
    p.armL = -2.6 + Math.sin(f) * 0.5;
    p.armR = -2.6 - Math.sin(f) * 0.5;
    p.elbowL = -0.4 + Math.sin(f) * 0.4;
    p.elbowR = -0.4 - Math.sin(f) * 0.4;
    p.legL = 0.1;
    p.legR = -0.05;
    p.kneeL = 0.2;
    p.spread = 0.3;
    return p;
  }
  const f = gait ?? t * (moving ? 13 : 2) + ph;
  const sw = moving ? 0.9 : 0.05;
  stride(f, sw, moving ? 1.6 : 0);
  p.elbowL = -0.15;
  p.elbowR = -0.35;
  p.bend = moving ? 0.4 : 0.15;
  p.roll = Math.sin(f * 0.5) * 0.1;
  p.armL = -1.25 + Math.sin(f * 0.9) * 0.25;
  p.armR = -1.25 + Math.cos(f * 0.8) * 0.25;
  p.spread = 0.2;
  if (moving) p.hip = 0.85 + Math.abs(Math.cos(f)) * 0.06;
  return p;
}

// Body sizes in metres (before the figure scale). Hip pivot at 0.85 m.
const THIGH = 0.43, SHIN = 0.35, TORSO = 0.52, NECK = 0.62, HEAD = 0.24, UPPER = 0.3, FORE = 0.27;
const SKIN = [0xe8c4a0, 0xd9a67e, 0xb07a52, 0x8a5a3a, 0x5e3a24, 0xf0d0b4];
// Jackets and shirts of a cold October night, 2009: parkas, hoodies, work jackets, fleece.
const SHIRT = [0x7a7f88, 0x2a3550, 0x8c2a24, 0xdedad0, 0x4a5638, 0x1c1c1e, 0x4b2f6e, 0x6a4a32, 0x2f5f7a, 0xa8a090, 0x3a3a3a, 0xb04a2a, 0x5a6a3a, 0x9a8a60];
const PANTS = [0x2c3e5c, 0x3a4a68, 0xb09a72, 0x1e1e22, 0x55585e, 0x4a3a2a, 0x24324a];
const SHOES = [0x1a1a1a, 0x3a2a1e, 0xd8d8d0, 0x55585e, 0x5a3a20];
const HAIR = [0x1a1410, 0x2a1c12, 0x3a2616, 0x6a4a2a, 0xb89a5a, 0x8a8a88, 0x7a3a1c, 0xd8d0c0];
const HAT = [0x1c1c1e, 0x8c2a24, 0x2a3550, 0x4a5638, 0x7a7f88, 0xb04a2a];

function partGeo(w: number, l: number, d: number, y0: number, z0 = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, l, d).toNonIndexed();
  g.translate(0, y0 + l / 2, z0);
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

/** Part numbers. */
const P = { torso: 0, hips: 1, head: 2, hair: 3, upL: 4, upR: 5, foreL: 6, foreR: 7, handL: 8, handR: 9, thighL: 10, thighR: 11, shinL: 12, shinR: 13, shoeL: 14, shoeR: 15, item: 16 } as const;

/** What is in the right hand: width, length, depth (m) and colour. Guns by type, then the
 *  things people swing (by name in WEAPONS). Placeholder shapes: one box each. */
const GUN_LOOK: Record<number, [number, number, number, number]> = {
  [Gun.Handgun]: [0.04, 0.2, 0.11, 0x1a1a1c],
  [Gun.Shotgun]: [0.05, 0.95, 0.07, 0x3a2a1e],
  [Gun.Rifle]: [0.05, 1.05, 0.07, 0x4a3220],
  [Gun.AR15]: [0.05, 0.85, 0.09, 0x141416],
  [Gun.AK]: [0.05, 0.88, 0.09, 0x5a3018],
};
const SWING_LOOK: Record<string, [number, number, number, number]> = {
  'kitchen knife': [0.025, 0.24, 0.03, 0xb8b8b8],
  'baseball bat': [0.07, 0.8, 0.07, 0xc8a060],
  'hockey stick': [0.04, 1.35, 0.07, 0x8a5a2a],
  crowbar: [0.03, 0.75, 0.03, 0x7a1c14],
  'frying pan': [0.22, 0.4, 0.04, 0x202020],
  hammer: [0.04, 0.35, 0.05, 0x6a4a2a],
  machete: [0.05, 0.6, 0.02, 0xa8a8a8],
  'fire axe': [0.07, 0.9, 0.07, 0xc0201a],
};

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
  /** Step phase per person, moved on by the distance walked (so feet do not slide). */
  private gait = new Map<number, { x: number; z: number; ph: number; t: number; yaw: number }>();

  constructor(scene: THREE.Scene, shared: Record<string, THREE.IUniform>) {
    // Transparent pass like the other figures: the ground is drawn there first, without depth.
    const mat = litBasic(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }), shared, 0.75);
    const geos: THREE.BufferGeometry[] = [];
    geos[P.torso] = partGeo(0.4, TORSO, 0.23, 0.1); // jacket, from the waist up
    geos[P.hips] = partGeo(0.36, 0.2, 0.21, -0.08);
    geos[P.head] = partGeo(0.2, HEAD, 0.22, 0, 0.01);
    geos[P.hair] = partGeo(1, 1, 1, 0); // scaled per person: short, long, beanie, cap
    geos[P.upL] = geos[P.upR] = partGeo(0.12, UPPER, 0.13, -UPPER);
    geos[P.foreL] = geos[P.foreR] = partGeo(0.1, FORE, 0.11, -FORE);
    geos[P.handL] = geos[P.handR] = partGeo(0.08, 0.1, 0.09, -0.1);
    geos[P.thighL] = geos[P.thighR] = partGeo(0.16, THIGH, 0.18, -THIGH);
    geos[P.shinL] = geos[P.shinR] = partGeo(0.13, SHIN, 0.14, -SHIN);
    geos[P.shoeL] = geos[P.shoeR] = partGeo(0.12, 0.08, 0.27, -0.08, 0.05);
    geos[P.item] = partGeo(1, 1, 1, -0.75); // scaled per person; held a quarter from its end
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
    if (this.gait.size > 3000) this.gait.clear();
  }
  get full() {
    return this.n >= MAX;
  }

  private put(part: number, mat: THREE.Matrix4, col: THREE.Color) {
    this.meshes[part].setMatrixAt(this.n, mat);
    this.meshes[part].setColorAt(this.n, col);
  }

  /** Step phase: one full cycle (two steps) per stride length walked. */
  private phase(a: Agent, pos: THREE.Vector3, fig: number, t: number): number | undefined {
    if (a.kind === Kind.Fallen) return undefined;
    let g = this.gait.get(a.uid);
    if (!g || t - g.t > 0.5) {
      g = { x: pos.x, z: pos.z, ph: h(a.uid) * 6.28, t, yaw: NaN };
      this.gait.set(a.uid, g);
    }
    const d = Math.hypot(pos.x - g.x, pos.z - g.z);
    if (d < 3) {
      const run = a.kind === Kind.Dead || a.fear > 0.3;
      g.ph += (d / ((run ? 2.3 : 1.45) * fig)) * Math.PI * 2;
    }
    g.x = pos.x;
    g.z = pos.z;
    g.t = t;
    return g.ph;
  }

  /** Turn smoothly toward the facing the simulation gives (at most about 1.5 turns a second). */
  private turn(a: Agent, want: number, t: number, dt: number): number {
    const g = this.gait.get(a.uid);
    if (!g) return want;
    if (Number.isNaN(g.yaw) || dt <= 0) return (g.yaw = want);
    const d = Math.atan2(Math.sin(want - g.yaw), Math.cos(want - g.yaw));
    const max = 9 * dt;
    g.yaw += Math.max(-max, Math.min(max, d));
    return g.yaw;
  }

  /** Add one person at local position `pos` (metres, ground y = 0). */
  add(a: Agent, pos: THREE.Vector3, yaw: number, fig: number, t: number, thermal: THREE.Color | null) {
    if (this.n >= MAX) return;
    const moving = Math.hypot(a.vx, a.vy) > 1e-5;
    const last = this.gait.get(a.uid)?.t ?? t;
    const ph = this.phase(a, pos, fig, t);
    yaw = this.turn(a, yaw, t, Math.min(0.1, t - last));
    const p = poseOf(a, t, moving ? ph : undefined);
    const dead = a.kind === Kind.Dead;
    const u = a.uid;
    const sk = new THREE.Color().setHex(SKIN[Math.floor(h(u * 5) * SKIN.length)]);
    const sh = new THREE.Color(), pa = new THREE.Color(), so = new THREE.Color(), ha = new THREE.Color();
    so.setHex(SHOES[Math.floor(h(u * 13) * SHOES.length)]);
    const style = h(u * 17); // < 0.2 beanie, < 0.42 long hair, < 0.47 bald, else short
    let hat = -1; // 0 beanie, 1 peaked cap
    if (a.role === Role.Police) sh.setHex(0x1c2640), pa.setHex(0x1c2640), so.setHex(0x101010), ha.setHex(0x1c2640), (hat = 1);
    else if (a.role === Role.Fire) sh.setHex(0x8a7448), pa.setHex(0x8a7448), so.setHex(0x101010), ha.setHex(0x16161a), (hat = 0); // turnout gear, helmet
    else if (a.role === Role.Hunter) sh.setHex(0xe0601a), pa.setHex(PANTS[Math.floor(h(u * 7) * PANTS.length)]), ha.setHex(0xe0601a), (hat = 1);
    else {
      sh.setHex(SHIRT[Math.floor(h(u * 3) * SHIRT.length)]);
      pa.setHex(PANTS[Math.floor(h(u * 7) * PANTS.length)]);
      if (style < 0.2) ha.setHex(HAT[Math.floor(h(u * 19) * HAT.length)]), (hat = 0);
      else ha.setHex(HAIR[Math.floor(h(u * 23) * HAIR.length)]);
    }
    const hand = sk.clone();
    if (dead) {
      // Grey-green skin, clothes darkened and bloodied: readable as one of the dead.
      sk.lerp(new THREE.Color(0x6f8a52), 0.75);
      hand.copy(sk).lerp(new THREE.Color(0x5a1a14), 0.4); // bloodied hands
      sh.lerp(new THREE.Color(0x3a1a16), 0.45).multiplyScalar(0.8);
      pa.multiplyScalar(0.7);
      if (hat < 0) ha.multiplyScalar(0.6); // matted
      else if (h(u * 29) > 0.5) (hat = -1), ha.setHex(0x2a2018); // lost the hat
    } else if (a.kind === Kind.Living && a.turn >= 0) sk.lerp(new THREE.Color(0x9aa08a), 0.5), hand.copy(sk);
    else if (a.spared) sk.lerp(new THREE.Color(0xd8584a), 0.3), hand.copy(sk); // fever-flushed (the dead pass them by)
    if (a.kind === Kind.Fallen) for (const c of [sk, hand, sh, pa, ha, so]) c.multiplyScalar(0.6);
    if (thermal) {
      sk.copy(thermal), hand.copy(thermal);
      for (const c of [sh, pa, so, ha]) c.copy(thermal).multiplyScalar(0.8);
    }
    // Sleeves: the dead have them torn; some living wear short sleeves under nothing (rare in October).
    const fore = dead && h(u * 31) > 0.4 ? sk : sh;

    // Root: position, facing, scale, then the hip pivot with the body's pitch and roll.
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
    this.root.compose(pos, this.q, this.s.set(fig, fig, fig));
    this.tmp.makeTranslation(0, p.hip, 0);
    this.root.multiply(this.tmp);
    this.e.set(p.pitch, 0, p.roll, 'XZY');
    this.root.multiply(this.tmp.makeRotationFromEuler(this.e));
    this.put(P.hips, this.root, pa);
    // Legs from the hip: thigh, knee, shin, shoe kept roughly flat.
    const legs = [
      [P.thighL, P.shinL, P.shoeL, p.legL, p.kneeL, -0.095],
      [P.thighR, P.shinR, P.shoeR, p.legR, p.kneeR, 0.095],
    ] as const;
    for (const [th, sn, sf, sw, kn, x] of legs) {
      this.m.copy(this.root).multiply(this.tmp.makeTranslation(x, 0, 0)).multiply(this.tmp2.makeRotationX(sw));
      this.put(th, this.m, pa);
      this.m.multiply(this.tmp.makeTranslation(0, -THIGH, 0)).multiply(this.tmp2.makeRotationX(kn));
      this.put(sn, this.m, pa);
      this.m.multiply(this.tmp.makeTranslation(0, -SHIN, 0)).multiply(this.tmp2.makeRotationX(-(sw + kn) * 0.8));
      this.put(sf, this.m, so);
    }
    // Torso bends at the hip; head and arms ride on it.
    const torso = this.m.copy(this.root).multiply(this.tmp.makeRotationX(p.bend)).clone();
    this.put(P.torso, torso, sh);
    const head = this.m.copy(torso).multiply(this.tmp.makeTranslation(0, NECK, 0));
    if (dead) head.multiply(this.tmp.makeRotationZ(Math.sin(u) * 0.25)); // head lolls
    const headM = head.clone();
    this.put(P.head, headM, sk);
    // Hair or hat: one box, shaped per person.
    if (!(hat < 0 && style >= 0.42 && style < 0.47)) {
      let sx = 0.22, sy = 0.07, sz = 0.24, y = HEAD - 0.05, z = -0.005;
      if (hat === 0) (sx = 0.225), (sy = 0.12), (sz = 0.245), (y = HEAD - 0.08); // beanie, pulled down
      else if (hat === 1) (sx = 0.23), (sy = 0.07), (sz = 0.3), (y = HEAD - 0.04), (z = 0.04); // peaked cap
      else if (style < 0.42) (sy = 0.2), (y = HEAD - 0.17), (z = -0.03), (sz = 0.2); // long hair, down the back
      this.m.copy(headM).multiply(this.tmp.makeTranslation(0, y, z)).multiply(this.tmp2.makeScale(sx, sy, sz));
      this.put(P.hair, this.m, ha);
    } else {
      this.m.makeScale(0, 0, 0);
      this.put(P.hair, this.m, ha);
    }
    const arms = [
      [P.upL, P.foreL, P.handL, p.armL, p.elbowL, -1],
      [P.upR, P.foreR, P.handR, p.armR, p.elbowR, 1],
    ] as const;
    for (const [up, fo, hd, sw, el, side] of arms) {
      this.e.set(sw, 0, side * p.spread, 'ZXY');
      this.m.copy(torso).multiply(this.tmp.makeTranslation(side * 0.255, NECK - 0.05, 0)).multiply(this.tmp2.makeRotationFromEuler(this.e));
      this.put(up, this.m, sh);
      this.m.multiply(this.tmp.makeTranslation(0, -UPPER, 0)).multiply(this.tmp2.makeRotationX(el));
      this.put(fo, this.m, fore);
      this.m.multiply(this.tmp.makeTranslation(0, -FORE, 0));
      this.put(hd, this.m, hand);
      if (side === 1) {
        // The thing in their hand: a gun, or whatever they swing. Along the forearm, so it
        // points where they aim.
        const look = a.kind === Kind.Living && a.turn < 0 ? (a.gun > 0 ? GUN_LOOK[a.gun] : SWING_LOOK[WEAPONS[a.weapon]?.name ?? '']) : undefined;
        if (look) {
          this.m.multiply(this.tmp.makeTranslation(0, -0.06, 0.02)).multiply(this.tmp2.makeScale(look[0], look[1], look[2]));
          this.c.setHex(look[3]);
          if (thermal) this.c.copy(thermal).multiplyScalar(0.35);
          this.put(P.item, this.m, this.c);
        } else this.put(P.item, this.m.makeScale(0, 0, 0), hand);
      }
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
