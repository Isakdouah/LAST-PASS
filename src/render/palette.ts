// The one fixed palette. Every pixel on the map snaps to one of these.
// Night-time Zombies-Aren't-Real-style colours: beige blocks, dark streets,
// white living, green dead, red blood, sodium-orange light, fire red.
export type RGB = [number, number, number];

export const PAL = {
  space: [5, 6, 10] as RGB,
  ground: [26, 28, 36] as RGB,
  asphalt: [40, 41, 50] as RGB,
  lit: [92, 64, 34] as RGB, // sodium street light on asphalt
  park: [22, 38, 28] as RGB,
  water: [12, 26, 54] as RGB,
  waterLit: [26, 44, 80] as RGB,
  roof: [168, 154, 124] as RGB,
  roofDark: [102, 94, 78] as RGB,
  wallA: [124, 112, 90] as RGB,
  wallB: [86, 78, 64] as RGB,
  window: [214, 178, 92] as RGB,
  built: [52, 52, 62] as RGB,
  living: [226, 224, 214] as RGB,
  scared: [255, 190, 110] as RGB,
  armed: [96, 160, 255] as RGB,
  police: [52, 96, 230] as RGB,
  dead: [112, 220, 80] as RGB,
  deadDark: [58, 120, 44] as RGB,
  blood: [96, 16, 18] as RGB,
  bloodDark: [58, 12, 14] as RGB,
  shadow: [12, 12, 18] as RGB,
  tracer: [255, 236, 140] as RGB,
  flash: [255, 255, 220] as RGB,
  fire: [226, 58, 30] as RGB,
  fireHot: [255, 168, 40] as RGB,
  smoke: [74, 64, 56] as RGB,
  smokeLight: [118, 106, 94] as RGB,
  hospital: [240, 240, 240] as RGB,
  ink: [140, 146, 160] as RGB,
  inkBright: [214, 218, 226] as RGB,
  steel: [150, 156, 170] as RGB,
  mark: [255, 214, 64] as RGB,
};

export const LIST: RGB[] = Object.values(PAL);

/** Thermal camera: the living are warm, the dead are cold, fire is white hot. */
export function thermalOf(c: RGB): RGB {
  const k = (n: keyof typeof PAL) => PAL[n] === c;
  if (k('living') || k('scared') || k('armed') || k('police')) return [255, 255, 240];
  if (k('fire') || k('fireHot') || k('flash') || k('tracer')) return [255, 255, 255];
  if (k('dead')) return [40, 52, 92];
  if (k('deadDark')) return [30, 38, 70];
  if (k('water') || k('waterLit')) return [8, 8, 22];
  if (k('blood') || k('bloodDark')) return [30, 26, 40];
  if (k('smoke') || k('smokeLight')) return [70, 60, 66];
  if (k('mark') || k('ink') || k('inkBright') || k('hospital')) return c;
  const l = (c[0] * 0.3 + c[1] * 0.5 + c[2] * 0.2) / 255;
  const v = 24 + l * 70;
  return [v * 0.7, v * 0.55, v * 0.9];
}

export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
