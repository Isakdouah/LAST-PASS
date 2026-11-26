"""Put the real 2010 Census head count into the game map.

Usage:
  python3 tools/build_population.py <tabblock2010_27_pophu.shp> src/data/minneapolis.json

Input: the Census Bureau's 2010 block file for Minnesota with population
  (TIGER/Line "TIGER2010BLKPOPHU", tabblock2010_27_pophu.zip, field POP10),
  from https://www2.census.gov/geo/tiger/TIGER2010BLKPOPHU/ . Public domain.
What it does: every census block (about a city block) keeps its exact 2010
  head count. The count is spread over the map cells (about 80 m) the block
  covers, a little more where there are buildings, and never onto water.
  A block that is smaller than a cell lands in the cell it sits in.
  Only the part of a block inside the map box counts.
Writes the new 'population' layer (and notes) into the map file in place.
"""
import base64
import json
import sys

import numpy as np
import shapefile  # pyshp
from PIL import Image, ImageDraw

SS = 8  # fine pixels per cell side, for measuring how much of a cell a block covers


def main(shp, mapfile):
    d = json.load(open(mapfile))
    west, south, east, north = d['bbox']
    gw, gh = d['width'], d['height']
    dec = lambda k: np.frombuffer(base64.b64decode(d['layers'][k]), dtype=np.uint8).reshape(gh, gw)
    land = dec('land').astype(np.float64)
    bldg = dec('buildings').astype(np.float64) / 255.0
    # Within a block, people live where the buildings are; open ground still gets a little.
    weight = land * (0.1 + bldg)
    land_idx = np.argwhere(land > 0)

    def fx(lon):
        return (lon - west) / (east - west) * gw * SS

    def fy(lat):
        return (north - lat) / (north - south) * gh * SS

    pop = np.zeros((gh, gw), dtype=np.float64)
    total_in_box = 0.0
    blocks = 0
    r = shapefile.Reader(shp)
    fields = [f[0] for f in r.fields[1:]]
    ip = fields.index('POP10')
    for sr in r.iterShapeRecords():
        p = sr.record[ip]
        if p <= 0:
            continue
        b = sr.shape.bbox  # lon/lat
        if b[2] < west or b[0] > east or b[3] < south or b[1] > north:
            continue
        pts = sr.shape.points
        parts = list(sr.shape.parts) + [len(pts)]
        rings = [[(fx(x), fy(y)) for x, y in pts[parts[k]:parts[k + 1]]] for k in range(len(parts) - 1)]
        x0, x1 = int(np.floor(fx(b[0]))), int(np.ceil(fx(b[2]))) + 1
        y0, y1 = int(np.floor(fy(b[3]))), int(np.ceil(fy(b[1]))) + 1
        # Align the local picture to whole cells.
        x0 -= x0 % SS
        y0 -= y0 % SS
        x1 += (-x1) % SS
        y1 += (-y1) % SS
        img = Image.new('L', (x1 - x0, y1 - y0), 0)
        dr = ImageDraw.Draw(img)
        # First ring is the outline; later ones may be holes (drawn back out).
        for k, ring in enumerate(rings):
            dr.polygon([(x - x0, y - y0) for x, y in ring], fill=255 if k == 0 or _ccw(ring) == _ccw(rings[0]) else 0)
        a = np.asarray(img, dtype=np.float64) / 255.0
        total_area = a.sum()
        cov = a.reshape((y1 - y0) // SS, SS, (x1 - x0) // SS, SS).sum(axis=(1, 3))
        cx0, cy0 = x0 // SS, y0 // SS
        # Clip to the map.
        gx0, gy0 = max(cx0, 0), max(cy0, 0)
        gx1, gy1 = min(cx0 + cov.shape[1], gw), min(cy0 + cov.shape[0], gh)
        if gx1 <= gx0 or gy1 <= gy0:
            continue
        inside = cov[gy0 - cy0:gy1 - cy0, gx0 - cx0:gx1 - cx0]
        if total_area > 0:
            share = inside.sum() / total_area
            if share <= 0:
                continue
            people = p * share
        else:
            # Tiny block: count it if its middle is in the box.
            mx, my = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            if not (west <= mx <= east and south <= my <= north):
                continue
            people = p
        blocks += 1
        total_in_box += people
        w = inside * weight[gy0:gy1, gx0:gx1]
        if w.sum() > 0:
            pop[gy0:gy1, gx0:gx1] += people * w / w.sum()
        else:
            # All water or no measurable area: nearest land cell to the block's middle.
            mx = min(max(int(fx((b[0] + b[2]) / 2) // SS), 0), gw - 1)
            my = min(max(int(fy((b[1] + b[3]) / 2) // SS), 0), gh - 1)
            j = np.argmin((land_idx[:, 0] - my) ** 2 + (land_idx[:, 1] - mx) ** 2)
            pop[land_idx[j, 0], land_idx[j, 1]] += people
    cells = _round_keep_total(pop)
    d['population'] = base64.b64encode(np.clip(cells, 0, 65535).astype('<u2').tobytes()).decode()
    d['populationNote'] = (
        f'Real 2010 Census head count: {int(cells.sum())} people from {blocks} census blocks in the box, '
        'spread inside each block toward its buildings. Source: U.S. Census Bureau, 2010 Census (TIGER/Line blocks with POP10).'
    )
    d['populationCredit'] = 'Population: U.S. Census Bureau, 2010 Census'
    with open(mapfile, 'w') as f:
        json.dump(d, f)
    print('blocks', blocks, 'people in box', round(total_in_box), 'cells sum', int(cells.sum()),
          'max/cell', int(cells.max()), 'cells with people', int((cells > 0).sum()))


def _ccw(ring):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += (x2 - x1) * (y2 + y1)
    return s < 0


def _round_keep_total(a):
    """Whole people per cell, with the leftovers handed to the cells closest to the next person."""
    flo = np.floor(a)
    rest = a - flo
    need = int(round(a.sum() - flo.sum()))
    out = flo.ravel().copy()
    if need > 0:
        top = np.argsort(-rest.ravel(), kind='stable')[:need]
        out[top] += 1
    return out.reshape(a.shape)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
