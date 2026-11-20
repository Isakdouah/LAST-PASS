import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ecef } from './geo';
import { LabelPicker, minPopulation, worldNames, labelWidth } from './placeLabels';

const W = 1280, H = 720;
function cam(lat: number, lon: number, alt: number) {
  const c = new THREE.PerspectiveCamera(40, W / H, 0.01, 1e6);
  c.position.copy(ecef(lat, lon, alt));
  c.up.set(0, 0, 1);
  c.lookAt(ecef(lat, lon, 0));
  c.updateMatrixWorld();
  const project = (v: THREE.Vector3) => {
    const p = v.clone().project(c);
    if (p.z > 1 || p.z < -1) return null;
    return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H };
  };
  return { pos: c.position.clone(), project };
}
const names = worldNames();
const show = (lat: number, lon: number, alt: number, max = 60) => {
  const c = cam(lat, lon, alt);
  return names.pick(c.pos, c.project, W, H, 40, max).map((p) => names.list[p.i]);
};

describe('town names on the globe', () => {
  it('has the Twin Cities and their suburbs', () => {
    const n = new Set(names.list.map((p) => p.name));
    for (const t of ['Minneapolis', 'Saint Paul', 'Edina', 'Roseville', 'Falcon Heights']) expect(n.has(t)).toBe(true);
  });

  it('far away: only big cities', () => {
    const far = show(45, -93, 20000);
    expect(far.length).toBeGreaterThan(5);
    for (const p of far) expect(Math.pow(10, 3 + p.code / 50)).toBeGreaterThan(100000);
  });

  it('closer in: smaller towns appear, Saint Paul among them', () => {
    const near = show(44.96, -93.18, 60);
    expect(near.map((p) => p.name)).toContain('Saint Paul');
    expect(Math.min(...near.map((p) => p.code))).toBeLessThan(80); // under ~40,000 people
    expect(minPopulation(0.01)).toBe(1000);
  });

  it('the far side of the planet is never labelled', () => {
    const up = ecef(45, -93, 0).normalize();
    for (const p of show(45, -93, 20000)) expect(ecef(p.lat, p.lon, 0).normalize().dot(up)).toBeGreaterThan(6371 / (6371 + 20000) - 1e-6);
  });

  it('labels never overlap, and bigger places win', () => {
    const c = cam(52, 5, 900);
    const got = names.pick(c.pos, c.project, W, H, 40, 80);
    for (let a = 0; a < got.length; a++)
      for (let b = a + 1; b < got.length; b++) {
        const A = got[a], B = got[b];
        const wa = labelWidth(names.list[A.i].name, names.list[A.i].code) / 2 + 3, wb = labelWidth(names.list[B.i].name, names.list[B.i].code) / 2 + 3;
        const overlap = Math.abs(A.x - B.x) < wa + wb && Math.abs(A.y - B.y) < 19;
        expect(overlap).toBe(false);
      }
    for (let k = 1; k < got.length; k++) expect(names.list[got[k - 1].i].code).toBeGreaterThanOrEqual(names.list[got[k].i].code);
  });

  it('works across the date line', () => {
    const fiji = show(-17.8, 179.9, 600);
    expect(fiji.length).toBeGreaterThan(0);
  });

  it('a tiny made-up list behaves', () => {
    const p = new LabelPicker([
      { lat: 0, lon: 0, code: 150, name: 'Big' },
      { lat: 0, lon: 0.001, code: 10, name: 'Small' },
    ]);
    const c = cam(0, 0, 50);
    expect(p.pick(c.pos, c.project, W, H, 40).length).toBe(1);
  });
});
