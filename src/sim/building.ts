// Inside one building, floor by floor: the "dollhouse". Only for a building with a hero in it,
// and only drawn once you have talked to them (it is a sketch made from what they tell you,
// not an x-ray). The dead come in at the ground floor and climb the stairs toward the living;
// the living move up and away, block stairwell doors, and fight on the landings.
// Pure numbers, one step per city tick (a minute), so it can be tested.
import { rng } from './outbreak';

export interface Floor {
  living: number;
  dead: number;
  /** 0..1: the stairwell door to this floor is blocked (furniture, vending machines). */
  barricade: number;
  /** Rooms on this floor (for the drawing), fixed per building. */
  rooms: number;
}

export interface Building {
  id: string;
  name: string;
  floors: Floor[];
  /** The hero's floor (0 = ground). */
  heroFloor: number;
  /** Floors you have news of (from the radio). Others are drawn grey. */
  known: boolean[];
  /** Running totals for the log. */
  turned: number;
  downed: number;
}

export function createBuilding(id: string, name: string, floors: number, people: number, heroFloor: number, seed = 1): Building {
  const r = rng(seed);
  const fl: Floor[] = [];
  for (let k = 0; k < floors; k++) fl.push({ living: 0, dead: 0, barricade: 0, rooms: 3 + Math.floor(r() * 3) });
  // People spread over the floors, more up where the hero is (they gathered there).
  let w = 0;
  const weights = fl.map((_, k) => (k === Math.min(heroFloor, floors - 1) ? 3 : 1));
  for (const x of weights) w += x;
  fl.forEach((f, k) => (f.living = (people * weights[k]) / w));
  return { id, name, floors: fl, heroFloor: Math.min(heroFloor, floors - 1), known: fl.map(() => false), turned: 0, downed: 0 };
}

/** One minute. `outsideDead` = the dead around the building; `aware` 0..1 = people inside know. */
export function stepBuilding(b: Building, outsideDead: number, aware: number, seed: number): Building {
  const r = rng(seed);
  const F = b.floors;
  // The dead get in at the ground floor (doors, windows), faster when there are many outside.
  F[0].dead += Math.min(outsideDead * 0.05, 40) * (0.5 + r() * 0.5);
  // Climbing: the dead go up toward the living. A blocked stairwell door holds them a while.
  for (let k = F.length - 2; k >= 0; k--) {
    const f = F[k], up = F[k + 1];
    if (f.dead <= 0) continue;
    const pull = up.living > 0 || F.slice(k + 2).some((x) => x.living > 0) ? 0.35 : 0.05;
    const go = f.dead * pull * (1 - 0.95 * up.barricade) * (f.living > 0 ? 0.4 : 1);
    f.dead -= go;
    up.dead += go;
    // They batter the door: barricades wear down.
    if (go > 0 || f.dead > 3) up.barricade = Math.max(0, up.barricade - 0.004 * Math.min(10, f.dead));
  }
  for (let k = 0; k < F.length; k++) {
    const f = F[k];
    // People on a floor with the dead: a few fight (tools, fire extinguishers), most run up.
    if (f.dead > 0.5 && f.living > 0) {
      const contact = f.dead / (f.dead + f.living);
      const bitten = Math.min(f.living, f.living * 0.35 * contact);
      const downed = Math.min(f.dead, f.living * 0.03 * (1 - contact));
      f.living -= bitten;
      f.dead += bitten - downed;
      b.turned += bitten;
      b.downed += downed;
      if (k + 1 < F.length) {
        const flee = f.living * 0.5;
        f.living -= flee;
        F[k + 1].living += flee;
      }
    }
    // Aware people block the door to their floor once they hear the dead below.
    const below = k > 0 ? F[k - 1].dead : 0;
    if (f.living > 2 && (below > 0.5 || aware > 0.5)) f.barricade = Math.min(1, f.barricade + 0.15 * aware);
  }
  return b;
}

export const totalLiving = (b: Building) => b.floors.reduce((s, f) => s + f.living, 0);
export const totalDead = (b: Building) => b.floors.reduce((s, f) => s + f.dead, 0);

/** What the hero has told you: their floor at first, then the floors around it, and the
 *  ground floor once someone has said what is down there. */
export function learnFloors(b: Building, linesHeard: number) {
  const k = b.heroFloor;
  b.known[k] = true;
  if (linesHeard >= 2) for (const d of [-1, 1]) if (b.known[k + d] !== undefined) b.known[k + d] = true;
  if (linesHeard >= 3) b.known[0] = true;
  if (linesHeard >= 4) b.known.fill(true);
}
