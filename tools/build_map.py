"""Turn an OpenStreetMap extract (.osm.pbf) into the small game map file.

Usage:  python3 tools/build_map.py <input.osm.pbf> src/data/minneapolis.json

Output: a grid of cells over the Twin Cities (Minneapolis + St Paul) with
  land/water, roads (major, minor), bridges, and an estimated population per cell.
Population is an ESTIMATE: the city total is spread over residential building
footprint area. Totals are rough 2009 figures (labelled guesses, see TOTAL_POP).
Map data (c) OpenStreetMap contributors, ODbL.
"""
import base64
import json
import sys

import numpy as np
import osmium
from PIL import Image, ImageDraw

# Bounding box: west, south, east, north (degrees). Minneapolis + St Paul core.
WEST, SOUTH, EAST, NORTH = -93.36, 44.87, -93.00, 45.06
GW, GH = 360, 260  # grid size in cells (about 80 m per cell)
SS = 4  # supersampling for drawing, then averaged down
# Guess: Minneapolis ~385k + St Paul ~285k + inner suburbs in the box, about 2009.
TOTAL_POP = 800_000

W, H = GW * SS, GH * SS


def px(lon, lat):
    return ((lon - WEST) / (EAST - WEST) * W, (NORTH - lat) / (NORTH - SOUTH) * H)


def inside(lon, lat, pad=0.02):
    return WEST - pad <= lon <= EAST + pad and SOUTH - pad <= lat <= NORTH + pad


water = Image.new('L', (W, H), 0)
roads_major = Image.new('L', (W, H), 0)
roads_minor = Image.new('L', (W, H), 0)
bridges = Image.new('L', (W, H), 0)
homes = Image.new('L', (W, H), 0)
other_bldg = Image.new('L', (W, H), 0)
dw, dmaj, dmin, dbr, dh, do = (ImageDraw.Draw(i) for i in (water, roads_major, roads_minor, bridges, homes, other_bldg))

MAJOR = {'motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link'}
MINOR = {'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'secondary_link', 'tertiary_link'}
HOME = {'house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace', 'yes', 'dormitory'}


class Collector(osmium.SimpleHandler):
    def way(self, w):
        hw = w.tags.get('highway')
        ww = w.tags.get('waterway')
        if not hw and ww not in ('river', 'canal'):
            return
        try:
            pts = [(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not pts or not any(inside(*p) for p in pts):
            return
        xy = [px(*p) for p in pts]
        if ww:
            dw.line(xy, fill=255, width=6)
        elif w.tags.get('bridge') == 'yes' and hw in MAJOR | MINOR:
            dbr.line(xy, fill=255, width=3)
        elif hw in MAJOR:
            dmaj.line(xy, fill=255, width=3)
        elif hw in MINOR:
            dmin.line(xy, fill=255, width=1)

    def area(self, a):
        t = a.tags
        is_water = t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('water') is not None
        b = t.get('building')
        if not is_water and not b:
            return
        for ring in a.outer_rings():
            pts = [(n.lon, n.lat) for n in ring]
            if len(pts) < 3 or not any(inside(*p) for p in pts):
                continue
            xy = [px(*p) for p in pts]
            if is_water:
                dw.polygon(xy, fill=255)
            elif b in HOME:
                dh.polygon(xy, fill=255)
            else:
                do.polygon(xy, fill=255)


def down(img):
    a = np.asarray(img, dtype=np.float32) / 255.0
    return a.reshape(GH, SS, GW, SS).mean(axis=(1, 3))


def main(src, out):
    Collector().apply_file(src, locations=True)
    wat = down(water)
    land = (wat < 0.5).astype(np.uint8)
    home = down(homes) * land
    pop = home / max(home.sum(), 1e-9) * TOTAL_POP
    layers = {
        'land': land,
        'roadMajor': (down(roads_major) > 0.15).astype(np.uint8),
        'roadMinor': (down(roads_minor) > 0.05).astype(np.uint8),
        'bridge': (down(bridges) > 0.05).astype(np.uint8),
        'buildings': np.clip((down(homes) + down(other_bldg)) * 255, 0, 255).astype(np.uint8),
    }
    # Bridges are crossings: make them land.
    layers['land'] = np.maximum(layers['land'], layers['bridge'])
    enc = lambda arr: base64.b64encode(arr.astype(np.uint8).tobytes()).decode()
    data = {
        'name': 'Twin Cities (Minneapolis + St Paul)',
        'bbox': [WEST, SOUTH, EAST, NORTH],
        'width': GW,
        'height': GH,
        'credit': '(c) OpenStreetMap contributors (ODbL)',
        'populationNote': f'Estimate: {TOTAL_POP} people spread over residential building area (guess, about 2009).',
        'layers': {k: enc(v) for k, v in layers.items()},
        'population': enc(np.clip(np.round(pop), 0, 65535).astype('<u2').view(np.uint8)),
    }
    with open(out, 'w') as f:
        json.dump(data, f)
    print('cells', GW * GH, 'land', int(land.sum()), 'pop', int(pop.sum()), 'max/cell', int(pop.max()))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
