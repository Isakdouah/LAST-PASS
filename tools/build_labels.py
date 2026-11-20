"""Place names for the globe labels: every town and village over 1,000 people
(GeoNames, CC BY 4.0, via the geonamescache package). Writes src/data/labels.json:
  pts:   base64, per place: int16 lat*100, int16 lon*100, uint8 log-population code
  names: all names joined with '|', same order (biggest first)
Names and populations are today's (GeoNames), used as a stand-in for 2009.

Usage:  pip install geonamescache==2.0.0 && python3 tools/build_labels.py src/data/labels.json
"""
import base64
import json
import math
import struct
import sys

import geonamescache

cities = sorted(geonamescache.GeonamesCache(min_city_population=1000).get_cities().values(),
                key=lambda c: -c['population'])
# GeoNames sometimes lists a district with a bigger population than its own city
# (Kleinzschocher > Leipzig, New South Memphis > Memphis). Real cities have many
# translated names; districts have few. So a place over 50,000 with a well-known
# neighbour (3x the names, within 12 km, at least 30% its size) is demoted to a tenth
# of its size: it still shows up close in, but no longer hides the city's name.
DROP = set()
def km(a, b):
    dx = (a['longitude'] - b['longitude']) * 111.2 * math.cos(math.radians(a['latitude']))
    return math.hypot(dx, (a['latitude'] - b['latitude']) * 111.2)
big = [c for c in cities if c['population'] >= 50000]
demoted = 0
for a in big:
    na = len(a['alternatenames'])
    for b in big:
        if b is a or abs(b['latitude'] - a['latitude']) > 0.12 or b['population'] < 0.3 * a['population']:
            continue
        if len(b['alternatenames']) >= max(10, 3 * na) and km(a, b) < 12:
            if a['population'] >= 1000000: print('  demoted', a['name'], a['population'], 'next to', b['name'])
            a['population'] //= 10
            demoted += 1
            break
cities.sort(key=lambda c: -c['population'])
buf = bytearray()
names = []
for c in cities:
    name = c['name'].replace('|', ' ').strip()
    if not name or (c['name'], c['countrycode']) in DROP:
        continue
    p = max(1000, c['population'])
    code = min(255, int((math.log10(p) - 3) * 50))  # 1k -> 0, 10M -> 200
    buf += struct.pack('<hhB', round(c['latitude'] * 100), round(c['longitude'] * 100), code)
    names.append(name)
json.dump({'n': len(names), 'pts': base64.b64encode(bytes(buf)).decode(), 'names': '|'.join(names),
           'credit': 'GeoNames (CC BY 4.0)'}, open(sys.argv[1], 'w', encoding='utf-8'),
          separators=(',', ':'), ensure_ascii=False)
print(len(names), 'places,', demoted, 'districts demoted')
