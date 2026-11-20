import { describe, expect, it } from 'vitest';
import { Session } from './session';
import { passCentre } from './clock';
import { RUMOURS } from './rumours';

const quiet = { start() {}, hush() {}, setStatic() {}, say() {}, shot() {}, muted: true } as never;
const inPass = (g: Session, k: number) => (g.t = passCentre(k));
const avgKnow = (g: Session) => {
  let s = 0, n = 0;
  for (let i = 0; i < g.world.know.length; i++) if (g.world.land[i] && g.world.healthy[i] > 0) (s += g.world.know[i]), n++;
  return s / n;
};

describe('speaking to the city', () => {
  it('"aim for the head" spreads block by block; with proof it goes much further', () => {
    const run = (proof: boolean) => {
      const g = new Session(quiet);
      g.reset('play');
      inPass(g, 1);
      g.proof = proof;
      g.doHeadcast();
      for (let k = 0; k < 90; k++) g.cityStep();
      return avgKnow(g);
    };
    const without = run(false), withProof = run(true);
    expect(without).toBeGreaterThan(0.05);
    expect(withProof).toBeGreaterThan(without * 1.8);
  });

  it('without proof the broadcast costs trust', () => {
    const g = new Session(quiet);
    g.reset('play');
    inPass(g, 1);
    const before = g.radio.groups.find((x) => x.id === 'walt')!.trust;
    g.doHeadcast();
    expect(g.radio.groups.find((x) => x.id === 'walt')!.trust).toBeLessThan(before);
  });

  it('a rumour can only be answered after you have looked; then it stops changing what people do', () => {
    const g = new Session(quiet);
    g.reset('play');
    inPass(g, 1); // before the other rumours start
    const st = g.rumours.find((r) => r.id === 'cure')!;
    st.active = true;
    expect(g.env().leave).toBeLessThan(1);
    g.doDebunk();
    expect(st.debunked).toBe(false); // not seen yet
    const r = RUMOURS.find((x) => x.id === 'cure')!;
    g.simulate(0.01, 0, { x0: r.where.x - 5, y0: r.where.y - 5, x1: r.where.x + 5, y1: r.where.y + 5 }, false);
    expect(st.seen).toBe(true);
    g.doDebunk();
    expect(st.debunked).toBe(true);
    expect(g.env().leave).toBe(1);
  });

  it('a hero who does not trust you yet says why, and it goes on their card', () => {
    const g = new Session(quiet);
    g.reset('play');
    inPass(g, 0);
    const walt = g.radio.groups.find((x) => x.id === 'walt')!;
    walt.trust = 0;
    g.radio.freq = walt.freq;
    let refused = false;
    for (let k = 0; k < 8 && !refused; k++) {
      g.tick += 3;
      g.doWarn();
      refused = g.heroState('walt')!.log.some((l) => l.text.includes('would not go'));
    }
    expect(refused).toBe(true);
  });
});
