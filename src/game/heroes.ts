// The heroes: a handful of people on the ground with full stories (the radio "stars" plus one
// promoted from the crowd). Each has a lore sheet, an ID card, a vehicle you can spot from orbit,
// an escape plan along real roads, and a little plot armour: close calls that turn a death into
// a narrow escape, if the maths and your help allow it. Every close call costs them something.
// All names, numbers and lines are PLACEHOLDERS for ISAK to rewrite. ID numbers are made up.

/** Map cell from longitude/latitude (same box as the Minneapolis map). */
export const cellOf = (lat: number, lon: number) => ({ x: ((lon + 93.36) / 0.36) * 360, y: ((45.06 - lat) / 0.19) * 260 });

export type CardKind = 'license' | 'staff' | 'transit' | 'student';
export type VehicleKind = 'pickup' | 'bus' | 'ambulance' | 'car';

/** One line of lore. It shows on the card once you have learned it. */
export interface Lore {
  label: string;
  text: string;
  /** heard: after this many radio lines; seen: once you have looked at them through the telescope;
   *  closecall / arrived: after those happen. */
  learn: { heard?: number; seen?: boolean; event?: 'closecall' | 'arrived' };
}

export interface Portrait {
  skin: string;
  hair: string;
  style: 'short' | 'long' | 'bun' | 'bald' | 'cropped';
  shirt: string;
  beard?: boolean;
  glasses?: boolean;
  grey?: boolean;
}

export interface Hero {
  id: string; // matches the radio group id
  name: string;
  card: CardKind;
  /** What is printed on the card itself (shown once you know who they are). */
  printed: Record<string, string>;
  portrait: Portrait;
  vehicle: { kind: VehicleKind; colour: number; label: string; before?: string };
  lore: Lore[];
  /** Close calls tonight: how many deaths can turn into narrow escapes. */
  closeCalls: number;
  /** Escape plan: a route along real roads (lat/lon points), how many can ride, and what each close call costs. */
  escape: { label: string; to: string; route: { lat: number; lon: number }[]; seats: number; kmh: number };
  costs: string[];
  /** What they say on the radio after a close call (one per cost). */
  after: string[];
  /** Why they will not do what you say (when they do not trust you yet). PLACEHOLDER lines. */
  refuse: string[];
}

export const HEROES: Hero[] = [
  {
    id: 'rosa',
    name: 'Rosa Medina',
    card: 'staff',
    printed: { title: 'RN · Emergency Dept.', id: 'EMP 0447 213', since: 'Staff since 2001', shift: 'Nights' },
    portrait: { skin: '#b07a52', hair: '#1c1410', style: 'bun', shirt: '#4a7a8c' },
    vehicle: { kind: 'ambulance', colour: 0xf4f2ea, label: 'Ambulance 14' },
    lore: [
      { label: 'Job', text: 'ER night nurse at the county hospital downtown. Eighteen years on nights.', learn: { heard: 1 } },
      { label: 'Home', text: 'Phillips, off Bloomington Avenue. Born in Guadalajara, came north at seventeen.', learn: { heard: 2 } },
      { label: 'Wants tonight', text: 'Get her eleven patients out. All of them.', learn: { heard: 3 } },
      { label: 'Carries', text: "A pager, a cracked Motorola RAZR and a box of swine-flu masks from this week's H1N1 drills.", learn: { seen: true } },
      { label: 'Link', text: 'Her son Danny (19) lives in the U of M dorms, on the same floor as Mai Vang.', learn: { heard: 4 } },
      { label: 'Fear', text: 'Being the one who decides who stays behind.', learn: { event: 'closecall' } },
      { label: 'Radio habit', text: 'Says "copy" like a paramedic (her ex was one). Signs off "cuídate".', learn: { heard: 2 } },
      { label: 'Secret', text: 'At 3:10 this afternoon she signed for the organ cooler that came in on the transfer flight.', learn: { event: 'arrived' } },
    ],
    closeCalls: 1,
    escape: {
      label: 'Ambulance 14 with the patients who can sit up',
      to: 'the U of M campus, where Danny is',
      seats: 8,
      kmh: 25,
      route: [
        { lat: 44.9727, lon: -93.2622 },
        { lat: 44.9752, lon: -93.2573 },
        { lat: 44.9737, lon: -93.2463 },
        { lat: 44.9734, lon: -93.2410 },
        { lat: 44.9737, lon: -93.2335 },
      ],
    },
    costs: ['Five patients who could not be moved stay behind in the stairwell.'],
    after: ["Rosa: We're out. Copy? We're out. I left five of them. I told them I'd come back. I won't be able to come back."],
    refuse: ["Rosa: I have eleven patients on this floor who can't walk. I'm not leaving them because a voice on the radio says so.", 'Rosa: Charge nurse says nobody leaves the unit. If I go, I lose my license. Give me something real.'],
  },
  {
    id: 'walt',
    name: 'Walter E. Lindqvist',
    card: 'license',
    printed: { dl: 'L-436-2X1-907-55', dob: '03/02/1938', exp: '03/02/2012', addr: '3540 Lindgren Ave S\nMinneapolis MN 55407', cls: 'D', sex: 'M', hgt: "5'-11\"", eyes: 'BLU', rest: 'CORRECTIVE LENSES' },
    portrait: { skin: '#e2b896', hair: '#b8b4ac', style: 'short', shirt: '#8a2a20', glasses: true, grey: true },
    vehicle: { kind: 'pickup', colour: 0xa82a1e, label: 'red 1997 Ford Ranger' },
    lore: [
      { label: 'Job', text: 'Retired. Thirty-one years on the line at the Ford plant in St Paul. Army radio operator before that.', learn: { heard: 1 } },
      { label: 'Home', text: 'Powderhorn since 1968. Widower. Ingrid died in 2006; her Dala horse still rides on the dashboard.', learn: { heard: 2 } },
      { label: 'Vehicle', text: 'A red 1997 Ranger built at his own plant. He swears he put the doors on this one.', learn: { seen: true } },
      { label: 'Wants tonight', text: 'Get the neighbours in his basement across the river to St Paul.', learn: { heard: 3 } },
      { label: 'Link', text: "Taught Abdi Warsame's nephew to build a crystal radio at the Powderhorn rec centre.", learn: { heard: 4 } },
      { label: 'Radio habit', text: 'Ends every call with "seventy-three" (ham code for best regards). Asks "QSL?" when he wants a yes.', learn: { heard: 1 } },
      { label: 'Fear', text: 'Outliving everyone again.', learn: { event: 'closecall' } },
      { label: 'Secret', text: 'For three days he heard strange traffic on 146.52, people talking about bites. He thought it was kids and told nobody.', learn: { event: 'arrived' } },
    ],
    closeCalls: 2,
    escape: {
      label: 'The red Ranger, neighbours in the back',
      to: 'across the Lake Street bridge to St Paul',
      seats: 7,
      kmh: 35,
      route: [
        { lat: 44.9405, lon: -93.256 },
        { lat: 44.9485, lon: -93.2558 },
        { lat: 44.9485, lon: -93.2300 },
        { lat: 44.9485, lon: -93.2085 },
        { lat: 44.948, lon: -93.199 },
        { lat: 44.948, lon: -93.170 },
      ],
    },
    costs: ['The base station stays behind. From now on he only has a handheld with a weak battery.', 'The windshield is gone and so are his glasses. He drives by the sound of the engine.'],
    after: [
      'Walt: ...reading you weak, I know. Had to leave the big set. Handheld only now. We made it out of the basement. QSL?',
      "Walt: Lost my glasses. Can't see a damn thing past the hood. You'll have to be my eyes now. Seventy-three.",
    ],
    refuse: ["Walt: Forty years in this house. Margaret's ashes are on the mantel. I'm not running from a rumour.", "Walt: I'll believe it when I see it with my own eyes. Basement door's bolted. I'm staying."],
  },
  {
    id: 'abdi',
    name: 'Abdi Warsame',
    card: 'transit',
    printed: { title: 'Bus Operator', id: 'OP 21-0815', route: 'Route 21 · Lake St', garage: 'South Garage', since: 'Since 2004' },
    portrait: { skin: '#5a3a26', hair: '#141010', style: 'cropped', shirt: '#2a3a5c', beard: true },
    vehicle: { kind: 'bus', colour: 0xe6d8a0, label: 'Bus 21' },
    lore: [
      { label: 'Job', text: 'Drives the 21 down Lake Street. Five years, never late once (he will tell you).', learn: { heard: 1 } },
      { label: 'Home', text: 'Riverside Plaza, Cedar-Riverside. Born in Mogadishu in 1979, came in 1996 by way of the Dadaab camp in Kenya.', learn: { heard: 2 } },
      { label: 'Wants tonight', text: 'Get the passengers out, then get home to his daughter Hodan (6), who is with his sister.', learn: { heard: 3 } },
      { label: 'Carries', text: 'A Nokia with two SIM cards: one for here, one for calling his mother in Mogadishu.', learn: { seen: true } },
      { label: 'Link', text: "His nephew learned radio from Walt Lindqvist. He trusts Walt's voice more than yours.", learn: { heard: 4 } },
      { label: 'Radio habit', text: 'Counts the passengers out loud every time the doors close.', learn: { heard: 2 } },
      { label: 'Fear', text: 'A checkpoint, and a soldier asking for his papers.', learn: { event: 'closecall' } },
      { label: 'Secret', text: 'His mother called this morning: in Mogadishu people were closing the roads. He thought she was talking about the war.', learn: { event: 'arrived' } },
    ],
    closeCalls: 2,
    escape: {
      label: 'Bus 21, every seat full',
      to: 'Riverside Plaza for Hodan, then east on I-94 to St Paul',
      seats: 40,
      kmh: 30,
      route: [
        { lat: 44.986, lon: -93.2875 },
        { lat: 44.9715, lon: -93.2862 },
        { lat: 44.9692, lon: -93.2700 },
        { lat: 44.9688, lon: -93.2475 },
        { lat: 44.9655, lon: -93.2150 },
        { lat: 44.9585, lon: -93.1700 },
      ],
    },
    costs: ['The rear doors jammed. Eight people did not get on.', 'The engine is hit. The bus will not go much further.'],
    after: [
      'Abdi: Thirty-two. Thirty-two on board. There were forty. The doors... Thirty-two.',
      'Abdi: Engine is making a sound I do not like. We go as far as she goes, then we walk.',
    ],
    refuse: ['Abdi: Dispatch says hold at the stop. If I leave the route, I lose the job. My daughter needs this job.', 'Abdi: There are still people running for the bus. I wait one more minute. One more.'],
  },
  {
    id: 'dorms',
    name: 'Mai Vang',
    card: 'student',
    printed: { id: '4 2 1 7 8 0 3 9', college: 'College of Biological Sciences', year: 'Sophomore', valid: 'Valid through 05/2011' },
    portrait: { skin: '#c89a6e', hair: '#0e0c0c', style: 'long', shirt: '#7a1e28' },
    vehicle: { kind: 'pickup', colour: 0x3a5a8c, label: "a stranger's blue pickup", before: 'a maroon backpack on the dorm steps' },
    lore: [
      { label: 'Who', text: 'Biology student, 20, on the third floor of Pioneer Hall. Answered a walkie on the MURS band nobody else would pick up.', learn: { heard: 1 } },
      { label: 'Home', text: 'Frogtown, St Paul. Her family came from Laos by way of a camp in Thailand.', learn: { heard: 2 } },
      { label: 'Wants tonight', text: 'Get home to Frogtown. Her grandmother does not answer the phone.', learn: { heard: 3 } },
      { label: 'Carries', text: "A patch of her grandmother's story cloth sewn on her backpack: the 1975 crossing of the Mekong.", learn: { seen: true } },
      { label: 'Link', text: "Rosa Medina's son Danny is with her. He keeps asking if anyone has heard from his mom.", learn: { heard: 4 } },
      { label: 'Radio habit', text: 'Says "okay okay okay" before she says anything that matters.', learn: { heard: 2 } },
      { label: 'Fear', text: 'The river. Her grandmother never talks about the crossing, only that some did not reach the other side.', learn: { event: 'closecall' } },
      { label: 'Secret', text: 'She filmed the first bite on campus on her phone and put it online. It keeps getting taken down.', learn: { event: 'arrived' } },
    ],
    closeCalls: 1,
    escape: {
      label: "the back of a stranger's pickup, with Danny",
      to: 'east on I-94 to Frogtown',
      seats: 6,
      kmh: 40,
      route: [
        { lat: 44.9737, lon: -93.2335 },
        { lat: 44.9695, lon: -93.2265 },
        { lat: 44.9655, lon: -93.2150 },
        { lat: 44.962, lon: -93.19 },
        { lat: 44.9585, lon: -93.15 },
      ],
    },
    costs: ['She had to let go of the backpack. The story cloth is somewhere on the ramp to I-94.'],
    after: ["Mai: okay okay okay. We're on the highway. Danny's here. I lost my bag. It doesn't matter. It doesn't matter."],
    refuse: ["Mai: My roommate is still out. I'm not leaving without Danny, I don't care.", 'Mai: The RA says stay in our rooms and lock the doors. Everyone is staying. I am not going out there alone.'],
  },
  {
    // St Paul. The other heroes are all running toward St Paul; Gloria is where they arrive.
    // Rondo history (I-94 cut through the neighbourhood in the 1960s and displaced hundreds of
    // Black families) is real; Gloria, her family and the details are PLACEHOLDERS for ISAK.
    id: 'gloria',
    name: 'Gloria Hollins',
    card: 'license',
    printed: { dl: 'H-452-118-640-31', dob: '07/14/1953', exp: '07/14/2013', addr: '668 Carroll Ave\nSt Paul MN 55104', cls: 'D', sex: 'F', hgt: "5'-5\"", eyes: 'BRO', rest: 'CORRECTIVE LENSES' },
    portrait: { skin: '#6a4430', hair: '#2a2420', style: 'short', shirt: '#c8a040', glasses: true, grey: true },
    vehicle: { kind: 'car', colour: 0xb8bcc4, label: "her nephew's silver Buick", before: 'the lit kitchen windows of the community centre' },
    lore: [
      { label: 'Job', text: 'Runs the kitchen at a community centre in Rondo. Feeds the after-school kids and the Friday seniors.', learn: { heard: 1 } },
      { label: 'Home', text: 'Rondo, St Paul, her whole life. Her mother lost the family house when I-94 was cut through in the sixties.', learn: { heard: 2 } },
      { label: 'Wants tonight', text: 'Keep the doors open for everyone coming over the river, as long as it is safe. Then one minute longer.', learn: { heard: 3 } },
      { label: 'Carries', text: 'A ring of keys to half the buildings on the block and a walkie her nephew left in the kitchen.', learn: { seen: true } },
      { label: 'Link', text: "Mai Vang's grandmother lives two streets over in Frogtown. Gloria checks on her every Sunday.", learn: { heard: 4 } },
      { label: 'Radio habit', text: 'Calls everybody "baby", even you. Counts heads like a lunch line.', learn: { heard: 2 } },
      { label: 'Fear', text: 'Locking the door on somebody. She has seen what it does to a neighbourhood when the doors close.', learn: { event: 'closecall' } },
      { label: 'Secret', text: "Her nephew Marcus works nights at a Minneapolis hospital. He stopped answering at nine o'clock.", learn: { event: 'arrived' } },
    ],
    closeCalls: 2,
    escape: {
      label: "her nephew's Buick, the last ones from the kitchen",
      to: "Frogtown for Mai's grandmother, then her sister's on the East Side",
      seats: 5,
      kmh: 30,
      route: [
        { lat: 44.9557, lon: -93.1265 },
        { lat: 44.9557, lon: -93.1165 },
        { lat: 44.96, lon: -93.1165 },
        { lat: 44.9557, lon: -93.105 },
        { lat: 44.96, lon: -93.09 },
        { lat: 44.9705, lon: -93.073 },
      ],
    },
    costs: ['She had to lock the side door with people still outside it.', "The Buick's back window is gone and Mai's grandmother is hurt. They drive slowly now."],
    after: [
      "Gloria: I locked it. Lord help me, I locked it. There were still people on the steps. Don't you ever tell me that was right.",
      "Gloria: We got her. We got Mrs Vang. She's cut but she's talking. You tell that girl her grandma is with me.",
    ],
    refuse: [
      "Gloria: Baby, there are forty people in my kitchen and more coming up Dale Street. I'm not closing the doors because you say so.",
      "Gloria: You've never seen this block. I have, for fifty-six years. Give me a reason, not an order.",
    ],
  },
];

export const heroById = (id: string) => HEROES.find((h) => h.id === id);

// Routes follow the streets: the session plugs in a router that knows where the buildings are.
type Router = (pts: { x: number; y: number }[]) => { x: number; y: number }[];
let router: Router | null = null;
const routeCache = new Map<string, { x: number; y: number }[]>();
export function setRouter(r: Router) {
  router = r;
  routeCache.clear();
}
/** The escape route in map cells (along the streets once a router is set). */
export function routeCells(h: Hero) {
  const hit = routeCache.get(h.id);
  if (hit) return hit;
  const pts = h.escape.route.map((p) => cellOf(p.lat, p.lon));
  if (!router) return pts;
  const r = router(pts);
  routeCache.set(h.id, r);
  return r;
}
const CELL_M = 80; // about 80 m per map cell (78.7 x 81.3)

/** Where you are `secs` after starting the escape (map cells), and whether you have arrived. Pure. */
export function escapeAt(h: Hero, secs: number): { x: number; y: number; face: number; arrived: boolean } {
  const pts = routeCells(h);
  let left = (Math.max(0, secs) * h.escape.kmh) / 3.6 / CELL_M; // cells travelled
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg) {
      const f = seg > 0 ? left / seg : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, face: Math.atan2(b.y - a.y, b.x - a.x), arrived: false };
    }
    left -= seg;
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return { x: b.x, y: b.y, face: Math.atan2(b.y - a.y, b.x - a.x), arrived: true };
}

/** Chance that a would-be death becomes a narrow escape. The maths, not the script, decides.
 *  helpedAgo: city ticks since you last warned them or sent help (Infinity = never).
 *  pressure: share of the dead around them (0..1). */
export function escapeChance(o: { left: number; helpedAgo: number; vehicle: boolean; trust: number; pressure: number }): number {
  if (o.left <= 0) return 0;
  const help = o.helpedAgo < 30 ? 0.35 : o.helpedAgo < 90 ? 0.15 : 0;
  const p = 0.2 + help + (o.vehicle ? 0.15 : 0) + o.trust * 0.2 - o.pressure * 0.3;
  return Math.max(0.05, Math.min(0.92, p));
}

/** What happens to a hero tonight, kept by the session. */
export interface HeroState {
  id: string;
  left: number; // close calls left
  helpedAt: number; // city tick of your last useful help (-1 never)
  /** How many times they turned down your advice (to pick the next reason). */
  refusals: number;
  escapeStart: number; // city tick the escape began (-1 none)
  arrived: boolean;
  dead: boolean;
  seen: boolean;
  closeCallsUsed: number;
  riders: number;
  pending: string; // a line waiting for the next time you tune in
  log: { t: number; text: string }[];
}
export function createHeroStates(): HeroState[] {
  return HEROES.map((h) => ({
    id: h.id,
    left: h.closeCalls,
    helpedAt: -1,
    refusals: 0,
    escapeStart: -1,
    arrived: false,
    dead: false,
    seen: false,
    closeCallsUsed: 0,
    riders: 0,
    pending: '',
    log: [],
  }));
}

/** How you would recognise them from orbit right now. */
export function seenAs(h: Hero, st: HeroState): string {
  return st.escapeStart < 0 && h.vehicle.before ? h.vehicle.before : h.vehicle.label;
}

/** Is a lore line learned yet? */
export function learned(l: Lore, said: number, st: HeroState): boolean {
  if (l.learn.heard !== undefined && said >= l.learn.heard) return true;
  if (l.learn.seen && st.seen) return true;
  if (l.learn.event === 'closecall' && st.closeCallsUsed > 0) return true;
  if (l.learn.event === 'arrived' && st.arrived) return true;
  return false;
}
