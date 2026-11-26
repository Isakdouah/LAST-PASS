import { Session } from '../src/game/session';
const quiet = { start() {}, hush() {}, setStatic() {}, say() {}, shot() {}, muted: true } as never;
const g = new Session(quiet); g.reset('play');
for (let m = 0; m < 600; m++) {
  g.skipMinute();
  if (m % 60 === 0) {
    const us = g.resp.units;
    const c: Record<string, number> = {};
    for (const u of us) c[u.kind + ':' + u.state] = (c[u.kind + ':' + u.state] || 0) + 1;
    let fires = 0; for (let i = 0; i < g.fires.fire.length; i++) if (g.fires.fire[i] > 0.05) fires++;
    console.log(Math.round(g.t), 'fires', fires, JSON.stringify(c));
  }
}
