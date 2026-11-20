// The hero ID card: click a hero through the telescope and their card pops up. It looks like
// the card in their wallet (our own lookalike designs, made-up numbers, no real seals), with a
// placeholder pixel portrait. What you have not learned yet is blacked out; it fills in as you
// hear them on the radio, look at them, and live through the night with them.
import { Hero, HeroState, learned, Portrait, seenAs as seenLabel } from '../game/heroes';
import type { Group } from '../game/radio';
import { esc } from './hud';

/** A 40 x 52 placeholder portrait, drawn pixel by pixel. PLACEHOLDER art. */
export function drawPortrait(p: Portrait, known: boolean): HTMLCanvasElement {
  const W = 40, H = 52;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  const shade = (hex: string, k: number) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };
  px(0, 0, W, H, '#6c7488'); // photo backdrop
  for (let y = 0; y < H; y += 2) for (let x = (y / 2) % 2; x < W; x += 2) px(x, y, 1, 1, '#646c80'); // dither
  if (!known) {
    // Unknown: a dark silhouette.
    px(13, 10, 14, 17, '#1c2030');
    px(6, 32, 28, 20, '#1c2030');
    px(16, 27, 8, 6, '#1c2030');
    g.fillStyle = '#aab0bd';
    g.font = '14px monospace';
    g.fillText('?', 17, 24);
    return c;
  }
  const skin = p.skin, dark = shade(skin, 0.78);
  // Shoulders and shirt.
  px(5, 38, 30, 14, p.shirt);
  px(5, 38, 4, 14, shade(p.shirt, 0.75));
  px(31, 38, 4, 14, shade(p.shirt, 0.75));
  px(16, 36, 8, 4, dark); // neck
  px(17, 38, 6, 3, skin);
  // Long hair behind the head.
  if (p.style === 'long') px(10, 12, 20, 26, p.hair);
  if (p.style === 'bun') px(15, 4, 10, 6, p.hair);
  // Head.
  px(12, 10, 16, 22, skin);
  px(12, 10, 3, 22, dark);
  px(13, 31, 14, 3, dark); // jaw
  px(11, 18, 2, 5, dark); // ears
  px(27, 18, 2, 5, skin);
  // Hair.
  const hair = p.hair;
  if (p.style === 'bald') px(12, 9, 16, 3, shade(skin, 0.9));
  else if (p.style === 'cropped') px(12, 8, 16, 4, hair);
  else px(11, 7, 18, 6, hair);
  if (p.style === 'short') px(11, 12, 3, 6, hair);
  if (p.style === 'long' || p.style === 'bun') (px(11, 12, 3, 12, hair), px(26, 12, 3, 12, hair));
  // Face.
  px(15, 19, 3, 2, '#1a1414'); // eyes
  px(22, 19, 3, 2, '#1a1414');
  px(15, 17, 3, 1, shade(hair, 1.0)); // brows
  px(22, 17, 3, 1, shade(hair, 1.0));
  px(19, 21, 2, 5, dark); // nose
  px(17, 28, 6, 1, shade(skin, 0.6)); // mouth
  if (p.glasses) {
    g.strokeStyle = '#2a2a30';
    g.lineWidth = 1;
    g.strokeRect(13.5, 17.5, 6, 5);
    g.strokeRect(20.5, 17.5, 6, 5);
  }
  if (p.beard) px(13, 26, 14, 7, shade(hair, 1.2));
  if (p.beard) px(17, 28, 6, 1, shade(skin, 0.6));
  if (p.grey) px(12, 7, 16, 1, '#d8d4cc');
  return c;
}

const HEAD: Record<string, { band: string; title: string; sub: string; cls: string }> = {
  license: { band: 'MINNESOTA', title: "DRIVER'S LICENSE", sub: 'CLASS D', cls: 'license' },
  staff: { band: 'COUNTY MEDICAL CENTER', title: 'STAFF IDENTIFICATION', sub: 'Must be worn at all times', cls: 'staff' },
  transit: { band: 'TWIN CITIES TRANSIT', title: 'OPERATOR', sub: 'Property of the transit authority', cls: 'transit' },
  student: { band: 'U OF M', title: 'STUDENT CARD', sub: 'Twin Cities campus', cls: 'student' },
};

/** The card's HTML. `known` = you have heard who they are. */
export function cardHtml(h: Hero, st: HeroState, gr: Group | undefined, portraitUrl: string): string {
  const known = !!gr && gr.known;
  const said = gr ? gr.said : 0;
  const head = HEAD[h.card];
  const bar = (n: number) => `<span class="redact">${'&nbsp;'.repeat(n)}</span>`;
  const f = (label: string, value: string, n = 10) => `<div class="f"><i>${esc(label)}</i><b>${known ? esc(value).replace(/\n/g, '<br>') : bar(n)}</b></div>`;
  let fields = '';
  const P = h.printed;
  if (h.card === 'license')
    fields = f('DL', P.dl, 16) + f('DOB', P.dob, 9) + f('EXP', P.exp, 9) + f('ADDRESS', P.addr, 20) + `<div class="row">${f('SEX', P.sex, 2)}${f('HGT', P.hgt, 5)}${f('EYES', P.eyes, 3)}</div>` + f('RESTR', P.rest, 14);
  else if (h.card === 'staff') fields = f('TITLE', P.title, 16) + f('EMPLOYEE', P.id, 12) + f('SHIFT', P.shift, 6) + f('', P.since, 14);
  else if (h.card === 'transit') fields = f('', P.title, 12) + f('OPERATOR NO.', P.id, 10) + f('ROUTE', P.route, 14) + f('GARAGE', P.garage, 12) + f('', P.since, 10);
  else fields = f('STUDENT ID', P.id, 14) + f('', P.college, 22) + f('', P.year, 10) + f('', P.valid, 18);
  const status = st.dead ? ['NO CONTACT', 'lost'] : st.arrived ? ['OUT OF THE CITY', 'out'] : st.escapeStart >= 0 ? ['ON THE ROAD', 'road'] : gr && gr.status === 'contact' ? ['UNDER ATTACK', 'attack'] : ['ALIVE', 'alive'];
  const lore = h.lore
    .map((l) => (learned(l, said, st) ? `<li><i>${esc(l.label)}</i> ${esc(l.text)}</li>` : `<li class="unk"><i>${esc(l.label)}</i> ${bar(18 + (l.text.length % 14))}</li>`))
    .join('');
  const log = st.log.length ? st.log.slice(-6).map((e) => `<li>${esc(e.text)}</li>`).join('') : '<li class="unk">Nothing yet. Tune the radio, or keep watching.</li>';
  const seenAs = `Seen from orbit: ${esc(seenLabel(h, st))}`;
  return `
  <div class="idcard ${head.cls}">
    <div class="band">${head.band}<span>${head.title}</span></div>
    <div class="body">
      <div class="photo"><img src="${portraitUrl}" alt=""><div class="stamp ${status[1]}">${status[0]}</div></div>
      <div class="fields">
        <div class="name">${known ? esc(h.name.toUpperCase()) : 'UNKNOWN'}</div>
        ${fields}
      </div>
    </div>
    <div class="foot">${head.sub}<span class="sig">${known ? esc(h.name) : ''}</span></div>
  </div>
  <div class="notes">
    <div class="seen">${seenAs}${gr && known ? ` · ${gr.freq.toFixed(2)} MHz` : ''}</div>
    <ul class="lore">${lore}</ul>
    <div class="logt">Your log</div>
    <ul class="log">${log}</ul>
    <div class="ph">PLACEHOLDER portrait and card design</div>
  </div>
  <div class="close">× close (Esc)</div>`;
}
