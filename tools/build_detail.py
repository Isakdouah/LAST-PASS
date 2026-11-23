"""Street-level detail for the 3D view: building outlines with heights, road lines,
water and parks, plus named police / fire / hospital places.

Usage:  python3 tools/build_detail.py <input.osm.pbf> src/data/detail.json

Coordinates are map cells (same grid as build_map.py) times Q, stored as a start
point (int16) and int8 steps, so the file stays small enough for one offline HTML.
Heights come from OSM height / building:levels; otherwise a guess by building type.
Map data (c) OpenStreetMap contributors, ODbL.
"""
import base64
import json
import re
import sys

import numpy as np
import osmium
from shapely.geometry import LineString, Polygon

WEST, SOUTH, EAST, NORTH = -93.36, 44.87, -93.00, 45.06
GW, GH = 360, 260
Q = 64  # sub-cell units (1 unit is about 1.2 m)

# Guessed heights in metres when OSM has none (labelled guesses).
GUESS = {'house': 7, 'detached': 7, 'garage': 3, 'garages': 3, 'shed': 3, 'apartments': 12, 'commercial': 8,
         'retail': 6, 'industrial': 9, 'warehouse': 9, 'church': 14, 'school': 9, 'hospital': 20, 'office': 15,
         'university': 15, 'dormitory': 15, 'hotel': 25, 'parking': 10, 'stadium': 30}
ROAD_W = {'motorway': 22, 'trunk': 18, 'primary': 15, 'motorway_link': 9, 'trunk_link': 9, 'primary_link': 9,
          'secondary': 13, 'tertiary': 11, 'secondary_link': 8, 'tertiary_link': 8,
          'residential': 8, 'unclassified': 8, 'living_street': 6}


def cell(lon, lat):
    return ((lon - WEST) / (EAST - WEST) * GW, (NORTH - lat) / (NORTH - SOUTH) * GH)


def inbox(pts, pad=2):
    return any(-pad <= x < GW + pad and -pad <= y < GH + pad for x, y in pts)


def num(s):
    m = re.match(r'\s*([0-9.]+)', s or '')
    try:
        return float(m.group(1)) if m else None
    except ValueError:
        return None


class Shapes:
    """Start point + int8 steps; long steps are split so they fit."""

    def __init__(self):
        self.starts, self.lens, self.steps, self.meta = [], [], [], []

    def add(self, pts, meta):
        q = [(round(x * Q), round(y * Q)) for x, y in pts]
        q = [p for k, p in enumerate(q) if k == 0 or p != q[k - 1]]
        if len(q) < 2 or not all(-32000 < v < 32000 for p in q for v in p):
            return
        self.starts += q[0]
        n = 0
        for (ax, ay), (bx, by) in zip(q, q[1:]):
            dx, dy = bx - ax, by - ay
            k = max(1, int(max(abs(dx), abs(dy)) // 127) + 1)
            px, py = ax, ay
            for j in range(1, k + 1):
                nx, ny = ax + round(dx * j / k), ay + round(dy * j / k)
                self.steps += (nx - px, ny - py)
                px, py = nx, ny
                n += 1
        self.lens.append(n)
        self.meta.append(meta)

    def pack(self):
        e = lambda a: base64.b64encode(a.tobytes()).decode()
        return {'count': len(self.lens), 'starts': e(np.array(self.starts, '<i2')), 'lens': e(np.array(self.lens, '<u2')),
                'steps': e(np.array(self.steps, 'i1')), 'meta': e(np.array(self.meta, 'u1'))}


bld, roads, water, parks = Shapes(), Shapes(), Shapes(), Shapes()
bridges = Shapes()  # every bridge deck (roads, paths, railways); meta = deck width in metres
bridge_roads = []  # indices into roads of the road pieces that are bridges (not painted on the ground)
BRIDGE_W = {'footway': 4, 'cycleway': 5, 'path': 4, 'pedestrian': 6, 'service': 6, 'rail': 7, 'light_rail': 7, 'abandoned': 7, 'disused': 7}
names = {}
places = []
POI = {'police': 'police', 'fire_station': 'fire', 'hospital': 'hospital'}


class C(osmium.SimpleHandler):
    def node(self, n):
        k = POI.get(n.tags.get('amenity'))
        if k and n.location.valid():
            x, y = cell(n.location.lon, n.location.lat)
            if 0 <= x < GW and 0 <= y < GH:
                places.append((round(x, 2), round(y, 2), k, n.tags.get('name', '')))

    def way(self, w):
        hw = w.tags.get('highway')
        rw = w.tags.get('railway')
        is_bridge = w.tags.get('bridge') not in (None, 'no')
        if is_bridge and (hw in ROAD_W or hw in BRIDGE_W or rw in BRIDGE_W):
            try:
                bp = [cell(n.lon, n.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                bp = None
            if bp and inbox(bp):
                bridges.add(bp, ROAD_W.get(hw) or BRIDGE_W.get(hw) or BRIDGE_W.get(rw))
        if hw not in ROAD_W:
            return
        try:
            pts = [cell(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if inbox(pts):
            pts = list(LineString(pts).simplify(0.01).coords) if len(pts) > 2 else pts
            before = len(roads.lens)
            roads.add(pts, ROAD_W[hw])
            if is_bridge and len(roads.lens) > before:
                bridge_roads.append(before)

    def area(self, a):
        t = a.tags
        k = POI.get(t.get('amenity'))
        b = t.get('building')
        is_water = t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('water') is not None
        is_park = t.get('leisure') in ('park', 'golf_course', 'pitch') or t.get('landuse') in ('grass', 'cemetery', 'recreation_ground') or t.get('natural') == 'wood'
        if not (b or k or is_water or is_park):
            return
        for ring in a.outer_rings():
            pts = [cell(n.lon, n.lat) for n in ring]
            if len(pts) < 4 or not inbox(pts):
                continue
            if k:
                cx = sum(p[0] for p in pts) / len(pts)
                cy = sum(p[1] for p in pts) / len(pts)
                if 0 <= cx < GW and 0 <= cy < GH:
                    places.append((round(cx, 2), round(cy, 2), k, t.get('name', '')))
            if is_water or is_park:
                target = water if is_water else parks
                poly = Polygon(pts).simplify(0.02)
                if not poly.is_empty and poly.geom_type == 'Polygon':
                    target.add(list(poly.exterior.coords), 0)
                for inner in a.inner_rings(ring):
                    ip = [cell(n.lon, n.lat) for n in inner]
                    if len(ip) >= 4:
                        target.add(ip, 1)  # 1 = hole (island)
                continue
            if not b:
                continue
            poly = Polygon(pts)
            if not poly.is_valid or poly.area * 79 * 79 < 30:  # skip sheds under ~30 m2
                continue
            poly = poly.simplify(0.02)
            if poly.is_empty or poly.geom_type != 'Polygon':
                continue
            h = num(t.get('height'))
            if h is None:
                lv = num(t.get('building:levels'))
                h = lv * 3.2 + 1 if lv else GUESS.get(b, 7)
            nm = t.get('name', '')
            if nm:
                names[bld_count()] = nm
            bld.add(list(poly.exterior.coords)[:-1] + [poly.exterior.coords[0]], min(250, round(h)))


def bld_count():
    return len(bld.lens)


def main(src, dst):
    C().apply_file(src, locations=True)
    data = {'q': Q, 'buildings': bld.pack(), 'roads': roads.pack(), 'water': water.pack(), 'parks': parks.pack(),
            'bridges': bridges.pack(), 'bridgeRoads': bridge_roads,
            'names': names, 'places': sorted(set(places))}
    with open(dst, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print('buildings', len(bld.lens), 'roads', len(roads.lens), 'water', len(water.lens), 'parks', len(parks.lens),
          'steps', len(bld.steps) // 2 + len(roads.steps) // 2, 'places', len(set(places)), 'bridges', len(bridges.lens))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
