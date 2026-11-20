// The world story on the globe: planes (blinking dots), ships (dim lights at sea) and the
// red rings of outbreaks elsewhere. Everything is read from src/game/world.ts at time t,
// so nothing here keeps its own state except the buffers.
import * as THREE from 'three';
import { ecef } from './geo';
import { FRONTS, frontRadius, planesAt, shipsAt } from '../game/world';

const MAX_PLANES = 600;
const MAX_SHIPS = 120;
const RING = 48;

function dots(n: number, color: number, size: number) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, depthWrite: false });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = 5;
  return p;
}

export class WorldFx {
  group = new THREE.Group();
  private planes = dots(MAX_PLANES, 0x9a9a96, 1);
  private planeBlink = dots(MAX_PLANES, 0xe23a1e, 2);
  private ships = dots(MAX_SHIPS, 0xda8a2e, 2);
  private rings: THREE.LineLoop[] = [];
  private v = new THREE.Vector3();

  constructor() {
    this.group.add(this.planes, this.planeBlink, this.ships);
    for (let k = 0; k < FRONTS.length; k++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RING * 3), 3));
      const ring = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xe23a1e, transparent: true, opacity: 0.8, depthWrite: false }));
      ring.frustumCulled = false;
      ring.renderOrder = 5;
      this.rings.push(ring);
      this.group.add(ring);
    }
  }

  /** t = game time; time = real seconds (for blinking); alt = camera height in km. */
  update(t: number, time: number, alt: number) {
    // From far away everything would be a smear; from very close it would be too sparse to matter.
    this.group.visible = alt > 60;
    if (!this.group.visible) return;
    const ps = planesAt(t);
    const pa = this.planes.geometry.attributes.position as THREE.BufferAttribute;
    const pb = this.planeBlink.geometry.attributes.position as THREE.BufferAttribute;
    let nb = 0;
    const n = Math.min(MAX_PLANES, ps.length);
    for (let k = 0; k < n; k++) {
      ecef(ps[k].lat, ps[k].lon, 11, this.v);
      pa.setXYZ(k, this.v.x, this.v.y, this.v.z);
      // Anti-collision strobes: each plane blinks on its own beat.
      if ((time * 1.3 + k * 0.37) % 1 < 0.18) pb.setXYZ(nb++, this.v.x, this.v.y, this.v.z);
    }
    pa.needsUpdate = pb.needsUpdate = true;
    this.planes.geometry.setDrawRange(0, n);
    this.planeBlink.geometry.setDrawRange(0, nb);

    const ss = shipsAt(t);
    const sa = this.ships.geometry.attributes.position as THREE.BufferAttribute;
    const m = Math.min(MAX_SHIPS, ss.length);
    for (let k = 0; k < m; k++) {
      ecef(ss[k].lat, ss[k].lon, 0.5, this.v);
      sa.setXYZ(k, this.v.x, this.v.y, this.v.z);
    }
    sa.needsUpdate = true;
    this.ships.geometry.setDrawRange(0, m);

    FRONTS.forEach((f, k) => {
      const r = frontRadius(f, t);
      const ring = this.rings[k];
      ring.visible = r > 0;
      if (!ring.visible) return;
      const ra = ring.geometry.attributes.position as THREE.BufferAttribute;
      // A marker, drawn a little wider than the spread so it reads from orbit.
      const shown = Math.max(120, r * 1.5);
      const dLat = shown / 111.2, dLon = shown / (111.2 * Math.cos((f.lat * Math.PI) / 180));
      // A slow pulse, so a growing outbreak catches the eye from orbit.
      const pulse = 1 + 0.15 * Math.sin(time * 2 + k);
      for (let j = 0; j < RING; j++) {
        const a = (j / RING) * Math.PI * 2;
        ecef(f.lat + Math.sin(a) * dLat * pulse, f.lon + Math.cos(a) * dLon * pulse, 1, this.v);
        ra.setXYZ(j, this.v.x, this.v.y, this.v.z);
      }
      ra.needsUpdate = true;
    });
  }
}
