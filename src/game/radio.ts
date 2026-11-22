// Radio: the only way to reach people on the ground, and only while the window is open
// (radio needs line of sight to the station). Four verbs:
//   LISTEN  tune the dial until a voice comes through the static; heard groups become contacts
//   SEE     what you look at through the telescope (who is where) - used when you speak
//   SPEAK   warn a group: they decide whether to trust a voice from space
//   CONNECT patch two groups together: they decide whether to help each other
// The player never moves anyone. Every call costs trust when it is wrong.
// All names and lines here are PLACEHOLDERS for ISAK to rewrite.
import { rng, World } from '../sim/outbreak';
import { pathLength, pathPoint } from './heroes';

export type GroupKind = 'star' | 'police' | 'civil' | 'bus' | 'broadcast';
export type Status = 'calm' | 'contact' | 'overrun';

export interface Group {
  id: string;
  name: string; // shown on the contact list
  who: string; // the voice
  kind: GroupKind;
  x: number; // map cell
  y: number;
  freq: number; // MHz
  trust: number; // 0..1: how much they believe you
  known: boolean;
  status: Status;
  silent: boolean; // overrun long enough that nobody answers
  pitch: number;
  rate: number;
  said: number; // lines said, to walk through a star's script
  warnedAt: number; // city tick of your last warning (-1 = none)
  fate: string; // for the end report
}

export interface Convoy {
  x: number;
  y: number;
  to: Group;
  from: Group;
  people: number;
  armed: number;
  ammo: number;
  bus: boolean;
  /** The way they drive (cells, along the streets; the session fills it in) and how far along. */
  path?: { x: number; y: number }[];
  at?: number;
}

export interface Radio {
  groups: Group[];
  freq: number;
  patchFrom: Group | null;
  convoys: Convoy[];
  /** Convoys that got there this step, and ones that did not make it (the session reports them). */
  arrivals: Convoy[];
  lostConvoys: Convoy[];
  stats: { warnRight: number; warnWrong: number; patches: number; refused: number; moved: number };
}

export const DIAL = { min: 144, max: 163 };
const TUNE = 0.25; // MHz either side where something comes through the static (clear above 0.75)

/** Cells from lon/lat (same box as the map). */
const cell = (lon: number, lat: number) => ({
  x: ((lon + 93.36) / 0.36) * 360,
  y: ((45.06 - lat) / 0.19) * 260,
});

function g(id: string, name: string, who: string, kind: GroupKind, at: { x: number; y: number }, freq: number, trust: number, pitch = 1, rate = 1): Group {
  return { id, name, who, kind, x: at.x, y: at.y, freq, trust, known: false, status: 'calm', silent: false, pitch, rate, said: 0, warnedAt: -1, fate: '' };
}

export function createRadio(): Radio {
  return {
    freq: 144.5,
    patchFrom: null,
    convoys: [],
    arrivals: [],
    lostConvoys: [],
    stats: { warnRight: 0, warnWrong: 0, patches: 0, refused: 0, moved: 0 },
    groups: [
      // The three stars (placeholders).
      g('rosa', 'Rosa, HCMC nurse', 'Rosa Medina', 'star', { x: 96.8, y: 121.8 }, 145.2, 0.3, 1.15, 1.05),
      g('walt', 'Walt, ham radio', 'Walt Lindqvist', 'star', cell(-93.256, 44.9405), 146.52, 0.55, 0.8, 0.9),
      g('abdi', 'Abdi, bus 21', 'Abdi Warsame', 'bus', cell(-93.2875, 44.986), 147.0, 0.3, 0.95, 1.1),
      // Others you can find.
      g('dorms', 'Mai, U of M dorms', 'Mai Vang', 'civil', { x: 128.5, y: 119.5 }, 151.82, 0.35, 1.2, 1.15),
      // St Paul: a walkie on the MURS band (154.57 MHz, a real licence-free channel).
      g('gloria', 'Gloria, Rondo kitchen', 'Gloria Hollins', 'star', cell(-93.1265, 44.9557), 154.57, 0.4, 0.95, 0.95),
      g('p1', 'MPD 1st Precinct', 'Sgt. Hale', 'police', { x: 88.6, y: 122.8 }, 155.37, 0.15, 0.85, 1.0),
      g('p3', 'MPD 3rd Precinct', 'Lt. Okafor', 'police', cell(-93.2326, 44.9486), 155.61, 0.15, 0.9, 1.0),
      g('p5', 'MPD 5th Precinct', 'Officer Berg', 'police', { x: 82.4, y: 155.6 }, 155.85, 0.15, 1.0, 1.05),
      g('noaa', 'Weather radio', 'automated voice', 'broadcast', { x: 90, y: 125 }, 162.55, 0, 0.7, 0.85),
    ],
  };
}

/** Where the dead are thickest near a group, as a compass word ('' if none close). */
export function threatDirection(w: World, gr: Group, radius = 12): { dir: string; count: number } {
  const cx = Math.floor(gr.x);
  const cy = Math.floor(gr.y);
  let sx = 0, sy = 0, n = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(w.height - 1, cy + radius); y++)
    for (let x = Math.max(0, cx - radius); x <= Math.min(w.width - 1, cx + radius); x++) {
      const z = w.infected[y * w.width + x];
      sx += (x - cx) * z;
      sy += (y - cy) * z;
      n += z;
    }
  if (n < 3) return { dir: '', count: 0 };
  const a = Math.atan2(-(sy / n), sx / n); // north = up
  const names = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
  const dir = names[(Math.round(a / (Math.PI / 4)) + 8) % 8];
  return { dir, count: Math.round(n) };
}

export function around(w: World, gr: Group, r = 1) {
  let living = 0, dead = 0, armed = 0;
  const cx = Math.floor(gr.x), cy = Math.floor(gr.y);
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      const i = y * w.width + x;
      living += w.healthy[i];
      dead += w.infected[i];
      armed += w.armed[i];
    }
  return { living, dead, armed };
}

export function updateStatus(w: World, gr: Group): void {
  if (gr.kind === 'broadcast') return;
  // Their own block decides whether they are overrun; the blocks around decide "contact".
  const own = around(w, gr, 0);
  const near = around(w, gr, 1);
  const before = gr.status;
  gr.status = (own.dead > 3 && own.dead > own.living * 2) || (own.living < 2 && own.dead > 0) ? 'overrun' : near.dead >= 2 ? 'contact' : 'calm';
  if (gr.status === 'overrun' && before === 'overrun') gr.silent = true;
  if (gr.status !== 'overrun') gr.silent = false;
}

/** The group on the dial right now, and how clear the signal is (0..1). */
export function tuned(r: Radio): { group: Group | null; signal: number } {
  let best: Group | null = null;
  let bd = TUNE;
  for (const gr of r.groups) {
    const d = Math.abs(gr.freq - r.freq);
    if (d < bd) {
      bd = d;
      best = gr;
    }
  }
  return { group: best, signal: best ? 1 - bd / TUNE : 0 };
}

// ---------- what people say (PLACEHOLDER writing) ----------
const STAR: Record<string, string[]> = {
  rosa: [
    "Who is this? This is a nurse's radio, get off the channel. ...Wait. You're up there? On the station?",
    "They've locked down the ER. Security says it's a bad batch of something. A man bit through an orderly's hand. Nobody is telling us anything.",
    "The third floor is gone. I'm in the east stairwell with eleven patients. If you can see the streets, tell me which way is clear.",
    'We are still here. Some of the patients can walk, some cannot. I am not leaving the ones who cannot.',
    'Power is out on our side of downtown. Battery is low. Talk to me while you can.',
    'If this is the last time you come over, tell someone we held the stairwell.',
  ],
  walt: [
    'CQ CQ, this is Walt in Powderhorn. ...You are the station? Well, I will be. Forty years on the air and this is a first.',
    'Folks on my block keep asking what is on the TV. Nothing is on the TV. Just the same loop about staying indoors.',
    'I have got the neighbors in my basement. Two deer rifles between us and a box of shells. Tell me what you see out there.',
    'We are holding. Lake Street is burning to the east of us. The Johnsons did not make it over the fence.',
    'Running on the car battery now. I will keep the set on as long as there is somebody to talk to.',
    'Sun comes up in a couple of hours. We are going to try for the river. Remember us.',
  ],
  abdi: [
    'Dispatch went quiet an hour ago. I have an empty bus, a full tank and nobody telling me where to go.',
    'I picked up people on Hennepin, they were running from the hospital. Where is safe? You can see. Tell me where to drive.',
    "Forty people on a bus built for sixty. They keep asking if I'm taking them home. I don't know where home is now.",
    'The bridges are jammed. Give me a road and I will take it.',
    "Fuel is under a quarter. Use me while I'm useful.",
    'Last run. Then I walk.',
  ],
};
STAR.dorms = [
  "okay okay okay. Is this... someone said this channel reaches the space station? That's insane. This is Mai, Pioneer Hall, third floor.",
  'We pushed the vending machines against the stairwell doors. There are maybe thirty of us. Nobody from the university is answering.',
  "My family's in Frogtown. My grandma doesn't pick up. I just want to know if the roads east are open.",
  "okay okay okay. There's a guy here, Danny, his mom's a nurse downtown. Have you heard anything from the hospital?",
  "Phones are dead. My battery's at one bar. I'm saving it for you.",
  "If you see a way out, tell me. I'm not staying in this building another night.",
];
// PLACEHOLDER lines for ISAK to rewrite. St Paul gets the trouble late: she hears it first
// from the people arriving.
STAR.gloria = [
  "Hello? Marcus, is that you? ...No. Who is this? The space station. Baby, I'm too old for jokes. ...You're serious.",
  "People keep coming up Dale Street from the river. They say Minneapolis is on fire. I've got coffee on and the big room open.",
  "Forty-one heads in my kitchen. Kids asleep on the gym mats. Somebody's bleeding and swears it's nothing. I don't like how he looks.",
  "If you can see the bridges, tell the ones coming over to come to the centre. Lights are on. Doors are open.",
  "There's a girl on the radio looking for her grandma in Frogtown? That's Mrs Vang. I know her. I'll go.",
  "Sun's coming. We are still here. You tell them St Paul kept the lights on.",
];
const NOAA = [
  'This is the National Weather Service. A health advisory is in effect for Hennepin County. Residents should stay indoors and avoid emergency rooms unless necessary.',
  'Officials report the situation is under control. Do not call 9-1-1 except for life-threatening emergencies.',
  'Shelter in place. Repeat. Shelter in place. Await further instructions.',
  'This is the National Weather Service. [the same message again, a little faster]',
];

function compassLine(w: World, gr: Group): string {
  const t = threatDirection(w, gr);
  return t.dir ? `The dead are to the ${t.dir}. Maybe ${t.count} of them.` : 'Nothing close yet. We hear shooting.';
}

/** The next thing this group says when you are tuned in. */
export function nextLine(r: Radio, w: World, gr: Group, pass: number): string {
  gr.known = true;
  if (gr.silent) return '[static. nobody answers]';
  if (gr.kind === 'broadcast') return NOAA[Math.min(NOAA.length - 1, pass)];
  if (gr.status === 'overrun') {
    gr.fate = gr.fate || 'overrun';
    return `${gr.who}: they're inside, they're... [the line goes dead]`;
  }
  const script = STAR[gr.id];
  if (script) {
    const k = Math.min(script.length - 1, Math.max(pass, gr.said));
    gr.said = k + 1;
    const extra = gr.status === 'contact' ? ` ${compassLine(w, gr)}` : '';
    return `${gr.who}: ${script[k]}${extra}`;
  }
  if (gr.kind === 'police') {
    if (gr.status === 'contact') return `${gr.who}, ${gr.name}: shots fired at the station, we need backup! ${compassLine(w, gr)}`;
    return `${gr.who}, ${gr.name}: ${pass < 2 ? 'Unknown station, this is a police channel. Identify yourself.' : 'We are holding. We have officers who could move, if anyone knew where.'}`;
  }
  if (gr.status === 'contact') return `${gr.who}: please, they're at the doors! ${compassLine(w, gr)}`;
  return `${gr.who}: we're barricaded in. Can you see anything from up there? ${compassLine(w, gr)}`;
}

// ---------- SPEAK: warn ----------
export function warn(r: Radio, w: World, gr: Group, tick: number, seed: number): string {
  if (gr.silent || gr.kind === 'broadcast') return '[no one answers]';
  const rand = rng(seed);
  if (rand() > 0.25 + gr.trust * 0.7) {
    r.stats.refused++;
    return `${gr.who}: Why should we believe a voice on the radio? We're staying put.`;
  }
  gr.warnedAt = tick;
  // They pull in the people around them and block the doors: the block makes a stand.
  const cx = Math.floor(gr.x), cy = Math.floor(gr.y), c = cy * w.width + cx;
  for (let y = cy - 3; y <= cy + 3; y++)
    for (let x = cx - 3; x <= cx + 3; x++) {
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      const i = y * w.width + x;
      const ring = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      // A voice they trust wakes the street and steadies it: fewer of them turn on each other.
      w.aware[i] = Math.max(w.aware[i], ring <= 2 ? 1 : 0.6);
      w.calm[i] = Math.max(w.calm[i], 1 - ring * 0.15);
      if (ring <= 1) w.guard[i] = 1;
      else if (w.infected[i] < 1) {
        const k = 0.5;
        w.healthy[c] += w.healthy[i] * k;
        w.armed[c] += w.armed[i] * k;
        w.ammo[c] += w.ammo[i] * k;
        w.healthy[i] *= 1 - k;
        w.armed[i] *= 1 - k;
        w.ammo[i] *= 1 - k;
      }
    }
  return `${gr.who}: Copy. We're pulling everyone in and blocking the doors.`;
}

// ---------- CONNECT: patch two groups ----------
export function patch(r: Radio, w: World, a: Group, b: Group, seed: number): string {
  if (a === b) return 'Pick a second channel to patch through.';
  if (a.silent || b.silent) return '[one side does not answer]';
  r.stats.patches++;
  const rand = rng(seed);
  // Who could help whom? Police or the bus can move; whoever is in trouble is helped.
  const helper = a.kind === 'police' || a.kind === 'bus' ? a : b.kind === 'police' || b.kind === 'bus' ? b : null;
  const needy = helper === a ? b : a;
  if (!helper) {
    // Two groups of neighbours: they share what they know and both get ready.
    for (const gr of [a, b]) w.guard[Math.floor(gr.y) * w.width + Math.floor(gr.x)] = Math.max(0.5, w.guard[Math.floor(gr.y) * w.width + Math.floor(gr.x)]);
    a.trust = Math.min(1, a.trust + 0.05);
    b.trust = Math.min(1, b.trust + 0.05);
    return `${a.who} and ${b.who} talk. They share what they know.`;
  }
  const own = around(w, helper);
  const p = 0.2 + helper.trust * 0.6 + (helper.status === 'calm' ? 0.2 : -0.3);
  if (rand() > p) {
    r.stats.refused++;
    return `${helper.who}: Negative. We can't leave our own people.`;
  }
  helper.trust = Math.min(1, helper.trust + 0.05);
  if (helper.kind === 'bus') {
    r.convoys.push({ x: helper.x, y: helper.y, to: needy, from: helper, people: 0, armed: 0, ammo: 0, bus: true });
    return `${helper.who}: On my way to ${needy.name}. Keep them alive until I get there.`;
  }
  const send = Math.min(20, own.armed * 0.4);
  if (send < 2) return `${helper.who}: We've got nobody left to send.`;
  // Take officers from the station cell.
  const i = Math.floor(helper.y) * w.width + Math.floor(helper.x);
  const take = Math.min(send, w.armed[i]);
  const ammo = take > 0 ? (w.ammo[i] * take) / w.armed[i] : 0;
  w.armed[i] -= take;
  w.healthy[i] -= take;
  w.ammo[i] -= ammo;
  r.convoys.push({ x: helper.x, y: helper.y, to: needy, from: helper, people: take, armed: take, ammo, bus: false });
  return `${helper.who}: Sending ${Math.round(take)} officers to ${needy.name}. They'll decide what to do when they get there.`;
}

/** One city tick: convoys drive, warnings are checked, readiness fades. */
export function stepRadio(r: Radio, w: World, tick: number): void {
  for (const gr of r.groups) {
    updateStatus(w, gr);
    // The stars' people keep their doors blocked for as long as they hold.
    if ((gr.kind === 'star' || gr.kind === 'bus') && gr.status !== 'overrun')
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = (Math.floor(gr.y) + dy) * w.width + Math.floor(gr.x) + dx;
          if (i >= 0 && i < w.guard.length) w.guard[i] = Math.max(w.guard[i], 0.7);
        }
    if (gr.warnedAt >= 0) {
      const t = threatDirection(w, gr, 3);
      if (t.count >= 5) {
        r.stats.warnRight++;
        gr.trust = Math.min(1, gr.trust + 0.2);
        gr.warnedAt = -1;
      } else if (tick - gr.warnedAt > 90) {
        r.stats.warnWrong++;
        gr.trust = Math.max(0, gr.trust - 0.15);
        gr.warnedAt = -1;
      }
    }
  }
  for (let i = 0; i < w.guard.length; i++) if (w.guard[i] > 0) w.guard[i] = Math.max(0, w.guard[i] - 0.003);
  const keep: Convoy[] = [];
  for (const c of r.convoys) {
    const dx = c.to.x - c.x, dy = c.to.y - c.y;
    let d = Math.hypot(dx, dy);
    // Along the streets when there is a route: police cars about 30 km/h, the bus 25 (cells per
    // one-minute tick); the old straight line otherwise.
    const v = c.path ? (c.bus ? 5 : 6) : c.bus ? 2 : 1.2;
    if (c.path) d = Math.max(0, pathLength(c.path) - (c.at ?? 0));
    const i = Math.floor(c.y) * w.width + Math.floor(c.x);
    if (!c.bus && w.infected[i] > 0) {
      // Fighting their way through.
      const shot = Math.min(w.infected[i], Math.min(c.ammo, c.armed * 2) * 0.4);
      w.infected[i] -= shot;
      w.fallen[i] += shot;
      c.ammo -= Math.min(c.ammo, c.armed * 2);
      const lost = Math.min(c.armed, w.infected[i] * 0.05);
      c.armed -= lost;
      c.people -= lost;
      w.infected[i] += lost;
    }
    if (d <= v) {
      r.arrivals.push(c);
      const j = Math.floor(c.to.y) * w.width + Math.floor(c.to.x);
      if (c.bus) {
        // Pick people up and take them to the safest contact.
        const ride = Math.min(40, w.healthy[j]);
        w.healthy[j] -= ride;
        const safe = r.groups.filter((gg) => gg.status === 'calm' && gg !== c.to && gg.kind !== 'broadcast').sort((a, b) => b.trust - a.trust)[0];
        if (safe && ride > 0) {
          r.convoys.push({ x: c.to.x, y: c.to.y, to: safe, from: c.to, people: ride, armed: 0, ammo: 0, bus: false });
          r.stats.moved += ride;
        } else w.healthy[j] += ride;
      } else {
        w.healthy[j] += c.people;
        w.armed[j] += c.armed;
        w.ammo[j] += c.ammo;
        if (c.people > 0) r.stats.moved += c.people;
      }
      continue;
    }
    if (c.path) {
      c.at = (c.at ?? 0) + v;
      const p = pathPoint(c.path, c.at);
      c.x = p.x;
      c.y = p.y;
    } else {
      c.x += (dx / d) * v;
      c.y += (dy / d) * v;
    }
    if (c.people > 0.5 || c.bus) keep.push(c);
    else r.lostConvoys.push(c);
  }
  r.convoys = keep;
}
