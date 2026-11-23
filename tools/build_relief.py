"""World relief for the globe: land heights and sea depths from AWS Terrain Tiles (terrarium,
zoom 3). Sources: USGS 3DEP / GMTED2010 / SRTM (U.S. Geological Survey), ETOPO1 (NOAA) and
others listed in tilezen/joerd docs/attribution.md. Output: src/data/earth-relief.png, 2048 x 1024
equirectangular, grey: 128 = sea level, up = land (square-root scale to 8,000 m), down = sea depth."""
import math, os, urllib.request
import numpy as np
from PIL import Image

Z = 3
RAW = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw', 'relief')
os.makedirs(RAW, exist_ok=True)
n = 2 ** Z
merc = np.zeros((n * 256, n * 256))
for y in range(n):
    for x in range(n):
        p = os.path.join(RAW, f'{Z}_{x}_{y}.png')
        if not os.path.exists(p):
            with urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png', timeout=60) as r, open(p, 'wb') as f:
                f.write(r.read())
        a = np.asarray(Image.open(p).convert('RGB')).astype(np.float64)
        merc[y * 256:(y + 1) * 256, x * 256:(x + 1) * 256] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
W, H = 2048, 1024
out = np.zeros((H, W))
size = n * 256
for j in range(H):
    lat = 90 - (j + 0.5) / H * 180
    lat = max(-85.0, min(85.0, lat))
    my = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * size
    iy = min(size - 1, int(my))
    xs = ((np.arange(W) + 0.5) / W * size).astype(int) % size
    out[j] = merc[iy, xs]
v = np.where(out >= 0, 128 + np.sqrt(np.clip(out, 0, 8000) / 8000) * 127, 128 - np.sqrt(np.clip(-out, 0, 8000) / 8000) * 127)
Image.fromarray(np.clip(np.round(v), 0, 255).astype(np.uint8), 'L').save(os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'earth-relief.png'), optimize=True)
print('max', out.max(), 'min', out.min())
