"""Build the offline character/trigger catalogue from AnimaDex's documented public source.
No images or API credentials are downloaded. Run with --csv PATH to reuse a local source.
"""
import argparse, csv, json, re, urllib.request, tempfile, hashlib
from pathlib import Path
from collections import defaultdict
arg=argparse.ArgumentParser(); arg.add_argument('--csv',type=Path); arg.add_argument('--relationships',type=Path); args=arg.parse_args()
source='https://huggingface.co/datasets/Laxhar/noob-wiki/resolve/main/danbooru_character.csv'
path=args.csv or Path(tempfile.gettempdir())/'moying-catalog'/'danbooru_character.csv'
if not path.exists():
 path.parent.mkdir(parents=True,exist_ok=True); urllib.request.urlretrieve(source,path)
rows=list(csv.DictReader(path.open(encoding='utf-8',newline='')))
by_slug={r['character']:r for r in rows}; grouped=defaultdict(list)
relation_path=args.relationships or Path(tempfile.gettempdir())/'moying-character-corrected.csv'
if not relation_path.exists():
 urllib.request.urlretrieve('https://huggingface.co/datasets/StoryAura/Danbooru-Dataset-csv/resolve/main/danbooru_character_tags_corrected.csv',relation_path)
# Supplement the older Animadex snapshot with newer, work-linked character metadata.
source_aliases={}
with relation_path.open(encoding='utf-8-sig',newline='') as f:
 for item in csv.DictReader(f):
  slug=item['character_tag']; copyright=item['copyright'].strip()
  if slug in by_slug:
   by_slug[slug]['count']=item['post_count']
  elif copyright and copyright!='original':
   row={'character':slug,'copyright':copyright,'trigger':slug.replace('_',' ')+', '+copyright.replace('_',' '),'count':item['post_count'],'core_tags':''}
   rows.append(row);by_slug[slug]=row
   names=[n.strip() for n in item['other_names'].split(',') if n.strip()]
   if names:source_aliases[slug]=names
relations={}
with relation_path.open(encoding='utf-8-sig',newline='') as f:
 for item in csv.DictReader(f):
  child=item['character_tag']; parent=item['base_character']
  if child in by_slug and parent in by_slug and child!=parent and by_slug[child]['copyright'] and by_slug[child]['copyright']==by_slug[parent]['copyright']:
   ct=set(by_slug[child].get('core_tags','').split(', ')); pt=set(by_slug[parent].get('core_tags','').split(', '))
   if not (('1girl' in ct and '1boy' in pt) or ('1boy' in ct and '1girl' in pt)): relations[child]=parent

def root(slug):
 original=by_slug[slug]; current=slug; seen=set()
 while current not in seen:
  seen.add(current)
  target=relations.get(current)
  if target and target not in seen: current=target; continue
  m=re.fullmatch(r'(.*)_\([^()]*\)',current)
  candidate=m.group(1) if m else ''
  if candidate and candidate not in seen and candidate in by_slug and by_slug[candidate]['copyright']==original['copyright']:
   current=candidate; continue
  return current
 return slug
for r in rows: grouped[root(r['character'])].append(r)
works=defaultdict(list); merged=0; redirects={}
for canonical,versions in grouped.items():
 r=by_slug[canonical]; copyright=r['copyright']; trigger=r['trigger'].strip()
 inferred=canonical.replace('_',' ')+', '+copyright.replace('_',' ')
 tags={t.strip() for t in r.get('core_tags','').split(',')}
 gender='f' if '1girl' in tags and '1boy' not in tags else 'm' if '1boy' in tags and '1girl' not in tags else 'u'
 variants=[v['trigger'].strip() for v in versions if v['character']!=canonical]
 for v in versions:
  if v['character']!=canonical: redirects[v['character']]=canonical
 row=[canonical,int(r.get('count') or 0),gender]
 if variants or trigger!=inferred:row.append(variants)
 if trigger!=inferred:row.append(trigger)
 works[copyright].append(row); merged+=len(variants)
data={'version':1,'source':source,'license':'Apache-2.0','sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'supplementSource':'https://huggingface.co/datasets/StoryAura/Danbooru-Dataset-csv','aliases':source_aliases,'rawCount':len(rows),'characterCount':len(grouped),'mergedVariants':merged,'workCount':len(works),'redirects':redirects,'works':[[work,sorted(entries,key=lambda r:-r[1])] for work,entries in sorted(works.items(),key=lambda kv:-sum(r[1] for r in kv[1]))]}
out=Path(__file__).resolve().parents[1]/'src/data/characterCatalog.json';out.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in data.items() if k not in ('works','redirects','aliases')},ensure_ascii=True));print('bytes',out.stat().st_size)
