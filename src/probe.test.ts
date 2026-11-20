import { it } from 'vitest';
import { Session } from './game/session';
import { passCentre } from './game/clock';
const quiet = { start() {}, hush() {}, setStatic() {}, say() {}, shot() {}, muted: true } as never;
it('probe night', () => {
  const g = new Session(quiet);
  g.reset('play');
  const start = g.totals().alive;
  const out: string[] = [];
  let k = 0;
  while (g.mode === 'play') {
    g.simulate(1, 0, null, false);
    if (k < 6 && g.t >= passCentre(k)) {
      const t = g.totals();
      const st = g.world.stats as unknown as Record<string, number>;
      const esc = g.world.stats.escaped; out.push(`pass${k + 1} esc ${(100*esc/start).toFixed(1)}% alive ${(100 * t.alive / start).toFixed(1)}% dead ${Math.round(t.dead)} fallen ${Math.round(t.fallen)}` + (st ? ' ' + JSON.stringify(Object.fromEntries(Object.entries(st).map(([a, b]) => [a, Math.round(b as number)]))) : ''));
      k++;
    }
  }
  console.log(out.join('\n'));
});
