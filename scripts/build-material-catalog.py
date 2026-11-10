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
# Cross-check gender against the newer appearance table. Any male/conflicting
# evidence wins exclusion; lack of evidence never becomes female by default.
appearance_source='https://huggingface.co/datasets/StoryAura/Danbooru-Dataset-csv/resolve/main/danbooru_character_appearance_corrected.csv'
appearance_path=Path(tempfile.gettempdir())/'moying-character-appearance.csv'
if not appearance_path.exists(): urllib.request.urlretrieve(appearance_source,appearance_path)
looks={r['name'].replace(' ','_'):r['looks'] for r in csv.DictReader(appearance_path.open(encoding='utf-8-sig',newline=''))}
def gender(slug):
 tags={t.strip() for t in (by_slug[slug].get('core_tags','')+', '+looks.get(slug,'')).split(',')}
 if any(re.fullmatch(r'\d+boys?', t) or t in ('male','male focus','male_focus','boy','man') for t in tags): return 'm'
 if any(re.fullmatch(r'1girl', t) or t in ('female','girl','woman') for t in tags): return 'f'
 return 'u'
def eligible(slug):
 r=by_slug[slug]
 work=r['copyright'].strip()
 return bool(work and work.lower() not in ('original','unknown','none','original_character') and gender(slug)=='f' and not re.search(r'genderswap|genderbend|male_to_female',slug+' '+r.get('core_tags','')))
relations={}
with relation_path.open(encoding='utf-8-sig',newline='') as f:
 for item in csv.DictReader(f):
  child=item['character_tag']; parent=item['base_character']
  if child in by_slug and parent in by_slug and child!=parent and eligible(child) and eligible(parent) and by_slug[child]['copyright']==by_slug[parent]['copyright']: relations[child]=parent

def root(slug):
 original=by_slug[slug]; current=slug; seen=set()
 while current not in seen:
  seen.add(current)
  target=relations.get(current)
  if target and target not in seen: current=target; continue
  m=re.fullmatch(r'(.*)_\([^()]*\)',current)
  candidate=m.group(1) if m else ''
  if candidate and candidate not in seen and candidate in by_slug and eligible(candidate) and by_slug[candidate]['copyright']==original['copyright']:
   current=candidate; continue
  return current
 return slug
for r in rows:
 if eligible(r['character']): grouped[root(r['character'])].append(r)
# Community primary Chinese names can reveal renamed tags absent from base_character.
# Only sufficiently long names within the exact same work are considered; machine
# translations and shared short nicknames cannot merge identities.
zh=json.loads((Path(__file__).resolve().parents[1]/'src/data/characterZh.json').read_text(encoding='utf-8'))
parents={key:key for key in grouped}
def find(key):
 while parents[key]!=key:
  parents[key]=parents[parents[key]]; key=parents[key]
 return key
seen_names={}
for family,versions in grouped.items():
 for r in versions:
  name=(zh.get(r['character']) or [''])[0].strip()
  if not re.fullmatch(r'[\u3400-\u9fff·・]{3,24}',name) or any(t in name for t in ('女主','主人公','无名','未知','原创')): continue
  signature=(r['copyright'],name)
  if signature in seen_names: parents[find(family)]=find(seen_names[signature])
  else: seen_names[signature]=family
families=defaultdict(list)
for family,versions in grouped.items():families[find(family)].extend(versions)
works=defaultdict(list); merged=0; redirects={}
for versions in families.values():
 # Keep the most widely used English trigger, independently of translation order.
 r=max(versions,key=lambda v:(int(v.get('count') or 0),v['character']))
 canonical=r['character']; copyright=r['copyright']; trigger=r['trigger'].strip()
 inferred=canonical.replace('_',' ')+', '+copyright.replace('_',' ')
 variants=[v['trigger'].strip() for v in versions if v['character']!=canonical]
 for v in versions:
  if v['character']!=canonical: redirects[v['character']]=canonical
 row=[canonical,int(r.get('count') or 0),'f']
 if variants or trigger!=inferred:row.append(variants)
 if trigger!=inferred:row.append(trigger)
 works[copyright].append(row); merged+=len(variants)
source_aliases={k:v for k,v in source_aliases.items() if eligible(k)}
data={'version':1,'source':source,'license':'Apache-2.0','sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'supplementSource':'https://huggingface.co/datasets/StoryAura/Danbooru-Dataset-csv','appearanceSource':appearance_source,'appearanceSha256':hashlib.sha256(appearance_path.read_bytes()).hexdigest(),'policy':'female-work-linked-v1','aliases':source_aliases,'rawCount':len(rows),'characterCount':len(families),'mergedVariants':merged,'workCount':len(works),'redirects':redirects,'works':[[work,sorted(entries,key=lambda r:-r[1])] for work,entries in sorted(works.items(),key=lambda kv:-sum(r[1] for r in kv[1]))]}
out=Path(__file__).resolve().parents[1]/'src/data/characterCatalog.json';out.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in data.items() if k not in ('works','redirects','aliases')},ensure_ascii=True));print('bytes',out.stat().st_size)
