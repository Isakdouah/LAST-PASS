// Picture bot for the calls board and holdouts: pass 2, look at a few holdouts, route one,
// then jump to pass 3 and show the report. Usage: node tools/shotsCalls.cjs <html> <out>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const file = path.resolve(process.argv[2] || 'dist/index.html');
const out = process.argv[3] || 'shotsCalls';
fs.mkdirSync(out, { recursive: true });
const wait = (p, ms) => p.waitForTimeout(ms);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await p.goto('file://' + file + '?hq');
  await wait(p, 2500);
  await p.evaluate(() => lastPass.start('play'));
  await wait(p, 5000);
  await p.evaluate(() => { lastPass.jump(1200 + 5520 - 150); lastPass.game.wasWindow = true; });
  // Look at the holdouts that matter (as a player sweeping the city would).
  const picks = await p.evaluate(() => {
    const g = lastPass.game;
    for (const h of g.holds.list) g.look(h.x, h.y, 0.5);
    return g.holds.list.filter((h) => h.state !== 'fallen').sort((a, b) => b.people - a.people).slice(0, 3).map((h) => ({ id: h.id, x: h.x, y: h.y, name: h.name, people: h.people }));
  });
  await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 1.2), [picks[0].x, picks[0].y]);
  await wait(p, 6000);
  await p.evaluate(() => lastPass.clearSay && lastPass.clearSay());
  await p.screenshot({ path: `${out}/a-calls-board.png` });
  // Route people to the first one by clicking its button.
  await p.evaluate(() => { const b = document.querySelector('#calls .btn'); if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await wait(p, 1500);
  await p.screenshot({ path: `${out}/b-routed.png` });
  await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.15), [picks[0].x, picks[0].y]);
  await wait(p, 6000);
  await p.evaluate(() => lastPass.clearSay && lastPass.clearSay());
  await p.screenshot({ path: `${out}/c-holdout-close.png` });
  const info = await p.evaluate(() => ({ air: lastPass.game.air, sheltered: lastPass.game.holds.list.reduce((a, h) => a + (h.state !== 'fallen' ? h.people : 0), 0) }));
  console.log(JSON.stringify({ picks, info, errors }));
  await b.close();
})();
