import { it } from 'vitest';
import { Session } from './game/session';
const quiet = { start() {}, hush() {}, setStatic() {}, say() {}, shot() {}, muted: true } as never;
it('nan hunt', () => {
  const g = new Session(quiet);
  g.reset('play');
  for (let k = 0; k < 600; k++) {
    g.cityStep();
    const w = g.world as unknown as Record<string, Float32Array>;
    for (const key of ['healthy','infected','fallen','armed','ammo','aware','know','skill','moving','crawl','escaped','jam','noise','strife']) {
      const a = w[key];
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]) || a[i] < -1e-3) { console.log('tick', k, key, i, a[i], 'h', g.world.healthy[i], 'z', g.world.infected[i], 'mov', g.world.moving[i]); return; }
    }
  }
  console.log('clean');
});
