import base64,io,zipfile,json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==')
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w') as z:z.writestr('image.png',png)
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for mode in ['foreground','background','failed']:
  page=browser.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def nai(route):
   requests.append(route.request.url)
   route.fulfill(status=403,content_type='application/json',body='{"message":"fixture failure"}') if mode=='failed' else route.fulfill(status=200,content_type='application/zip',body=buf.getvalue())
  page.route('**/mock-nai/**',nai)
  page.route('**/api/images/upload',lambda route:route.fulfill(status=200,json={'path':'/user/images/fixture.png'}))
  page.route('**/api/files/upload',lambda route:route.fulfill(status=200,json={'path':'/user/files/fixture.json'}))
  page.route('**/user/images/fixture.png',lambda route:route.fulfill(status=200,content_type='image/png',body=png))
  page.goto('http://127.0.0.1:5178/tests/browser/novel-presentation.html')
  page.wait_for_function('window.fixture?.novelReader')
  assert page.locator('[data-bbi-slot]').count()==0
  if mode=='background':page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true})")
  result=page.evaluate('async()=>{await fixture.novelReader.planFloor(0);return await fixture.novelReader.generateFloor(0)}')
  if mode=='failed':
   assert result['status']=='failed',result
   page.wait_for_timeout(2100)
   assert len(requests)==1,requests
   results.append('真实Vue卡片挂载后，小说出图失败没有触发卡片额外自动重试')
  else:
   assert result['status']=='ready',result
   if mode=='background':
    assert page.locator('[data-bbi-slot]').count()==0
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))")
   image=page.locator('.mes_text img.bbi-figure__img')
   image.wait_for(state='visible')
   page.wait_for_function("document.querySelector('[data-bbi-slot]').shadowRoot.querySelector('img').naturalWidth>0")
   assert len(requests)==1
   if mode=='foreground':
    page.evaluate('fixture.resetDom()')
    page.evaluate('async()=>{await fixture.novelReader.planFloor(0);return await fixture.novelReader.generateFloor(0)}')
    page.locator('.mes_text img.bbi-figure__img').wait_for(state='visible')
    assert len(requests)==1
    results.append('真实解析器→NAI ZIP解包→图片上传→extra→正文锚点→Vue图片显示通过；缓存图修复无需重新生图')
   else:results.append('后台保存不渲染，恢复可见后真实正文与卡片直接显示，无需刷新聊天')
  assert not errors,errors
  page.close()
 browser.close()
(root/'.preview').mkdir(exist_ok=True)
(root/'.preview/real-presentation-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
