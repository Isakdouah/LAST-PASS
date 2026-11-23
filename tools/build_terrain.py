"""Ground heights for the city box, from AWS Terrain Tiles (terrarium PNG, zoom 13).
In the US these come from USGS 3DEP (public domain, about 10 m): credit "3DEP terrain data courtesy
of the U.S. Geological Survey" on screen. Bare earth: bridges are removed (we build our own).
Output: src/data/terrain.json, 2 samples per map cell (about 40 m), heights in 0.5 m steps."""
import base64, io, json, math, os, sys, urllib.request
import numpy as np
from PIL import Image

WEST, SOUTH, EAST, NORTH = -93.36, 44.87, -93.00, 45.06
GW, GH = 360, 260
PER = 2  # samples per cell
Z = 13
RAW = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw', 'terrain')
os.makedirs(RAW, exist_ok=True)


def tile_xy(lon, lat):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile(x, y):
    p = os.path.join(RAW, f'{Z}_{x}_{y}.png')
    if not os.path.exists(p):
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png'
        with urllib.request.urlopen(url, timeout=60) as r, open(p, 'wb') as f:
            f.write(r.read())
    a = np.asarray(Image.open(p).convert('RGB')).astype(np.float64)
    return a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768


x0, y0 = tile_xy(WEST, NORTH)
x1, y1 = tile_xy(EAST, SOUTH)
tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256))
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = tile(tx, ty)
W, H = GW * PER, GH * PER
out = np.zeros((H, W))
for j in range(H):
    lat = NORTH - (j + 0.5) / H * (NORTH - SOUTH)
    for i in range(W):
        lon = WEST + (i + 0.5) / W * (EAST - WEST)
        fx, fy = tile_xy(lon, lat)
        px, py = (fx - tx0) * 256 - 0.5, (fy - ty0) * 256 - 0.5
        ix, iy = int(px), int(py)
        ax, ay = px - ix, py - iy
        m = mosaic
        out[j, i] = (m[iy, ix] * (1 - ax) * (1 - ay) + m[iy, ix + 1] * ax * (1 - ay) + m[iy + 1, ix] * (1 - ax) * ay + m[iy + 1, ix + 1] * ax * ay)
lo, hi = float(out.min()), float(out.max())
step = 0.5 if hi - lo <= 127 else math.ceil((hi - lo) / 255 * 10) / 10
q = np.clip(np.round((out - lo) / step), 0, 255).astype(np.uint8)
json.dump({'w': W, 'h': H, 'per': PER, 'min': round(lo, 2), 'step': step, 'data': base64.b64encode(q.tobytes()).decode()},
          open(os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'terrain.json'), 'w'))
print('tiles', (tx1 - tx0 + 1) * (ty1 - ty0 + 1), 'heights', round(lo, 1), round(hi, 1), 'step', step)
