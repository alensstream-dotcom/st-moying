"""Build the offline character/trigger catalogue from AnimaDex's documented public source.
No images or API credentials are downloaded. Run with --csv PATH to reuse a local source.
"""
import argparse, csv, json, re, urllib.request, tempfile, hashlib
from pathlib import Path
from collections import defaultdict
arg=argparse.ArgumentParser(); arg.add_argument('--csv',type=Path); args=arg.parse_args()
source='https://huggingface.co/datasets/Laxhar/noob-wiki/resolve/main/danbooru_character.csv'
path=args.csv or Path(tempfile.gettempdir())/'moying-catalog'/'danbooru_character.csv'
if not path.exists():
 path.parent.mkdir(parents=True,exist_ok=True); urllib.request.urlretrieve(source,path)
rows=list(csv.DictReader(path.open(encoding='utf-8',newline='')))
by_slug={r['character']:r for r in rows}; grouped=defaultdict(list)
def root(slug):
 original=by_slug[slug]; current=slug
 while True:
  m=re.fullmatch(r'(.*)_\([^()]*\)',current)
  if not m: return current
  candidate=m.group(1)
  if candidate not in by_slug or by_slug[candidate]['copyright']!=original['copyright']: return current
  current=candidate
for r in rows: grouped[root(r['character'])].append(r)
works=defaultdict(list); merged=0
for canonical,versions in grouped.items():
 r=by_slug[canonical]; copyright=r['copyright']; trigger=r['trigger'].strip()
 inferred=canonical.replace('_',' ')+', '+copyright.replace('_',' ')
 tags={t.strip() for t in r.get('core_tags','').split(',')}
 gender='f' if '1girl' in tags and '1boy' not in tags else 'm' if '1boy' in tags and '1girl' not in tags else 'u'
 variants=[v['trigger'].strip() for v in versions if v['character']!=canonical]
 row=[canonical,int(r.get('count') or 0),gender]
 if variants or trigger!=inferred:row.append(variants)
 if trigger!=inferred:row.append(trigger)
 works[copyright].append(row); merged+=len(variants)
data={'version':1,'source':source,'license':'Apache-2.0','sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'rawCount':len(rows),'characterCount':len(grouped),'mergedVariants':merged,'workCount':len(works),'works':[[work,sorted(entries,key=lambda r:-r[1])] for work,entries in sorted(works.items(),key=lambda kv:-sum(r[1] for r in kv[1]))]}
out=Path(__file__).resolve().parents[1]/'src/data/characterCatalog.json';out.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in data.items() if k!='works'},ensure_ascii=True));print('bytes',out.stat().st_size)
