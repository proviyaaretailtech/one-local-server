#!/usr/bin/env python3
"""Build the all-India place list the location picker searches (server/data/india-*.{tsv.gz,json}).

Source: GeoNames (https://www.geonames.org, CC BY 4.0) — IN.zip, admin1CodesASCII.txt, admin2Codes.txt
from https://download.geonames.org/export/dump/. Download them into one folder and run:

    python3 scripts/build-india-places.py /path/to/folder

Output (committed, rebuilt only when refreshing the data):
  server/data/india-places.tsv.gz  one populated place per line:
      name  lat  lng  state_code  district_code  population  kind  aliases(|-separated)
      kind: c = city (district HQ or 1 lakh+), t = town (has a population figure),
            l = locality inside a city, v = village
  server/data/india-admin.json     state and district names by code
"""
import gzip, json, os, re, sys

src = sys.argv[1] if len(sys.argv) > 1 else '.'
out = os.path.join(os.path.dirname(__file__), '..', 'server', 'data')

states, districts = {}, {}
for line in open(os.path.join(src, 'admin1CodesASCII.txt'), encoding='utf8'):
    code, name, ascii_name, _ = line.rstrip('\n').split('\t')
    if code.startswith('IN.'): states[code[3:]] = ascii_name
for line in open(os.path.join(src, 'admin2Codes.txt'), encoding='utf8'):
    code, name, ascii_name, _ = line.rstrip('\n').split('\t')
    if code.startswith('IN.'):
        _, a1, a2 = code.split('.')
        # "Pune Division", "District Rampur", "Lucknow District" → "Pune", "Rampur", "Lucknow"
        districts[f'{a1}.{a2}'] = re.sub(r'^District\s+|\s+(District|Division)$', '', ascii_name.strip())

# Official renames newer than the source data: shown under the new name, found by either.
RENAMED = {('Aurangabad', '16'): 'Chhatrapati Sambhajinagar', ('Osmanabad', '16'): 'Dharashiv', ('Ahmednagar', '16'): 'Ahilyanagar',
           ('Allahabad', '36'): 'Prayagraj', ('Gurgaon', '10'): 'Gurugram', ('Fyzabad', '36'): 'Ayodhya'}
SKIP = {'PPLQ', 'PPLH', 'PPLW', 'PPLCH'}  # abandoned, historical, destroyed
best = {}
for line in open(os.path.join(src, 'IN.txt'), encoding='utf8'):
    f = line.rstrip('\n').split('\t')
    if f[6] != 'P' or f[7] in SKIP: continue
    name, alts, lat, lng, code, a1, a2, pop = f[2].strip(), f[3], float(f[4]), float(f[5]), f[7], f[10], f[11], int(f[14] or 0)
    if not name or a1 not in states: continue
    if code in ('PPLC', 'PPLA', 'PPLA2') or pop >= 100_000: kind = 'c'
    elif code == 'PPLX': kind = 'l'
    elif pop > 0 or code.startswith('PPLA'): kind = 't'
    else: kind = 'v'
    aliases = ''
    if kind == 'c':  # renamed cities: Bangalore → Bengaluru, Aurangabad → Chhatrapati Sambhajinagar…
        seen = {name.lower()}
        keep = []
        for a in alts.split(','):
            a = a.strip()
            if a and a[0].isupper() and a.isascii() and a.replace(' ', '').replace('-', '').isalpha() and a.lower() not in seen and len(a) > 3:
                seen.add(a.lower()); keep.append(a)
        new = RENAMED.get((name, a1))
        if new: keep, name = [name] + keep, new  # show today's official name, still find the old one
        aliases = '|'.join(keep[:8])
    key = (name.lower(), a1, a2)
    rank = ({'c': 3, 't': 2, 'l': 1, 'v': 0}[kind], pop)
    if key not in best or rank > best[key][0]:
        best[key] = (rank, (name, f'{lat:.4f}', f'{lng:.4f}', a1, a2, str(pop), kind, aliases))

rows = sorted((v[1] for v in best.values()), key=lambda r: r[0].lower())
# mtime=0 keeps the file byte-identical between rebuilds of the same data (clean git diffs).
with open(os.path.join(out, 'india-places.tsv.gz'), 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=9, mtime=0) as fh:
    fh.write(''.join('\t'.join(r) + '\n' for r in rows).encode('utf8'))
json.dump({'states': states, 'districts': districts}, open(os.path.join(out, 'india-admin.json'), 'w'), separators=(',', ':'), sort_keys=True)
print(f'{len(rows)} places, {len(states)} states, {len(districts)} districts')
