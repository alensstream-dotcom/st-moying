"""Run through skills/webapp-testing/scripts/with_server.py on port 5179.
Requires Python Playwright; uses installed Edge headlessly. No live ST or generation API.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
preview = root / '.preview'
preview.mkdir(exist_ok=True)
(preview / 'visual.html').write_text('''<!doctype html><html><meta charset="utf-8"><body><div class="bbi-root" data-theme="day"><div id="app"></div></div>
<script type="module">
import { createApp } from 'vue';
import VisualStudio from '/src/pages/characters/VisualStudio.vue';
import '/src/styles/theme.css'; import '/src/styles/base.css';
const ctx = { chat:[{name:'叙事',is_user:false,is_system:false,mes:'小雪是女子。\\n\\n<bbi_image>1girl, forest<characters>[{"name":"小雪","tag":"1girl, black hair, blue hanfu","nl":""}]</characters><size>portrait</size></bbi_image>'}],
 chatMetadata:{baibai_image_char_tags:{version:3,entries:[{name:'小雪',source:'manual',fields:{sex:'1girl',hair:'black hair',eyes:'blue eyes',outfit:'blue hanfu'},raw:'',nl:'',desc:'',history:[]}]}},extensionSettings:{},
 name1:'User',name2:'小雪',characters:[{name:'小雪',avatar:'x',description:'仙侠修仙世界'}],characterId:0,
 getCurrentChatId:()=> 'ui-test',getRequestHeaders:()=>({}),saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},
 saveChat:async()=>{},eventSource:{on:()=>{},emit:async()=>{}},eventTypes:{} };
window.SillyTavern={getContext:()=>ctx}; window.__uiContext=ctx;
const {hydrateVisualLibrary}=await import('/src/state/visualLibrary.ts'); hydrateVisualLibrary();
const {hydrateCharTags}=await import('/src/state/charTags.ts'); hydrateCharTags();
const {refreshSceneStore,sceneAt}=await import('/src/state/sceneStore.ts'); refreshSceneStore(); window.__sceneAt=sceneAt;
createApp(VisualStudio).mount('#app');
</script><style>body{font-family:system-ui;margin:20px;background:#f4f4f5;color:#222}#app{max-width:900px;margin:auto}</style></body></html>''', encoding='utf-8')

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:5179/.preview/visual.html')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='世界观、视觉素材与定妆', exact=True).click()
    page.get_by_placeholder('中文名/别名/服装类型，如：仙侠剑修、JK').fill('仙侠女剑修服')
    page.get_by_role('button', name='库内抽样', exact=True).click()
    page.locator('.bbi-visual-candidate').wait_for(state='visible')
    initial = page.locator('.bbi-visual-candidate strong').inner_text()
    page.get_by_role('button', name='换个款式', exact=True).click()
    changed = page.locator('.bbi-visual-candidate strong').inner_text()
    assert initial != changed, (initial, changed)
    page.get_by_role('button', name='收藏款式', exact=True).click()
    page.get_by_role('status').filter(has_text='人物穿搭未改变').wait_for(state='visible')
    stored = page.evaluate('window.__uiContext.extensionSettings.bbi_visual_materials_v1.records')
    assert len(stored) == 1
    assert page.evaluate('window.__uiContext.chatMetadata.bbi_visual_timeline_v1 === undefined')
    page.get_by_role('button', name='重画这套 / 生成真实预览', exact=True).click()
    page.wait_for_timeout(100)
    assert page.locator('.bbi-visual-candidate img').count() == 0, 'Failed generation must not fabricate preview'
    page.get_by_role('button', name='目标人物、定妆与衣物状态', exact=True).click()
    page.get_by_role('combobox', name='目标人物', exact=True).select_option(index=1)
    identity = page.evaluate('window.__sceneAt(0).characters[0].identity')
    page.get_by_role('button', name='应用候选到目标人物', exact=True).click()
    page.get_by_role('status').filter(has_text='已建立带版本快照').wait_for(state='visible')
    assert page.evaluate('window.__uiContext.chatMetadata.bbi_visual_timeline_v1.entries.length') == 1
    assert page.evaluate('window.__sceneAt(0).characters[0].identity') == identity
    assert page.evaluate('window.__sceneAt(0).characters[0].baseAppearance.hair') == 'black hair'
    assert page.evaluate('window.__uiContext.chat[0].extra.bbiCharChanges.scene.frames.length') == 1
    page.get_by_role('button', name='撤销上次视觉操作', exact=True).click()
    page.get_by_role('button', name='按状态重编译本楼', exact=True).click()
    page.get_by_role('status').filter(has_text='已按各图对应位置重编译').wait_for(state='visible')
    assert page.evaluate('window.__uiContext.chatMetadata.bbi_visual_timeline_v1.entries.length') == 0
    page.screenshot(path=str(preview / 'visual-desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(100)
    overflow = page.evaluate('document.documentElement.scrollWidth > window.innerWidth')
    assert not overflow, 'Mobile layout has horizontal overflow'
    page.screenshot(path=str(preview / 'visual-mobile.png'), full_page=True)
    assert not errors, errors
    print(json.dumps({'ui': 'passed', 'checks': ['mount','Chinese outfit query','different material seed','collect without changing outfit','no fake preview on failure','apply and recompile without changing identity/face','undo and recompile','mobile overflow','no browser errors'], 'desktop': str(preview / 'visual-desktop.png'), 'mobile': str(preview / 'visual-mobile.png')}, ensure_ascii=False))
    browser.close()
