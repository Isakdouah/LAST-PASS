// The weather on the night of Friday 16 October 2009 in Minneapolis-St. Paul.
// Source: National Weather Service Twin Cities, October 2009 daily climate table (MSP airport),
// read through a search summary on 20 Nov 2026 (we could not open the PDF directly):
// high about 45 F (7 C), low about 37 F (3 C), 0.04 inch of precipitation, no snow.
// October 2009 was the 4th coldest and 5th wettest on record there. The hours of the drizzle are
// not in the daily table: when it falls is our guess.
export const WEATHER = { highC: 7, lowC: 3, precipInch: 0.04 };

/** 0..1: how hard it is drizzling at a local hour (guess: on and off late in the evening). */
export function drizzle(hour: number): number {
  const h = hour >= 24 ? hour - 24 : hour;
  const on = (h >= 22 && h < 24) || (h >= 0 && h < 1.5);
  return on ? 0.5 + 0.5 * Math.max(0, Math.sin(h * 5.1)) : 0;
}

/** Air temperature, falling through the night (C). */
export function tempC(hour: number): number {
  const since = (hour - 19.67 + 24) % 24; // hours since the start
  return Math.max(WEATHER.lowC, WEATHER.lowC + 3.5 - since * 0.5);
}
