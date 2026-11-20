// Last Pass, rough draft 2: the 3D engine. One night over Minneapolis, 16 October 2009.
// Three ways to look: from the Cupola (your seat, looking down at the Earth), from outside
// the station, and through the telescope, which zooms smoothly from the whole planet to
// one street corner. You can only see and talk to Minneapolis while it is in sight.
import { worldNames, BIG, type Placed } from './engine/placeLabels';
import './ui/hud.css';
import * as THREE from 'three';
import { Sound } from './audio';
import { fmt, inWindow, localTime, MPLS, realSeconds, subPoint, untilWindow, passIndex } from './game/clock';
import { tuned } from './game/radio';
import { Box, GH, GW, Mode, places, Session, CELL_X } from './game/session';
import { Pixel } from './engine/pixel';
import { Globe, cityLights } from './engine/globe';
import { CityLayer, cellToLocal, localToCell } from './engine/city';
import { buildCupola, buildStation, drawLaptop, drawRadio } from './engine/station';
import { arcKm, ALT_ISS, ecef, enu, FOOTPRINT_KM, latLonOf, R_EARTH, station, sunDir } from './engine/geo';
import { blendPose, Frame, lookQuat, newPose, Pose, Telescope, TELE } from './engine/views';
import { Hud, esc } from './ui/hud';
import { WorldFx } from './engine/worldfx';
import { darkness } from './game/world';
import { HEROES, heroById, routeCells as routeCellsOf, escapeAt as escapeAtOf, seenAs } from './game/heroes';
import { drawDollhouse } from './ui/dollhouse';
import { cardHtml, drawPortrait } from './ui/card';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const px = new Pixel(canvas);
const hud = new Hud();
const sound = new Sound();
const game = new Session(sound);
game.say = (who, text, secs) => hud.say(who, text, secs);

// ---------- scenes ----------
const globe = new Globe();
const city = new CityLayer();
const worldFx = new WorldFx();
globe.scene.add(worldFx.group);
const stationScene = new THREE.Scene();
const iss = buildStation();
const cup = buildCupola();
stationScene.add(iss.root);
const eyeLocal = iss.cupolaAt.clone().add(new THREE.Vector3(0, 1.0, 0));
cup.root.position.copy(eyeLocal);
stationScene.add(cup.root);
const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.4);
stationScene.add(sunLight, sunLight.target);
const earthGlow = new THREE.HemisphereLight(0x1a2234, 0x2a3a5a, 0.5);
stationScene.add(earthGlow);
// In Earth's shadow the real station is nearly black; a soft fill (as if from the
// floodlights and the glow below) keeps it readable. A game choice, not physics.
const fill = new THREE.DirectionalLight(0x8090b0, 0.0);
stationScene.add(fill, fill.target);
const cupolaShell = iss.root.children.find((c) => c instanceof THREE.Group && c.position.distanceTo(iss.cupolaAt) < 1.0);
// Orbit path in the globe scene.
const trackGeo = new THREE.BufferGeometry();
trackGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(240 * 3), 3));
const track = new THREE.Line(trackGeo, new THREE.LineBasicMaterial({ color: 0xc8a030, transparent: true, opacity: 0.6 }));
track.frustumCulled = false;
globe.scene.add(track);

const camGlobe = new THREE.PerspectiveCamera(40, 16 / 9, 0.0005, 2e6);
const camCity = new THREE.PerspectiveCamera(40, 16 / 9, 0.3, 3e6);
const camStation = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 2e5);
const cityFrame = new Frame();
const CITY_C = { lat: (44.87 + 45.06) / 2, lon: (-93.36 + -93.0) / 2 };
{
  const { e, n, u } = enu(CITY_C.lat, CITY_C.lon);
  cityFrame.set(ecef(CITY_C.lat, CITY_C.lon, 0), e, u, n.clone().negate());
}
const stFrame = new Frame();

// ---------- views ----------
type View = 'cupola' | 'outside' | 'tele';
let view: View = 'cupola';
const tele = new Telescope();
const look = { yaw: 0, pitch: 0 }; // cupola: 0,0 = straight down, top of picture = flight direction
const orbitCam = { yaw: 2.4, pitch: 0.35, dist: 75 };
const pose = newPose();
const fromPose = newPose();
let blend = 1; // 1 = done
let thermal = false;
let playerName = 'Astronaut';
try {
  playerName = localStorage.getItem('lastpass.name') || playerName;
} catch {
  /* private window: fine */
}
const handAct = { tune: 0, talk: 0 };

function setView(v: View) {
  if (v === view) return;
  fromPose.pos.copy(pose.pos);
  fromPose.quat.copy(pose.quat);
  fromPose.fov = pose.fov;
  if (v === 'tele' && view !== 'tele') {
    // Start exactly where the Cupola looks: straight down from the station, then zoom.
    const s = station(game.t);
    const { e, n } = enu(s.lat, s.lon);
    tele.jumpTo(s.lat, s.lon, ALT_ISS);
    tele.heading = tele.tHeading = Math.atan2(s.fwd.dot(e), s.fwd.dot(n));
  }
  view = v;
  blend = 0;
}

function poseCupola(out: Pose) {
  const dir = new THREE.Vector3(0, -1, 0);
  dir.applyAxisAngle(new THREE.Vector3(0, 0, 1), look.pitch); // tip toward forward
  dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), look.yaw);
  const upHint = look.pitch > 0.6 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), look.yaw);
  const q = lookQuat(eyeLocal, eyeLocal.clone().add(dir), upHint);
  stFrame.toEarth(eyeLocal, out.pos);
  out.quat.copy(stFrame.rot).multiply(q);
  out.fov = 80;
}
function poseOutside(out: Pose) {
  const c = new THREE.Vector3(-6, 0, 0);
  const p = new THREE.Vector3(
    Math.cos(orbitCam.pitch) * Math.cos(orbitCam.yaw),
    Math.sin(orbitCam.pitch),
    Math.cos(orbitCam.pitch) * Math.sin(orbitCam.yaw),
  )
    .multiplyScalar(orbitCam.dist)
    .add(c);
  const q = lookQuat(p, c, new THREE.Vector3(0, 1, 0));
  stFrame.toEarth(p, out.pos);
  out.quat.copy(stFrame.rot).multiply(q);
  out.fov = 45;
}

// ---------- game rules for the telescope ----------
const inCityBox = (lat: number, lon: number) => lat > 44.85 && lat < 45.08 && lon > -93.38 && lon < -92.98;
function teleFloor(): { floor: number; why: string } {
  const s = station(game.t);
  const away = arcKm(s.lat, s.lon, tele.tLat, tele.tLon);
  if (game.mode === 'sandbox' && inCityBox(tele.tLat, tele.tLon)) return { floor: TELE.minD, why: '' };
  if (away > FOOTPRINT_KM) return { floor: 1800, why: 'That ground is below the horizon from the station. Old photo only.' };
  if (inCityBox(tele.tLat, tele.tLon)) {
    if (game.canLook()) return { floor: TELE.minD, why: '' };
    return { floor: 1800, why: '' };
  }
  return { floor: 40, why: 'Only Minneapolis is mapped up close in this demo.' };
}

/** Ground point (lat, lon) under a screen position, or null (sky). */
function pick(sx: number, sy: number): { lat: number; lon: number } | null {
  const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camGlobe);
  const o = ray.ray.origin, d = ray.ray.direction;
  const b = o.dot(d), c = o.lengthSq() - R_EARTH * R_EARTH;
  const disc = b * b - c;
  if (disc < 0) return null;
  const tt = -b - Math.sqrt(disc);
  if (tt < 0) return null;
  const ll = latLonOf(o.clone().addScaledVector(d, tt));
  return { lat: ll.lat, lon: ll.lon };
}
function pickCell(sx: number, sy: number) {
  const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camCity);
  const tt = -ray.ray.origin.y / ray.ray.direction.y;
  if (!(tt > 0)) return null;
  return localToCell(ray.ray.origin.clone().addScaledVector(ray.ray.direction, tt));
}

// ---------- input ----------
// ---------- hero ID cards ----------
const cardEl = document.createElement('div');
cardEl.id = 'card';
document.body.appendChild(cardEl);
const portraits = new Map<string, string>();
let cardId = '';
let cardShown = 0;
function portraitUrl(id: string, known: boolean) {
  const key = id + (known ? '+' : '-');
  if (!portraits.has(key)) portraits.set(key, drawPortrait(heroById(id)!.portrait, known).toDataURL());
  return portraits.get(key)!;
}
function renderCard() {
  const h = heroById(cardId), st = game.heroState(cardId);
  if (!h || !st) return;
  const gr = game.radio.groups.find((g) => g.id === cardId);
  cardEl.innerHTML = cardHtml(h, st, gr, portraitUrl(cardId, !!gr && gr.known));
  // The dollhouse: only for a hero inside a building, once you have talked to them.
  const b = game.buildings.get(cardId);
  if (b && gr && gr.known) {
    const inside = st.escapeStart < 0 && !st.dead;
    const img = drawDollhouse(b, inside, thermal, performance.now() / 1000).toDataURL();
    const first = h.name.split(' ')[0];
    const note = inside ? `Sketch from what ${first} tells you. Grey floors: no news yet${thermal ? ' (thermal shows warm shapes)' : ' (T: thermal)'}.` : `${first} is not in the building any more. Last known.`;
    cardEl.querySelector('.notes')?.insertAdjacentHTML('beforebegin', `<div class="dollhouse"><div class="dht">Inside: ${b.name}</div><img src="${img}" alt=""><div class="dhn">${note}</div></div>`);
  }
  cardEl.querySelector('.close')?.addEventListener('click', closeCard);
  cardShown = performance.now();
}
function openCard(id: string) {
  const st = game.heroState(id);
  if (!st) return;
  if (!st.seen) {
    st.seen = true;
    st.log.push({ t: game.t, text: `${localTime(game.t)} Pass ${passIndex(game.t) + 1}: seen from orbit: ${seenAs(heroById(id)!, st)}.` });
  }
  cardId = id;
  city.selected = id;
  cardEl.classList.add('open');
  renderCard();
}
function closeCard() {
  cardId = '';
  city.selected = '';
  cardEl.classList.remove('open');
}
/** The hero under the mouse (within 40 px), if any. */
function heroAt(sx: number, sy: number): string {
  let best = '', bd = 40;
  for (const h of HEROES) {
    const p = city.heroPos(h.id);
    if (!p) continue;
    const q = p.project(camCity);
    if (q.z > 1) continue;
    const x = ((q.x + 1) / 2) * window.innerWidth, y = ((1 - q.y) / 2) * window.innerHeight;
    const d = Math.hypot(x - sx, y - sy);
    if (d < bd) (bd = d), (best = h.id);
  }
  return best;
}

let mode: Mode | 'name' = 'title';
let drag: { x: number; y: number; moved: boolean; button: number } | null = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  sound.start();
  drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  drag.moved = true;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (view === 'tele') {
    if (drag.button === 2) tele.tHeading -= dx * 0.005;
    else tele.drag(dx, dy, window.innerHeight);
  } else if (view === 'cupola') {
    look.yaw -= dx * 0.004;
    look.pitch = THREE.MathUtils.clamp(look.pitch + dy * 0.004, 0, 1.45);
  } else {
    orbitCam.yaw += dx * 0.005;
    orbitCam.pitch = THREE.MathUtils.clamp(orbitCam.pitch + dy * 0.005, -1.4, 1.4);
  }
});
window.addEventListener('mouseup', (e) => {
  if (drag && !drag.moved && (mode === 'play' || mode === 'sandbox') && view === 'tele' && drag.button === 0) {
    const id = game.canLook() && tele.d < 4 ? heroAt(e.clientX, e.clientY) : '';
    if (id) {
      openCard(id);
      drag = null;
      return;
    }
    if (cardId) closeCard();
  }
  if (drag && !drag.moved && mode === 'sandbox' && view === 'tele') {
    const c = pickCell(e.clientX, e.clientY);
    if (c && c.x >= 0 && c.y >= 0 && c.x < GW && c.y < GH) game.seed(c.x, c.y, 25);
  }
  drag = null;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    sound.start();
    if (mode !== 'play' && mode !== 'sandbox') return;
    if (view === 'cupola') {
      if (e.deltaY < 0) setView('tele');
      return;
    }
    if (view === 'outside') {
      orbitCam.dist = THREE.MathUtils.clamp(orbitCam.dist * Math.exp(e.deltaY * 0.001), 18, 260);
      return;
    }
    // Zoom toward the point under the mouse, so you can aim while zooming.
    const f = Math.exp(e.deltaY * 0.0012);
    if (f < 1 && !tele.flying) {
      // Move the aim by the same share as the zoom, measured from what is on screen now.
      const p = pick(e.clientX, e.clientY);
      if (p) {
        const k = (1 - f) * 0.9;
        let dl = p.lon - tele.lon;
        dl = ((((dl + 180) % 360) + 360) % 360) - 180;
        tele.tLat += (p.lat - tele.lat) * k;
        tele.tLon += dl * k;
      }
    }
    const before = tele.tD;
    tele.zoom(f);
    if (f < 1 && tele.tD === before) {
      const why = teleFloor().why || (game.canLook() ? '' : `Minneapolis is out of sight. Next pass in ${fmt(realSeconds(game.t, game.t + untilWindow(game.t)))}.`);
      if (why) hud.say('', why, 3);
    }
  },
  { passive: false },
);
window.addEventListener('resize', () => px.resize());

window.addEventListener('keydown', (e) => {
  sound.start();
  const k = e.key;
  if (mode === 'name') return; // the name box handles keys
  if (mode === 'title') {
    if (k === 'Enter') askName();
    if (k === '`') start('sandbox'); // developer sandbox
    return;
  }
  if (mode === 'end') {
    if (k === 'Enter') start('play');
    if (k === 'Escape') toTitle();
    return;
  }
  if (k === 'Escape') return cardId ? closeCard() : toTitle();
  if (k === '1') setView('cupola');
  if (k === '2') setView('outside');
  if (k === '3') setView('tele');
  if (k === 'f' || k === 'F') {
    // Snap the telescope back to the ground under the station.
    const s = subPoint(game.t);
    if (view !== 'tele') setView('tele');
    tele.tLat = s.lat;
    tele.tLon = s.lon;
    tele.tD = Math.max(tele.floor, ALT_ISS);
    tele.flying = true;
  }
  if (k === 'g' || k === 'G') {
    if (view !== 'tele') setView('tele');
    tele.tLat = MPLS.lat;
    tele.tLon = MPLS.lon;
    tele.tD = Math.max(tele.d, 60);
    tele.flying = true;
  }
  if (k === 'q' || k === 'Q') tele.tHeading += 0.4;
  if (k === 'e' || k === 'E') tele.tHeading -= 0.4;
  if (k === ' ') game.paused = !game.paused;
  if (k === 't' || k === 'T') {
    thermal = !thermal;
    px.uniforms.thermal.value = thermal ? 1 : 0;
    city.setThermal(thermal);
    globe.mat.uniforms.thermal.value = thermal ? 1 : 0;
  }
  if (k === 'm' || k === 'M') {
    sound.muted = !sound.muted;
    if (sound.muted) sound.hush();
  }
  if (k === '+' || k === '=') tele.zoom(0.6);
  if (k === '-') tele.zoom(1.6);
  const tuneBy = (df: number) => {
    game.tune(df);
    handAct.tune = 1.2;
  };
  if (k === 'ArrowRight') tuneBy(e.shiftKey ? 0.5 : 0.02);
  if (k === 'ArrowLeft') tuneBy(e.shiftKey ? -0.5 : -0.02);
  if (k === 'ArrowUp') tuneBy(0.5);
  if (k === 'ArrowDown') tuneBy(-0.5);
  if (k === 'w' || k === 'W') {
    const { group, signal } = tuned(game.radio);
    if (group && signal >= 0.75 && game.radioUp()) hud.say(playerName, `${group.who.split(' ')[0]}, this is ${playerName} on the space station. Listen to me.`, 4);
    handAct.talk = 3;
    game.doWarn();
  }
  if (k === 'p' || k === 'P') {
    handAct.talk = 2;
    game.doPatch();
  }
  if ((k === 'h' || k === 'H') && game.mode === 'play') {
    handAct.talk = 3;
    game.doHeadcast();
  }
  if ((k === 'd' || k === 'D') && game.mode === 'play') {
    handAct.talk = 3;
    game.doDebunk();
  }
  if (game.mode === 'sandbox') {
    if (k === 'r' || k === 'R') game.reset('sandbox');
    if (k >= '5' && k <= '8') game.sandboxRate = [3, 6, 15, 40][Number(k) - 5];
  }
});

// ---------- screens ----------
function toTitle() {
  sound.hush();
  mode = 'title';
  game.mode = 'title';
  hud.clearSay();
  hud.screen.innerHTML = '';
}
function askName() {
  mode = 'name';
  hud.screen.innerHTML = `<h1>LAST PASS</h1>
    <div>What is your name, astronaut?</div><br>
    <div><input id="nameBox" maxlength="18" value="${esc(playerName === 'Astronaut' ? '' : playerName)}" placeholder="type a name"></div><br>
    <div class="mark">[Enter] begin</div>
    <div class="small"><br>Placeholder: the name is used when you speak on the radio.</div>`;
  const box = document.getElementById('nameBox') as HTMLInputElement;
  box.focus();
  box.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      playerName = box.value.trim().slice(0, 18) || 'Astronaut';
      try {
        localStorage.setItem('lastpass.name', playerName);
      } catch {
        /* fine */
      }
      start('play');
    }
    if (e.key === 'Escape') toTitle();
  });
}
function start(m: 'play' | 'sandbox') {
  game.reset(m);
  mode = m;
  hud.screen.innerHTML = '';
  hud.clearSay();
  view = 'cupola';
  look.yaw = 0;
  look.pitch = 0;
  blend = 1;
  if (m === 'sandbox') {
    view = 'tele';
    tele.jumpTo(MPLS.lat, MPLS.lon, 8);
    hud.say('', 'Sandbox (developer): click the ground to start an outbreak. 5-8 change speed, R resets.', 6);
  } else {
    hud.say('', `Friday 16 October 2009, 19:40 in Minneapolis and St Paul. ${playerName}, you are alone on the station. It comes over the city at 20:00.`, 9);
    setTimeout(() => {
      if (mode === 'play') hud.say('', 'Scroll in to look through the telescope. Arrow keys tune the radio. 1 Cupola, 2 outside, 3 telescope.', 9);
    }, 9000);
  }
}
function titleText() {
  return `<h1>LAST PASS</h1>
    <div>Minneapolis. Friday 16 October 2009. One night, six passes.</div>
    <div>You are the last one up here. You cannot move anyone.</div>
    <div>You can look, listen, speak and connect people.</div><br>
    <div class="mark">[Enter] begin</div><br>
    <div class="small">Headphones on. Rough draft 2: names, voices and lines are placeholders.<br>
    Map data © OpenStreetMap contributors (ODbL). Place names and city lights: GeoNames (CC BY 4.0). Numbers are estimates.</div>`;
}
function endText() {
  const { alive, dead, fallen } = game.totals();
  const r = game.radio;
  let h = `<h1>DAWN</h1><div>The station drifts away from Minneapolis.</div><br>`;
  h += `<div>Living: <span class="mark">${Math.round(alive).toLocaleString('en-US')}</span> of ${Math.round(game.startPop).toLocaleString('en-US')} (${Math.round((alive / game.startPop) * 100)}%) · Turned: ${Math.round(dead).toLocaleString('en-US')} · Fallen: ${Math.round(fallen).toLocaleString('en-US')}</div><br>`;
  h += `<div>The people you talked to:</div><div class="small">`;
  for (const g of r.groups) {
    if (g.kind === 'broadcast') continue;
    const fate = !g.known ? 'never heard from' : g.silent || g.status === 'overrun' ? g.fate || 'lost' : g.status === 'contact' ? 'still fighting at dawn' : 'alive at dawn';
    h += `${esc(g.name)}: ${fate}<br>`;
  }
  const s = r.stats;
  h += `<br>${s.warnRight} warnings came true, ${s.warnWrong} false alarms, ${s.refused} times they did not trust you. Patches: ${s.patches}.</div><br>`;
  h += `<div class="mark">[Enter] play the night again · [Esc] menu</div>`;
  return h;
}

// ---------- per frame ----------
let lastFrame = performance.now();
let lastLights = -1;
let lastOverlay = 0;
let fpsAcc = 0, fpsN = 0, fps = 0, cpuAvg = 0;
const tmp = new THREE.Vector3();
const tPose = newPose();
const cityLL = new Float32Array(cityLights.length * 2);
cityLights.forEach((c, k) => cityLL.set([c.lat, c.lon], k * 2));

function frame(now: number) {
  const cpu0 = performance.now();
  const realDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  fpsAcc += realDt;
  fpsN++;
  if (fpsAcc > 1) {
    fps = fpsN / fpsAcc;
    fpsAcc = fpsN = 0;
  }
  const time = now / 1000;
  const playing = mode === 'play' || mode === 'sandbox';
  if (mode === 'title' && !hud.screen.innerHTML) hud.screen.innerHTML = titleText();
  // Behind the title: the station drifting over the night side.
  if (!playing && mode !== 'end') game.t = 600 + time * 3;

  const s = station(game.t);
  stFrame.set(s.pos, s.fwd, s.up, s.right);

  // Camera pose for the current view.
  tele.floor = teleFloor().floor;
  tele.update(realDt);
  if (!playing) {
    orbitCam.yaw = 2.2 + time * 0.03;
    orbitCam.pitch = 0.25;
    orbitCam.dist = 85;
    poseOutside(tPose);
  } else if (view === 'cupola') poseCupola(tPose);
  else if (view === 'outside') poseOutside(tPose);
  else tele.pose(tPose);
  if (blend < 1) {
    blend = Math.min(1, blend + realDt / 1.1);
    const e = blend * blend * (3 - 2 * blend);
    blendPose(fromPose, tPose, e, pose);
  } else {
    pose.pos.copy(tPose.pos);
    pose.quat.copy(tPose.quat);
    pose.fov = tPose.fov;
  }

  // The simulation: the street zone follows the telescope when it is low over the city.
  let zone: Box | null = null;
  const camAlt = pose.pos.length() - R_EARTH;
  const lookCell = { x: ((tele.lon + 93.36) / 0.36) * GW, y: ((45.06 - tele.lat) / 0.19) * GH };
  if (playing && view === 'tele' && tele.d < 1.5 && inCityBox(tele.lat, tele.lon)) {
    const half = Math.max(3, (tele.d * 1000 * 0.9) / CELL_X);
    const fx = Math.sin(tele.heading), fy = -Math.cos(tele.heading);
    const cx = lookCell.x + fx * half * 0.4, cy = lookCell.y + fy * half * 0.4;
    zone = { x0: Math.max(0, cx - half), y0: Math.max(0, cy - half), x1: Math.min(GW, cx + half), y1: Math.min(GH, cy + half) };
  }
  if (playing) {
    game.simulate(realDt, now, zone, !!zone);
    if (game.street && game.street.shots) sound.shot(Math.min(1, 0.3 / Math.max(0.09, tele.d)) * Math.min(1, game.street.shots / 2));
    if (game.mode === 'end') {
      mode = 'end';
      hud.screen.innerHTML = endText();
    }
  }

  // Sun, sight, globe.
  const sun = sunDir(game.t);
  globe.update(sun, s.up, Math.cos(FOOTPRINT_KM / R_EARTH), pose.pos, game.t);
  // Minneapolis on the night-lights map follows the simulation: lights go out as it falls.
  // Elsewhere the scripted outbreaks put the lights out (redrawn every 15 game minutes).
  const mplsDark = Math.round(darkShare() * 20);
  const lightsKey = mplsDark + 100 * Math.floor(game.t / 900);
  if (lightsKey !== lastLights) {
    lastLights = lightsKey;
    const ll = { lat: 0, lon: 0 };
    globe.drawLights((k) => {
      ll.lat = cityLL[k * 2];
      ll.lon = cityLL[k * 2 + 1];
      if (Math.abs(ll.lat - MPLS.lat) < 0.4 && Math.abs(ll.lon - MPLS.lon) < 0.6) return 1 - mplsDark / 20;
      return 1 - darkness(ll, game.t);
    });
  }
  worldFx.update(game.t, time, camAlt);
  {
    const pa = trackGeo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < 240; k++) {
      const p = subPoint(game.t + (k - 60) * 25);
      ecef(p.lat, p.lon, ALT_ISS, tmp);
      pa.setXYZ(k, tmp.x, tmp.y, tmp.z);
    }
    pa.needsUpdate = true;
    track.visible = playing && view === 'tele' && tele.d > 500;
  }

  // Cameras for each layer.
  const aspect = px.w / px.h;
  camGlobe.aspect = camCity.aspect = camStation.aspect = aspect;
  camGlobe.position.copy(pose.pos);
  camGlobe.quaternion.copy(pose.quat);
  camGlobe.fov = pose.fov;
  camGlobe.near = Math.max(0.0005, camAlt * 0.0005);
  camGlobe.updateProjectionMatrix();
  camGlobe.updateMatrixWorld();
  cityFrame.apply(pose, camCity);
  camCity.near = Math.max(0.3, camAlt * 0.05);
  camCity.updateProjectionMatrix();
  stFrame.apply(pose, camStation);
  camStation.near = view === 'cupola' ? 0.02 : 0.2;
  camStation.updateProjectionMatrix();

  // City layer: fades in as you come down over Minneapolis.
  const camLL = latLonOf(pose.pos);
  const cityKm = arcKm(camLL.lat, camLL.lon, CITY_C.lat, CITY_C.lon);
  city.alpha = THREE.MathUtils.clamp((700 - camAlt) / 450, 0, 1) * (cityKm < 400 ? 1 : 0);
  if (now - lastOverlay > 250) {
    lastOverlay = now;
    city.updateOverlay(game);
  }
  if (city.alpha > 0) city.update(game, camCity.position, lookCell, view === 'tele' ? tele.d : camAlt, time, px.h, pose.fov);

  // Station: sunlight (none in Earth's shadow), arrays turn to the Sun, lights blink.
  const sunLocal = sun.clone().applyQuaternion(stFrame.rot.clone().invert());
  const inShadow = s.pos.dot(sun) < 0 && s.pos.clone().addScaledVector(sun, -s.pos.dot(sun)).length() < R_EARTH;
  sunLight.position.copy(sunLocal).multiplyScalar(100);
  sunLight.intensity = inShadow ? 0 : 2.4;
  earthGlow.intensity = inShadow ? 1.1 : 0.8;
  fill.intensity = inShadow ? 0.9 : 0.2;
  fill.position.copy(camStation.position).add(new THREE.Vector3(0, 40, 0));
  for (const a of iss.arrays) a.rotation.z = Math.atan2(sunLocal.x, sunLocal.y);
  iss.lights.visible = Math.floor(time * 1.2) % 2 === 0;
  const inside = playing && view === 'cupola' && blend > 0.6;
  if (cupolaShell) cupolaShell.visible = !inside;
  updateCupola(time, realDt);

  // Draw: globe, then city, then the station (each layer clears depth).
  px.begin();
  px.layer(globe.scene, camGlobe);
  if (city.alpha > 0) px.layer(city.scene, camCity);
  if (view !== 'tele' || blend < 1 || !playing) px.layer(stationScene, camStation);
  px.end();

  // Text.
  hud.show(playing);
  hud.beginLabels();
  if (playing) {
    drawLabels();
    hud.update(game, { view, viewText: viewText(), hint: hintText(), keys: keysText(), name: playerName });
  }
  hud.endLabels();
  if (cardId && now - cardShown > 500) renderCard();
  cpuAvg = cpuAvg * 0.95 + (performance.now() - cpu0) * 0.05;
  requestAnimationFrame(frame);
}

function darkShare() {
  let dark = 0, land = 0;
  const w = game.world;
  for (let i = 0; i < w.land.length; i += 5) {
    if (!w.land[i] || w.healthy[i] + w.infected[i] < 1) continue;
    land++;
    if (game.isDark(i)) dark++;
  }
  return land ? dark / land : 0;
}

function updateCupola(time: number, dt: number) {
  handAct.tune = Math.max(0, handAct.tune - dt);
  handAct.talk = Math.max(0, handAct.talk - dt);
  const breathe = Math.sin(time * 1.3) * 0.006;
  const R = cup.hands.right, L = cup.hands.left;
  // Right hand reaches for the tuning knob while you tune; left lifts the mic to talk.
  const rt = handAct.tune > 0 ? 1 : 0;
  R.position.lerp(new THREE.Vector3(-0.38 - rt * 0.1, -0.55 + breathe - rt * 0.1, -0.24 + rt * 0.02), 0.15);
  const lt = handAct.talk > 0 ? 1 : 0;
  L.position.lerp(new THREE.Vector3(-0.36 + lt * 0.08, -0.55 + breathe + lt * 0.15, 0.26 - lt * 0.12), 0.12);
  L.rotation.x += ((lt ? 0.2 : -0.5) - L.rotation.x) * 0.12;
  cup.floaters.forEach((f, k) => {
    f.position.y += Math.sin(time * 0.4 + k * 2) * 0.0004;
    f.rotation.x += 0.0015 * (k + 1);
    f.rotation.y += 0.001 * (k + 2);
  });
  // Screens: the laptop's orbit map and the radio's display, four times a second.
  if (Math.floor(time * 4) !== Math.floor((time - dt) * 4)) {
    const sp = subPoint(game.t);
    const trackPts = [];
    for (let k = -40; k < 80; k++) trackPts.push(subPoint(game.t + k * 60));
    const open = inWindow(game.t);
    drawLaptop(cup.laptop.canvas, sp, trackPts, MPLS, [
      `${playerName.toUpperCase()}  EXP 21`,
      open ? 'MPLS IN SIGHT' : `MPLS NEXT ${fmt(realSeconds(game.t, game.t + untilWindow(game.t)))}`,
      `PASS ${passIndex(game.t) + 1}/6`,
    ]);
    cup.laptop.tex.needsUpdate = true;
    const { signal, group } = tuned(game.radio);
    drawRadio(cup.radio.canvas, game.radio.freq, game.radioUp() && group ? signal : 0, true);
    cup.radio.tex.needsUpdate = true;
  }
}

function viewText() {
  if (view === 'cupola') return 'Cupola · looking down';
  if (view === 'outside') return 'Outside the station';
  const w = tele.d * 1.3;
  const width = w < 1 ? `${Math.round(w * 1000)} m` : `${w < 20 ? w.toFixed(1) : Math.round(w).toLocaleString('en-US')} km`;
  return `Telescope · ${width} across${thermal ? ' · THERMAL' : ''}`;
}
function keysText() {
  const v = (x: View, k: string, n: string) => `<span class="${view === x ? 'mark' : ''}">${k} ${n}</span>`;
  let h = `${v('cupola', '1', 'Cupola')} &nbsp;${v('outside', '2', 'Outside')} &nbsp;${v('tele', '3', 'Telescope')}<br>`;
  if (view === 'tele') h += 'Wheel zoom · drag move · right-drag turn · F station · G Minneapolis · click a hero for their card<br>';
  else if (view === 'cupola') h += 'Drag to look around · wheel in: telescope<br>';
  else h += 'Drag to circle the station · wheel zoom<br>';
  h += 'Arrows tune · W warn · P patch · H "aim for the head" · D answer a rumour · T thermal · Space pause';
  return h;
}
function hintText(): string {
  if (game.mode === 'sandbox') return '';
  const known = game.radio.groups.filter((g) => g.known);
  if (!inWindow(game.t)) return 'Far side of the Earth. What you did shows up next pass.';
  if (view !== 'tele') return 'Minneapolis is in sight. Scroll in for the telescope, G finds the city.';
  if (game.proof && (!game.headcast || !game.headcast.proof)) return 'You have proof now. H tells the whole city to aim for the head.';
  const rum = game.rumours.find((x) => x.active && x.seen && !x.debunked);
  if (rum) return 'You have seen it with your own eyes. D answers the rumour.';
  if (known.length === 0) return 'Radio: Up/Down tune fast, Left/Right fine. Hams use 146.52.';
  const r = game.radio;
  if (r.stats.patches === 0 && known.every((g) => g.warnedAt < 0) && r.stats.warnRight + r.stats.warnWrong === 0)
    return 'W warns who you are tuned to. They decide if they believe you.';
  if (!known.some((g) => g.kind === 'police')) return 'Police talk around 155 MHz. P + P patches two channels.';
  if (tele.d > 1.5) return 'Zoom all the way in to see people fight. T: thermal camera.';
  return '';
}

let towns: Placed[] = [], townsAt = 0;
const mplsText = () => (inWindow(game.t) ? '+ MINNEAPOLIS' : '+ Minneapolis (out of sight)');
const SKIP_TOWNS = new Set(['Minneapolis']);
/** Names on the map: Minneapolis and the station from orbit; stations, hospitals and contacts up close. */
function drawLabels() {
  const W = window.innerWidth, H = window.innerHeight;
  const toScreen = (v: THREE.Vector3, cam: THREE.Camera) => {
    const p = v.clone().project(cam);
    if (p.z > 1 || p.z < -1) return null;
    return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H };
  };
  const camPos = pose.pos;
  const alt = camPos.length() - R_EARTH;
  if (view === 'tele' && alt > 2.5) {
    // Town names: re-chosen a few times a second, moved with the globe every frame.
    const now = performance.now();
    if (now - townsAt > 150) {
      townsAt = now;
      const avoid = hud.panels();
      // Keep clear of the Minneapolis and station markers too.
      const marks: [THREE.Vector3, string][] = [[ecef(MPLS.lat, MPLS.lon, 0), mplsText()], [station(game.t).pos, `▲ ${playerName.toUpperCase()} (ISS)`]];
      for (const [m, text] of marks) {
        const p = m.clone().normalize().dot(camPos.clone().sub(m)) > 0 ? toScreen(m, camGlobe) : null;
        const w = (text.length * 7) / 2 + 6;
        if (p) avoid.push({ x0: p.x - w, y0: p.y - 22, x1: p.x + w, y1: p.y + 2 });
      }
      towns = worldNames().pick(camPos, (v) => toScreen(v, camGlobe), W, H, pose.fov, 60, alt > 25 ? SKIP_TOWNS : undefined, avoid);
    }
    const names = worldNames().list, v = new THREE.Vector3();
    for (const t of towns) {
      const n = names[t.i];
      const p = toScreen(ecef(n.lat, n.lon, 0, v), camGlobe);
      if (p) hud.label(p.x, p.y - 3, n.code >= BIG ? n.name.toUpperCase() : n.name, n.code >= BIG ? 'town big' : 'town');
    }
  } else towns = [];
  if (view === 'tele' && alt > 25) {
    const m = ecef(MPLS.lat, MPLS.lon, 0);
    if (m.clone().normalize().dot(camPos.clone().sub(m)) > 0) {
      const p = toScreen(m, camGlobe);
      if (p) hud.label(p.x, p.y - 6, mplsText(), 'contact');
    }
    const st = station(game.t).pos;
    if (alt > 400 && st.clone().normalize().dot(camPos.clone().sub(st)) > 0) {
      const p = toScreen(st, camGlobe);
      if (p) hud.label(p.x, p.y - 4, `▲ ${playerName.toUpperCase()} (ISS)`, '');
    }
  }
  if (view === 'tele' && tele.d < 8 && city.alpha > 0.5) {
    const v = new THREE.Vector3();
    for (const pl of places) {
      cellToLocal(pl.x, pl.y, v, 6);
      const p = toScreen(v, camCity);
      if (p && p.x > 0 && p.x < W && p.y > 0 && p.y < H && v.distanceTo(camCity.position) < tele.d * 4000)
        hud.label(p.x, p.y, (pl.kind === 'police' ? '■ ' : pl.kind === 'fire' ? '▲ ' : '✚ ') + (pl.name || pl.kind), 'place');
    }
    for (const g of game.radio.groups) {
      if (!g.known || g.kind === 'broadcast' || g.kind === 'police') continue;
      const hp = city.heroPos(g.id);
      if (hp) v.copy(hp).setY(12);
      else cellToLocal(g.x, g.y, v, 12);
      const p = toScreen(v, camCity);
      if (p && p.x > 0 && p.x < W && p.y > 0 && p.y < H) hud.label(p.x, p.y, `◆ ${g.name}`, 'contact');
    }
  }
}

requestAnimationFrame(frame);

// For automatic checks (screenshots, tests).
(window as unknown as { lastPass: object }).lastPass = {
  game,
  tele,
  look,
  orbitCam,
  view: () => view,
  setView: (v: View) => {
    setView(v);
    blend = 1;
  },
  start: (m: 'play' | 'sandbox') => start(m),
  fps: () => fps,
  openCard,
  closeCard,
  clearSay: () => hud.clearSay(),
  city,
  heroCell: (id: string) => {
    const h = heroById(id)!;
    const st = game.heroState(id)!;
    const r = routeCellsOf(h);
    return st.escapeStart >= 0 ? escapeAtOf(h, (game.tick - st.escapeStart) * 60) : r[0];
  },
  /** Average time per frame spent in our own code (ms), without the graphics card. */
  cpu: () => cpuAvg,
  jump: (seconds: number) => {
    game.setZone(null);
    while (game.t < seconds) {
      game.t += 60;
      game.cityStep();
    }
    game.wasWindow = inWindow(game.t);
  },
  key: (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k })),
  front: () => {
    const w = game.world;
    let best = 0, bi = 0;
    for (let i = 0; i < w.healthy.length; i++) {
      const v = Math.min(w.healthy[i], w.infected[i]);
      if (v > best) (best = v), (bi = i);
    }
    return { x: (bi % GW) + 0.5, y: Math.floor(bi / GW) + 0.5, v: best };
  },
  /** Point the telescope at a place on Earth from d km. */
  lookAt: (lat: number, lon: number, d: number) => {
    setView('tele');
    blend = 1;
    tele.jumpTo(lat, lon, d);
  },
  /** Point the telescope at a map cell from d km. */
  lookCell: (x: number, y: number, d: number) => {
    setView('tele');
    blend = 1;
    tele.jumpTo(45.06 - (y / GH) * 0.19, -93.36 + (x / GW) * 0.36, d);
  },
};
