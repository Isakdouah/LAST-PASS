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
}

export interface CityMap {
  name: string;
  credit: string;
  width: number;
  height: number;
  roadMajor: Uint8Array;
  roadMinor: Uint8Array;
  buildings: Uint8Array;
  world: World;
}

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function loadMap(file: MapFile): CityMap {
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
  return {
    name: file.name,
    credit: file.credit,
    width,
    height,
    roadMajor: bytes(file.layers.roadMajor),
    roadMinor: bytes(file.layers.roadMinor),
    buildings: bytes(file.layers.buildings),
    world,
  };
}
