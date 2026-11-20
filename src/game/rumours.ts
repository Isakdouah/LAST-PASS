// Rumours: what people say on the radio and the phone tonight. Some are false, and they
// change what people do (stay put, turn on each other). You can debunk one, but only after
// you have looked at the place yourself through the telescope; otherwise you are just
// another voice, and it costs you trust. All text is PLACEHOLDER for ISAK to rewrite.

export interface Rumour {
  id: string;
  /** Game seconds after 19:40 when it starts going round. */
  at: number;
  source: string;
  text: string;
  /** Where to look to see the truth (map cell). */
  where: { x: number; y: number };
  place: string;
  /** What you say when you debunk it. */
  truth: string;
  /** While believed: share of people who still leave (1 = no change), and how much more people turn on each other. */
  leave: number;
  strife: number;
}

export const RUMOURS: Rumour[] = [
  {
    id: 'cure',
    at: 2.3 * 3600,
    source: 'Caller on KFAI',
    text: '"They have a shot at HCMC that stops it. Bring the bitten to the hospital. Do not leave them."',
    where: { x: 96.8, y: 121.8 },
    place: 'HCMC',
    truth: 'I am looking at HCMC right now. The dead are inside. There is no shot. Do not go there.',
    leave: 0.6,
    strife: 1,
  },
  {
    id: 'looting',
    at: 3.4 * 3600,
    source: 'Police scanner chatter',
    text: '"Gangs are looting Lake Street and shooting anyone they see."',
    where: { x: 97.5, y: 152.6 },
    place: 'Lake Street and Chicago Avenue',
    truth: 'I can see Lake Street. Those are neighbours, carrying people out of the stores. Nobody is hunting you but the dead.',
    leave: 0.85,
    strife: 2,
  },
  {
    id: 'bridges',
    at: 5 * 3600,
    source: 'Caller on WCCO',
    text: '"The Army closed every bridge. There is no way out across the river."',
    where: { x: 115.1, y: 112.2 },
    place: 'the I-35W bridge',
    truth: 'I see the I-35W bridge. Cars are crossing. It is open. If you can drive, go now.',
    leave: 0.5,
    strife: 1.2,
  },
];

export interface RumourState {
  id: string;
  /** Going round now. */
  active: boolean;
  /** You have looked at the place through the telescope since it started. */
  seen: boolean;
  debunked: boolean;
}

export const createRumours = (): RumourState[] => RUMOURS.map((r) => ({ id: r.id, active: false, seen: false, debunked: false }));
export const rumourById = (id: string) => RUMOURS.find((r) => r.id === id)!;

/** The combined effect of every rumour people still believe. */
export function rumourEffect(states: RumourState[]): { leave: number; strife: number } {
  let leave = 1, strife = 1;
  for (const s of states) {
    if (!s.active || s.debunked) continue;
    const r = rumourById(s.id);
    leave *= r.leave;
    strife *= r.strife;
  }
  return { leave, strife };
}
