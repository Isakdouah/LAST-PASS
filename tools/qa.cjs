// Test bot: plays the built game headless, photographs the same views every time and
// counts what should never happen. Usage: node tools/qa.cjs <out-folder> [label]
// Needs a fresh `npm run build` (dist/index.html). Speed numbers here are a software
// renderer: compare them build to build, not with a real laptop.
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2] || 'qa-out';
fs.mkdirSync(out, { recursive: true });
const wait = (p, ms) => p.waitForTimeout(ms);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await p.goto('file://' + process.cwd() + '/dist/index.html?hq');
  await wait(p, 2500);
  const shot = async (name) => { await p.evaluate(() => lastPass.clearSay()); await p.screenshot({ path: `${out}/${name}.png` }); };
  const report = { shots: [], checks: [], errors };
  await p.screenshot({ path: `${out}/0-title.png` });
  await p.evaluate(() => lastPass.start('play'));
  await wait(p, 9000);
  await p.evaluate(() => lastPass.key('2'));
  await wait(p, 3000);
  await shot('1-station-outside');
  await p.evaluate(() => lastPass.key('1'));
  await wait(p, 3000);
  await shot('2-cupola');
  await p.evaluate(() => { lastPass.jump(6600); lastPass.game.wasWindow = true; });
  await p.evaluate(() => lastPass.lookCell(180, 130, 20));
  await wait(p, 5000);
  await shot('3-city');
  const walt = await p.evaluate(() => lastPass.heroCell('walt'));
  await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 1.5), [walt.x, walt.y]);
  await wait(p, 6000);
  await shot('4-neighbourhood');
  await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.3), [walt.x, walt.y]);
  await wait(p, 9000);
  await shot('5-walts-street');
  report.checks.push({ at: 'walts street', ...(await p.evaluate(() => lastPass.qa())) });
  await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.07), [walt.x, walt.y]);
  await wait(p, 5000);
  await shot('6-walts-street-close');
  // The front line: where the living and the dead meet.
  const f = await p.evaluate(() => lastPass.front());
  await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.3), [f.x, f.y]);
  await wait(p, 8000);
  for (let k = 0; k < 6; k++) {
    report.checks.push({ at: 'front ' + k, ...(await p.evaluate(() => lastPass.qa())) });
    await wait(p, 2000);
  }
  await shot('7-front');
  const g = await p.evaluate(() => { const s = lastPass.game.street; const a = s && (s.agents.find((a) => a.hold && a.hold.grip > 1.5) || s.agents.find((a) => a.hold) || s.agents.find((a) => a.kind === 1)); return a && [a.x, a.y]; });
  if (g) {
    await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.05), g);
    await wait(p, 2500);
    await shot('8-fight-close');
  }
  await p.evaluate(([x, y]) => lastPass.lookCell(x, y, 0.3), [f.x, f.y]);
  await p.evaluate(() => lastPass.key('t'));
  await wait(p, 3000);
  await shot('9-thermal');
  await p.evaluate(() => lastPass.key('t'));
  report.fps = await p.evaluate(() => lastPass.fps());
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  const sum = (k) => Math.max(...report.checks.map((c) => c[k] || 0));
  console.log(JSON.stringify({ worst: { inBuilding: sum('inBuilding'), inWater: sum('inWater'), overlap: sum('overlap'), inCar: sum('inCar'), carOverlap: sum('carOverlap') }, walkers: sum('walkers'), stepMs: sum('stepMs'), frameMs: sum('frameMs'), errors: errors.length, err0: errors[0] }));
  await b.close();
})();
