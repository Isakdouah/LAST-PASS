// Holdouts: places where people gather to wait for daylight, pool their guns and shells,
// and hold the doors. All by math (numbers per place, one step per game minute).
//
// What makes a place hold (ISAK, 26 Nov 2026): a precinct or a fire station beats an ordinary
// apartment block, and a really crowded place is worst. So each place has:
//  - fort: how hard it is to get into (brick, steel doors, few windows on the ground floor);
//  - cap: how many it can shelter before crowding makes it weaker;
//  - screen: how well they check newcomers for bites (police and firefighters do; a hospital
//    takes the bitten in on purpose, which is why it goes bad from the inside).
// All numbers are guesses, chosen so the order above comes out of the math, not a script.
import type { NamedPlace } from '../map/places';
import type { World } from '../sim/outbreak';

export type HoldKind = 'precinct' | 'station' | 'apartments' | 'hospital';
export type HoldState = 'open' | 'holding' | 'fallen';

export interface Holdout {
  id: number;
  name: string;
  kind: HoldKind;
  x: number;
  y: number;
  fort: number;
  cap: number;
  screen: number;
  /** People inside (living). */
  people: number;
  armed: number;
  ammo: number;
  /** Of the people inside: bitten, not turned yet (nobody knows how many). */
  hidden: number;
  /** The dead inside the walls. */
  inside: number;
  /** 0..1: boards on the windows, cars across the door; grows while it is quiet. */
  boards: number;
  /** 0..1: share who know to aim for the head. */
  know: number;
  state: HoldState;
  fellAt: number;
  /** Most people it ever held. */
  peak: number;
  /** Until this game time, people further away are told to come here (your radio call). */
  routedUntil: number;
  /** Game time you last looked at it (telescope low over it during a pass). */
  seenAt: number;
  /** What it looked like then (what you know). */
  seen: { people: number; state: HoldState; pressure: number; ammo: number } | null;
  /** The dead put down from the walls. */
  downed: number;
}

export interface Holdouts {
  list: Holdout[];
  /** Everyone who ever got inside one. */
  arrived: number;
}

/** Fort, room and screening by kind (guesses). */
/** door = how far past their room they let people in (police and firefighters shut the doors). */
export const KINDS: Record<HoldKind, { fort: number; cap: number; screen: number; pull: number; door: number; label: string }> = {
  precinct: { fort: 0.9, cap: 160, screen: 0.8, pull: 1.2, door: 1.05, label: 'precinct' },
  station: { fort: 0.75, cap: 90, screen: 0.7, pull: 1, door: 1.05, label: 'fire station' },
  apartments: { fort: 0.45, cap: 350, screen: 0.25, pull: 0.8, door: 1.3, label: 'apartment block' },
  hospital: { fort: 0.3, cap: 500, screen: 0, pull: 1.6, door: 1.6, label: 'hospital' },
};

const nbr8 = [-1, 0, 1];

/** The places that can become holdouts: every precinct, fire station and hospital, and the
 *  densest blocks of flats (from the census numbers), spaced apart. */
export function createHoldouts(places: NamedPlace[], w: World, flats = 10): Holdouts {
  const list: Holdout[] = [];
  const add = (kind: HoldKind, x: number, y: number, name: string) => {
    const k = KINDS[kind];
    list.push({ id: list.length, name, kind, x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5, fort: k.fort, cap: k.cap, screen: k.screen, people: 0, armed: 0, ammo: 0, hidden: 0, inside: 0, boards: 0, know: 0, state: 'open', fellAt: -1, peak: 0, routedUntil: -1, seenAt: -1, seen: null, downed: 0 });
  };
  for (const p of places) {
    if (p.x < 1 || p.y < 1 || p.x >= w.width - 1 || p.y >= w.height - 1) continue;
    if (!w.land[Math.floor(p.y) * w.width + Math.floor(p.x)]) continue;
    add(p.kind === 'police' ? 'precinct' : p.kind === 'fire' ? 'station' : 'hospital', p.x, p.y, p.name || p.kind);
  }
  // The densest blocks of flats, at least 10 cells (about 800 m) from any other holdout.
  const cells = [...w.healthy.keys()].filter((i) => w.land[i]).sort((a, b) => w.healthy[b] - w.healthy[a]);
  let made = 0;
  for (const i of cells) {
    if (made >= flats) break;
    const x = (i % w.width) + 0.5, y = Math.floor(i / w.width) + 0.5;
    if (list.some((h) => Math.hypot(h.x - x, h.y - y) < 10)) continue;
    let near = '', nd = 1e9;
    for (const p of places) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < nd) (nd = d), (near = p.name || '');
    }
    add('apartments', x, y, `Apartments near ${near.replace(/ \(2009\)$/, '')}`);
    made++;
  }
  return { list, arrived: 0 };
}

export const cellOf = (h: Holdout, w: World) => Math.floor(h.y) * w.width + Math.floor(h.x);

/** The dead pressing on the doors: in the cell, and half of those next door. */
export function pressure(h: Holdout, w: World): number {
  const cx = Math.floor(h.x), cy = Math.floor(h.y);
  let z = 0;
  for (const dy of nbr8)
    for (const dx of nbr8) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      z += w.infected[y * w.width + x] * (dx || dy ? 0.5 : 1);
    }
  return z;
}

/** How hard the place is to break into right now. Crowding past the room it has makes it
 *  weaker (people in the hallways, doors opened for one more family, no one in charge). */
export function defence(h: Holdout): number {
  const crowd = h.people / h.cap;
  const crowdK = crowd > 1 ? 1 / (crowd * crowd) : 1;
  const shooters = Math.min(h.armed, h.ammo / 4);
  return (h.fort * (1 + h.boards) * 40 + shooters * 2.5 * (0.5 + h.know)) * crowdK * (h.people > 0 ? 1 : 0);
}

export interface HoldEvents {
  fell: Holdout[];
  /** New people let in this minute, by holdout id. */
  joined: Map<number, number>;
}

/**
 * One game minute. `t` = game seconds; `dark` 0..1; `say` gets the odd radio line.
 * People come from nearby blocks when they know the dead are close; the routed place pulls
 * from further away. The armed pool their rounds. The dead at the door are shot from the
 * windows (noise: it draws more). If the dead outnumber what the place can stand, it can
 * break, and the bitten inside can turn and open it from within.
 */
export function stepHoldouts(H: Holdouts, w: World, t: number, dark: number, seed: number, say: (text: string) => void = () => {}, news = 1): HoldEvents {
  // Early on nobody thinks "hole up": it is a riot, a drug, an accident. Once the news is
  // out, people start to gather (news 0..1, from the TV and phones).
  const ready = Math.min(1, news * 1.2);
  let s = seed >>> 0 || 1;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ev: HoldEvents = { fell: [], joined: new Map() };
  const W = w.width;
  for (const h of H.list) {
    if (h.state === 'fallen') continue;
    const k = KINDS[h.kind];
    const ci = cellOf(h, w);
    const z = pressure(h, w);

    // 1. People arrive: those who know the dead are about, from the blocks around it.
    //    Routed by your call: from further off, and more of them believe it.
    const routed = h.routedUntil > t;
    const reach = routed ? 5 : 2;
    const room = Math.max(0, h.cap * k.door - h.people); // some keep letting people in past "full"
    let came = 0;
    const cx = Math.floor(h.x), cy = Math.floor(h.y);
    for (let dy = -reach; dy <= reach && room - came > 0.5; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= w.height) continue;
        const i = y * W + x;
        const hh = w.healthy[i];
        if (!w.land[i] || hh < 0.5) continue;
        const dist = Math.hypot(dx, dy);
        if (dist > reach + 0.5) continue;
        let near = 0.3 * z;
        for (const ey of nbr8)
          for (const ex of nbr8) {
            const xx = x + ex, yy = y + ey;
            if (xx >= 0 && yy >= 0 && xx < W && yy < w.height) near += w.infected[yy * W + xx] * (ex || ey ? 0.5 : 1);
          }
        const danger = near / (near + 0.05 * hh + 3);
        // On their own: the aware, when the dead are close. Told on the radio: some go before
        // the dead come (more of those who already know something is wrong).
        const own = w.aware[i] * danger * 0.12 * k.pull * ready;
        const told = routed ? 0.025 * (0.3 + w.aware[i]) : 0;
        const share = Math.min(0.25, (own + told) / (1 + dist * 0.6));
        const go = Math.min(hh * share, room - came);
        if (go <= 0) continue;
        const part = go / hh;
        const a = w.armed[i] * part, am = w.ammo[i] * part;
        w.healthy[i] -= go;
        w.armed[i] -= a;
        w.ammo[i] -= am;
        w.moving[i] = Math.max(0, Math.min(w.healthy[i], w.moving[i] * (1 - part)));
        // Some of them are bitten and say nothing; the screened places turn some away.
        const bitten = go * Math.min(0.25, (w.infected[i] / (hh + w.infected[i] + 1)) * 0.6) * (1 - h.screen);
        h.know = (h.know * h.people + w.know[i] * go) / (h.people + go);
        h.people += go;
        h.armed += a;
        h.ammo += am;
        h.hidden += bitten;
        came += go;
      }
    if (came > 0) {
      ev.joined.set(h.id, came);
      H.arrived += came;
      if (h.state === 'open' && h.people >= 15) {
        h.state = 'holding';
        say(`${h.name}: "We've got ${Math.round(h.people)} people in here. Doors are shut."`);
      }
    }
    h.peak = Math.max(h.peak, h.people);
    if (h.people < 1) continue;

    // 2. Boards go up while it is quiet enough to work.
    h.boards = Math.min(1, h.boards + (z < 5 ? 0.03 : 0.008) * Math.min(1, h.people / 20));

    // 3. Shooting from the windows: pooled rounds, the armed take turns.
    if (z > 0 && h.armed > 0 && h.ammo > 0) {
      const shooters = Math.min(h.armed, 12 + h.armed * 0.2); // only so many windows
      const shots = Math.min(h.ammo, shooters * 3);
      const p = Math.max(0.05, (0.35 - 0.15 * dark) * (0.7 + 0.6 * h.know));
      const kills = Math.min(w.infected[ci] + 0.5 * z, shots * p * (0.25 + 0.6 * h.know));
      const here = Math.min(w.infected[ci], kills);
      w.infected[ci] -= here;
      w.fallen[ci] += here;
      // The rest from the street next door.
      let left = kills - here;
      for (const dy of nbr8)
        for (const dx of nbr8) {
          if (left <= 0 || (!dx && !dy)) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= w.height) continue;
          const j = y * W + x;
          const d = Math.min(w.infected[j], left);
          w.infected[j] -= d;
          w.fallen[j] += d;
          left -= d;
        }
      h.downed += kills - left;
      h.ammo -= shots;
      w.noise[ci] += shots; // and it draws more of them
      w.stats.shots += shots;
      h.know = Math.min(1, h.know + 0.01 * (1 - h.know));
    }

    // 4. From the inside: the bitten turn (about an hour after the bite), and someone has to
    //    deal with it in a crowded room. Crowding makes it worse.
    if (h.hidden > 0) {
      const turn = h.hidden * 0.03;
      h.hidden -= turn;
      h.people -= turn;
      h.inside += turn;
    }
    if (h.inside > 0) {
      const crowd = Math.max(1, h.people / h.cap);
      const put = Math.min(h.inside, (h.armed * 0.4 + h.people * 0.04) * (0.5 + h.know) / crowd);
      const bites = Math.min(h.people, h.inside * 0.5 * crowd);
      h.inside -= put;
      w.fallen[ci] += put;
      h.people -= bites;
      h.inside += bites;
      h.armed = Math.min(h.armed, h.people);
      h.hidden = Math.min(h.hidden, h.people);
    }

    // 5. Does it break? The dead at the door against what the place can stand; or from the
    //    inside, when too many have turned in there.
    const def = defence(h);
    const breakIn = z > def ? Math.min(0.5, ((z - def) / (def + 10)) * 0.3) : 0;
    const fromInside = h.inside > 3 + h.people * 0.15;
    if (fromInside || r() < breakIn) {
      fall(h, w, ci, t, fromInside, say);
      ev.fell.push(h);
    }
  }
  return ev;
}

function fall(h: Holdout, w: World, ci: number, t: number, fromInside: boolean, say: (text: string) => void) {
  // Most are caught in there; some get out into the street; some go down fighting.
  const caught = h.people * 0.6, ran = h.people * 0.3, lost = h.people * 0.1;
  w.infected[ci] += caught + h.inside; // the hidden bitten are among the people
  w.healthy[ci] += ran;
  w.moving[ci] += ran;
  w.armed[ci] += Math.min(h.armed, ran) * 0.5;
  w.fallen[ci] += lost;
  w.aware[ci] = 1;
  say(fromInside ? `${h.name}: "Someone turned in here, they're inside, they're-" (static)` : `${h.name}: "They're through the door! Get upstairs! Get-" (static)`);
  h.people = 0;
  h.armed = 0;
  h.hidden = 0;
  h.inside = 0;
  h.state = 'fallen';
  h.fellAt = t;
}

/** Living people sheltering in holdouts right now. */
export function sheltered(H: Holdouts): number {
  let n = 0;
  for (const h of H.list) if (h.state !== 'fallen') n += h.people;
  return n;
}
/** The dead inside holdout walls (they count with the dead). */
export function insideDead(H: Holdouts): number {
  let n = 0;
  for (const h of H.list) if (h.state !== 'fallen') n += h.inside;
  return n;
}
