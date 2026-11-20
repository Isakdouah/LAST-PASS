// Cameras. One "master" camera pose lives in the Earth-fixed frame (kilometres, full
// double precision in JavaScript). Each layer (globe, city, station) gets its own
// three.js camera in its own local units, so nothing shakes from float rounding.
import * as THREE from 'three';
import { ecef, enu, R_EARTH } from './geo';

export interface Pose {
  pos: THREE.Vector3; // km, Earth-fixed
  quat: THREE.Quaternion; // camera orientation, Earth-fixed
  fov: number;
}

/** A local frame: origin (km, Earth-fixed) and a rotation from local to Earth-fixed axes.
 *  Local units are metres. */
export class Frame {
  origin = new THREE.Vector3();
  rot = new THREE.Quaternion();
  private inv = new THREE.Quaternion();
  set(origin: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) {
    this.origin.copy(origin);
    this.rot.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.inv.copy(this.rot).invert();
    return this;
  }
  /** Put a camera into this frame's local space (metres). */
  apply(p: Pose, cam: THREE.PerspectiveCamera) {
    cam.position.copy(p.pos).sub(this.origin).multiplyScalar(1000).applyQuaternion(this.inv);
    cam.quaternion.copy(this.inv).multiply(p.quat);
    cam.fov = p.fov;
    cam.updateMatrixWorld();
  }
  /** Local metres to Earth-fixed km. */
  toEarth(v: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(v).applyQuaternion(this.rot).multiplyScalar(0.001).add(this.origin);
  }
  /** Earth-fixed km to local metres. */
  toLocal(v: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(v).sub(this.origin).multiplyScalar(1000).applyQuaternion(this.inv);
  }
}

/** Orientation looking from `pos` toward `at`, with `up` toward the top of the picture. */
export function lookQuat(pos: THREE.Vector3, at: THREE.Vector3, up: THREE.Vector3, out = new THREE.Quaternion()) {
  const m = new THREE.Matrix4().lookAt(pos, at, up);
  return out.setFromRotationMatrix(m);
}

const D = Math.PI / 180;
export const TELE = { minD: 0.09, maxD: 26000, fov: 40 };

/** The telescope: always looks at a ground point; distance from it zooms smoothly from
 *  the whole planet down to street level, leaning over (tilt) as it gets low so you see
 *  the buildings stand up. */
export class Telescope {
  lat = 45;
  lon = -93;
  d = 3000;
  heading = 0;
  tLat = 45;
  tLon = -93;
  tD = 3000;
  tHeading = 0;
  /** Lowest allowed distance right now (km); the game rules set it. */
  floor: number = TELE.minD;
  flying = false;

  tilt(d = this.d): number {
    const s = Math.max(0, Math.min(1, (Math.log(220) - Math.log(d)) / (Math.log(220) - Math.log(TELE.minD))));
    return 58 * D * Math.pow(s, 1.5);
  }

  jumpTo(lat: number, lon: number, d: number) {
    this.lat = this.tLat = lat;
    this.lon = this.tLon = lon;
    this.d = this.tD = d;
  }

  drag(dx: number, dy: number, screenH: number) {
    const kmPerPx = (2 * Math.min(this.d, R_EARTH * 2.5) * Math.tan((TELE.fov * D) / 2)) / screenH;
    const h = this.heading;
    // Screen right and up on the ground, in east/north parts.
    const rE = Math.cos(h), rN = -Math.sin(h);
    const uE = Math.sin(h), uN = Math.cos(h);
    const moveE = -dx * kmPerPx * rE + dy * kmPerPx * uE;
    const moveN = -dx * kmPerPx * rN + dy * kmPerPx * uN;
    this.tLat = Math.max(-85, Math.min(85, this.tLat + (moveN / R_EARTH) / D));
    this.tLon += moveE / (R_EARTH * Math.max(0.1, Math.cos(this.tLat * D))) / D;
    this.flying = false;
  }

  zoom(factor: number) {
    this.tD = Math.max(this.floor, Math.min(TELE.maxD, this.tD * factor));
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * (this.flying ? 2.2 : 9));
    let dl = this.tLon - this.lon;
    dl = ((((dl + 180) % 360) + 360) % 360) - 180;
    this.lon += dl * k;
    this.lat += (this.tLat - this.lat) * k;
    this.tD = Math.max(this.floor, this.tD);
    this.d = Math.exp(Math.log(this.d) + (Math.log(this.tD) - Math.log(this.d)) * k);
    this.heading += (this.tHeading - this.heading) * k;
    if (this.flying && Math.abs(dl) < 0.01 && Math.abs(this.tLat - this.lat) < 0.01) this.flying = false;
  }

  pose(out: Pose): Pose {
    const g = ecef(this.lat, this.lon, 0);
    const { e, n, u } = enu(this.lat, this.lon);
    const h = n.clone().multiplyScalar(Math.cos(this.heading)).addScaledVector(e, Math.sin(this.heading));
    const tau = this.tilt();
    out.pos.copy(g).addScaledVector(u, Math.cos(tau) * this.d).addScaledVector(h, -Math.sin(tau) * this.d);
    // Up on screen: the heading direction, tipped toward the sky as we lean over.
    const up = h.clone().multiplyScalar(Math.cos(tau)).addScaledVector(u, Math.sin(tau));
    lookQuat(out.pos, g, up, out.quat);
    out.fov = TELE.fov;
    return out;
  }
}

export function newPose(): Pose {
  return { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 40 };
}

/** Blend two poses (position along a straight line, orientation by slerp). */
export function blendPose(a: Pose, b: Pose, s: number, out: Pose): Pose {
  out.pos.copy(a.pos).lerp(b.pos, s);
  out.quat.copy(a.quat).slerp(b.quat, s);
  out.fov = a.fov + (b.fov - a.fov) * s;
  return out;
}
