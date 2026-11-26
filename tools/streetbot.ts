// Street test bot: runs the street simulation with no drawing, at a few places that
// matter, and measures what makes up-close watching feel wrong. Prints one line per place
// and a verdict. Usage: npx vite-node tools/streetbot.ts [seconds]
// The goals are fixed here and must not be loosened to make a run pass.
import { Session, blocked, insideBuilding, onRoad, places, roadNet, wet, GW } from '../src/game/session';
import { Kind, Role, stepStreet, M } from '../src/sim/street';

const GOALS = {
  stuck: 0.02, // share of people pushing at a wall for over 2 s
  shakes: 0.5, // back-and-forth twitches within a fifth of a second, per person per minute (jitter)
  // (Whole about-turns over a second are also printed, as "flips": people do turn back when
  // the dead cut them off, so that one is watched, not a pass/fail.)
  inBuilding: 0, // people really inside a building
  blind: 0, // shots at something the shooter could not see
};
const quiet = { start() {}, hush() {}, setStatic() {}, say() {}, shot() {}, muted: true } as never;
const SECONDS = Number(process.argv[2] || 40);

function deepInside(x: number, y: number): boolean {
  if (!insideBuilding(x, y)) return false;
  const r = 0.7 / M;
  for (let k = 0; k < 8; k++) if (!insideBuilding(x + Math.cos(k * 0.785) * r, y + Math.sin(k * 0.785) * r)) return false;
  return true;
}

function run(name: string, pick: (g: Session) => { x: number; y: number }, passT: number, half = 4) {
  const g = new Session(quiet);
  g.reset('play');
  while (g.t < passT) g.skipMinute();
  const f = pick(g);
  const box = { x0: f.x - half, y0: f.y - half, x1: f.x + half, y1: f.y + half };
  g.setZone(box);
  const s = g.street!;
  const dt = 1 / 15;
  const last = new Map<number, { x: number; y: number; dx: number; dy: number }>();
  let samples = 0, stuckSum = 0, stuckMax = 0, flips = 0, personSec = 0, inB = 0, ms = 0, steps = 0;
  const policeStart = new Map<number, { x: number; y: number }>();
  for (const a of s.agents) if (a.role === Role.Police) policeStart.set(a.uid, { x: a.x, y: a.y });
  const fast = new Map<number, { x: number; y: number; dx: number; dy: number }>();
  let shakes = 0, fastSec = 0;
  for (let k = 0; k < SECONDS * 15; k++) {
    const t0 = performance.now();
    stepStreet(s, g.world, k * 7919 + 3, dt, blocked, g.env(), onRoad, roadNet(), wet);
    ms += performance.now() - t0;
    steps++;
    if (k % 3 === 2)
      for (const a of s.agents) {
        if (a.gone || a.kind === Kind.Fallen || a.car === 1) continue;
        const p = fast.get(a.uid);
        const dx = (a.x - (p?.x ?? a.x)) * M, dy = (a.y - (p?.y ?? a.y)) * M;
        if (p && Math.hypot(dx, dy) > 0.12 && Math.hypot(p.dx, p.dy) > 0.12 && (dx * p.dx + dy * p.dy) / (Math.hypot(dx, dy) * Math.hypot(p.dx, p.dy)) < -0.7) shakes++;
        fast.set(a.uid, { x: a.x, y: a.y, dx, dy });
        fastSec += 0.2;
      }
    if (k % 15 !== 14) continue;
    // Once a second: who is pushing at a wall, who turned right round, who is inside.
    let movers = 0, stuck = 0;
    for (const a of s.agents) {
      if (a.gone || a.kind === Kind.Fallen || a.car === 1 || a.hold || a.held > 0 || (a.kind === Kind.Living && a.turn >= 0) || (a.kind === Kind.Dead && a.down > 0)) {
        last.delete(a.uid);
        continue;
      }
      movers++;
      if (a.bump > 2) stuck++;
      if (deepInside(a.x, a.y)) inB++;
      const p = last.get(a.uid);
      const dx = (a.x - (p?.x ?? a.x)) * M, dy = (a.y - (p?.y ?? a.y)) * M;
      if (p && Math.hypot(dx, dy) > 0.5 && Math.hypot(p.dx, p.dy) > 0.5) {
        const c = (dx * p.dx + dy * p.dy) / (Math.hypot(dx, dy) * Math.hypot(p.dx, p.dy));
        if (c < -0.7) flips++;
      }
      last.set(a.uid, { x: a.x, y: a.y, dx, dy });
      personSec++;
    }
    samples++;
    const sh = movers ? stuck / movers : 0;
    stuckSum += sh;
    stuckMax = Math.max(stuckMax, sh);
  }
  let pMoved = 0, pN = 0;
  for (const a of s.agents)
    if (policeStart.has(a.uid)) {
      pN++;
      const p0 = policeStart.get(a.uid)!;
      if (Math.hypot(a.x - p0.x, a.y - p0.y) * M > 5) pMoved++;
    }
  const st = s.stats;
  const res = {
    name,
    people: s.agents.filter((a) => a.kind === Kind.Living).length,
    dead: s.agents.filter((a) => a.kind === Kind.Dead).length,
    stuck: +(stuckSum / Math.max(1, samples)).toFixed(3),
    stuckMax: +stuckMax.toFixed(3),
    shakes: +((shakes / Math.max(1, fastSec)) * 60).toFixed(2),
    flips: +((flips / Math.max(1, personSec)) * 60).toFixed(2),
    inBuilding: inB,
    shots: st.shots,
    blind: st.blind,
    police: `${pMoved}/${pN} moved`,
    bites: st.bites,
    stepMs: +(ms / steps).toFixed(1),
  };
  const pass = res.stuck <= GOALS.stuck && res.shakes <= GOALS.shakes && res.inBuilding <= GOALS.inBuilding && res.blind <= GOALS.blind;
  console.log(JSON.stringify(res), pass ? 'PASS' : 'FAIL');
  return pass;
}

const front = (g: Session) => {
  const w = g.world;
  let best = 0, bi = 0;
  for (let i = 0; i < w.healthy.length; i++) {
    const v = Math.min(w.healthy[i], w.infected[i]);
    if (v > best) (best = v), (bi = i);
  }
  return { x: (bi % GW) + 0.5, y: Math.floor(bi / GW) + 0.5 };
};
const PASS2 = 1200 + 5520 - 60, PASS3 = 1200 + 2 * 5520 - 60;
const precinct = (name: string) => (g: Session) => {
  void g;
  const p = places.find((q) => q.kind === 'police' && q.name.includes(name))!;
  return { x: p.x, y: p.y };
};
const results = [
  run('front, pass 2', front, PASS2),
  run('front, pass 3', front, PASS3),
  run('1st Precinct, pass 2', precinct('1st Precinct'), PASS2),
  run('3rd Precinct, pass 2', precinct('3rd Precinct'), PASS2),
];
console.log(results.every(Boolean) ? 'ALL PASS' : 'NOT YET');
