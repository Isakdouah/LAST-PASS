// Game bot: plays the whole night three ways with no drawing and compares how many people
// are alive in holdouts at dawn (the night goal). Usage: npx vite-node tools/gamebot.ts
// Goal (fixed, not to be loosened): sensible play saves at least 30% more people in
// holdouts at dawn than doing nothing, and more than random calls.
import { Session, AIR } from '../src/game/session';
import { inWindow, passCentre, PASSES, WINDOW, nightOver } from '../src/game/clock';
import { defence, pressure, sheltered, KINDS } from '../src/game/holdouts';

const quiet = { start() {}, hush() {}, setStatic() {}, say() {}, shot() {}, muted: true } as never;
type Policy = 'nothing' | 'random' | 'sensible';

function play(policy: Policy, seed: number) {
  const g = new Session(quiet);
  g.reset('play');
  g.say = () => {};
  let r = seed >>> 0 || 1;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  let routes = 0;
  for (let k = 0; k < PASSES; k++) {
    const t0 = passCentre(k) - WINDOW + 30;
    while (g.t < t0) g.skipMinute();
    if (!inWindow(g.t) || policy === 'nothing') continue;
    // Look at every holdout (the telescope sweeps the city), then spend the air time.
    for (const h of g.holds.list) g.look(h.x, h.y, 0.5);
    const open = g.holds.list.filter((h) => h.state !== 'fallen');
    let pick: typeof open;
    if (policy === 'random') {
      pick = [];
      for (let n = 0; n < AIR && open.length; n++) pick.push(open[Math.floor(rnd() * open.length)]);
    } else {
      // Where it helps most: a strong place with room, the living close by, the dead not yet at the door.
      const w = g.world;
      const score = (h: (typeof open)[0]) => {
        let living = 0;
        for (let dy = -5; dy <= 5; dy++)
          for (let dx = -5; dx <= 5; dx++) {
            const x = Math.floor(h.x) + dx, y = Math.floor(h.y) + dy;
            if (x >= 0 && y >= 0 && x < w.width && y < w.height) living += w.healthy[y * w.width + x] * w.aware[y * w.width + x];
          }
        const room = Math.max(0, h.cap * KINDS[h.kind].door - h.people);
        // The dead within about 400 m: a place they are already around is a trap.
        let near = 0;
        for (let dy = -5; dy <= 5; dy++)
          for (let dx = -5; dx <= 5; dx++) {
            const x = Math.floor(h.x) + dx, y = Math.floor(h.y) + dy;
            if (x >= 0 && y >= 0 && x < w.width && y < w.height) near += w.infected[y * w.width + x];
          }
        const risk = (pressure(h, w) + near * 0.2) / (defence(h) + KINDS[h.kind].fort * 40 + 1);
        // Who would come (about a third of those who hear), what fits, and the odds it holds.
        return (Math.min(living * 0.3, room) * Math.sqrt(KINDS[h.kind].fort)) / (1 + 4 * risk);
      };
      // Not the same place twice while the last call still runs.
      pick = open.filter((h) => h.routedUntil <= g.t).sort((a, b) => score(b) - score(a)).slice(0, AIR);
    }
    for (const h of pick) if (g.doRoute(h.id)) routes++;
  }
  while (!nightOver(g.t)) g.skipMinute();
  const tot = g.totals();
  if (process.env.DETAIL === policy)
    for (const h of g.holds.list) if (h.peak > 50) console.log(h.kind.padEnd(10), h.name.slice(0, 34).padEnd(34), h.state.padEnd(8), 'peak', Math.round(h.peak), 'now', Math.round(h.people), 'fell', h.fellAt > 0 ? Math.round(h.fellAt / 60) : '-', 'routed', h.routedUntil > 0 ? 'Y' : '');
  return { policy, sheltered: Math.round(sheltered(g.holds)), alive: Math.round(tot.alive), held: g.holds.list.filter((h) => h.state !== 'fallen' && h.people > 0).length, fell: g.holds.list.filter((h) => h.state === 'fallen').length, routes };
}

const res = (['nothing', 'random', 'sensible'] as Policy[]).map((p) => play(p, 7));
for (const x of res) console.log(JSON.stringify(x));
const [none, rand, good] = res;
const ok = good.sheltered >= none.sheltered * 1.3 && good.sheltered > rand.sheltered;
console.log(`sensible vs nothing: ${((good.sheltered / Math.max(1, none.sheltered) - 1) * 100).toFixed(0)}% more in holdouts at dawn`, ok ? 'PASS' : 'NOT YET');
