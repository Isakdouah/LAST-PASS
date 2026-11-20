"""Earth land mask texture for the 3D globe (equirectangular, 4096x2048, ~10 km per pixel).
Usage: python3 tools/build_earth.py src/data/earth-land.png
Source: global-land-mask Python package (GLOBE / NOAA data). Grey = land, black = sea.
"""
import sys
import numpy as np
from global_land_mask import globe
from PIL import Image

W, H = 4096, 2048
lat = 90 - (np.arange(H) + 0.5) * 180 / H
lon = -180 + (np.arange(W) + 0.5) * 360 / W
LON, LAT = np.meshgrid(lon, lat)
land = globe.is_land(LAT, LON)
Image.fromarray((land * 255).astype(np.uint8), 'L').save(sys.argv[1], optimize=True)
print('land share', land.mean())
