"""Derive work media only from explicit descriptions in the MIT community dictionary.
Unknown classifications are omitted. Anime adaptations can coexist with their source medium.
"""
import csv, json, os, re, urllib.request
from pathlib import Path
source = 'https://huggingface.co/datasets/ame-la/danbooru-tags-data-zh/resolve/main/tags/copyright.csv'
path = Path(os.environ.get('TEMP', '/tmp')) / 'moying-copyright-notes.csv'
if not path.exists():
    urllib.request.urlretrieve(source, path)
patterns = [('游戏', r'游戏|遊戲|视觉小说|視覺小說'), ('动漫', r'动画|動畫|动漫|動漫'),
            ('漫画', r'漫画|漫畫'), ('小说', r'轻小说|輕小說|网络小说|網路小說|小说系列|小說系列|小说作品|小說作品')]
media = {}
for row in csv.DictReader(path.open(encoding='utf-8-sig')):
    types = [name for name, pattern in patterns if re.search(pattern, row['notes'])]
    if types:
        media[row['tag']] = types
out = Path(__file__).resolve().parents[1] / 'src/data/workMedia.json'
out.write_text(json.dumps(media, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print('Classified works:', len(media))
