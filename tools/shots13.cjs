// Picture bot for draft 13: the same views every time, for before/after comparison.
// Usage: node tools/shots13.cjs <dist/index.html> <out-folder>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const file = path.resolve(process.argv[2] || 'dist/index.html');
const out = process.argv[3] || 'shots13';
fs.mkdirSync(out, { recursive: true });
const wait = (p, ms) => p.waitForTimeout(ms);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await p.goto('file://' + file + '?hq');
  await wait(p, 2500);
  const shot = async (name) => {
    await p.evaluate(() => lastPass.clearSay && lastPass.clearSay());
    await p.screenshot({ path: `${out}/${name}.png` });
  };
  await p.evaluate(() => lastPass.start('play'));
  await wait(p, 6000);
  // Pass 2, over the busiest front (where ISAK's screenshot was).
  await p.evaluate(() => { lastPass.jump(6600); lastPass.game.wasWindow = true; });
  const f = await p.evaluate(() => lastPass.front());
  for (const [name, d, ms] of [['a-20km', 20, 5000], ['b-8km', 8, 5000], ['c-3.6km', 3.6, 5000], ['d-1km', 1, 6000]]) {
    await p.evaluate(([x, y, d]) => lastPass.lookCell(x, y, d), [f.x, f.y, d]);
    await wait(p, ms);
    await shot(name);
  }
  // A responder at work, close up.
  const u = await p.evaluate(() => {
    const us = lastPass.game.resp.units;
    const pick = us.find((u) => u.state === 'scene' && u.kind === 'fire') || us.find((u) => u.state === 'scene') || us.find((u) => u.state === 'out');
    return pick ? { x: pick.x, y: pick.y, kind: pick.kind, label: pick.label, state: pick.state } : null;
  });
  if (u) {
    await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.12), [u.x, u.y]);
    await wait(p, 4000);
    const at = await p.evaluate((label) => { const v = lastPass.game.resp.units.find((q) => q.label === label); return { x: v.x, y: v.y }; }, u.label);
    await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.12), [at.x, at.y]);
    await wait(p, 4000);
    await shot('e-responder-' + u.kind);
    await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.05), [at.x, at.y]);
    await wait(p, 3000);
    await shot('f-responder-close');
  }
  await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.08), [f.x, f.y]);
  await wait(p, 8000);
  await shot('g-front-close');
  const info = await p.evaluate(() => ({ fps: lastPass.fps && lastPass.fps(), units: lastPass.game.resp ? lastPass.game.resp.units.length : 0 }));
  fs.writeFileSync(`${out}/info.json`, JSON.stringify({ u, info, errors }, null, 1));
  console.log(JSON.stringify({ u, info, errors: errors.slice(0, 3) }));
  await b.close();
})();
