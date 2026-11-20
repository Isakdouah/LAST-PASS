// Turns the processed OpenStreetMap file (tools/build_map.py) into a simulation World.
import { createWorld, World } from '../sim/outbreak';

export interface MapFile {
  name: string;
  bbox: number[];
  width: number;
  height: number;
  credit: string;
  layers: Record<'land' | 'roadMajor' | 'roadMinor' | 'bridge' | 'buildings', string>;
  population: string;
  places: [number, number, string][];
}

export type PlaceKind = 'police' | 'fire' | 'hospital';
export interface Place {
  x: number;
  y: number;
  kind: PlaceKind;
}

/**
 * Guesses, to tune later. Pew (June 2023 survey): 32% of US adults personally own a gun.
 * Cities run lower than the national figure and children are counted in the population,
 * so we start with about 1 in 5 people armed, each with a small home supply of ammo.
 */
export const ARMED_SHARE = 0.2;
export const HOME_AMMO = 20;
export const POLICE_OFFICERS = 40;
export const POLICE_AMMO = 150;

export interface CityMap {
  name: string;
  credit: string;
  width: number;
  height: number;
  roadMajor: Uint8Array;
  roadMinor: Uint8Array;
  buildings: Uint8Array;
  places: Place[];
  world: World;
}

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function loadMap(file: MapFile, override?: Place[]): CityMap {
  const { width, height } = file;
  const world = createWorld(width, height);
  world.land.set(bytes(file.layers.land));
  const popBytes = bytes(file.population);
  const pop = new Uint16Array(popBytes.buffer, popBytes.byteOffset, width * height);
  for (let i = 0; i < pop.length; i++) world.healthy[i] = world.land[i] ? pop[i] : 0;
  const major = bytes(file.layers.roadMajor);
  const minor = bytes(file.layers.roadMinor);
  const bridge = bytes(file.layers.bridge);
  for (let i = 0; i < world.road.length; i++) world.road[i] = major[i] || bridge[i] ? 3 : minor[i] ? 1 : 0;
  for (let i = 0; i < world.healthy.length; i++) {
    world.armed[i] = world.healthy[i] * ARMED_SHARE;
    world.ammo[i] = world.armed[i] * HOME_AMMO;
  }
  const places: Place[] = override ?? (file.places ?? []).map(([x, y, kind]) => ({ x, y, kind: kind as PlaceKind }));
  // Police stations: officers with far more ammunition, spread over the station and its block.
  for (const p of places) {
    if (p.kind !== 'police') continue;
    const i = Math.floor(p.y) * width + Math.floor(p.x);
    if (!world.land[i]) continue;
    world.healthy[i] += POLICE_OFFICERS;
    world.armed[i] += POLICE_OFFICERS;
    world.ammo[i] += POLICE_OFFICERS * POLICE_AMMO;
  }
  return {
    name: file.name,
    credit: file.credit,
    width,
    height,
    roadMajor: bytes(file.layers.roadMajor),
    roadMinor: bytes(file.layers.roadMinor),
    buildings: bytes(file.layers.buildings),
    places,
    world,
  };
}
