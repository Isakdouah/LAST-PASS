// First responders: squad cars, fire engines and ambulances. They are the first to know
// something is wrong (the calls pour in), and the first to be overwhelmed.
// Each one is a vehicle with a crew, a home (precinct, fire station, hospital) and a job:
// police answer 911 calls where the living and the dead meet; engines go to fires near
// their station; ambulances go where people are hurt and come back to the hospital.
// Late in the night, with calls they can never answer, some officers go home to their
// families instead. Nobody moves them but their own dispatch: the player never does.
// The crews are real people from the city numbers (police leave their station's count while
// they are out); engine and ambulance crews are on shift, counted from the start.
import type { NamedPlace } from '../map/places';
import { rng, World } from '../sim/outbreak';
import type { Fires } from '../sim/fire';

export type UnitKind = 'police' | 'fire' | 'ems';
export type UnitState = 'home' | 'out' | 'scene' | 'back' | 'family' | 'lost';

export interface Unit {
  id: number;
  kind: UnitKind;
  /** Call sign, as dispatch says it ("Squad 112", "Engine 6", "Medic 14"). */
  label: string;
  /** Home base (map cells) and its name. */
  home: { x: number; y: number };
  base: string;
  x: number;
  y: number;
  face: number;
  /** Route (map cells) and how far along it (cells). */
  path: { x: number; y: number }[] | null;
  along: number;
  state: UnitState;
  crew: number;
  armed: boolean;
  ammo: number;
  /** Where it is going or working (map cell). */
  target: { x: number; y: number } | null;
  /** Game seconds left on scene. */
  sceneT: number;
  /** Calls answered, people helped, the dead put down, fires knocked down (for the dawn report). */
  answered: number;
  downed: number;
  fires: number;
  /** Crew members drawn in the street right now (their uids), so the street decides their fate. */
  inStreet: number[];
}

export interface Responders {
  units: Unit[];
  /** Calls waiting (cells where people are calling for help), newest picture each tick. */
  calls: { x: number; y: number; weight: number }[];
  /** Dispatch radio, newest last (for the HUD and the log). */
  radio: { t: number; text: string }[];
}

/** Our numbers (guesses for a 2009 city night shift, not records): */
export const FLEET = {
  /** Squad cars out of each precinct, two officers each. */
  squadsPerStation: 5,
  /** One engine per fire station, four firefighters. */
  engineCrew: 4,
  /** Ambulances per hospital, two medics each. */
  ambulancesPerHospital: 2,
  /** Speeds (metres per second) through a city in panic. */
  speed: { police: 15, fire: 11, ems: 13 },
  /** Minutes on a call. */
  scene: { police: 9, fire: 14, ems: 4 },
  /** From this hour, with calls stacking up, officers start to go home to their families. */
  familyFrom: 22.5,
};

const M = 79; // metres per map cell

export function createResponders(places: NamedPlace[], world: World): Responders {
  const units: Unit[] = [];
  let id = 0;
  const add = (kind: UnitKind, p: NamedPlace, label: string, crew: number, armed: boolean, ammo: number) =>
    units.push({ id: id++, kind, label, home: { x: p.x, y: p.y }, base: p.name || 'station', x: p.x, y: p.y, face: 0, path: null, along: 0, state: 'home', crew, armed, ammo, target: null, sceneT: 0, answered: 0, downed: 0, fires: 0, inStreet: [] });
  let squad = 100, engine = 1, medic = 1;
  for (const p of places) {
    const i = Math.floor(p.y) * world.width + Math.floor(p.x);
    if (p.kind === 'police') {
      for (let k = 0; k < FLEET.squadsPerStation; k++) {
        // Two officers leave the station's numbers and ride in the car.
        if (world.healthy[i] < 2) break;
        world.healthy[i] -= 2;
        world.armed[i] = Math.max(0, world.armed[i] - 2);
        const am = Math.min(world.ammo[i], 60);
        world.ammo[i] -= am;
        add('police', p, `Squad ${squad++ + 10}`, 2, true, am);
      }
      squad = Math.ceil(squad / 100) * 100;
    } else if (p.kind === 'fire') add('fire', p, `Engine ${engine++}`, FLEET.engineCrew, false, 0);
    else if (p.kind === 'hospital') for (let k = 0; k < FLEET.ambulancesPerHospital; k++) add('ems', p, `Medic ${medic++}`, 2, false, 0);
  }
  return { units, calls: [], radio: [] };
}

/** People riding in or working from the vehicles (they count among the living). */
export function crewTotal(R: Responders): number {
  let n = 0;
  for (const u of R.units) if (u.state !== 'lost' && u.state !== 'family') n += u.crew;
  return n;
}

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Drive along the route (per frame, game seconds). */
export function moveUnits(R: Responders, dt: number) {
  for (const u of R.units) {
    if (!u.path || u.path.length < 2 || (u.state !== 'out' && u.state !== 'back' && u.state !== 'family')) continue;
    u.along += ((FLEET.speed[u.kind] * dt) / M);
    let rest = u.along;
    let k = 0;
    while (k < u.path.length - 1) {
      const a = u.path[k], b = u.path[k + 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (rest <= L) {
        const f = L > 0 ? rest / L : 1;
        u.x = a.x + (b.x - a.x) * f;
        u.y = a.y + (b.y - a.y) * f;
        if (L > 0) u.face = Math.atan2(b.y - a.y, b.x - a.x);
        break;
      }
      rest -= L;
      k++;
    }
    if (k >= u.path.length - 1) {
      const end = u.path[u.path.length - 1];
      u.x = end.x;
      u.y = end.y;
      u.path = null;
      if (u.state === 'out') (u.state = 'scene'), (u.sceneT = FLEET.scene[u.kind] * 60);
      else if (u.state === 'back') u.state = 'home';
      else if (u.state === 'family') u.state = 'lost'; // gone home; out of the story
    }
  }
}

/**
 * Once a city step (60 game seconds): calls come in, dispatch sends who is free, crews on
 * scene fight, rescue, put out fires, and some are lost. `hour` = local hour.
 * `watched(x, y)` = the street simulation is drawing this cell (then it decides the fight).
 * `route(a, b)` = a street route. `say` = dispatch radio.
 */
export function stepResponders(
  R: Responders,
  w: World,
  fires: Fires,
  hour: number,
  seed: number,
  route: (a: { x: number; y: number }, b: { x: number; y: number }) => { x: number; y: number }[],
  watched: (x: number, y: number) => boolean,
  say: (text: string) => void,
) {
  const r = rng(seed);
  const W = w.width;
  // Calls: where people are awake and the dead are among them (people call 911).
  const calls: { x: number; y: number; weight: number }[] = [];
  for (let i = 0; i < w.healthy.length; i++) {
    const h = w.healthy[i], z = w.infected[i];
    if (h < 3 || z < 1) continue;
    calls.push({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, weight: Math.min(h, z * 4) * (0.3 + w.aware[i]) });
  }
  calls.sort((a, b) => b.weight - a.weight);
  R.calls = calls.slice(0, 60);
  const taken = (c: { x: number; y: number }) => R.units.some((u) => u.target && (u.state === 'out' || u.state === 'scene') && d2(u.target, c) < 4);
  const send = (u: Unit, to: { x: number; y: number }, why: string) => {
    const p = route({ x: u.x, y: u.y }, to);
    u.path = p.length >= 2 ? p : [{ x: u.x, y: u.y }, to];
    u.along = 0;
    u.target = { x: to.x, y: to.y };
    u.state = 'out';
    u.answered++;
    if (r() < 0.25) say(`${u.label}, ${why}.`);
  };
  // Free units take the nearest call within their reach (busiest first).
  for (const u of R.units) {
    if (u.state !== 'home' || u.crew <= 0) continue;
    if (u.kind === 'police') {
      const c = R.calls.find((c) => !taken(c) && d2(c, u) < 70 * 70);
      if (c) send(u, c, 'responding to a disturbance, people screaming, units requested');
    } else if (u.kind === 'ems') {
      // Ambulances go where people are hurt: the fighting.
      const c = R.calls.find((c) => !taken(c) && d2(c, u) < 60 * 60 && w.fallen[Math.floor(c.y) * W + Math.floor(c.x)] > 0);
      if (c) send(u, c, 'en route, multiple injured, bites reported');
    } else {
      // Engines go to fires near their station (the biggest first).
      let best = -1, bf = 0.15;
      const sx = Math.floor(u.home.x), sy = Math.floor(u.home.y);
      for (let y = Math.max(0, sy - 40); y < Math.min(w.height, sy + 40); y++)
        for (let x = Math.max(0, sx - 40); x < Math.min(W, sx + 40); x++) {
          const i = y * W + x;
          if (fires.fire[i] > bf && !R.units.some((o) => o !== u && o.kind === 'fire' && o.target && Math.floor(o.target.x) === x && Math.floor(o.target.y) === y)) (bf = fires.fire[i]), (best = i);
        }
      if (best >= 0) send(u, { x: (best % W) + 0.5, y: Math.floor(best / W) + 0.5 }, 'responding, structure fire');
    }
  }
  // Late at night, calls nobody can answer: some officers go home to their families.
  const backlog = R.calls.filter((c) => !taken(c)).length;
  if (hour >= FLEET.familyFrom)
    for (const u of R.units) {
      if (u.kind !== 'police' || u.crew <= 0 || (u.state !== 'home' && u.state !== 'back' && u.state !== 'scene')) continue;
      if (r() < 0.004 * Math.min(10, backlog / 4) * (hour - FLEET.familyFrom + 0.5)) {
        // Somewhere out in the suburbs (the edge of the map, away from the city centre).
        const ang = r() * Math.PI * 2;
        const to = { x: Math.max(2, Math.min(W - 3, 180 + Math.cos(ang) * 200)), y: Math.max(2, Math.min(w.height - 3, 130 + Math.sin(ang) * 150)) };
        const p = route({ x: u.x, y: u.y }, to);
        u.path = p.length >= 2 ? p : [{ x: u.x, y: u.y }, to];
        u.along = 0;
        u.state = 'family';
        u.target = null;
        w.stats.escaped += u.crew; // they leave the city: counted with those who got out
        say(`${u.label}: "Dispatch, I can't... I'm going home to my kids." No answer from dispatch.`);
      }
    }
  // On scene.
  for (const u of R.units) {
    if (u.state !== 'scene') continue;
    u.sceneT -= 60;
    const cx = Math.floor(u.x), cy = Math.floor(u.y);
    const i = cy * W + cx;
    if (!watched(u.x, u.y) && u.crew > 0) {
      const z = w.infected[i];
      if (u.kind === 'police' && z > 0 && u.ammo > 0) {
        // Two trained shooters with a car for cover: a handful of the dead each minute.
        const down = Math.min(z, u.crew * (1.2 + r()), u.ammo / 6);
        w.infected[i] -= down;
        w.fallen[i] += down;
        u.ammo = Math.max(0, u.ammo - down * 6);
        u.downed += down;
      }
      if (u.kind === 'fire') {
        // Water on it: the fire goes down, if the crew can work.
        if (z < u.crew * 2) {
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const j = (cy + dy) * W + cx + dx;
              if (j >= 0 && j < fires.fire.length) fires.fire[j] = Math.max(0, fires.fire[j] - (dx || dy ? 0.12 : 0.3));
            }
          if (fires.fire[i] <= 0.05) (u.fires++, (u.sceneT = Math.min(u.sceneT, 0)));
        }
      }
      // Too many of them: most crews get back in and pull out (training: don't die in place).
      if (z > u.crew * 4 + w.healthy[i] * 0.5 && r() < 0.6) {
        const p = route({ x: u.x, y: u.y }, u.home);
        u.path = p.length >= 2 ? p : [{ x: u.x, y: u.y }, u.home];
        u.along = 0;
        u.state = 'back';
        u.target = null;
        say(`${u.label}: "Too many, we're falling back to ${u.base}."`);
        continue;
      }
      // The crew can be caught: more of the dead around, more risk.
      const risk = Math.min(0.3, (z / (z + w.healthy[i] + u.crew * 4 + 1)) * (u.kind === 'police' ? 0.08 : 0.12));
      for (let k = 0; k < u.crew; k++)
        if (r() < risk) {
          u.crew--;
          w.infected[i] += 1; // bitten: they turn
        }
      if (u.crew <= 0) {
        u.state = 'lost';
        say(`${u.label}, ${u.label}, respond... (no answer)`);
        continue;
      }
    }
    if (u.sceneT <= 0 && u.inStreet.length === 0) {
      const p = route({ x: u.x, y: u.y }, u.home);
      u.path = p.length >= 2 ? p : [{ x: u.x, y: u.y }, u.home];
      u.along = 0;
      u.state = 'back';
      u.target = null;
    }
  }
}
