// The International Space Station as it was in mid-October 2009, built from simple shapes
// (close to the real layout, not survey-accurate), plus one change for the story: Node 3
// "Tranquility" with the Cupola (really added in February 2010) is already there.
// Local frame, metres: +x forward (direction of flight), +y up (away from Earth),
// +z starboard (right). Also the inside of the Cupola, where the player lives.
import * as THREE from 'three';
import landUrl from '../data/earth-land.png';

type Mat = THREE.Material;
const lam = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const basic = (color: number, extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

const M = {
  white: lam(0xd8d6cc), // beta cloth / white thermal blankets
  offwhite: lam(0xbdb8a8),
  grey: lam(0x7c8088),
  dark: lam(0x2a2d33),
  truss: lam(0x9a9ea6),
  gold: lam(0x8a6a2c), // solar cells look gold-brown from the front
  goldBack: lam(0xc8c2b0),
  rus: lam(0xc6c9bf),
  rusArray: lam(0x1d2a4a),
  radiator: lam(0xf0f0ea),
  black: lam(0x111215),
  glass: basic(0x0a1220, { transparent: true, opacity: 0.18, depthWrite: false }),
};

function cyl(r: number, len: number, axis: 'x' | 'y' | 'z', mat: Mat, at: [number, number, number], seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(...at);
  return m;
}
function box(w: number, h: number, d: number, mat: Mat, at: [number, number, number]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...at);
  return m;
}
/** A module with ribbed blanket bands, so it does not look like a plain tube. */
function module(r: number, len: number, axis: 'x' | 'y' | 'z', at: [number, number, number], mat: Mat = M.white) {
  const g = new THREE.Group();
  g.add(cyl(r, len, axis, mat, [0, 0, 0], 20));
  const bands = Math.max(2, Math.round(len / 1.6));
  for (let k = 0; k <= bands; k++) {
    const p = -len / 2 + (k / bands) * len;
    const pos: [number, number, number] = axis === 'x' ? [p, 0, 0] : axis === 'y' ? [0, p, 0] : [0, 0, p];
    g.add(cyl(r * 1.02, 0.12, axis, M.offwhite, pos, 20));
  }
  // End cones (berthing mechanisms).
  for (const s of [-1, 1]) {
    const pos: [number, number, number] = axis === 'x' ? [(s * len) / 2, 0, 0] : axis === 'y' ? [0, (s * len) / 2, 0] : [0, 0, (s * len) / 2];
    g.add(cyl(r * 0.6, 0.5, axis, M.grey, pos, 16));
  }
  g.position.set(...at);
  return g;
}

/** One solar wing: a mast and two gold blankets, `len` metres long along +x or -x. */
function wing(dir: 1 | -1, len = 33) {
  const g = new THREE.Group();
  g.add(box(len, 0.25, 0.35, M.truss, [(dir * len) / 2, 0, 0]));
  for (const s of [-1, 1]) {
    const blanket = new THREE.Group();
    const cells = 12;
    for (let k = 0; k < cells; k++) {
      const seg = len / cells;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.96, 0.04, 4.6), k % 2 ? M.gold : lam(0x7a5c24));
      panel.position.set(dir * (1.2 + seg * (k + 0.5) * 0.96), 0, s * 2.75);
      blanket.add(panel);
    }
    g.add(blanket);
  }
  return g;
}

export interface StationModel {
  root: THREE.Group;
  arrays: THREE.Group[]; // turn to face the sun
  cupolaAt: THREE.Vector3; // centre of the Cupola's big window, station frame
  lights: THREE.Group;
}

export function buildStation(): StationModel {
  const root = new THREE.Group();
  const arrays: THREE.Group[] = [];
  // US segment along the flight line.
  root.add(module(2.15, 8.5, 'x', [0, 0, 0])); // Destiny lab
  root.add(module(2.2, 7.2, 'x', [7.85, 0, 0])); // Harmony (Node 2)
  root.add(cyl(1.0, 1.6, 'x', M.grey, [12.3, 0, 0])); // PMA-2 docking port
  root.add(module(2.25, 6.9, 'z', [7.85, 0, 5.7])); // Columbus (ESA)
  root.add(module(2.2, 11.2, 'z', [7.85, 0, -7.9])); // Kibo pressurised module (Japan)
  root.add(module(2.2, 4.2, 'y', [7.85, 4.3, -9.5])); // Kibo logistics section
  root.add(box(5.0, 3.8, 5.6, M.offwhite, [7.85, 0, -16.4])); // Kibo exposed facility
  root.add(module(2.2, 9.8, 'y', [7.85, -7.1, 0], M.offwhite)); // HTV-1 cargo ship (berthed Sep-Oct 2009)
  root.add(module(2.25, 5.5, 'x', [-7.0, 0, 0])); // Unity (Node 1)
  root.add(module(2.0, 5.5, 'z', [-7.0, 0, 5.0])); // Quest airlock
  root.add(module(2.2, 6.7, 'z', [-7.0, 0, -5.6])); // Tranquility (Node 3): story change, early
  // Cupola on Tranquility's Earth-facing side: six side windows and one big round one.
  const cupolaAt = new THREE.Vector3(-7.0, -3.35, -6.2);
  const cup = new THREE.Group();
  const shell = new THREE.CylinderGeometry(0.75, 1.48, 1.2, 6, 1, true);
  cup.add(new THREE.Mesh(shell, lam(0xcfcac0, { side: THREE.DoubleSide })));
  cup.add(cyl(0.55, 0.1, 'y', basic(0xffc070), [0, -0.62, 0], 24)); // warm light inside, seen through the glass
  cup.position.copy(cupolaAt).add(new THREE.Vector3(0, 0.6, 0));
  root.add(cup);
  root.add(cyl(1.1, 0.8, 'y', M.grey, [-7.0, -2.5, -6.2])); // berthing ring
  // Russian segment, aft.
  root.add(cyl(1.0, 2.0, 'x', M.grey, [-10.7, 0, 0])); // PMA-1
  root.add(module(2.05, 12.6, 'x', [-18.0, 0, 0], M.rus)); // Zarya
  root.add(module(2.1, 13.1, 'x', [-30.9, 0, 0], M.rus)); // Zvezda
  root.add(cyl(1.3, 2.5, 'y', M.rus, [-25.4, -2.6, 0])); // Pirs docking compartment
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.add(box(1.2, 0.05, 12.0, M.rusArray, [0, 0, s * 8.6]));
    a.position.set(-31.5, 0, 0);
    root.add(a);
    const z = new THREE.Group();
    z.add(box(3.3, 0.05, 9.0, M.rusArray, [0, 0, s * 6.8]));
    z.position.set(-16, 0, 0);
    root.add(z);
  }
  // Visiting ships: Soyuz TMA-16 on Zvezda's aft port, Soyuz TMA-15 under Zarya, a Progress under Pirs.
  root.add(soyuz('x', [-41.0, 0, 0], -1));
  root.add(soyuz('y', [-18.0, -6.5, 0], -1));
  root.add(progress([-25.4, -8.0, 0]));
  // The truss: about 100 m, across the top of Destiny.
  const trussY = 4.0;
  root.add(box(2.6, 2.6, 92, M.truss, [0, trussY, 0]));
  for (let k = -45; k <= 45; k += 3) root.add(box(2.8, 2.8, 0.2, M.grey, [0, trussY, k])); // bays
  root.add(box(3.0, 3.0, 4.0, M.grey, [-2, 3.2, 0])); // S0 centre
  root.add(box(2.2, 4.0, 2.2, M.truss, [-7, 2.6, 0])); // Z1
  // Radiators (S1 / P1): three white panels each side, hanging toward Earth.
  for (const s of [-1, 1])
    for (let k = 0; k < 3; k++) {
      const r = box(3.0, 0.08, 23, M.radiator, [0, 0, 0]);
      const piv = new THREE.Group();
      piv.add(r);
      r.position.set(0, -11.5, 0);
      r.rotation.x = Math.PI / 2;
      piv.position.set(-1.5 + k * 0.4, trussY - 1.4, s * (12 + k * 3.2));
      piv.rotation.z = 0.35;
      root.add(piv);
    }
  // Four big solar array pairs (P6, P4, S4, S6); they turn on the truss to follow the Sun.
  for (const z of [-46, -32, 32, 46]) {
    const a = new THREE.Group();
    const near = z > 0 ? -1 : 1;
    a.add(wing(1));
    a.add(wing(-1));
    a.children[0].position.z = near * 3.6;
    a.children[1].position.z = -near * 3.6;
    a.position.set(0, trussY, z);
    arrays.push(a);
    root.add(a);
    root.add(box(1.4, 6, 1.4, M.truss, [0, trussY, z])); // mast canister
  }
  // Canadarm2: two booms, elbow up.
  const arm = new THREE.Group();
  const b1 = cyl(0.2, 8.5, 'y', M.white, [0, 4.25, 0], 8);
  const b2 = cyl(0.2, 8.5, 'y', M.white, [0, 4.25, 0], 8);
  const j = new THREE.Group();
  j.add(b2);
  j.position.y = 8.5;
  j.rotation.z = -2.1;
  b1.add(j);
  b1.position.y = 4.25;
  b1.rotation.z = 0.35;
  arm.add(b1);
  arm.position.set(1.2, trussY + 1.5, 8);
  root.add(arm);
  // Navigation and floodlights (they blink; see update()).
  const lights = new THREE.Group();
  for (const p of [[12.8, 0, 0], [-46, 0, 0], [0, trussY, 46], [0, trussY, -46], [7.85, 0, -19.2], [7.85, 0, 9.3]] as [number, number, number][]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), basic(0xffffff));
    l.position.set(...p);
    lights.add(l);
  }
  root.add(lights);
  return { root, arrays, cupolaAt, lights };
}

function soyuz(axis: 'x' | 'y', at: [number, number, number], dir: 1 | -1) {
  const g = new THREE.Group();
  const along = (d: number): [number, number, number] => (axis === 'x' ? [dir * d, 0, 0] : [0, dir * d, 0]);
  g.add(cyl(1.1, 2.6, axis, lam(0x6d7a52), along(1.4), 14)); // orbital module (green blankets)
  g.add(cyl(1.1, 2.2, axis, lam(0xb8b3a5), along(3.6), 14)); // descent module
  g.add(cyl(1.35, 2.5, axis, lam(0xd0d0cc), along(5.9), 14)); // service module
  for (const s of [-1, 1]) {
    const w = axis === 'x' ? box(0.6, 0.04, 4.2, M.rusArray, [dir * 5.9, 0, s * 3.4]) : box(0.04, 0.6, 4.2, M.rusArray, [0, dir * 5.9, s * 3.4]);
    g.add(w);
  }
  g.position.set(...at);
  return g;
}
function progress(at: [number, number, number]) {
  const g = new THREE.Group();
  g.add(cyl(1.1, 3.4, 'y', lam(0x5f6a4c), [0, 0, 0], 14));
  g.add(cyl(1.35, 2.6, 'y', lam(0xd0d0cc), [0, -3.0, 0], 14));
  for (const s of [-1, 1]) g.add(box(0.04, 0.6, 4.2, M.rusArray, [0, -3.0, s * 3.4]));
  g.position.set(...at);
  return g;
}

// ---------------- inside the Cupola ----------------
// Eye at the origin, looking down (-y) through the big round window; forward (+x) is the
// direction of flight, at the top of the picture. Everything here is close: metres.

export interface Cupola {
  root: THREE.Group;
  hands: { left: THREE.Group; right: THREE.Group };
  laptop: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  radio: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  floaters: THREE.Object3D[];
  photo: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
}

const skin = lam(0x9c7f6e);
const sleeve = lam(0x1f2a44); // navy polo shirt

function canvasTex(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return { canvas, tex };
}

function hand(side: 1 | -1) {
  const g = new THREE.Group();
  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.34), sleeve);
  fore.position.z = 0.17;
  g.add(fore);
  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.06), skin);
  cuff.position.z = -0.02;
  g.add(cuff);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.03, 0.09), skin);
  palm.position.set(0, -0.005, -0.08);
  g.add(palm);
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.018, 0.06), skin);
    f.position.set(-0.03 + k * 0.02, -0.012, -0.15);
    f.rotation.x = 0.35;
    g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.05), skin);
  thumb.position.set(side * 0.05, 0.0, -0.09);
  thumb.rotation.y = side * 0.6;
  g.add(thumb);
  return g;
}

export function buildCupola(): Cupola {
  const root = new THREE.Group();
  const frame = lam(0xd9d4c6);
  const metal = lam(0x8f8a7c);
  const floor = -1.0; // the big window's plane, 1 m below the eye
  // Big round window frame (80 cm glass): a chunky ring with bolts, then the glass seal.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 40), frame);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = floor;
  root.add(ring);
  const seal = new THREE.Mesh(new THREE.RingGeometry(0.39, 0.41, 40), lam(0x1c1c20));
  seal.rotation.x = -Math.PI / 2;
  seal.position.y = floor + 0.005;
  root.add(seal);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const bolt = box(0.02, 0.02, 0.02, metal, [Math.cos(a) * 0.46, floor + 0.01, Math.sin(a) * 0.46]);
    root.add(bolt);
  }
  // Six side windows, between the bottom ring and the top ring, separated by struts.
  const top = 0.15, rTop = 1.45, rBot = 0.5;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const s0 = new THREE.Vector3(Math.cos(a) * rBot, floor, Math.sin(a) * rBot);
    const s1 = new THREE.Vector3(Math.cos(a) * rTop, top, Math.sin(a) * rTop);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, s0.distanceTo(s1)), frame);
    strut.position.copy(s0).add(s1).multiplyScalar(0.5);
    strut.lookAt(s1);
    root.add(strut);
    // Bottom frame between the big window and each side window.
    const b = ((k + 0.5) / 6) * Math.PI * 2;
    const bot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 2 * rBot * Math.sin(Math.PI / 6)), frame);
    bot.position.set(Math.cos(b) * rBot * Math.cos(Math.PI / 6), floor + 0.02, Math.sin(b) * rBot * Math.cos(Math.PI / 6));
    bot.rotation.y = -b;
    root.add(bot);
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 2 * rTop * Math.sin(Math.PI / 6)), frame);
    topBar.position.set(Math.cos(b) * rTop * Math.cos(Math.PI / 6), top, Math.sin(b) * rTop * Math.cos(Math.PI / 6));
    topBar.rotation.y = -b;
    root.add(topBar);
  }
  // The hatch ring above, where the Cupola joins Node 3 (you look down out of it).
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.6, 6, 1, true), lam(0xc4bfb2, { side: THREE.BackSide }));
  hatch.position.y = top + 0.3;
  root.add(hatch);
  // Handrails (yellow-ish, as on the station).
  for (const a of [0.5, 2.6, 4.7]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.5), lam(0xb89a4a));
    rail.position.set(Math.cos(a) * 1.15, -0.1, Math.sin(a) * 1.15);
    rail.rotation.y = -a;
    root.add(rail);
  }
  // A work shelf strapped across the aft side window: laptop, radio, mic. It sits low in
  // the picture so the Earth stays in the middle.
  const desk = new THREE.Group();
  desk.add(box(0.36, 0.025, 1.1, metal, [0, 0, 0]));
  desk.add(box(0.36, 0.006, 1.08, lam(0x3c4a3a), [0, 0.016, 0])); // velcro mat
  desk.position.set(-0.52, -0.74, 0);
  desk.rotation.z = -0.35; // tipped toward the eye
  root.add(desk);
  // Laptop (a 2009 ThinkPad-style machine): black body, screen with the orbit map.
  const laptop = canvasTex(256, 160);
  const lap = new THREE.Group();
  lap.add(box(0.24, 0.022, 0.32, M.black, [0, 0, 0]));
  lap.add(box(0.16, 0.002, 0.27, lam(0x26272b), [0.03, 0.012, 0])); // keyboard
  const scr = new THREE.Group();
  scr.add(box(0.012, 0.21, 0.32, M.black, [0, 0, 0]));
  const scrFace = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.175), basic(0xffffff, { map: laptop.tex }));
  scrFace.rotation.y = Math.PI / 2;
  scrFace.position.x = 0.007;
  scr.add(scrFace);
  scr.position.set(-0.12, 0.1, 0);
  scr.rotation.z = -0.35;
  lap.add(scr);
  lap.position.set(0.02, 0.03, 0.3);
  lap.rotation.y = 0.12;
  desk.add(lap);
  // Ham radio (2009 amateur rig, as used for school contacts): grey box, amber display.
  const radio = canvasTex(128, 40);
  const rad = new THREE.Group();
  rad.add(box(0.15, 0.055, 0.19, lam(0x3a3c40), [0, 0, 0]));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.05), basic(0xffffff, { map: radio.tex }));
  face.rotation.x = -Math.PI / 2;
  face.rotation.z = Math.PI / 2;
  face.position.set(-0.01, 0.029, 0);
  rad.add(face);
  rad.add(cyl(0.022, 0.03, 'y', lam(0x15161a), [0.05, 0.04, -0.06], 10));
  rad.add(cyl(0.014, 0.025, 'y', lam(0x15161a), [0.05, 0.04, 0.05], 8));
  rad.position.set(0.02, 0.04, -0.22);
  desk.add(rad);
  desk.add(box(0.04, 0.03, 0.08, lam(0x222326), [0.1, 0.03, -0.42])); // hand mic
  desk.add(box(0.12, 0.08, 0.1, lam(0x2c2e33), [-0.08, 0.05, -0.42])); // headset case
  // Velcro, photos and notes taped around the windows: this is someone's home.
  const photo = canvasTex(64, 48);
  drawPhoto(photo.canvas);
  const paper = lam(0xe8e4d6);
  const note = lam(0xe8d870);
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) / 6) * Math.PI * 2 + 0.25;
    const mat = k % 3 === 0 ? basic(0xffffff, { map: photo.tex }) : k % 3 === 1 ? paper : note;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.12), mat);
    q.position.set(Math.cos(a) * 1.25, 0.14, Math.sin(a) * 1.25);
    q.lookAt(0, -0.2, 0);
    q.rotateZ(((a * 7) % 0.4) - 0.2);
    root.add(q);
  }
  // Cables and a bungee cord with a checklist; a pen, a drink pouch and a camera float.
  const cable = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.012, 4, 24, 2.2), lam(0x2c2c30));
  cable.rotation.x = Math.PI / 2;
  cable.position.y = 0.05;
  root.add(cable);
  const bungee = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.2, 4), lam(0x4a6aa8));
  bungee.rotation.x = Math.PI / 2;
  bungee.rotation.z = 0.9;
  bungee.position.set(0.7, -0.2, 0.1);
  root.add(bungee);
  const floaters: THREE.Object3D[] = [];
  const pen = box(0.12, 0.012, 0.012, lam(0x2050c0), [0.32, -0.55, 0.42]);
  const pouch = box(0.07, 0.11, 0.025, lam(0xc8c8d0), [0.45, -0.45, -0.45]);
  const camera = new THREE.Group(); // a big 2009 DSLR with a long lens, tethered
  camera.add(box(0.14, 0.1, 0.08, M.black, [0, 0, 0]));
  camera.add(cyl(0.035, 0.16, 'x', M.black, [0.12, 0, 0], 10));
  camera.position.set(0.62, -0.5, -0.05);
  floaters.push(pen, pouch, camera);
  for (const f of floaters) root.add(f);
  // The astronaut's forearms and hands (fingers point forward), coming in from the bottom.
  const left = hand(-1), right = hand(1);
  left.scale.setScalar(0.8);
  right.scale.setScalar(0.8);
  left.rotation.order = right.rotation.order = 'YXZ';
  left.rotation.set(-0.5, -Math.PI / 2 + 0.3, 0);
  right.rotation.set(-0.5, -Math.PI / 2 - 0.3, 0);
  left.position.set(-0.36, -0.55, 0.26);
  right.position.set(-0.38, -0.55, -0.24);
  root.add(left, right);
  // Light: warm cabin light from the hatch, cool Earth light from the window.
  const cabin = new THREE.PointLight(0xffd8a0, 2.2, 4, 1.2);
  cabin.position.set(0, 0.4, 0);
  root.add(cabin);
  root.add(new THREE.HemisphereLight(0x8090a8, 0x101420, 0.35));
  return { root, hands: { left, right }, laptop, radio, floaters, photo };
}

/** A small family photo (placeholder art): two figures and a sky. */
function drawPhoto(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2efe6';
  g.fillRect(0, 0, 64, 48);
  g.fillStyle = '#6a94c0';
  g.fillRect(3, 3, 58, 26);
  g.fillStyle = '#4e7a3a';
  g.fillRect(3, 29, 58, 12);
  g.fillStyle = '#2a2a30';
  g.fillRect(20, 16, 6, 18);
  g.fillRect(34, 20, 5, 14);
  g.fillStyle = '#d0a080';
  g.fillRect(20, 11, 6, 6);
  g.fillRect(34, 16, 5, 5);
}

let mapImg: HTMLImageElement | null = null;
/** The laptop shows a world map with the orbit, like the tracking software on board. */
export function drawLaptop(c: HTMLCanvasElement, sub: { lat: number; lon: number }, track: { lat: number; lon: number }[], mpls: { lat: number; lon: number }, text: string[]) {
  const g = c.getContext('2d')!;
  g.fillStyle = '#05101e';
  g.fillRect(0, 0, c.width, c.height);
  if (!mapImg) {
    mapImg = new Image();
    mapImg.src = landUrl;
  }
  const mh = 120;
  if (mapImg.complete && mapImg.naturalWidth) {
    g.globalAlpha = 0.55;
    g.drawImage(mapImg, 0, 0, c.width, mh);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#2a6a4a';
    g.fillRect(0, 0, c.width, mh);
    g.globalCompositeOperation = 'source-over';
  }
  const X = (lon: number) => ((lon + 180) / 360) * c.width;
  const Y = (lat: number) => ((90 - lat) / 180) * mh;
  g.fillStyle = '#e8d040';
  for (const p of track) g.fillRect(X(p.lon), Y(p.lat), 1, 1);
  g.fillStyle = '#ff5a30';
  g.fillRect(X(mpls.lon) - 1, Y(mpls.lat) - 1, 3, 3);
  g.fillStyle = '#ffffff';
  g.fillRect(X(sub.lon) - 2, Y(sub.lat) - 2, 5, 5);
  g.fillStyle = '#0a1a2c';
  g.fillRect(0, mh, c.width, c.height - mh);
  g.fillStyle = '#9fd0ff';
  g.font = '10px monospace';
  text.forEach((t, k) => g.fillText(t, 4, mh + 12 + k * 12));
  // Tex already set to update by the caller.
}

export function drawRadio(c: HTMLCanvasElement, freq: number, signal: number, on: boolean) {
  const g = c.getContext('2d')!;
  g.fillStyle = on ? '#2a1a06' : '#0c0c0c';
  g.fillRect(0, 0, c.width, c.height);
  if (!on) return;
  g.fillStyle = '#ffb030';
  g.font = 'bold 22px monospace';
  g.fillText(freq.toFixed(2), 8, 26);
  g.font = '10px monospace';
  g.fillText('MHz FM', 88, 26);
  for (let b = 0; b < 8; b++) {
    g.fillStyle = b < Math.round(signal * 8) ? '#ffb030' : '#4a3010';
    g.fillRect(8 + b * 9, 32, 7, 5);
  }
}
