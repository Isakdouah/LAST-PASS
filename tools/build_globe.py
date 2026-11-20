"""Coarse world land mask (0.5 degree) for the orbit view.
Usage: python3 tools/build_globe.py src/data/globe.json
Source: the global-land-mask Python package (derived from GLOBE / NOAA elevation data).
"""
import base64, json, sys
import numpy as np
from global_land_mask import globe

lat = np.linspace(89.75, -89.75, 360)
lon = np.linspace(-179.75, 179.75, 720)
LON, LAT = np.meshgrid(lon, lat)
land = globe.is_land(LAT, LON).astype(np.uint8)
json.dump({'w': 720, 'h': 360, 'land': base64.b64encode(np.packbits(land.ravel()).tobytes()).decode(),
           'note': 'land mask from the global-land-mask package (GLOBE data), 0.5 degree'}, open(sys.argv[1], 'w'))
print('land share', land.mean())
