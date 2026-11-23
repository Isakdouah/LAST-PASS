// The Earth from orbit: land and sea from a land mask, made-up but plausible ground
// colours, moving clouds, day and night from the real Sun position, city lights at
// night (every town over 15,000 people), the atmosphere's thin blue rim, and stars.
// Ground outside the station's line of sight is shown grey and still: an old photo.
import * as THREE from 'three';
import landUrl from '../data/earth-land.png';
import reliefUrl from '../data/earth-relief.png';
import citiesFile from '../data/cities.json';
import { R_EARTH } from './geo';

const NOISE = /* glsl */ `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(w.xyz);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D land;
uniform sampler2D relief;
uniform sampler2D lights;
uniform vec3 sun;
uniform vec3 foot;
uniform float footCos;
uniform float time;
uniform vec3 camPos;
uniform float thermal;
uniform float lightsFade;
varying vec3 vN;
varying vec3 vW;
${NOISE}
/** Real height (m) from the relief map: 128 = sea level, square-root scale to 8,000 m. */
float hgt(vec2 uv) {
  float v = (texture2D(relief, uv).r * 255.0 - 128.0) / 127.0;
  return sign(v) * v * v * 8000.0;
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  float lat = asin(clamp(n.z, -1.0, 1.0));
  float lon = atan(n.y, n.x);
  vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
  float l = smoothstep(0.35, 0.65, texture2D(land, uv).r);
  float alat = abs(lat) * 57.29578;
  // Ground: forest, steppe, desert by latitude and noise (a plausible guess, not real data).
  float nz = fbm(n * 14.0);
  float dry = smoothstep(0.55, 0.0, abs(alat - 24.0) / 22.0) * smoothstep(0.35, 0.7, nz + 0.15);
  vec3 forest = mix(vec3(0.10, 0.17, 0.09), vec3(0.22, 0.27, 0.13), nz);
  vec3 desert = mix(vec3(0.55, 0.44, 0.29), vec3(0.73, 0.62, 0.43), fbm(n * 31.0));
  vec3 tundra = vec3(0.30, 0.27, 0.22);
  vec3 ground = mix(forest, desert, dry);
  ground = mix(ground, tundra, smoothstep(55.0, 66.0, alat + nz * 6.0));
  ground = mix(ground, vec3(0.90, 0.92, 0.95), smoothstep(68.0, 74.0, alat + nz * 8.0));
  vec3 sea = mix(vec3(0.03, 0.10, 0.24), vec3(0.06, 0.18, 0.34), fbm(n * 9.0));
  // Real relief: mountains are rock, the highest carry snow; shallow seas over the shelves are paler.
  float hm = hgt(uv);
  ground = mix(ground, vec3(0.36, 0.32, 0.27), smoothstep(1200.0, 3000.0, hm) * 0.8);
  ground = mix(ground, vec3(0.92, 0.93, 0.96), smoothstep(5200.0, 6600.0, hm + (alat - 30.0) * 60.0));
  sea = mix(sea, vec3(0.07, 0.24, 0.38), smoothstep(-600.0, -60.0, hm) * 0.7);
  vec3 col = mix(sea, ground, l);
  // Slopes tilt the surface toward or away from the Sun (heights exaggerated 12x so you can read them).
  vec3 nl = n;
  {
    float ex = 1.0 / 2048.0, ey = 1.0 / 1024.0;
    float dx = (hgt(uv + vec2(ex, 0.0)) - hgt(uv - vec2(ex, 0.0))) / (2.0 * 6.2831853 * 6371000.0 * max(0.05, cos(lat)) * ex);
    float dy = (hgt(uv + vec2(0.0, ey)) - hgt(uv - vec2(0.0, ey))) / (2.0 * 3.1415927 * 6371000.0 * ey);
    vec3 east = normalize(vec3(-sin(lon), cos(lon), 0.0));
    vec3 north = vec3(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
    nl = normalize(n - 12.0 * l * (dx * east + dy * north));
  }
  // Clouds drift slowly eastward.
  vec3 cp = n * 5.0 + vec3(time * 0.004, 0.0, 0.0);
  float cl = smoothstep(0.52, 0.72, fbm(cp + fbm(cp * 2.0) * 0.6));
  cl *= 0.55 + 0.45 * smoothstep(5.0, 30.0, alat) ; // fewer clouds in the deep tropics, more in the storm belts
  col = mix(col, vec3(0.88, 0.89, 0.92), cl * 0.9);
  // Sunlight.
  float ndl = dot(n, sun);
  float day = smoothstep(-0.08, 0.18, ndl);
  float ndl2 = dot(nl, sun);
  vec3 lit = col * (0.15 + 0.95 * clamp(ndl2 * 1.3 + 0.12, 0.0, 1.0));
  // Sunset band along the terminator.
  lit += vec3(0.35, 0.12, 0.02) * exp(-pow(ndl * 9.0, 2.0)) * 0.5;
  vec3 night = col * vec3(0.012, 0.016, 0.03) + vec3(0.004, 0.006, 0.012);
  float city = texture2D(lights, uv).r * lightsFade;
  night += vec3(1.0, 0.62, 0.22) * city * 1.3 * (1.0 - cl * 0.75) * l;
  vec3 c = mix(night, lit, day);
  // Atmosphere: blue haze toward the edge of the disc (day side), faint at night.
  vec3 v = normalize(camPos - vW);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  c += vec3(0.12, 0.25, 0.55) * rim * (0.15 + 0.85 * smoothstep(-0.25, 0.3, ndl));
  // Out of the station's sight: an old grey photo.
  float inSight = smoothstep(footCos - 0.002, footCos + 0.002, dot(n, foot));
  float g = dot(c, vec3(0.3, 0.5, 0.2));
  vec3 photo = vec3(g) * vec3(0.55, 0.56, 0.62);
  c = mix(photo, c, 0.35 + 0.65 * inSight);
  // The edge of sight: a thin line.
  c += vec3(0.6, 0.5, 0.2) * (1.0 - smoothstep(0.0, 0.0015, abs(dot(n, foot) - footCos))) * 0.35;
  if (thermal > 0.5) c = vec3(0.05 + city * 0.6 * (1.0 - day) + 0.15 * l);
  gl_FragColor = vec4(c, 1.0);
}`;

const HALO_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 sun;
uniform vec3 camPos;
varying vec3 vN;
varying vec3 vW;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  vec3 v = normalize(camPos - vW);
  float edge = pow(1.0 - abs(dot(n, v)), 2.2);
  float d = smoothstep(-0.3, 0.4, dot(n, sun));
  vec3 c = mix(vec3(0.02, 0.03, 0.08), vec3(0.25, 0.45, 0.9), d) * edge;
  gl_FragColor = vec4(c, edge * (0.25 + 0.75 * d));
}`;

/** City list from tools/build_lights.py: lat, lon, size code. */
export interface CityLight {
  lat: number;
  lon: number;
  code: number;
}
export const cityLights: CityLight[] = (() => {
  const f = citiesFile as unknown as { n: number; pts: string };
  const bin = atob(f.pts);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  const dv = new DataView(b.buffer);
  const out: CityLight[] = [];
  for (let k = 0; k < f.n; k++) {
    const o = k * 5;
    out.push({ lat: dv.getInt16(o, true) / 100, lon: dv.getInt16(o + 2, true) / 100, code: dv.getUint8(o + 4) });
  }
  return out;
})();

export class Globe {
  scene = new THREE.Scene();
  mat: THREE.ShaderMaterial;
  private halo: THREE.ShaderMaterial;
  private lightsCanvas = document.createElement('canvas');
  private lightsTex: THREE.CanvasTexture;
  private stars: THREE.Points;

  constructor() {
    const landTex = new THREE.TextureLoader().load(landUrl);
    const reliefTex = new THREE.TextureLoader().load(reliefUrl);
    reliefTex.colorSpace = THREE.NoColorSpace;
    landTex.minFilter = THREE.LinearFilter;
    landTex.generateMipmaps = false;
    this.lightsCanvas.width = 4096;
    this.lightsCanvas.height = 2048;
    this.lightsTex = new THREE.CanvasTexture(this.lightsCanvas);
    this.lightsTex.minFilter = THREE.LinearFilter;
    this.lightsTex.generateMipmaps = false;
    this.drawLights(() => 1);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        land: { value: landTex },
        relief: { value: reliefTex },
        lights: { value: this.lightsTex },
        sun: { value: new THREE.Vector3(1, 0, 0) },
        foot: { value: new THREE.Vector3(1, 0, 0) },
        footCos: { value: 0.95 },
        time: { value: 0 },
        camPos: { value: new THREE.Vector3() },
        thermal: { value: 0 },
        lightsFade: { value: 1 },
      },
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 384, 192), this.mat);
    earth.rotation.x = Math.PI / 2; // sphere poles on z (our north)
    this.scene.add(earth);
    this.halo = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { sun: this.mat.uniforms.sun, camPos: this.mat.uniforms.camPos },
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH + 90, 128, 64), this.halo);
    halo.rotation.x = Math.PI / 2;
    this.scene.add(halo);
    // Stars: fixed directions far away (they follow the camera so they never get closer).
    const n = 3500;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < n; k++) {
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos.set([r * Math.cos(a) * 9e5, r * Math.sin(a) * 9e5, z * 9e5], k * 3);
      const b = Math.pow(rnd(), 3) * 0.9 + 0.1;
      const warm = rnd();
      col.set([b * (0.8 + 0.2 * warm), b * 0.85, b * (1.0 - 0.2 * warm)], k * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  /** Paint the night lights; `power(k)` (0..1) dims city k (power cuts, the dark). */
  drawLights(power: (k: number) => number) {
    const c = this.lightsCanvas, g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < cityLights.length; k++) {
      const p = power(k);
      if (p <= 0.01) continue;
      const cty = cityLights[k];
      const x = ((cty.lon + 180) / 360) * c.width;
      const y = ((90 - cty.lat) / 180) * c.height;
      const size = 0.6 + (cty.code / 64) ** 2 * 0.9; // pixels; 10 million people is about 9 px
      const a = Math.min(1, 0.25 + cty.code / 220) * p;
      g.fillStyle = `rgba(255,255,255,${(a * 0.3).toFixed(3)})`;
      g.beginPath();
      g.arc(x, y, size * 1.7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      g.beginPath();
      g.arc(x, y, Math.max(0.5, size * 0.6), 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    this.lightsTex.needsUpdate = true;
  }

  update(sun: THREE.Vector3, foot: THREE.Vector3, footCos: number, camPos: THREE.Vector3, time: number) {
    const u = this.mat.uniforms;
    u.sun.value.copy(sun);
    u.foot.value.copy(foot);
    u.footCos.value = footCos;
    u.camPos.value.copy(camPos);
    u.time.value = time;
    // Up close the blurry night-lights picture would smear: the 3D city takes over.
    const alt = camPos.length() - R_EARTH;
    u.lightsFade.value = Math.min(1, Math.max(0.0, (alt - 15) / 150));
    this.stars.position.copy(camPos);
  }
}
