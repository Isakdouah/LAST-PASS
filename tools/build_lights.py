"""City lights for the globe: every town over 15,000 people (GeoNames, CC BY 4.0,
via the geonamescache package). Writes src/data/cities.json:
  pts: base64 of int16 lat*100, int16 lon*100, uint8 log-population code, per city
  big: [name, country, lat, lon, population] for cities over 500,000 (radio events)
Populations are today's, used as a rough stand-in for 2009 (a guess, good enough
for night lights).

Usage:  pip install geonamescache==2.0.0 && python3 tools/build_lights.py src/data/cities.json
"""
import base64
import json
import math
import struct
import sys

import geonamescache

cities = sorted(geonamescache.GeonamesCache().get_cities().values(), key=lambda c: -c['population'])
buf = bytearray()
big = []
for c in cities:
    p = max(15000, c['population'])
    code = min(255, int((math.log10(p) - 4) * 64))  # 10k -> 0, 10M -> 192
    buf += struct.pack('<hhB', round(c['latitude'] * 100), round(c['longitude'] * 100), code)
    if p >= 500000:
        big.append([c['name'], c['countrycode'], round(c['latitude'], 3), round(c['longitude'], 3), p])
json.dump({'n': len(cities), 'pts': base64.b64encode(bytes(buf)).decode(), 'big': big,
           'credit': 'GeoNames (CC BY 4.0)'}, open(sys.argv[1], 'w'), separators=(',', ':'))
print(len(cities), 'cities,', len(big), 'big')
