// 酒馆小说导入与配图阅读器 v6.3.1(多楼层中断修复版)
// 自定义分节、范围批选、顺序生图、待处理恢复与分节版本保护。
// 手机系统完全挂起 WebView 时无法保证继续运行，返回后可恢复待处理任务。
(function () {
    'use strict';

    const VERSION = '6.3.1';
    const DB_NAME = 'TavernNovelReaderDB_v2';
    const STORE_BOOKS = 'books_store';
    const STORE_META = 'meta_store';
    const META_KEY = 'reader_settings_v6_0';
    const MARK_KEY = 'thNovelV6';
    const FLOOR_HEADER_RE = /^【第(\d+)节\s*·\s*([^】]*)】/;
    const SENTENCE_END = '。！？…；!?…';

    let settings = {
        activeBookId: '',
        chunkSize: 1200,
        autoCreateCard: true,
        lockSwipeReroll: true,
        autoAppendOnBottom: true,
        pureMode: false,
        showFloatingHud: true,
        hudMinimized: false,
        hudPos: null,
        keepAliveBg: true,
        preGenWaitSec: 150,
        preGenRetry: 3,
        cooldownSec: 4,
        preGenLookahead: 900,
        customCleanRules: '/q,\\q',
        boundBtnType: 'floor',
        boundBtnSelector: '.bbi-tag-action',
        boundSlashCmd: '',
        tocGroupByChapter: true,
        exportFormat: 'epub',
        exportIncludeImages: true,
        exportIncludeUnillustrated: true,
        exportSplitByChapter: true,
        defaultCardPrompt: '【画风与人物强制设定】本角色卡为小说配图专属角色卡。画面核心出镜人物固定为女性角色（1girl, solo, female focus, beautiful detailed eyes, delicate face, anime style），严禁生成无关男性单人特写。请严格根据当前最新一条AI回复中的小说正文场景、服饰、动作与环境描写提取生图提示词。'
    };

    let _cb = null;
    let currentBook = null;
    Object.defineProperty(globalThis, '__cbProbe', { configurable: true, get() { return _cb; } });
    function setCurrentBook(v, why) {
        if (dbgOn() && globalThis.__cbs) globalThis.__cbs.push(String(_cb && _cb.id) + ' -> ' + String(v && v.id) + ' [' + why + '] gen=' + MY_GEN + ' inst=' + INST + ' ' + STK());
        if (v === _cb) return;
        if (dbgOn() && globalThis.__cbLog) globalThis.__cbLog.push((_cb && _cb.id) + ' -> ' + (v && v.id) + ' [' + why + '] ' + STK());
        _cb = v;
    }
    Object.defineProperty(globalThis, '__cbSet', { configurable: true, value: setCurrentBook });
    const INST = Math.random().toString(36).slice(2, 6);

    // 本实例所有需要注销的副作用（监听、定时器、观察器）
    const teardowns = [];
    function on(target, type, fn, opts) {
        if (!target) return;
        target.addEventListener(type, fn, opts);
        teardowns.push(() => { try { target.removeEventListener(type, fn, opts); } catch (e) { } });
    }
    function every(ms, fn) {
        const id = setInterval(fn, ms);
        teardowns.push(() => clearInterval(id));
        return id;
    }
    function later(fn, ms) {
        const id = setTimeout(fn, ms);
        teardowns.push(() => clearTimeout(id));
        return id;
    }
    // 同步登记：boot 里一旦先 await 再登记，就会漏掉"并发注入"的另一份
    try {
        const hw0 = getHostWindow();
        hw0.__thReaderV6Instances = hw0.__thReaderV6Instances || [];
        hw0.__thReaderV6Instances.push(teardown);
    } catch (e) { }
    function teardown() {
        alive = false;
        try { if (dbgOn()) (getHostWindow().__td = getHostWindow().__td || []).push(MY_GEN + ' by gen=' + getHostWindow().__thReaderV6Gen); } catch (e) { }
    try { if (getHostWindow().__thReaderV6Owner === INST) getHostWindow().__thReaderV6Owner = null; } catch (e) { }
        for (const fn of teardowns) { try { fn(); } catch (e) { } }
        teardowns.length = 0;
        try { sentinelObserver?.disconnect(); } catch (e) { }
        try { jumpHoldRo?.disconnect(); } catch (e) { }
        try { pinObserver?.disconnect(); } catch (e) { }
        try {
            const cEl = getChatEl();
            if (cEl && cEl.dataset.thNovelSpyV6) delete cEl.dataset.thNovelSpyV6;
        } catch (e) { }
    }
    let booted = false;
    // teardown 之后，这个实例可能还有 await 没走完（boot 里的 loadSettings/loadBook），
    // 它一旦继续跑就会把刚导入的那本书换掉，所以下面这些入口都要先看它还活不活。
    let alive = true;
    try { (getHostWindow().__hb = getHostWindow().__hb || []).length = 0; } catch (e) { }
    const MY_GEN = (() => {
        try {
            const hw0 = getHostWindow();
            hw0.__thReaderV6Gen = (hw0.__thReaderV6Gen || 0) + 1;
            return hw0.__thReaderV6Gen;
        } catch (e) { return 1; }
    })();
    function isDead() {
        if (!alive) return true;
        try {
            if (getHostWindow().__thReaderV6Gen !== MY_GEN) { alive = false; return true; }
        } catch (e) { }
        return false;
    }
    try { if (dbgOn()) (getHostWindow().__live = getHostWindow().__live || []).push(MY_GEN); } catch (e) { }
    try { const d0 = (getHostDocument().documentElement.dataset.thInsts = String((getHostDocument().documentElement.dataset.thInsts || '') + ',' + MY_GEN + '/' + INST)); } catch (e) { }
    every(500, () => { if (!dbgOn()) return; try { const w = getHostWindow(); w.__hb = w.__hb || []; if (alive) { w.__hb.push(MY_GEN + ':' + (w.__thReaderV6Gen === MY_GEN ? 'cur' : 'old') + ':' + (w.__thReaderV6Owner === INST ? 'own' : '-')); } if (w.__hb.length > 200) w.__hb.splice(0, 100); } catch (e) { } });
    let queueRunning = false;
    let queueStop = false;
    let queuePromise = null;
    let queueProgress = '';
    let queueContext = null;
    let queueStarting = false;
    let pipelineMode = false;
    let pipelineEvents = [];
    function recordPipeline(event, details) {
        pipelineEvents.push({at:new Date().toISOString(),event,hidden:isRealDocHidden(),...details});
        if(pipelineEvents.length>500)pipelineEvents.splice(0,pipelineEvents.length-500);
    }
    function exportPipelineDiagnostics() {
        const api=getHostWindow()?.STBaiBaiImage;
        const report={readerVersion:VERSION,pluginVersion:api?.pluginVersion||null,bridgeVersion:api?.novelReader?.version||null,
            queueRunning,queueStatus,events:pipelineEvents};
        saveBlob(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'小说生图队列诊断.json');
    }
    function refreshPipelineView() {
        if(isRealDocHidden() || !currentBook)return;
        const ctx=getSTContext();
        const map=scanFloorMap(currentBook);
        const base=Number(currentBook.currentIndex)||0;
        // Present a small reading window after data-only deployment. Rendering is never awaited by generation.
        for(let idx=base;idx<base+3;idx++) {
            const info=map[idx];
            if(info && !mesEl(info.mesId) && typeof ctx?.addOneMessage==='function') {
                try{ctx.addOneMessage(ctx.chat[info.mesId],{scroll:false,forceId:info.mesId});}
                catch(e){recordPipeline('display-refresh-failed',{reason:String(e?.message||e).slice(0,200)});}
            }
        }
        getHostWindow()?.STBaiBaiImage?.novelReader?.refresh?.();
    }
    let lastQueueFailed = [];
    let queueStatus = '尚未开始生图';
    let batchRange = '';
    let batchCount = 10;
    let tocFilter = 'all';
    let selectionMode = false;
    function queueContextChanged() {
        if (isDead()) return true;
        if (!queueContext) return false;
        const ctx = getSTContext();
        if (!ctx) return true;
        let id = null;
        try { id = ctx?.getCurrentChatId?.(); } catch (e) { }
        // 只比「聊天 id / 当前书 id」,不比 ctx.chat 的数组身份:
        // 酒馆在保存、重载、虚拟列表重排后会换掉 chat 数组对象(或短暂返回空 id),
        // 旧写法会把它当成「聊天已切换」,在后台静默中止整条队列——表现就是只出第一张图,后面全停在待处理。
        // 楼层每轮都用 findFloorByChunk 实时重查,插件写回前也自己校验 chatId/swipe,不会写错楼。
        if (queueContext.chatId && id && id !== queueContext.chatId) return true;
        if (currentBook && currentBook.id !== queueContext.bookId) return true;
        return false;
    }
    function updateQueueStatus(text) {
        queueStatus = text;
        const el = panelEl?.querySelector('#toc-queue-status');
        if (el) el.textContent = text;
        updateHud();
    }
    function parseSectionRange(value, total) {
        const out = new Set();
        const normalized = String(value).trim().replace(/[，、；;]/g, ',').replace(/[—–～~至]/g, '-');
        if (!normalized) throw new Error('请输入节号，例如 1-10,15,20-25');
        for (const token of normalized.split(',')) {
            const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (!match) throw new Error('节号格式错误：' + token);
            const a = Number(match[1]), b = Number(match[2] || match[1]);
            if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < a || b > total) throw new Error('节号应在 1～' + total + ' 之间，范围从小到大填写');
            for (let i=a; i<=b; i++) out.add(i-1);
        }
        return [...out].sort((a,b)=>a-b);
    }
    let selectedChunkSet = new Set();
    let lastVisible = { mesId: -1, chunkIdx: -1 };
    let sentinelObserver = null;
    let appendInFlight = false;
    // 导入过程中（含自动建卡触发的切卡）不允许 loadBook 改选别的书
    let importInFlight = false;
    // 消息的稳定 UI 身份：mesid 会被重排改写，排序/去重得靠它
    let uiidSeq = 0;
    // 刚导入/续读的书，loadBook 别把它换掉
    let pinnedBookId = '';

    // ============ 基础工具 ============
    let bgWaiters = [];
    let bgWorker = null;
    let bgWorkerUrl = '';
    let lastWorkerPumpAt = 0;
    let origDocHiddenDesc = null;
    let origDocVisDesc = null;
    let bgVisSpoofed = false;
    let pumpingBgQueue = false;
    let activeGenMesId = -1;
    let bgViewportShifted = false;
    let bgSavedUserTop = null;
    let bgSavedUserAnchor = null;
    let lastTagReqState = { mesId: -1, pending: false, settledAt: 0, failed: false, reason: '' };
    let goToChunkSeq = 0;
    let tocNeedsFocusCurrent = false;

    function saveUserViewportForBg() {
        try {
            const chatEl = getChatEl();
            if (!chatEl || bgViewportShifted) return;
            bgSavedUserTop = rawTop(chatEl);
            bgSavedUserAnchor = pickAnchor(chatEl);
        } catch (e) { }
    }

    function restoreUserViewportFromBg() {
        try {
            if (!bgViewportShifted) return;
            bgViewportShifted = false;
            const chatEl = getChatEl();
            if (!chatEl) return;
            if (bgSavedUserAnchor && bgSavedUserAnchor.el && bgSavedUserAnchor.el.isConnected) {
                correctToAnchor(chatEl, bgSavedUserAnchor, bgSavedUserTop ?? 0);
            } else if (bgSavedUserTop !== null && Number.isFinite(bgSavedUserTop)) {
                setTopRaw(chatEl, bgSavedUserTop);
            }
        } catch (e) { }
    }

    // 针对安卓 TauriTavern 的 ChatSurface (只渲染视口 V ∪ 真尾部 T) 与前端面板冻结机制：
    // 仅当应用处于后台 (isRealDocHidden() === true) 或目标楼层被虚拟化卸载 (!mesEl(mesId)) 时，
    // 临时将 #chat 的物理视口对齐到目标生图楼层；切回前台或队列结束时立即无感恢复阅读位置。
    async function alignFloorIntoViewportForGen(mesId) {
        try {
            const chatEl = getChatEl();
            if (!chatEl) return;
            let el = mesEl(mesId);
            if (!el) {
                saveUserViewportForBg();
                bgViewportShifted = true;
                await ensureFloorMounted(mesId, 4000);
                el = mesEl(mesId);
            }
            if (el && isRealDocHidden()) {
                saveUserViewportForBg();
                bgViewportShifted = true;
                const want = Math.max(0, el.offsetTop - 24);
                setTopRaw(chatEl, want);
            }
        } catch (e) { }
    }

    // 仅在当前正在生图的那单个 .mes 节点自身挂载 getBoundingClientRect，绝不污染全局 Element.prototype.getBoundingClientRect！
    function tempPatchFloorRectInView(el) {
        if (!el || typeof el.getBoundingClientRect !== 'function') return () => { };
        const hadOwn = Object.prototype.hasOwnProperty.call(el, 'getBoundingClientRect');
        const prevOwn = el.getBoundingClientRect;
        const protoRect = (getHostWindow() && getHostWindow().Element && getHostWindow().Element.prototype && getHostWindow().Element.prototype.getBoundingClientRect) || prevOwn;
        try {
            el.getBoundingClientRect = function () {
                const r = protoRect.call(this);
                const chatEl = getChatEl();
                const cr = chatEl ? protoRect.call(chatEl) : null;
                const ct = (cr && cr.height > 0) ? cr.top : 40;
                const ch = (cr && cr.height > 0) ? cr.height : 720;
                const cl = (cr && cr.width > 0) ? cr.left : 0;
                const cw = (cr && cr.width > 0) ? cr.width : 400;
                if (!r || r.width === 0 || r.height === 0 || r.bottom <= ct + 16 || r.top >= ct + ch - 16) {
                    const vTop = ct + 72;
                    const vHeight = Math.min(Math.max((r && r.height) || 260, 180), Math.max(200, ch - 100));
                    const vLeft = cl + 12;
                    const vWidth = Math.max((r && r.width) || (cw - 24) || 340, 240);
                    return {
                        top: vTop, bottom: vTop + vHeight, left: vLeft, right: vLeft + vWidth,
                        width: vWidth, height: vHeight, x: vLeft, y: vTop,
                        toJSON() { return this; }
                    };
                }
                return r;
            };
        } catch (e) { }
        return () => {
            try {
                if (hadOwn) el.getBoundingClientRect = prevOwn;
                else delete el.getBoundingClientRect;
            } catch (e) { }
        };
    }

    function initOrigDocDescs() {
        if (origDocHiddenDesc && origDocVisDesc) return;
        try {
            const hw = getHostWindow();
            const docProto = (hw && hw.Document && hw.Document.prototype) || (typeof Document !== 'undefined' ? Document.prototype : null);
            if (docProto) {
                if (!origDocHiddenDesc) origDocHiddenDesc = Object.getOwnPropertyDescriptor(docProto, 'hidden');
                if (!origDocVisDesc) origDocVisDesc = Object.getOwnPropertyDescriptor(docProto, 'visibilityState');
            }
        } catch (e) { }
    }

    function isRealDocHidden() {
        try {
            initOrigDocDescs();
            const doc = getHostDocument();
            if (!doc) return false;
            if (origDocHiddenDesc && typeof origDocHiddenDesc.get === 'function') {
                return Boolean(origDocHiddenDesc.get.call(doc));
            }
            if (origDocVisDesc && typeof origDocVisDesc.get === 'function') {
                return origDocVisDesc.get.call(doc) === 'hidden';
            }
            return Boolean(doc.hidden || doc.visibilityState === 'hidden');
        } catch (e) { return false; }
    }

    function hasMoyingBgPending() {
        try {
            const win = getHostWindow();
            const raw = win && win.localStorage ? win.localStorage.getItem('moying_image_bg_pending') : null;
            return Boolean(raw && raw !== '[]' && raw.trim().length > 2);
        } catch (e) { return false; }
    }

    // 保持真实 document.hidden / visibilityState（不伪造 visible，以免破坏墨影的后台 JPG 转存跳过、rAF 回退和后台生图接管）
    function setDocVisibilitySpoof(enable) {
        if (!bgVisSpoofed) return;
        try {
            initOrigDocDescs();
            const win = getHostWindow();
            const doc = getHostDocument();
            if (!doc) return;
            const docProto = win && win.Document && win.Document.prototype;
            bgVisSpoofed = false;
            delete doc.hidden;
            delete doc.webkitHidden;
            delete doc.visibilityState;
            if (docProto) {
                if (origDocHiddenDesc) Object.defineProperty(docProto, 'hidden', origDocHiddenDesc);
                if (origDocVisDesc) Object.defineProperty(docProto, 'visibilityState', origDocVisDesc);
            }
            if (doc.__thOrigHasFocus) {
                doc.hasFocus = doc.__thOrigHasFocus;
                delete doc.__thOrigHasFocus;
            }
        } catch (e) { }
    }

    function pumpMoyingBgQueue() {
        if (pipelineMode || !queueRunning || pumpingBgQueue || !hasMoyingBgPending() || queueContextChanged()) return;
        const bbi = getHostWindow()?.STBaiBaiImage;
        if (!bbi || typeof bbi.resumeBackgroundPending !== 'function') return;
        if (typeof bbi.isBackgroundGenRunning === 'function' && bbi.isBackgroundGenRunning()) return;
        pumpingBgQueue = true;
        Promise.resolve().then(() => bbi.resumeBackgroundPending()).catch(e => {
            console.warn('[小说阅读器] 后台队列唤醒失败', e);
        }).finally(() => { pumpingBgQueue = false; });
    }

    function drainBgWaiters() {
        const now = Date.now();
        if (queueRunning && now - lastWorkerPumpAt >= 3500) {
            lastWorkerPumpAt = now;
            if (hasMoyingBgPending()) pumpMoyingBgQueue();
        }
        if (!bgWaiters.length) return;
        const due = [];
        bgWaiters = bgWaiters.filter(w => {
            if (now >= w.at) { due.push(w); return false; }
            return true;
        });
        for (const w of due) { try { w.fire(); } catch (e) { } }
    }

    function stopBgWorker() {
        if (!bgWorker) return;
        try { bgWorker.postMessage('stop'); bgWorker.terminate(); } catch (e) { }
        if (bgWorkerUrl) {
            try { ((getHostWindow() && getHostWindow().URL) || URL).revokeObjectURL(bgWorkerUrl); } catch (e) { }
            bgWorkerUrl = '';
        }
        bgWorker = null;
    }

    function ensureBgWorker() {
        if (bgWorker) return bgWorker;
        try {
            const hw = getHostWindow();
            const BlobCtor = (hw && hw.Blob) || Blob;
            const URLObj = (hw && hw.URL && typeof hw.URL.createObjectURL === 'function') ? hw.URL : URL;
            const WorkerCtor = (hw && hw.Worker) || Worker;
            const code = 'let t=null;onmessage=e=>{if(e.data==="start"){if(!t)t=setInterval(()=>postMessage("tick"),240);}else if(e.data==="stop"){if(t){clearInterval(t);t=null;}}};';
            const blob = new BlobCtor([code], { type: 'application/javascript' });
            bgWorkerUrl = URLObj.createObjectURL(blob);
            bgWorker = new WorkerCtor(bgWorkerUrl);
            bgWorker.onmessage = drainBgWaiters;
            bgWorker.postMessage('start');
            teardowns.push(stopBgWorker);
        } catch (e) { bgWorker = null; }
        return bgWorker;
    }
    function sleep(ms) {
        const d = Math.max(0, Number(ms) || 0);
        return new Promise(r => {
            let done = false;
            const fire = () => { if (done) return; done = true; clearTimeout(tid); r(); };
            const tid = setTimeout(fire, d);
            if (queueRunning) {
                ensureBgWorker();
                bgWaiters.push({ at: Date.now() + d, fire });
            }
        });
    }
    function nowMs() { return Date.now(); }

    function getHostWindow() {
        try { if (window.parent && window.parent.document) return window.parent; } catch (e) { }
        return window;
    }
    function getHostDocument() { return getHostWindow().document || document; }

    // 诊断开关。控制台里执行 `__TH_DEBUG = true` 后，滚动、铺楼、排队这些内部细节
    // 会写进 window.__st2 / __aa / __pl 之类的数组；默认关，免得每帧拼字符串。
    function dbgOn() {
        try { return Boolean(getHostWindow().__TH_DEBUG); } catch (e) { return false; }
    }

    function getSTContext() {
        try {
            const hw = getHostWindow();
            if (hw.SillyTavern && typeof hw.SillyTavern.getContext === 'function') return hw.SillyTavern.getContext();
            if (typeof SillyTavern !== 'undefined' && SillyTavern && typeof SillyTavern.getContext === 'function') return SillyTavern.getContext();
        } catch (e) { }
        return null;
    }

    function getTavernHelper() {
        try {
            const hw = getHostWindow();
            if (hw.TavernHelper) return hw.TavernHelper;
            if (typeof TavernHelper !== 'undefined') return TavernHelper;
        } catch (e) { }
        return null;
    }

    function notify(type, msg, title) {
        title = title || '小说阅读器';
        try {
            const hw = getHostWindow();
            const t = (typeof toastr !== 'undefined' && toastr) ? toastr : hw.toastr;
            if (t && typeof t[type] === 'function') {
                t[type](msg, title, { timeOut: type === 'error' ? 4200 : 2600, closeButton: true, progressBar: true });
                return;
            }
        } catch (e) { }
        try { console.log(`[reader v${VERSION}][${type}] ${msg}`); } catch (e) { }
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 32bit FNV-1a，用于判断楼层正文是否已过期
    function hashText(str) {
        let h = 0x811c9dc5;
        const s = String(str || '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return h.toString(16);
    }

    function formatBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n <= 0) return '0 KB';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function formatChunkFloorText(chunk, chunkIndex) {
        return `【第${chunkIndex + 1}节 · ${chunk.title}】\n\n${chunk.content}`;
    }

    // 确认框：脚本跑在 iframe 里时裸 confirm 可能取不到，回退到宿主 window
    function ask(msg) {
        try {
            const hw = getHostWindow();
            const fn = (typeof confirm === 'function') ? confirm : hw.confirm;
            return fn ? fn.call(hw, msg) : true;
        } catch (e) { return true; }
    }

    function saveBlob(blob, filename) {
        const doc = getHostDocument();
        const a = doc.createElement('a');
        const url = (getHostWindow().URL || URL).createObjectURL(blob);
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        (doc.body || doc.documentElement).appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); try { (getHostWindow().URL || URL).revokeObjectURL(url); } catch (e) { } }, 4000);
    }

    // ============ 样式 ============
    function injectStyles() {
        const doc = getHostDocument();
        let st = doc.getElementById('th-novel-style-v6');
        if (!st) {
            st = doc.createElement('style');
            st.id = 'th-novel-style-v6';
            (doc.head || doc.body).appendChild(st);
        }
        // 原生滚动锚定会自己改 scrollTop，和我们冻结/回写打架，必须关掉。
        // 光靠样式表不够：页面里还活着的旧实例会把它改成 auto，
        // 而且它一改，浏览器就会在内容变化时"补偿"性地跳位。所以内联加 !important 钉死。
        const chatEl0 = getHostDocument().getElementById('chat');
        if (chatEl0) chatEl0.style.setProperty('overflow-anchor', 'none', 'important');
        st.textContent = `
            /* 关掉原生锚定：我们会自己冻结/回写 scrollTop，
               开着的话浏览器也会偷偷改 scrollTop，两边打架就会出现"往回跳" */
            #chat { overflow-anchor: none !important; scroll-behavior: auto; }
            #chat .mes.th-novel-active-floor { border-left: 3px solid #89b4fa !important; }
            #chat > .th-novel-sentinel {
                /* #chat 是 flex 列，默认会被压缩，必须固定住 */
                flex: 0 0 auto !important;
                width: 100%;
                display: block;
                min-height: 1px;
                pointer-events: none;
            }
            body.th-novel-lock-swipe #chat .mes .swipe_left,
            body.th-novel-lock-swipe #chat .mes .swipe_right,
            body.th-novel-lock-swipe #chat .mes .swipes-counter {
                display: none !important; pointer-events: none !important; visibility: hidden !important;
            }
            body.th-novel-pure-mode #top-bar,
            body.th-novel-pure-mode #top-settings-holder,
            body.th-novel-pure-mode #form_sheld,
            body.th-novel-pure-mode #send_form,
            body.th-novel-pure-mode .TH-script-buttons,
            body.th-novel-pure-mode #qr--bar { display: none !important; }
            body.th-novel-pure-mode #chat {
                height: 100dvh !important; max-height: 100dvh !important;
                padding-top: 8px !important; padding-bottom: 40px !important;
            }
            .th-nv-btn {
                background: #313244; color: #cdd6f4; border: 1px solid #45475a;
                border-radius: 6px; padding: 4px 9px; font-size: 11px; cursor: pointer;
            }
            .th-nv-btn:hover { background: #45475a; color: #fff; }
            .th-nv-btn.primary { background: #a6e3a1; color: #11111b; border: none; font-weight: 700; }
            .th-nv-btn.danger { background: #f38ba8; color: #11111b; border: none; font-weight: 700; }
            .th-nv-btn.blue { background: #89b4fa; color: #11111b; border: none; font-weight: 700; }
            .th-nv-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
            .th-nv-input {
                background: #1e1e2e; color: #fff; border: 1px solid #45475a;
                border-radius: 6px; padding: 6px 9px; font-size: 12px;
            }
        `;
        st.textContent += `
            #th-novel-panel { --nv-ink:#e2edf6; --nv-muted:#a2b6c9; --nv-edge:#344b61; --nv-accent:#73d7cf; color-scheme:dark; padding:20px !important; }
            #th-novel-panel * { box-sizing:border-box; }
            #th-novel-panel .th-nv-card { max-width:880px !important; height:min(92dvh,960px) !important; background:#142537 !important; color:var(--nv-ink) !important; border:1px solid var(--nv-edge) !important; border-radius:18px !important; box-shadow:0 24px 90px #0008 !important; }
            #th-novel-panel .th-nv-head { padding:12px 16px !important; background:#102031 !important; border-color:var(--nv-edge) !important; flex-shrink:0; }
            #th-novel-panel .th-nv-head > .th-nv-row { flex-wrap:nowrap; gap:4px; overflow-x:auto; }
            #th-novel-panel .th-nv-head [aria-selected="true"] { background:#73d7cf !important; color:#102b38 !important; }
            #th-novel-panel .th-nv-btn { min-height:40px; padding:8px 12px; border:1px solid var(--nv-edge); border-radius:9px; background:#233c53; color:var(--nv-ink); font-size:13px; line-height:1.25; font-weight:600; touch-action:manipulation; }
            #th-novel-panel .th-nv-btn:hover { background:#35536d; }
            #th-novel-panel .th-nv-btn.primary { background:#73d7cf; color:#102b38; }
            #th-novel-panel .th-nv-btn.blue { background:#a9ccef; color:#152b40; }
            #th-novel-panel .th-nv-btn.danger { background:#efb3b7; color:#422432; }
            #th-novel-panel .th-nv-btn:disabled { opacity:.45; cursor:wait; }
            #th-novel-panel :is(button,input,select,summary):focus-visible { outline:3px solid #73d7cf; outline-offset:2px; }
            #th-novel-panel .th-nv-input { min-height:40px; max-width:100%; min-width:0; border:1px solid var(--nv-edge); background:#102031; color:var(--nv-ink); border-radius:8px; font-size:14px; }
            #th-novel-panel .th-nv-toolbar { background:#142537; border-bottom:1px solid var(--nv-edge); padding:16px; display:flex; flex-direction:column; gap:12px; flex-shrink:0; max-height:52%; overflow-y:auto; }
            #th-novel-panel .th-nv-booktitle { font:600 21px/1.35 "Noto Serif SC","Source Han Serif SC","Songti SC",serif; margin:0 0 5px; color:#e2edf6; overflow-wrap:anywhere; }
            #th-novel-panel .th-nv-summary { font-size:12px; color:var(--nv-muted); line-height:1.6; }
            #th-novel-panel .th-nv-tools summary { cursor:pointer; color:#a9ccef; padding:8px 0; font-size:13px; }
            #th-novel-panel .th-nv-toolbody { display:grid; gap:10px; padding-top:8px; }
            #th-novel-panel .th-nv-toolbody .th-nv-row { gap:8px; }
            #th-novel-panel .th-nv-label { font-size:12px; color:var(--nv-muted); }
            #th-novel-panel #toc-search { width:100%; }
            #th-novel-panel .th-nv-dock { padding:12px 16px; border-top:1px solid var(--nv-edge); background:#102031; flex-shrink:0; display:flex; flex-direction:column; gap:8px; }
            #th-novel-panel .th-nv-actions { display:grid; grid-template-columns:1fr 1.25fr auto; gap:8px; }
            #th-novel-panel #toc-queue-status { color:var(--nv-muted); font-size:12px; line-height:1.45; overflow-wrap:anywhere; }
            #th-novel-panel #th-novel-toc-list { min-height:90px; padding:10px 16px !important; overscroll-behavior:contain; scrollbar-width:thin; }
            #th-novel-panel #th-novel-toc-list > [data-idx] { flex-wrap:nowrap; min-height:56px; background:#192e42 !important; border-color:#2d455b !important; border-radius:9px !important; color:#e2edf6 !important; padding:9px !important; font-size:13px !important; margin-left:0 !important; flex-shrink:0; }
            #th-novel-panel #th-novel-toc-list > [data-selected="true"] { background:#244c58 !important; border-color:#73d7cf !important; }
            #th-novel-panel #th-novel-toc-list > [aria-current="true"] { border-left:3px solid #a9ccef !important; }
            #th-novel-panel .th-nv-chk { width:22px !important; height:22px !important; accent-color:#73d7cf; margin:4px; }
            #th-novel-panel .th-nv-chapter { background:#102031 !important; color:#bcd5eb !important; border-left-color:#54819e !important; min-height:48px; flex-shrink:0; }
            #th-novel-panel .th-nv-fold { width:30px !important; padding:10px 0; }
            #th-novel-panel [data-gen], #th-novel-panel [data-chaptergen] { background:#c2d4e5 !important; color:#183044 !important; }
            @media(max-width:600px) {
                #th-novel-panel { padding:0 !important; }
                #th-novel-panel .th-nv-card { max-width:100% !important; height:100dvh !important; border-radius:0 !important; border:none !important; padding-top:env(safe-area-inset-top); padding-bottom:env(safe-area-inset-bottom); }
                #th-novel-panel .th-nv-head { padding:8px !important; gap:4px !important; }
                #th-novel-panel .th-nv-head .th-nv-btn { padding:8px; font-size:12px; white-space:nowrap; }
                #th-novel-panel .th-nv-toolbar { padding:12px; max-height:46%; gap:8px; }
                #th-novel-panel .th-nv-booktitle { font-size:19px; }
                #th-novel-panel .th-nv-btn { min-height:44px; }
                #th-novel-panel .th-nv-dock { padding:10px 12px; }
                #th-novel-panel #th-novel-toc-list { padding:8px 12px !important; }
                #th-novel-panel [data-idx] > .th-nv-length { display:none; }
                #th-novel-panel [data-idx] > .th-nv-chunktitle { white-space:normal !important; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
                #th-novel-panel .th-nv-actions { grid-template-columns:1fr 1fr; }
                #th-novel-panel #toc-stop { grid-column:1/-1; }
            }
            @media(prefers-reduced-motion:reduce) { #th-novel-panel * { scroll-behavior:auto !important; transition:none !important; } }
`;
        if (doc.body) {
            doc.body.classList.toggle('th-novel-lock-swipe', Boolean(settings.lockSwipeReroll));
            doc.body.classList.toggle('th-novel-pure-mode', Boolean(settings.pureMode));
        }
    }

    // ============ 滚动引擎 ============
    // freezeDepth > 0 时吞掉 scrollTop 写入；退出冻结立刻按冻结前的值写回。
    let freezeDepth = 0;
    let frozenTop = 0;
    // 后台/预生图期间视口锚定保护：禁止宿主 updateMessageBlock / scrollChatToBottom 把读者正在看的页面拽走
    let bgGenScrollLockDepth = 0;
    let bgGenAnchor = null;
    let bgGenAnchorTop = 0;
    let smoothTarget = null;
    let smoothUntil = 0;
    let restoreRaf = 0;
    let jumpFollowRaf = 0;
    // 每次跳转递增；上一轮的 follow 循环看到代数变了就自行退出，免得互相踩
    let jumpGen = 0;
    // 用户已经自己动手，后续补检不许再把他拽回去
    let userTookOver = false;
    // 读者正贴着底部读：这段时间铺楼要一直贴住底部，别再拿锚点复位
    let bottomStickUntil = 0;
    // 贴底时真正要守住的位置：追加前那一刻的视口顶端。
    // 追加后如果直接贴到新的底部，看到的是新楼层的空壳（占位高度），屏幕一片空白；
    // 守在原处，读者的视线刚好落在新楼层开头，跟往下翻一样自然。
    let bottomHoldTop = 0;
    // 跳转跟随窗口进行中
    function jumping() { return jumpGuardUntil > 0 && nowMs() < jumpGuardUntil; }

    function STK() { return ((new Error().stack || '').split(String.fromCharCode(10)).slice(2, 6) || []).map(x => x.trim().replace(/https?:\/\/[^/]+\//, '').slice(0, 60)).join(' << '); }

    function findScrollTopDescriptor(el) {
        let proto = Object.getPrototypeOf(el);
        while (proto) {
            const d = Object.getOwnPropertyDescriptor(proto, 'scrollTop');
            if (d && d.get && d.set) return d;
            proto = Object.getPrototypeOf(proto);
        }
        return null;
    }

    function getChatEl() { return getHostDocument().getElementById('chat'); }

    function rawTop(el) {
        try { return el.scrollTop; } catch (e) { return 0; }
    }

    // 我们自己在写 scrollTop 时置位，避免被自己的守卫吞掉
    let writingSelf = false;
    // 刚写进去的值与时刻：用来把"浏览器回写/回声"和"读者真的在滑"分开
    let lastSelfTop = -1;
    let lastSelfAt = 0;
    // 跳转跟随窗口内，外部写入一律让位给 follow 循环
    let jumpGuardUntil = 0;
    // 最后一次真实手势（touchstart/mousedown/wheel）的时刻。
    // 跟随窗口里只有它能把控制权抢回去：程序化滚动、宿主的 ResizeObserver 贴底
    // 都会产生"外部写入"，但都不是读者在翻页，跟随一旦被它们打断就再也回不到目标。
    let lastGestureAt = 0;
    function noteGesture() { lastGestureAt = nowMs(); }
    // 内容刚刚变高的时刻。宿主贴底就是在这个时机发生的（ResizeObserver），
    // 与"读者自己滚到底"可以用这个时间差分开。
    let lastGrowAt = 0;

    // 我们最后一次写 scrollTop 的时刻。滚动监听要靠它区分"自己写的位移"和读者滑动。
    let lastSelfWriteAt = 0;
    function selfWriteAt() { return lastSelfWriteAt; }

    function setTopRaw(el, v) {
        lastSelfWriteAt = Date.now();
        writingSelf = true;
        lastSelfTop = Math.round(v);
        lastSelfAt = nowMs();
        try { if (dbgOn()) (getHostWindow().__st2 = getHostWindow().__st2 || []).push(Math.round(rawTop(el)) + '->' + Math.round(v) + ' || ' + String(new Error().stack || '').split(String.fromCharCode(10)).slice(2, 6).map(x => x.trim().replace(/https?:\/\/[^/]+\//, '').slice(0, 55)).join(' < ')); } catch (e2) { }
        try {
            const d = findScrollTopDescriptor(el);
            if (d && d.set) d.set.call(el, v); else el.scrollTop = v;
        } catch (e) { }
        writingSelf = false;
    }

    function installChatHooks() {
        const doc = getHostDocument();
        const chatEl = doc.getElementById('chat');
        if (!chatEl) return;
        // 被顶掉的实例收手：它的 boot 还在往下走，会再调到这里，
        // 把活实例刚装好的 setter 夺过去。
        if (isDead()) return;
        // 这里的 "已装过" 必须认主人：酒馆会把同一份脚本再跑一遍，
        // 上一个实例的 dataset 标记和它自己的 setter 闭包都还在，
        // 新实例如果按旧标记直接 return，自己的 follow 循环就永远拿不到
        // "外部写入" 的通知（哨兵观察器也挂在函数末尾，一并装不上）。
        const token = INST + '/' + MY_GEN;
        if (chatEl.dataset.thNovelHooksV6 === token) return;
        const desc = findScrollTopDescriptor(chatEl);
        if (!desc) return;
        if (chatEl.dataset.thNovelHooksV6) {
            // 有人在元素上直接定义了访问器：先摘掉，退回原型上的那份，
            // 否则会一层层套娃，旧实例的闭包也跟着一起跑。
            try { delete chatEl.scrollTop; } catch (e) { }
        }
        chatEl.dataset.thNovelHooksV6 = token;

        try {
            Object.defineProperty(chatEl, 'scrollTop', {
                configurable: true,
                enumerable: true,
                get() { return desc.get.call(this); },
                set(v) {
                    try { if (dbgOn()) { const w = getHostWindow(); w.__sw = w.__sw || []; if (w.__sw.length > 300) w.__sw.splice(0, 150); w.__sw.push('T fz=' + freezeDepth + ' self=' + writingSelf + ' jg=' + Math.round(jumpGuardUntil - nowMs()) + ' ' + Math.round(desc.get.call(this)) + '->' + Math.round(v) + ' ' + String(new Error().stack || '').split(String.fromCharCode(10)).slice(2, 5).map(x => x.trim().replace(/https?:\/\/[^/]+\//, '').slice(0, 60)).join(' < ')); } } catch (e9) { }
                    if (freezeDepth > 0) return; // 冻结期间一切写入作废，出来后统一写回
                    // 后台/预生图期间：若不是读者手势触发的滚动，一律吞掉外部对 scrollTop 的跳转写入，保持当前视口纹丝不动
                    if (!writingSelf && (bgGenScrollLockDepth > 0 || queueRunning) && nowMs() - lastGestureAt > 450) {
                        return;
                    }
                    // 宿主自带的"贴底"逻辑会在 ResizeObserver 里把视口往底部拽；
                    // 跳转跟随期间让它写，落点就会被一点点推走。这里吞掉，
                    // 由 follow 循环按目标几何重摆（用户一动手就恢复让位）。
                    if (!writingSelf && jumpGuardUntil > 0 && !userTookOver && nowMs() < jumpGuardUntil) {
                        // 外部写入不是全都该丢：读者自己滑、或 ST 的贴底把它推开了很远，
                        // 直接吞掉会让视口僵在原地。这里记下来，下一帧把它当成"新落点"采纳。
                        if (Math.abs(v - rawTop(this)) > 24) pendingExternalTop = v;
                        if (!reassertQueued) {
                            reassertQueued = true;
                            requestAnimationFrame(() => {
                                reassertQueued = false;
                                if (pendingExternalTop !== null) { const p = pendingExternalTop; pendingExternalTop = null; adoptExternalTop(p); }
                                else reassertJump();
                            });
                        }
                        return;
                    }
                    if (Math.abs(v - desc.get.call(this)) > 120) {
                        try { if (dbgOn()) (getHostWindow().__ext = getHostWindow().__ext || []).push('fz=' + freezeDepth + ' jg=' + Math.round(jumpGuardUntil - nowMs()) + ' uto=' + userTookOver + ' ' + Math.round(desc.get.call(this)) + '->' + Math.round(v) + ' sh=' + this.scrollHeight + ' || ' + String(new Error().stack || '').split(String.fromCharCode(10)).slice(2, 6).map(x => x.replace(/.*at /, '')).join(' < ')); } catch (e) { }
                    }
                    desc.set.call(this, v);
                }
            });
        } catch (e) { try { delete chatEl.dataset.thNovelHooksV6; } catch (err) { } return; }

        // 拦截宿主或生图插件在生图完成/切换楼层时直接调用 chatEl.scrollTo / scrollBy / scrollIntoView（它们会绕过 scrollTop setter 导致跳楼层！）
        try {
            if (!chatEl.__thOrigScrollTo && typeof chatEl.scrollTo === 'function') {
                chatEl.__thOrigScrollTo = chatEl.scrollTo.bind(chatEl);
                chatEl.scrollTo = function (...args) {
                    if (!writingSelf && (freezeDepth > 0 || ((bgGenScrollLockDepth > 0 || queueRunning) && nowMs() - lastGestureAt > 450 && smoothTarget === null && jumpGuardUntil <= nowMs()))) {
                        return;
                    }
                    return chatEl.__thOrigScrollTo(...args);
                };
            }
            if (!chatEl.__thOrigScrollBy && typeof chatEl.scrollBy === 'function') {
                chatEl.__thOrigScrollBy = chatEl.scrollBy.bind(chatEl);
                chatEl.scrollBy = function (...args) {
                    if (!writingSelf && (freezeDepth > 0 || ((bgGenScrollLockDepth > 0 || queueRunning) && nowMs() - lastGestureAt > 450 && smoothTarget === null && jumpGuardUntil <= nowMs()))) {
                        return;
                    }
                    return chatEl.__thOrigScrollBy(...args);
                };
            }
            const win = getHostWindow();
            if (win && win.Element && win.Element.prototype && !win.Element.prototype.__thOrigScrollIntoView) {
                const origSiv = win.Element.prototype.scrollIntoView;
                win.Element.prototype.__thOrigScrollIntoView = origSiv;
                win.Element.prototype.scrollIntoView = function (...args) {
                    try {
                        if ((freezeDepth > 0 || bgGenScrollLockDepth > 0 || queueRunning) && this && this.closest && this.closest('#chat')) {
                            return;
                        }
                    } catch (e) { }
                    return origSiv.apply(this, args);
                };
                teardowns.push(() => {
                    try {
                        if (win.Element.prototype.__thOrigScrollIntoView) {
                            win.Element.prototype.scrollIntoView = win.Element.prototype.__thOrigScrollIntoView;
                            delete win.Element.prototype.__thOrigScrollIntoView;
                        }
                    } catch (e) { }
                });
            }
        } catch (e) { }

        initialiseSentinel();
    }

    // 冻结期间锚定一个可见楼层；结束后按"锚点相对视口的位置"复位。
    // 只记 scrollTop 不行：手机上惯性还在跑，冻结时记下的值已经落后于手指。
    function pickAnchor(chatEl) {
        const chatTop = chatEl.getBoundingClientRect().top;
        let best = null;
        for (const el of chatEl.querySelectorAll(':scope > .mes')) {
            const r = el.getBoundingClientRect();
            if (r.bottom < chatTop + 8) continue;
            best = { el, offset: r.top - chatTop };
            break;
        }
        return best;
    }

    // 新楼层正文是异步提交的，未提交前它只有空壳高度，总高会瞬间变小、
    // 浏览器随即把 scrollTop 钳回去。先按上一层的等高撑住，等内容到位再撤掉。
    // 占位高度至少给到接近一屏：读者贴在底部时，追加的空壳如果只有小半屏，
    // 会立刻又满足"离底 < 400"，于是一口气连着追加十几层，屏幕上全是空白。
    // 撑满一屏后，追加完离底就有一屏多远，要等读者真的滑下来才会再补。
    function holdHeightUntilContent(el, fallbackH) {
        if (!el) return;
        const chatEl = getChatEl();
        const wantView = chatEl ? Math.round(viewHOf(chatEl) * 1.02) : 0;
        const h = Math.max(120, Math.round(fallbackH || 0), wantView);
        el.style.minHeight = h + 'px';
        let ro = null;   // 必须在 release 之前声明：release 会引用它
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            el.style.minHeight = '';
            if (ro) { try { ro.disconnect(); } catch (e) { } }
        };
        if (typeof ResizeObserver !== 'function') { setTimeout(release, 1500); return; }
        let stable = 0;
        ro = new ResizeObserver(() => {
            // 内容撑到占位高度以上就说明已经提交完成
            if (el.scrollHeight >= h - 2) {
                stable++;
                if (stable >= 2) release();
            } else {
                stable = 0;
            }
        });
        try { ro.observe(el); } catch (e) { }
        setTimeout(release, 2500);
    }

    let pinnedAnchor = null;

    function withFrozenScroll(fn) {
        const DBG = (m) => { try { if (dbgOn()) (getHostWindow().__fl = getHostWindow().__fl || []).push(m); } catch (e) { } };
        const dTop0 = getChatEl() ? rawTop(getChatEl()) : -1;
        DBG('freeze-in top=' + dTop0);
        const chatEl = getChatEl();
        if (!chatEl) { try { fn(); } catch (e) { } return; }
        const fallbackTop = rawTop(chatEl);
        const anchor = pickAnchor(chatEl);
        pinnedAnchor = anchor;
        const prevH = chatEl.scrollHeight;
        // 读者本来就贴在底部：铺楼后要继续贴着底部，按锚点复位反而会把他
        // 提到"上次铺楼那一节"的位置（这就是读到一半自己跳回上面）。
        const wasBottom = prevH - fallbackTop - chatEl.clientHeight <= 40;
        if (wasBottom) { bottomStickUntil = nowMs() + 1600; bottomHoldTop = fallbackTop; }
        freezeDepth++;
        try { fn(); } catch (e) { } finally {
            freezeDepth--;
            const lost = prevH - chatEl.scrollHeight;
            if (lost > 0) { compPx += lost; applyTail(); }
            // 读者本来就贴在底部：铺楼后要继续贴着底部。按锚点复位会把内容
            // 重新钉回原处，而尾部余量这时正在缩短，画面就会被往上一提
            // （手机上就是"读到一半自己跳回上面"）。
            // 这里不看 userTookOver：读者一直贴着底部，无论他是不是刚动过手指。
            // 落点用"追加前那一刻的顶端"：它下面刚好接上新楼层，而不是新楼层的底部。
            if (wasBottom) setTopRaw(chatEl, Math.min(bottomHoldTop, chatEl.scrollHeight - chatEl.clientHeight));
            else correctToAnchor(chatEl, anchor, fallbackTop);
            frozenTop = rawTop(chatEl);
            DBG('freeze-out top=' + frozenTop + ' anchorOff=' + (anchor ? Math.round(anchor.offset) : 'x'));
            startPin(anchor, 1200);
        }
    }

    async function withBgGenScrollLock(fn) {
        installChatHooks();
        jumpGen++;
        stopJumpHold();
        stopLanding();
        stopPin();
        bgGenScrollLockDepth++;
        try {
            return await fn();
        } finally {
            bgGenScrollLockDepth = Math.max(0, bgGenScrollLockDepth - 1);
            if (bgGenScrollLockDepth === 0) bgGenAnchor = null;
        }
    }

    // 按锚点的绝对位置算目标 scrollTop。
    // 用绝对值而不是"当前值 + 差值"：内容塌陷时浏览器会把 scrollTop 钳小，
    // 差值法在这种情况下算不出要补多少。
    function anchorTarget(chatEl, anchor) {
        const chatTop = chatEl.getBoundingClientRect().top;
        const absTop = anchor.el.getBoundingClientRect().top - chatTop + chatEl.scrollTop;
        return absTop - anchor.offset;
    }

    function correctToAnchor(chatEl, anchor, fallbackTop) {
        if (!chatEl) return;
        // 读者贴在底部时，铺楼期间任何"按锚点复位"都会把他往上提
        // （锚点在内容里，新内容都加在下面）。这段时间统一按贴底处理。
        if (bottomStickUntil > nowMs() && !jumping()) {
            const bottom = chatEl.scrollHeight - chatEl.clientHeight;
            // 同样守在追加前的位置，而不是一路贴到新底（贴底看到的是空壳）
            const want = Math.max(0, Math.min(bottomHoldTop, bottom));
            if (Math.abs(want - chatEl.scrollTop) > 1) setTopRaw(chatEl, want);
            frozenTop = rawTop(chatEl);
            return;
        }
        if (anchor && anchor.el.isConnected) {
            const want = anchorTarget(chatEl, anchor);
            const max = chatEl.scrollHeight - chatEl.clientHeight;
            const clamped = Math.max(0, Math.min(want, Math.max(0, max)));
            try { if (dbgOn()) (getHostWindow().__cor = getHostWindow().__cor || []).push('cor want=' + Math.round(want) + ' clamp=' + Math.round(clamped) + ' cur=' + Math.round(chatEl.scrollTop) + ' max=' + Math.round(max) + ' sh=' + chatEl.scrollHeight + ' ch=' + chatEl.clientHeight); } catch (e) { }
            if (Math.abs(clamped - chatEl.scrollTop) > 1) setTopRaw(chatEl, clamped);
        } else if (typeof fallbackTop === 'number') {
            setTopRaw(chatEl, fallbackTop);
        }
    }

    // 追加后的一段时间里持续把锚点钉在原地。
    // TauriTavern 的正文是异步提交的：新楼层会先以空壳高度插入、随后才撑开，
    // 空壳那一帧总高比原来还小，浏览器就会把 scrollTop 钳回去。
    // 用 ResizeObserver 盯住每次高度变化，只补"往上缩"的量，从不往回拉。
    let pinObserver = null;
    let pinTimer = 0;

    function stopPin() {
        if (pinObserver) { try { pinObserver.disconnect(); } catch (e) { } pinObserver = null; }
        if (pinTimer) { clearTimeout(pinTimer); pinTimer = 0; }
        if (restoreRaf) { cancelAnimationFrame(restoreRaf); restoreRaf = 0; }
        pinnedAnchor = null;
    }

    function startPin(anchor, ms) {
        const chatEl = getChatEl();
        stopPin();
        if (!chatEl || !anchor || !anchor.el.isConnected) return;
        if (typeof ResizeObserver !== 'function') { scheduleReassert(6); return; }

        // 关键：只有"内容高度变了"才补偿。
        // 用户自己在拖的时候高度没变，这时回写会把他的手感拽回去（就是往回跳）。
        let lastH = chatEl.scrollHeight;
        const fix = () => {
            if (!anchor.el.isConnected) { stopPin(); return; }
            const h = chatEl.scrollHeight;
            if (h === lastH) return;
            lastH = h;
            // 读者已经滑到别处去了：原来的锚点这时往往在视口外很远，
            // 照着它复位等于把画面拽回上一次铺楼的位置。
            // 贴底时按"贴底"补，否则换一个当前可见的楼层当锚点。
            if (userTookOver) {
                const atBottom = h - rawTop(chatEl) - chatEl.clientHeight <= 12;
                const cr = chatEl.getBoundingClientRect();
                const ar = anchor.el.getBoundingClientRect();
                const offScreen = ar.bottom < cr.top || ar.top > cr.bottom;
                if (atBottom) {
                    // 守在原位而不是贴新底：贴新底看到的是刚插进来的空壳
                    const want = Math.max(0, Math.min(bottomHoldTop || (h - chatEl.clientHeight), h - chatEl.clientHeight));
                    setTopRaw(chatEl, want);
                    frozenTop = rawTop(chatEl);
                    return;
                }
                if (offScreen) {
                    const neu = pickAnchor(chatEl);
                    if (neu) { pinnedAnchor = neu; anchor = neu; }
                }
            }
            correctToAnchor(chatEl, anchor, null);
            frozenTop = rawTop(chatEl);
        };
        pinObserver = new ResizeObserver(fix);
        try { pinObserver.observe(chatEl); } catch (e) { }
        for (const child of chatEl.children) {
            try { pinObserver.observe(child); } catch (e) { }
        }
        fix();
        // 再补几帧（RO 只在尺寸真的变化时回调，视觉抖动可能早于一次静置）
        scheduleReassert(4);
        pinTimer = setTimeout(stopPin, Math.max(400, ms || 900));
    }

    // 兜底：没有 RO 时逐帧校准几次
    function scheduleReassert(frames) {
        const chatEl = getChatEl();
        if (!chatEl) return;
        if (restoreRaf) cancelAnimationFrame(restoreRaf);
        const anchor = pinnedAnchor;
        let left = Math.max(1, frames || 1);
        const step = () => {
            restoreRaf = 0;
            if (smoothTarget !== null) { left = 0; return; }
            if (left <= 0) return;
            correctToAnchor(chatEl, anchor, null);
            left--;
            frozenTop = rawTop(chatEl);
            if (left > 0) restoreRaf = requestAnimationFrame(step);
        };
        restoreRaf = requestAnimationFrame(step);
    }

    function floorTopOffset(chatEl, mesEl) {
        if (!chatEl || !mesEl) return 0;
        const cr = chatEl.getBoundingClientRect();
        const mr = mesEl.getBoundingClientRect();
        return Math.max(0, Math.round(rawTop(chatEl) + (mr.top - cr.top) - 4));
    }

    // 尾部余量：让靠后的楼层也能滚到视口顶端
    let tailPx = 0;

    // 余量被缩短、而视口正好在可滚范围末端时，浏览器会顺手把 scrollTop 钳下来。
    // 跟随窗口里这就是"落点一路往上飘"的直接原因，所以缩之前先把视口垫到新末端。
    function avoidClamp() {
        const chatEl = getChatEl();
        if (!chatEl) return;
        const max = chatEl.scrollHeight - chatEl.clientHeight;
        const top = rawTop(chatEl);
        if (top > max + 1) setTopRaw(chatEl, max);
    }
    // 追加楼层时新节点会先塌陷一帧，浏览器随即把 scrollTop 钳回去。
    // 用这段临时 padding 把"塌陷掉的高度"补回来，钳位就不会发生。
    let compPx = 0;

    // #chat 的 clientHeight 会被 padding 污染，视口高要取它的父容器
    function viewHOf(chatEl) {
        const p = chatEl && chatEl.parentElement;
        const h = p ? p.clientHeight : 0;
        return h > 60 ? h : (chatEl ? Math.min(chatEl.clientHeight || 600, 900) : 600);
    }

    function applyTail() {
        const chatEl = getChatEl();
        if (!chatEl) return;
        // padding 只留给"临时补偿"，其余余量挂哨兵。
        // 但 #chat 是 content-box（max-height 只约束内容盒），padding 会同时撑大
        // clientHeight 和 scrollHeight：只加不减的话，几十次铺楼就能把它堆到几千像素，
        // 视口里全是这块空白（看起来就是"划到底一片空白还一直加载"）。所以它必须会自己退。
        chatEl.style.setProperty('padding-bottom', Math.max(0, Math.round(compPx)) + 'px', 'important');
        const s = sentinelFor((getHostDocument().getElementById('th-novel-sentinel') || {}).dataset?.nextIdx || 0);
        if (s) s.style.height = Math.max(0, Math.round(tailPx)) + 'px';
        if (compPx > 0) {
            if (compTimer) clearTimeout(compTimer);
            compTimer = setTimeout(releaseComp, 900);
        }
    }

    // 正文都提交完了就把临时补偿撤掉；撤的时候按钳位量补 scrollTop，画面不动
    let compTimer = 0;
    function releaseComp() {
        compTimer = 0;
        const chatEl = getChatEl();
        if (!chatEl || compPx <= 0) return;
        const top = rawTop(chatEl);
        const shrink = Math.round(compPx);
        compPx = 0;
        chatEl.style.setProperty('padding-bottom', '0px', 'important');
        const afterMax = Math.max(0, chatEl.scrollHeight - chatEl.clientHeight);
        const want = Math.min(top, afterMax);
        if (Math.abs(rawTop(chatEl) - want) > 1) setTopRaw(chatEl, want);
    }

    function setTail(px) {
        tailPx = Math.max(0, Math.round(px));
        applyTail();
    }

    // 文末需要多少可滚动余量，取决于最后一层有多高：
    // 要让最后一层能滚到视口顶端，余量就得补上"视口高 - 这一层高"。
    // 按一屏死给会让短楼层下面挂一大片空白，按这个算则空白始终刚好够用。
    function tailNeed(chatEl, extra) {
        const viewH = viewHOf(chatEl);
        let lastH = 0;
        try {
            const kids = chatEl.querySelectorAll(':scope > .mes');
            const last = kids[kids.length - 1];
            if (last) lastH = Math.round(last.getBoundingClientRect().height);
        } catch (e) { lastH = 0; }
        const fit = Math.max(0, Math.round(viewH - lastH + 16));
        return Math.max(Math.round(extra || 0), fit, 160);
    }

    function ensureTail(extra) {
        const chatEl = getChatEl();
        if (!chatEl) return;
        const need = tailNeed(chatEl, extra);
        if (need > tailPx) {
            tailPx = need;
            applyTail();
        }
    }

    // 目标楼的最终落点。正文是异步提交的，几何会变，所以每次都用当前位置重算。
    // 目标楼的绝对位置（与底部 padding 无关），并保证下方有足够余量。
    // 余量按"需要多少"算绝对值，不能每次累加——跟随循环每帧都会调用它。
    function targetForFloor(chatEl, el) {
        const wanted = floorTopOffset(chatEl, el);
        // 内容真实高度（去掉我们加的余量）
        const contentH = chatEl.scrollHeight - tailPx;
        const needed = wanted - (contentH - viewHOf(chatEl)) + 24;
        // 直接写成绝对值，封顶按"这一层要能顶到视口顶部"来算：
        // 余量比这更大时读者一贴到底只会看到空白，比这更小时目标层顶不上去。
        const viewH = viewHOf(chatEl);
        const elH = Math.round(el.getBoundingClientRect().height);
        const cap = Math.max(160, Math.round(viewH - Math.min(elH, viewH - 40) + 16));
        // 跳转期间下方多是占位高度，成文后一起缩回，scrollHeight 一缩浏览器就把
        // scrollTop 钳下来，落点整体上移（目标被推到视口上方）。这段时间垫住下限。
        const minTail = jumping() ? Math.round(viewH * 0.8) : 0;
        const want = Math.max(Math.round(needed), minTail);
        setTailSafe(Math.max(0, Math.min(want, Math.max(cap, minTail))));
        return wanted;
    }

    // 改尾巴余量。余量挂在内容下方：
    //  - 变小时，只要没滚到底，视口本来就不会动，只有被钳位的那部分才需要补；
    //    （以前无条件把 scrollTop 减去缩小量，每铺一节就把画面往上提几百像素，
    //     读者在手机上正往上滑的时候就会"莫名其妙跳回上面"）
    //  - 到底时干脆先不缩，免得把贴在底部的人拽离底部。
    function setTailSafe(next) {
        const chatEl = getChatEl();
        if (!chatEl) { tailPx = next; return; }
        if (Math.abs(next - tailPx) < 1) return;
        const before = tailPx;
        const top = rawTop(chatEl);
        const maxBefore = chatEl.scrollHeight - chatEl.clientHeight;
        const atBottom = maxBefore - top <= 80;
        if (next < before && atBottom) return;
        const shrink = Math.max(0, before - next);
        const afterMax = Math.max(0, (chatEl.scrollHeight - shrink) - chatEl.clientHeight);
        tailPx = next;
        applyTail();
        // 只在会因为变短被钳住时，才把视口按钳位量挪回来（视觉上等于没动）
        const want = Math.min(top, afterMax);
        if (Math.abs(rawTop(chatEl) - want) > 1) setTopRaw(chatEl, want);
    }

    // 等目标楼层的内容提交完（高度不再变），再滚。
    // 不等就滚，落点会按"空壳高度"算出来，等正文铺开后目标就跑偏了。
    // 等整段聊天的总高度稳定。只看目标楼不够——它上面的楼层还在异步写正文，
    // 那些楼层一旦撑开就会把目标往下顶。
    function waitFloorSettled(el, budgetMs) {
        return new Promise(resolve => {
            const doc = getHostDocument();
            if (isRealDocHidden()) {
                sleep(80).then(resolve);
                return;
            }
            const chatEl = getChatEl();
            const maxWait = budgetMs || 1200;
            const deadline = nowMs() + maxWait;
            let last = -1;
            let stable = 0;
            let finished = false;
            const done = () => { if (finished) return; finished = true; clearTimeout(guard); resolve(); };
            const guard = setTimeout(done, maxWait + 120);
            const scheduleNext = (fn) => {
                if (doc && (doc.hidden || doc.visibilityState === 'hidden')) setTimeout(fn, 40);
                else requestAnimationFrame(fn);
            };
            const tick = () => {
                if (finished) return;
                if (!chatEl || !el.isConnected) return done();
                if (doc && (doc.hidden || doc.visibilityState === 'hidden')) return done();
                const h = chatEl.scrollHeight;
                if (Math.abs(h - last) < 2) stable++; else stable = 0;
                last = h;
                if (stable >= 8 || nowMs() > deadline) return done();
                scheduleNext(tick);
            };
            scheduleNext(tick);
        });
    }

    // 跳转 = 等布局稳定 → 滚一次 → 之后由 ResizeObserver 钉住。
    // 不再用"逐帧判断是否稳定"的启发式：正文是异步写进来的，
    // 逐帧判断很容易在空窗期误判为已稳定而提前收手。
    // 酒馆只把最近百来层挂在 DOM 上（懒加载）。跳到远处的节时，目标节点
    // 根本不存在，硬查必然落空。这里按"挂载区间 + 平均层高"估个位置滚过去，
    // 让宿主把那段挂出来，几次就能收敛到真正需要的楼层。
    async function ensureFloorMounted(mesId, budgetMs, expectedJumpGen) {
        const doc = getHostDocument();
        const chatEl = doc.getElementById('chat');
        if (!chatEl) return false;
        const ctx = getSTContext();
        syncMountedMesDom(chatEl, ctx && ctx.chat);
        const find = () => doc.querySelector('#chat .mes[mesid="' + mesId + '"]');
        if (find()) return true;

        const maxBudget = Math.min(budgetMs || 4000, 6000);
        const deadline = nowMs() + maxBudget;
        let stepCount = 0;

        while (nowMs() < deadline && !isDead()) {
            if (expectedJumpGen !== undefined && expectedJumpGen !== jumpGen) return false;
            stepCount++;
            const totalMsgs = Math.max(1, (ctx && Array.isArray(ctx.chat)) ? ctx.chat.length : 1);
            const allKids = [...chatEl.querySelectorAll(':scope > .mes')];
            // 针对安卓 TauriTavern 的 V ∪ T 虚拟列表：排除与视口 V 不连续的孤立尾部节点 T，才能算准当前视口 V 的真实上下界！
            const vKids = allKids.filter((el, idx) => {
                if (idx === allKids.length - 1 && idx > 0) {
                    const curId = Number(el.getAttribute('mesid'));
                    const prevId = Number(allKids[idx - 1].getAttribute('mesid'));
                    if (Number.isFinite(curId) && Number.isFinite(prevId) && curId > prevId + 1) return false;
                }
                return true;
            });
            const vFirst = vKids.length ? Number(vKids[0].getAttribute('mesid')) : NaN;
            const vLast = vKids.length ? Number(vKids[vKids.length - 1].getAttribute('mesid')) : NaN;
            const more = doc.getElementById('show_more_messages');

            if (more && Number.isFinite(vFirst) && mesId < vFirst) {
                try { more.click(); } catch (e) { }
            }

            const contentH = Math.max(400, chatEl.scrollHeight - tailPx);
            const maxScroll = Math.max(0, chatEl.scrollHeight - chatEl.clientHeight);
            const avgH = Math.max(120, Math.min(900, contentH / totalMsgs));

            if (Number.isFinite(vFirst) && mesId < vFirst) {
                const firstTop = floorTopOffset(chatEl, vKids[0]);
                const est = Math.max(0, Math.round(firstTop + (mesId - vFirst) * avgH));
                setTopRaw(chatEl, est);
            } else if (Number.isFinite(vLast) && mesId > vLast) {
                const lastEl = vKids[vKids.length - 1];
                const lastBottom = floorTopOffset(chatEl, lastEl) + Math.max(120, Math.round(lastEl.getBoundingClientRect().height || avgH));
                const est = Math.min(maxScroll, Math.round(lastBottom + (mesId - vLast - 1) * avgH));
                setTopRaw(chatEl, est);
            } else {
                const prop = Math.min(maxScroll, Math.max(0, Math.round((mesId / totalMsgs) * contentH)));
                setTopRaw(chatEl, prop);
            }
            try { chatEl.dispatchEvent(new (getHostWindow().Event || Event)('scroll')); } catch (e) { }

            await sleep(90);
            syncMountedMesDom(chatEl, ctx && ctx.chat);
            if (find()) return true;

            // 若在超大跨度跳转中该楼层已在 ctx.chat[mesId] 但尚未挂载 DOM，且经过 3 次滚屏仍未出现，则直接将其挂载进 DOM 并同步顺序
            if (stepCount >= 3 && !more && ctx && Array.isArray(ctx.chat) && ctx.chat[mesId] && typeof ctx.addOneMessage === 'function') {
                try {
                    ctx.addOneMessage(ctx.chat[mesId], { scroll: false, forceId: mesId });
                    syncMountedMesDom(chatEl, ctx.chat);
                } catch (e) { }
                if (find()) return true;
            }
        }
        return Boolean(find());
    }

    async function scrollToFloorStart(mesId, smooth, budgetMs) {
        const doc = getHostDocument();
        const chatEl = doc.getElementById('chat');
        if (!chatEl || isDead()) return false;

        // 关键修复：必须在 ensureFloorMounted 之前递增 jumpGen 并停掉上一跳的跟随循环，防止多次连续跳章时新旧两轮跳转互抢 scrollTop！
        if (jumpFollowRaf) { cancelAnimationFrame(jumpFollowRaf); jumpFollowRaf = 0; }
        const myEntryGen = ++jumpGen;
        userTookOver = false;
        verifyPasses = 0;
        stopPin();
        stopJumpHold();
        stopLanding();

        const ctx = getSTContext();
        syncMountedMesDom(chatEl, ctx && ctx.chat);
        let el = doc.querySelector('#chat .mes[mesid="' + mesId + '"]');
        if (!el) {
            await ensureFloorMounted(mesId, 4500, myEntryGen);
            if (isDead() || myEntryGen !== jumpGen) return false;
            syncMountedMesDom(chatEl, ctx && ctx.chat);
            el = doc.querySelector('#chat .mes[mesid="' + mesId + '"]');
        }
        if (!el || isDead() || myEntryGen !== jumpGen) return false;

        let targetUiid = el.getAttribute('data-uiid') || '';
        const chunkIdx = chunkIndexOfMesEl(el);
        if (chunkIdx >= 0 && currentBook) {
            const byChunk = findFloorByChunk(currentBook.id, chunkIdx);
            if (byChunk >= 0 && byChunk !== mesId) {
                const alt = doc.querySelector(`#chat .mes[mesid="${byChunk}"]`);
                if (alt) { mesId = byChunk; el = alt; targetUiid = alt.getAttribute('data-uiid') || targetUiid; }
            }
        }

        if (dbgOn() && window.__sj) window.__sj.push('t=' + Math.round(performance.now()) + ' inst=' + INST + ' gen=' + MY_GEN + ' dead=' + isDead() + ' uto=' + userTookOver + ' jump mesId=' + mesId + ' chunk=' + chunkIndexOfMesEl(el) + ' from=' + STK());
        markActiveFloor(mesId);

        const above = [...(doc.getElementById('chat')?.querySelectorAll(':scope > .mes') || [])];
        const mePos = above.indexOf(el);
        const thinAbove = mePos > 0 && above.slice(Math.max(0, mePos - 3), mePos).some(n => n.getBoundingClientRect().height < 120);
        if (thinAbove) budgetMs = Math.max(budgetMs || 0, 3200);
        // 贴底窗口也要关掉：读者恰好停在底部去点"下一节"时，贴底逻辑会一直
        // 把他按在（现在已经是上一节的）底部，和跳转互相对冲，表现成"点了没反应"。
        bottomStickUntil = 0;
        bottomHoldTop = 0;

        frozenTop = rawTop(chatEl);
        smoothTarget = -1;            // 定位中：别让 scroll 监听改写阅读位置
        smoothUntil = nowMs() + 5000;
        // 下面要先等布局（可能一秒多）。这段时间也得算在跟随窗口里，
        // 否则中途的滚动会把胶囊序号按旧位置改写回去。
        jumpGuardUntil = nowMs() + 3000;

        // 先垫足下方余量：跟随期间下方占位楼层会陆续缩回真实高度，
        // scrollHeight 一缩，浏览器就把 scrollTop 钳下去，落点整体偏掉。
        try { setTailSafe(Math.max(tailPx, Math.round(viewHOf(chatEl) * 1.6))); } catch (e) { }
        await waitFloorSettled(el, budgetMs || 1600);

        const target = targetForFloor(chatEl, el);
        frozenTop = target;
        smoothTarget = smooth ? target : null;
        smoothUntil = nowMs() + (smooth ? 1400 : 0);
        try {
            chatEl.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
        } catch (e) {
            setTopRaw(chatEl, target);
        }

        holdForJump(el, ++jumpGen, budgetMs, targetUiid);
        // 落定后刷新一次胶囊：平滑滚动期间滚动监听不更新序号，落点也不会再产生
        // scroll 事件，不补这一下，胶囊就停在上一次跳到的章节上（看着像跳错了）。
        later(() => { try { updateHud(); } catch (e) { } }, (smooth ? 1400 : 120) + 120);
        return true;
    }

    // 用 ResizeObserver 钉住目标楼：只要有高度变化就立刻把落点摆回原位。
    // 只响应"高度真的变了"，比逐帧轮询准，也不会在空闲时反复写 scrollTop。
    let jumpHoldRo = null;
    let jumpHoldTimer = 0;
    let jumpHoldEl = null;
    let jumpHoldUiid = null;
    let reassertQueued = false;

    // 排序生效后立刻把落点摆回来：order 变化不改 scrollHeight，跟随循环收不到信号。
    function reassertJump() {
        const chatEl = getChatEl();
        if (!chatEl || !jumpHoldEl) return;
        const hit = jumpHoldUiid ? getHostDocument().querySelector(`#chat .mes[data-uiid="${jumpHoldUiid}"]`) : null;
        const node = hit || (jumpHoldEl.isConnected ? jumpHoldEl : null);
        if (!node) return;
        const want = targetForFloor(chatEl, node);
        if (Math.abs(want - rawTop(chatEl)) > 1) {
            setTopRaw(chatEl, want);
            frozenTop = want;
        }
    }

    function stopJumpHold() {
        try { if (dbgOn()) { const w = getHostWindow(); w.__sjk = w.__sjk || []; w.__sjk.push(String(new Error().stack || '').split(String.fromCharCode(10)).slice(2, 5).join(' < ').slice(0, 200)); } } catch (e) { }
        jumpGuardUntil = 0;
        if (jumpHoldRo) { try { jumpHoldRo.disconnect(); } catch (e) { } jumpHoldRo = null; }
        if (jumpHoldTimer) { clearTimeout(jumpHoldTimer); jumpHoldTimer = 0; }
    }

    // 跳转窗口里被拦下的外部写入。跳转本身会在几百毫秒内落定，
    // 但"钉住落点"的窗口有好几秒：这段时间里读者自己往下滑、或 ST 把视口贴到底，
    // 如果用一律吞掉（再摆回落点），读者看到的画面就会被拽回上面的剧情。
    // 所以插入/冻结之外的外部写入一律采纳成新的阅读位置 —— 但要能分清
    // 「读者在滑」和「浏览器自己在调」：前者要采纳，后者必须继续跟目标。
    let pendingExternalTop = null;

    // 目标楼层到视口顶端的距离：跟随窗口里它会因为上方正文异步撑开而不断变大。
    function jumpTargetGap() {
        const chatEl = getChatEl();
        if (!chatEl) return null;
        const hit = jumpHoldUiid ? getHostDocument().querySelector(`#chat .mes[data-uiid="${jumpHoldUiid}"]`) : null;
        const node = hit || (jumpHoldEl && jumpHoldEl.isConnected ? jumpHoldEl : null);
        if (!node) return null;
        return Math.round(node.getBoundingClientRect().top - chatEl.getBoundingClientRect().top);
    }

    function adoptExternalTop(v) {
        const D = (m) => { try { const w = getHostWindow(); w.__ad = w.__ad || []; if (w.__ad.length > 100) w.__ad.splice(0, 50); w.__ad.push(m); } catch (e) { } };
        const chatEl = getChatEl();
        D('in v=' + v + ' el=' + Boolean(chatEl) + ' fz=' + freezeDepth + ' inflight=' + appendInFlight);
        if (!chatEl || !Number.isFinite(v)) { D('bail el'); reassertJump(); return; }
        if (freezeDepth > 0 || appendInFlight) { D('bail fz/inflight'); reassertJump(); return; }
        const cur = rawTop(chatEl);
        if (Math.abs(v - cur) <= 1) { D('bail same cur=' + cur); return; }
        // 我们自己刚写的值回声：不是读者动作。
        if (Math.abs(v - lastSelfTop) <= 2 && nowMs() - lastSelfAt < 260) { D('bail echo v=' + v); return; }
        // 跟随窗口里，外部写入分两种情况：
        //  · 读者真的动了手指（surrenderToUser 已置 userTookOver）→ 采纳成新落点；
        //  · 其它（宿主 ResizeObserver 贴底、程序化滚动、浏览器钳位）→ 继续跟目标。
        // 后者必须继续跟：这段时间里目标楼层正被上方涌入的正文往下推，
        // 一旦停止跟随，目标就再也回不到顶端，画面会一路往上滑回去。
        // 内容刚变高（≤400ms）时落到的"底部"是宿主贴底，不是读者在翻；其余写入采纳。
        const grewRecently = nowMs() - lastGrowAt < 400;
        if (jumpGuardUntil > 0 && nowMs() < jumpGuardUntil && nowMs() - lastGestureAt > 800 && grewRecently) {
            reassertJump();
            D('follow v=' + v);
            return;
        }
        userTookOver = true;
        smoothTarget = null;
        smoothUntil = 0;
        jumpGen++;
        stopJumpHold();
        setTopRaw(chatEl, v);
        frozenTop = rawTop(chatEl);
        D('set ' + v + ' -> ' + rawTop(chatEl) + ' jg=' + jumpGen);
        const max = chatEl.scrollHeight - chatEl.clientHeight;
        if (max - frozenTop <= 400) triggerAutoAppend();
    }

    function holdForJump(el, gen, budgetMs, targetUiid) {
        let node = el;
        const chatEl = getChatEl();
        stopJumpHold();
        jumpHoldEl = el;
        jumpHoldUiid = targetUiid || null;
        if (!chatEl || typeof ResizeObserver !== 'function') { verifyLater(el, gen, 400); return; }

        const resolve = () => {
            if (targetUiid) {
                const hit = getHostDocument().querySelector(`#chat .mes[data-uiid="${targetUiid}"]`);
                if (hit) return hit;
            }
            return el;
        };
        const place = () => {
            try { if (dbgOn()) { const w = getHostWindow(); w.__pp = w.__pp || []; if (w.__pp.length > 300) w.__pp.splice(0, 150); w.__pp.push('gen=' + gen + ' jg=' + jumpGen + ' dead=' + isDead() + ' uto=' + userTookOver + ' gest=' + (nowMs() - lastGestureAt)); } } catch (e) { }
            // 本帧的 follow 循环可能是"读者动手之前"就排上的：那一步算出来的落点
            // 会立刻把读者刚滑到的位置顶回去，所以这里再判一次代数。
            // 另外被人顶掉的实例（酒馆会把同一份脚本再跑一遍）也还在跑自己的跟随循环，
            // 它按自己的旧落点写 scrollTop，画面照样被拽回去。
            if (isDead() || gen !== jumpGen) return;
            const cur = resolve();
            try { if (dbgOn()) { const w = getHostWindow(); w.__pi = w.__pi || []; if (w.__pi.length > 300) w.__pi.splice(0, 150); w.__pi.push('cur=' + Boolean(cur) + ' el=' + Boolean(el && el.isConnected) + ' uiid=' + Boolean(jumpHoldUiid)); } } catch (e) { }
            if (!cur) return;
            el = cur;
            const w = targetForFloor(chatEl, cur);
            if (dbgOn() && window.__ph) { const _i = Number(cur.getAttribute('mesid')); const _m = (getSTContext().chat || [])[_i]; window.__ph.push({ gen, mesid: cur.getAttribute('mesid'), chunk: _m && getMark(_m) ? getMark(_m).chunkIndex : 'x', top: Math.round(rawTop(chatEl)), want: Math.round(w), max: Math.round(chatEl.scrollHeight - chatEl.clientHeight), elTop: Math.round(cur.getBoundingClientRect().top - chatEl.getBoundingClientRect().top), h: Math.round(cur.getBoundingClientRect().height), tail: tailPx }); }
            if (gen !== jumpGen) { stopJumpHold(); return; }
            let want = w;
            const maxTop = chatEl.scrollHeight - chatEl.clientHeight;
            // 余量固定钉在"八成屏"：下方多是等高占位，成文后一起缩回去，
            // 余量一缩 scrollHeight 就小，浏览器顺手把 scrollTop 钳下来，
            // 落点就会一路往上飘（读者看到的是上面的剧情）。钉住它就没有钳位。
            const keepTail = Math.round(viewHOf(chatEl) * 0.8);
            if (tailPx < keepTail) setTailSafe(keepTail);
            avoidClamp();
            want = targetForFloor(chatEl, el);
            if (want > maxTop + 1) {
                const shortBy = want - maxTop;
                setTailSafe(tailPx + shortBy + 24);
                want = targetForFloor(chatEl, el);
            }
            try { if (dbgOn()) { const w3 = getHostWindow(); w3.__pc = w3.__pc || []; if (w3.__pc.length > 200) w3.__pc.splice(0, 100); w3.__pc.push('cur=' + Math.round(rawTop(chatEl)) + ' want=' + Math.round(want) + ' max=' + Math.round(chatEl.scrollHeight - chatEl.clientHeight) + ' gap=' + Math.round(cur.getBoundingClientRect().top - chatEl.getBoundingClientRect().top)); } } catch (e) { }
            if (Math.abs(want - rawTop(chatEl)) > 1) {
                try { if (dbgOn()) { const w2 = getHostWindow(); w2.__pl = w2.__pl || []; w2.__pl.push('t=' + performance.now().toFixed(1) + ' PLACE inst=' + INST + ' gen=' + gen + ' jg=' + jumpGen + ' uto=' + userTookOver + ' fz=' + freezeDepth + ' inf=' + appendInFlight + ' ' + Math.round(rawTop(chatEl)) + '->' + Math.round(want) + ' max=' + Math.round(chatEl.scrollHeight - chatEl.clientHeight)); } } catch (e) { }
                setTopRaw(chatEl, want);
                frozenTop = want;
            }
            smoothTarget = want;
            smoothUntil = nowMs() + 2500;
        };

        // #chat 自身高度固定、楼层又被 min-height 撑住，RO 收不到"内容变高"，
        // 所以主循环用 rAF：按固定时长一直跟，不靠"看起来稳了"收手。
        // 区域越长，异步提交拖得越久，跟随窗口按需求延长
        const holdUntil = nowMs() + Math.max(4000, (budgetMs || 0) + 2600);
        jumpGuardUntil = holdUntil;
        // 只有总高度变了才重摆；用户自己在拖的时候高度不变，别抢。
        // 另外高度连续一段时间不变就收手，否则读者永远被按在原地。
        const offsetOf = () => { const c = resolve(); return c ? Math.round(c.getBoundingClientRect().top - chatEl.getBoundingClientRect().top) : 0; };
        let lastH = chatEl.scrollHeight;
        let lastOff = offsetOf();
        let quietSince = nowMs();
        let lastPlace = 0;
        const loop = () => {
            jumpFollowRaf = 0;
            try { if (dbgOn()) { const w = getHostWindow(); w.__lp = w.__lp || []; if (w.__lp.length > 400) w.__lp.splice(0, 200); w.__lp.push('gen=' + gen + '/' + jumpGen + ' uto=' + userTookOver + ' g=' + (nowMs() - lastGestureAt) + ' grow=' + (nowMs() - lastGrowAt)); } } catch (e) { }
            if (gen !== jumpGen) { stopJumpHold(); return; }
            const h = chatEl.scrollHeight;
            const off = offsetOf();
            if (h !== lastH) lastGrowAt = nowMs();
            if (h !== lastH || Math.abs(off - lastOff) > 2) {
                lastH = h;
                lastOff = off;
                quietSince = nowMs();
                place();
                lastPlace = nowMs();
            } else if (nowMs() - lastPlace > 160) { place(); lastPlace = nowMs(); }
            const quiet = nowMs() - quietSince;
            if (nowMs() > holdUntil) {
                // 到点了但还没对准：先别收手，延长到对准并稳住为止（有硬上限）。
                const aligned = Math.abs(off) <= 8;
                if (!aligned && nowMs() < holdUntil + 6000) {
                    if (nowMs() - lastPlace > 120) { place(); lastPlace = nowMs(); }
                    jumpFollowRaf = requestAnimationFrame(loop);
                    return;
                }
                stopJumpHold();
                if (gen !== jumpGen) return;
                smoothTarget = null;
                frozenTop = rawTop(chatEl);
                // 落定后再补几轮：上方楼层稍后成文会把目标顶开，
                // 只补一次往往补不回来（画面就停在偏了半屏的位置上）。
                // 上下方楼层会陆续成文，把目标一点点顶开；补校正要铺满整段成文期，
                // 不能只补头两秒（之后再有变化就没人管，画面停在偏了半屏的位置）。
                for (const d of [200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5500, 6800, 8200]) verifyLater(el, gen, d);
                return;
            }
            if (quiet > 900) {
                // 守望：安静的这段时间里如果有人把目标推开了（排序、别书楼层插入），
                // 偏移就会变；这时不要等高度信号，直接按几何摆回去。
                if (Math.abs(off - lastOff) > 6) {
                    lastOff = off;
                    lastH = h;
                    quietSince = nowMs();
                    place();
                    lastPlace = nowMs();
                }
            }
            jumpFollowRaf = requestAnimationFrame(loop);
        };
        try { const w = getHostWindow(); w.__hfj = w.__hfj || []; w.__hfj.push('schedule gen=' + gen + ' holdUntil=' + Math.round(holdUntil - nowMs())); } catch (e) { }
        jumpFollowRaf = requestAnimationFrame(loop);
        try { const w = getHostWindow(); w.__hfj.push('scheduled id=' + jumpFollowRaf); } catch (e) { }
    }

    // 落定后的补检：还偏就整段重来（重新等布局稳定再滚一次）。
    // 偏差多半来自"上面几层稍后才把正文写完"，只挪一次补不上。
    let verifyPasses = 0;
    function verifyLater(el, gen, delayMs) {
        setTimeout(() => {
            try { const w = window; w.__vl = w.__vl || []; w.__vl.push(delayMs + ' d=' + Math.round(el.getBoundingClientRect().top - getChatEl().getBoundingClientRect().top) + ' dead=' + isDead() + ' gen=' + gen + '/' + jumpGen + ' uto=' + userTookOver + ' conn=' + el.isConnected + ' vp=' + verifyPasses + ' sm=' + (smoothTarget !== null)); } catch (e) { }
            // 被顶掉的实例也有排好的校时器：它的 jumpGen 还停在当初那份，
            // 一跑就会把自己那套落点写进共用的 #chat。
            if (isDead() || gen !== jumpGen || userTookOver || !el.isConnected) return;
            const chatEl = getChatEl();
            if (!chatEl || smoothTarget !== null) return;
            const chatTop = chatEl.getBoundingClientRect().top;
            const delta = el.getBoundingClientRect().top - chatTop - 4;
            if (Math.abs(delta) <= 12) return;
            if (verifyPasses >= 16) { verifyPasses = 0; return; }
            verifyPasses++;
            // 不能用 el 上的 mesid：重排会改写它，只能按"节号"重新定位
            const idx = chunkIndexOfMesEl(el);
            if (idx >= 0) scrollToFloorStart(mesIdOfChunk(idx), false);
        }, delayMs);
    }

    function chunkIndexOfMesEl(el) {
        const id = Number(el.getAttribute('mesid'));
        const ctx = getSTContext();
        const msg = (ctx && Array.isArray(ctx.chat)) ? ctx.chat[id] : null;
        const mk = getMark(msg);
        return mk ? Number(mk.chunkIndex) : -1;
    }

    function mesIdOfChunk(chunkIdx) {
        const map = scanFloorMap();
        const info = map[chunkIdx];
        return info ? info.mesId : -1;
    }

    function markActiveFloor(mesId) {
        try { if (dbgOn()) { const w = window; w.__mk = w.__mk || []; w.__mk.push('mes=' + mesId + ' ch=' + chunkIndexOfMesEl({ getAttribute: () => String(mesId) }) + ' ' + STK().split(' << ').slice(1, 4).join('<<')); } } catch (e) { }
        const doc = getHostDocument();
        doc.querySelectorAll('#chat .mes.th-novel-active-floor').forEach(el => {
            if (parseInt(el.getAttribute('mesid'), 10) !== mesId) el.classList.remove('th-novel-active-floor');
        });
        const el = doc.querySelector(`#chat .mes[mesid="${mesId}"]`);
        if (el) el.classList.add('th-novel-active-floor');
    }

    function sentinelFor(idx) {
        const doc = getHostDocument();
        const chatEl = doc.getElementById('chat');
        if (!chatEl) return null;
        let s = doc.getElementById('th-novel-sentinel');
        if (!s) {
            s = doc.createElement('div');
            s.id = 'th-novel-sentinel';
            s.className = 'th-novel-sentinel';
            // 内联写死：宿主/主题的 CSS 很容易覆盖样式表规则
            s.style.flex = '0 0 auto';
            s.style.minHeight = '1px';
            s.style.width = '100%';
            s.style.pointerEvents = 'none';
            s.style.order = '99999';
        }
        // 每次都用内联样式兜一次，避免元素被别处重建后失效
        s.style.flex = '0 0 auto';
        s.style.order = '99999';
        s.dataset.nextIdx = String(idx);
        // 哨兵必须永远在 #chat 最后一个子节点，否则被顶上去就再也不会触发
        if (s.parentNode !== chatEl || chatEl.lastElementChild !== s) chatEl.appendChild(s);
        return s;
    }

    // 预接下一节：观察一个贴着聊天末尾的哨兵，提前 lookahead 像素就开始铺楼
    function initialiseSentinel() {
        const doc = getHostDocument();
        const chatEl = doc.getElementById('chat');
        if (!chatEl || sentinelObserver) return;
        if (typeof IntersectionObserver !== 'function') return;

        sentinelObserver = new IntersectionObserver((entries) => {
            try { if (dbgOn()) (getHostWindow().__io = getHostWindow().__io || []).push('CB n=' + entries.length + ' gen=' + MY_GEN + ' dead=' + isDead() + ' tgt=' + (entries[0] && entries[0].target && entries[0].target.id)); } catch (e3) { }
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                try { if (dbgOn()) (getHostWindow().__aa = getHostWindow().__aa || []).push('IO fire gen=' + MY_GEN + ' n=' + Object.keys(scanFloorMap()).length); } catch (e2) { }
                triggerAutoAppend();
            }
        }, { root: chatEl, rootMargin: `0px 0px ${Math.max(200, Number(settings.preGenLookahead) || 900)}px 0px`, threshold: 0 });

        setupSentinelObserverFor();
    }

    function setupSentinelObserverFor() {
        if (!sentinelObserver) { try { if (dbgOn()) (getHostWindow().__io = getHostWindow().__io || []).push('SETUP no-observer gen=' + MY_GEN); } catch (e) { } return; }
        sentinelObserver.disconnect();
        const s = getHostDocument().getElementById('th-novel-sentinel');
        try { if (dbgOn()) (getHostWindow().__io = getHostWindow().__io || []).push('SETUP s=' + (s ? s.id + '/h' + s.offsetHeight + '/p' + (s.parentNode && s.parentNode.id) : 'null') + ' gen=' + MY_GEN + ' dead=' + isDead()); } catch (e) { }
        if (s) sentinelObserver.observe(s);
    }

    function refreshSentinel() {
        if (!currentBook) return;
        const chatEl = getChatEl();
        if (!chatEl) return;
        const map = scanFloorMap();
        const deployed = Object.keys(map).map(Number);
        if (deployed.length === 0) return;
        const next = Math.max(...deployed) + 1;
        if (next < currentBook.chunks.length) {
            sentinelFor(next);
            setupSentinelObserverFor();
            // 哨兵永远贴在聊天最末尾，避免被其它楼层顶到中间
            const s = getHostDocument().getElementById('th-novel-sentinel');
            if (s && s !== chatEl.lastElementChild) chatEl.appendChild(s);
        } else {
            // 铺完了也要留着：哨兵同时承担尾部余量
            sentinelFor(Math.max(0, currentBook.chunks.length - 1));
            const s = getHostDocument().getElementById('th-novel-sentinel');
            if (s && s !== chatEl.lastElementChild) chatEl.appendChild(s);
        }
    }

    async function triggerAutoAppend() {
        const D = (m) => { try { if (dbgOn()) (getHostWindow().__aa = getHostWindow().__aa || []).push(m); } catch (e) { } };
        // 已 teardown 实例的滚动/观察回调仍会跑；它拿着自己的 currentBook，
        // 铺出来就是别人书号的楼层，必须先让位给当前实例。
        if (isDead()) return;
        if (!settings.autoAppendOnBottom || !currentBook || queueRunning || appendInFlight) { D('skip auto=' + settings.autoAppendOnBottom + ' book=' + Boolean(currentBook) + ' q=' + queueRunning + ' inflight=' + appendInFlight); return; }
        const map = scanFloorMap();
        const deployed = Object.keys(map).map(Number);
        D('entry gen=' + MY_GEN + ' n=' + deployed.length + ' auto=' + settings.autoAppendOnBottom + ' q=' + queueRunning + ' inflight=' + appendInFlight + ' cur=' + (currentBook && currentBook.id));
        if (deployed.length === 0) { D('skip nofloors b=' + (currentBook && currentBook.id) + ' cur=' + (currentBook === currentBook) + ' chatMarks=' + JSON.stringify(((getSTContext()?.chat) || []).map(m => (m && m.extra && m.extra.thNovelV6 && m.extra.thNovelV6.bookId) || '-').slice(-4)) + ' dist=' + Math.round(getChatEl().scrollHeight - rawTop(getChatEl()) - getChatEl().clientHeight)); return; }
        const next = Math.max(...deployed) + 1;
        if (next >= currentBook.chunks.length) { D('skip end'); return; }
        if (map[next]) { D('skip exists'); refreshSentinel(); return; }
        D('append ' + next);

        appendInFlight = true;
        try {
            const chatEl0 = getChatEl();
            // 跳转途中（刚点目录/上一节）不要改落点：读者要领的是他点的那一节，
            // 这里再把画面推去下一节，看起来就像"点了第 4 节却停在第 5 节"。
            const holdJump = jumping();
            const wasBottom = !holdJump && chatEl0 ? chatEl0.scrollHeight - rawTop(chatEl0) - chatEl0.clientHeight <= 60 : false;
            const mesId = await deployFloor(next);
            refreshSentinel();
            ensureTail();
            updateHud();
            // 贴着底部续铺时，把视口放到新楼层的开头。
            // 只"贴到底"的话，底部是尾部余量 + 新楼层的占位高度，屏幕上是一整片空白，
            // 而且比例很容易一直满足阈值，于是一路空铺（手机上就是这个样子）。
            if (wasBottom && mesId >= 0) {
                const el = getHostDocument().querySelector(`#chat .mes[mesid="${mesId}"]`);
                const chatEl = getChatEl();
                if (el && chatEl) {
                    // 把视口顶端对到新楼层开头，再往上留一点点上一节的尾巴当参照，
                    // 读者不至于一翻就是满屏新内容、甚至一屏空白。
                    const want = Math.max(0, floorTopOffset(chatEl, el) - 8);
                    setTopRaw(chatEl, Math.min(want, chatEl.scrollHeight - chatEl.clientHeight));
                    bottomHoldTop = rawTop(chatEl);
                    bottomStickUntil = nowMs() + 1200;
                    currentBook.currentIndex = next;
                    saveProgressOnly(currentBook);
                }
            }
        } finally {
            // 追加完不要马上再追加：空壳刚插进来时量到的"离底距离"是占位而不是正文，
            // 连着补就会一口气铺出十几层空白楼。这里等正文落定一小会儿再判。
            setTimeout(async () => {
                appendInFlight = false;
                // 读者一直停在底部时不会再产生 scroll 事件，IO 也不会再回调
                // （哨兵高度没变），这里主动再判一次，形成连续阅读。
                if (settings.autoAppendOnBottom && !queueRunning) {
                    const chatEl = getChatEl();
                    if (chatEl && chatEl.scrollHeight - rawTop(chatEl) - chatEl.clientHeight <= 400) {
                        triggerAutoAppend();
                    }
                }
            }, 650);
        }
    }

    // ============ 文本清理 ============
    function cleanText(text) {
        if (!text) return '';
        let s = String(text);
        // 编码/HTML 残留
        s = s.replace(/^\uFEFF/, '')
            .replace(/\r\n?/g, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?p[^>]*>/gi, '\n\n')
            .replace(/&quot;/gi, '“').replace(/&ldquo;/gi, '“').replace(/&rdquo;/gi, '”')
            .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D]/g, '');

        if (settings.customCleanRules) {
            for (const rule of String(settings.customCleanRules).split(',').map(x => x.trim()).filter(Boolean)) {
                s = s.split(rule).join('');
            }
        }
        return s;
    }

    // 只做“显示层”清理：行首缩进、行尾空白、行数压缩。不在这里压缩段内空行，
    // 段落结构交给 chunker 用原文偏移自己处理。
    function normaliseForStore(text) {
        return cleanText(text)
            .split('\n')
            .map(line => line.replace(/^[ \t　]+/, '').replace(/[ \t　]+$/, ''))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^[\n\s]+|[\n\s]+$/g, '');
    }

    // ============ 编码解码 ============
    function decodeBuffer(buffer) {
        const u8 = new Uint8Array(buffer);
        const tryDecode = (enc, fatal) => {
            try { return new TextDecoder(enc, { fatal: Boolean(fatal) }).decode(u8); } catch (e) { return null; }
        };
        if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
            return tryDecode('utf-8', false) || '';
        }
        if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return tryDecode('utf-16le', false) || '';
        if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return tryDecode('utf-16be', false) || '';

        const utf8 = tryDecode('utf-8', true);
        if (utf8 !== null) return utf8;
        const gb = tryDecode('gb18030', false);
        if (gb !== null) {
            // gb18030 能把任何字节解出东西，用替换符数量粗判是否更像 utf-8 残破
            const bad = (gb.match(/\uFFFD/g) || []).length;
            if (bad <= gb.length * 0.01) return gb;
            const loose = tryDecode('utf-8', false);
            if (loose !== null && (loose.match(/\uFFFD/g) || []).length < bad) return loose;
            return gb;
        }
        return tryDecode('utf-8', false) || '';
    }

    // ============ 章节解析 ============
    function parseChapters(rawText) {
        const text = normaliseForStore(rawText);
        const headingRe = /^[ \t　]*(?:正文[ \t　]*)?(?:第[零一二三四五六七八九十百千万两0-9]+[章回节卷集部篇]|楔子|序章|序言|引子|尾声|终章|后记|番外|Chapter[ \t]+\d+|【第[零一二三四五六七八九十百千万两0-9]+[章回节]】)(?:[ \t　:：.．、—\-·][^\n]*)?$/i;

        const lines = text.split('\n');
        const heads = [];
        let cursor = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.length > 0 && trimmed.length <= 70 && headingRe.test(line)) {
                heads.push({ title: trimmed, lineStart: cursor, lineEnd: cursor + line.length + 1, lineIndex: i });
            }
            cursor += line.length + 1;
        }

        if (heads.length === 0) {
            return text.trim() ? [{ title: '正文', content: text }] : [];
        }

        const chapters = [];
        const preamble = text.slice(0, heads[0].lineStart).trim();
        if (preamble.length > 30) chapters.push({ title: '序言', content: preamble });

        for (let i = 0; i < heads.length; i++) {
            const h = heads[i];
            const stop = (i + 1 < heads.length) ? heads[i + 1].lineStart : text.length;
            // 关键修复：标题行之后即使直接是下一章（空章），也保留这一章，不再被 `if (body.length > 0)` 丢弃
            const body = text.slice(h.lineEnd, stop).replace(/^[\n\s]+/, '').replace(/[\n\s]+$/, '');
            chapters.push({ title: h.title, content: body });
        }
        return chapters.filter(c => c.content.length > 0 || c.title);
    }

    // ============ 切分：连续偏移量，绝不丢字 ============
    // 2: 修掉接缝处两边一起 trim 吃掉段间空行的问题。老书（1 及更早）载入时按新规则重切一次。
    const CHUNK_VER = 2;
    const MIN_TAIL = 120;       // 末尾小于这个长度就并进上一节
    const BOUND_WINDOW = 260;   // 回溯找切点的最大距离

    function pickCut(text, from, hardEnd, minEnd) {
        // 在 [minEnd, hardEnd] 里找最靠后的自然断点
        const lo = Math.max(minEnd, hardEnd - BOUND_WINDOW);
        // 1) 空行（把这一对换行都留在上一节末尾，下一节从正文起头）
        for (let i = hardEnd; i >= lo; i--) {
            if (text[i] === '\n' && text[i - 1] === '\n') return i + 1;
        }
        // 2) 句末标点或换行
        for (let i = hardEnd; i >= lo; i--) {
            const c = text[i];
            if (c && (SENTENCE_END.indexOf(c) >= 0 || c === '”' || c === '」' || c === '』' || c === '】')) return i + 1;
            if (c === '\n') return i + 1;
        }
        return hardEnd;
    }

    // 返回 [{ start, end }]，首尾相接、完整覆盖 [0, len)
    function sliceRanges(text, limit) {
        const len = text.length;
        if (limit <= 0 || len <= limit) return [{ start: 0, end: len }];

        const minEnd = Math.max(1, Math.floor(limit * 0.55));
        const ranges = [];
        let pos = 0;
        while (pos < len) {
            const hardEnd = Math.min(len, pos + limit);
            if (hardEnd >= len) { ranges.push({ start: pos, end: len }); break; }

            const cut = Math.max(pos + 1, Math.min(hardEnd, pickCut(text, pos, hardEnd, pos + minEnd)));
            let safeCut = cut;
            // Do not split a UTF-16 surrogate pair (emoji / rare Han characters).
            if (safeCut < len && /[\uD800-\uDBFF]/.test(text[safeCut-1]) && /[\uDC00-\uDFFF]/.test(text[safeCut])) safeCut++;
            ranges.push({ start: pos, end: safeCut });
            pos = safeCut;
        }

        // 末尾过短：并进上一节（不丢字，只让最后一节稍长）
        if (ranges.length > 1) {
            const last = ranges[ranges.length - 1];
            if (last.end - last.start < Math.min(MIN_TAIL, Math.floor(limit * 0.15))) {
                const prev = ranges[ranges.length - 2];
                prev.end = last.end;
                ranges.pop();
            }
        }
        return ranges;
    }

    // 只在整章的首/尾去掉多余空白。中间接缝处必须原样保留：切点常常落在空行上
    // （正文里两段之间的 \n\n），两边一起 trim 就会把段间空行吃掉，拼回去段落粘连在一起，
    // 读起来就是"丢失内容"。
    function contentOf(text, range, isFirst, isLast) {
        let s = text.slice(range.start, range.end);
        if (isFirst) s = s.replace(/^[\n\s]+/, '');
        if (isLast) s = s.replace(/[\n\s]+$/, '');
        return s;
    }

    function buildChunks(book) {
        if (!book) return { coverage: 1 };
        if (!Array.isArray(book.rawChapters) || book.rawChapters.length === 0) {
            if (Array.isArray(book.chunks) && book.chunks.length > 0) {
                book.rawChapters = book.chunks.map(c => ({
                    title: String(c.title || '').replace(/\s*[（(]\d+\/\d+[)）]\s*$/, ''),
                    content: c.content
                }));
            } else {
                book.chunks = [];
                return { coverage: 1 };
            }
        }

        const limit = Math.max(0, Number(settings.chunkSize) || 0);
        const chunks = [];
        let sourceChars = 0;
        let keptChars = 0;

        book.rawChapters.forEach((chap, cIdx) => {
            const baseTitle = String(chap.title || `第${cIdx + 1}章`).replace(/\s*[（(]\d+\/\d+[)）]\s*$/, '').trim() || `第${cIdx + 1}章`;
            const body = normaliseForStore(chap.content || '');
            const compact = body.replace(/\s/g, '').length;
            sourceChars += compact;
            if (compact === 0) return;

            const ranges = sliceRanges(body, limit);
            const parts = ranges
                .map((r, i) => ({ ...r, text: contentOf(body, r, i === 0, i === ranges.length - 1) }))
                .filter(p => p.text.length > 0);

            if (parts.length === 0) return;

            parts.forEach((p, pIdx) => {
                keptChars += p.text.replace(/\s/g, '').length;
                chunks.push({
                    title: parts.length > 1 ? `${baseTitle}（${pIdx + 1}/${parts.length}）` : baseTitle,
                    chapterTitle: baseTitle,
                    content: p.text,
                    chapterIndex: cIdx,
                    partIndex: pIdx + 1,
                    totalParts: parts.length,
                    start: p.start,
                    end: p.end
                });
            });
        });

        book.chunks = chunks;
        book.appliedChunkSize = limit;
        book.chunkVer = CHUNK_VER;
        const coverage = sourceChars === 0 ? 1 : keptChars / sourceChars;
        book.coverage = coverage;

        if (typeof book.currentIndex !== 'number' || book.currentIndex < 0) book.currentIndex = 0;
        if (book.currentIndex >= chunks.length) book.currentIndex = Math.max(0, chunks.length - 1);
        return { coverage };
    }

    // ============ IndexedDB ============
    function openDB() {
        return new Promise((resolve, reject) => {
            const idb = getHostWindow().indexedDB || window.indexedDB;
            if (!idb) return reject(new Error('当前环境不支持 IndexedDB'));
            const req = idb.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_BOOKS)) db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    function idbPut(store, value, key) {
        return openDB().then(db => new Promise(resolve => {
            const tx = db.transaction(store, 'readwrite');
            const os = tx.objectStore(store);
            if (key === undefined) os.put(value); else os.put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        })).catch(() => false);
    }

    function idbReq(store, mode, fn) {
        return openDB().then(db => new Promise(resolve => {
            const tx = db.transaction(store, mode);
            const req = fn(tx.objectStore(store));
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = () => resolve(null);
        })).catch(() => null);
    }

    let settingsLoaded = false;
    function saveSettings() { return idbPut(STORE_META, JSON.parse(JSON.stringify(settings)), META_KEY); }

    async function loadSettings() {
        const got = await idbReq(STORE_META, 'readonly', os => os.get(META_KEY));
        if (got && typeof got === 'object') {
            Object.assign(settings, got);
            if (settings.boundBtnSelector && /extraMesButtonsHint|fa-ellipsis/.test(settings.boundBtnSelector)) {
                settings.boundBtnType = 'floor';
                settings.boundBtnSelector = '.fa-palette';
            }
            // 旧默认值一律升到墨影专用按钮（只有它会把图写进正文）。
            // 无条件升级：派发链里 .bbi-tag-action 找不到时仍会回退到 .fa-palette。
            if (settings.boundBtnSelector === '.fa-palette') {
                settings.boundBtnSelector = '.bbi-tag-action';
            }
            settings.preGenRetry = Math.max(0, Math.min(10, Number(settings.preGenRetry) || 0));
            if (settings.keepAliveBg === undefined) settings.keepAliveBg = true;
            if (!got.epubDefaultMigratedV61) {
                settings.exportFormat = 'epub';
                settings.epubDefaultMigratedV61 = true;
            }
        }
        settingsLoaded = true;
        return settings;
    }

    // 只存进度（localStorage，几十字节）。滚动停一下就整本写一次 IndexedDB 太贵：
    // 4MB 的书每次要 stringify 4.7MB + 88ms 写入，滑一下卡一下。
    function saveProgressOnly(book) {
        if (!book) return;
        try {
            getHostWindow().localStorage.setItem('th_novel_progress_' + book.id, JSON.stringify({
                currentIndex: book.currentIndex || 0,
                lastMesId: book.lastMesId || 0,
                lastScrollTop: book.lastScrollTop || 0,
                updatedAt: nowMs()
            }));
        } catch (e) { }
    }

    function saveBook(book) {
        if (!book) return Promise.resolve(false);
        saveProgressOnly(book);
        return idbPut(STORE_BOOKS, JSON.parse(JSON.stringify(book)));
    }

    function applyProgress(book) {
        if (!book) return;
        try {
            const raw = getHostWindow().localStorage.getItem('th_novel_progress_' + book.id);
            if (!raw) return;
            const p = JSON.parse(raw);
            if (typeof p.currentIndex === 'number' && p.currentIndex >= 0) book.currentIndex = p.currentIndex;
            if (typeof p.lastMesId === 'number') book.lastMesId = p.lastMesId;
            if (typeof p.lastScrollTop === 'number') book.lastScrollTop = p.lastScrollTop;
        } catch (e) { }
    }

    async function getBook(id) {
        if (!id) return null;
        const b = await idbReq(STORE_BOOKS, 'readonly', os => os.get(id));
        if (b) applyProgress(b);
        return b;
    }

    async function listBooks() {
        const list = await idbReq(STORE_BOOKS, 'readonly', os => os.getAll());
        const arr = Array.isArray(list) ? list : [];
        arr.forEach(applyProgress);
        arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return arr;
    }

    async function deleteBook(id) {
        try { getHostWindow().localStorage.removeItem('th_novel_progress_' + id); } catch (e) { }
        await openDB().then(db => new Promise(resolve => {
            const tx = db.transaction(STORE_BOOKS, 'readwrite');
            tx.objectStore(STORE_BOOKS).delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        })).catch(() => false);
    }

    async function clearBooks() {
        await openDB().then(db => new Promise(resolve => {
            const tx = db.transaction(STORE_BOOKS, 'readwrite');
            tx.objectStore(STORE_BOOKS).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        })).catch(() => false);
    }

    // ============ 楼层地图（身份靠 extra 标记，不靠正文标题） ============
    function getMark(msg) {
        try {
            const m = msg && msg.extra && msg.extra[MARK_KEY];
            return (m && typeof m === 'object') ? m : null;
        } catch (e) { return null; }
    }

    function floorImages(mesId, msg) {
        const out = [];
        const seen = new Set();
        const push = (url, title) => {
            const u = String(url || '');
            if (!u || u.length < 8 || seen.has(u)) return;
            if (/avatar|user-default|img\/ai4|spinner|loading|\.svg$/i.test(u)) return;
            seen.add(u);
            out.push({ url: u, title: String(title || '') });
        };
        try {
            const media = (msg && msg.extra && Array.isArray(msg.extra.media)) ? msg.extra.media : [];
            for (const m of media) {
                if (!m) continue;
                const isImg = !m.type || m.type === 'image' || /^data:image|\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(String(m.url || ''));
                if (isImg) push(m.url, m.title);
            }
            const single = msg && msg.extra && msg.extra.image;
            if (typeof single === 'string' && single) push(single, '');
            const swipes = msg && msg.extra && Array.isArray(msg.extra.image_swipes) ? msg.extra.image_swipes : [];
            for (const s of swipes) if (typeof s === 'string') push(s, '');
            // 墨影（.bbi-tag-action）**不写 extra.media**：它把图存在
            // extra.bbiImage[<swipe>][<tagHash>] = [{ path, status, ... }]，卡片的
            // <img> 还挂在 shadowRoot 里，querySelectorAll 也看不见。
            // 只认 media 的话，插件明明出图成功、这里也永远返回 0，
            // 于是每张都要干等满「单张最长等待」再判失败——这是批量生图失败的主因。
            const bbi = msg && msg.extra && msg.extra.bbiImage;
            if (bbi && typeof bbi === 'object') {
                const pull = (bag, onlyReady) => {
                    if (!bag || typeof bag !== 'object') return;
                    for (const list of Object.values(bag)) {
                        if (!Array.isArray(list)) continue;
                        for (const e of list) {
                            if (!e || typeof e.path !== 'string' || !e.path) continue;
                            if (onlyReady && e.status && e.status !== 'ready') continue;
                            push('/' + e.path.replace(/^\/+/, ''), e.prompt);
                        }
                    }
                };
                // 当前 swipe 全收（含尚未标 ready 的占位），其它 swipe 只收已完成的。
                pull(bbi[String(msg.swipe_id ?? 0)], true);
                for (const [k, bag] of Object.entries(bbi)) {
                    if (k !== String(msg.swipe_id ?? 0)) pull(bag, true);
                }
            }
        } catch (e) { }
        // DOM 兜底：插件可能只画在 DOM 里
        try {
            const el = getHostDocument().querySelector(`#chat .mes[mesid="${mesId}"]`);
            if (el) {
                el.querySelectorAll('.mes_img, .mes_text img, img').forEach(img => {
                    if (img.closest('.avatar, .mesAvatarWrapper')) return;
                    if (img.classList && img.classList.contains('error')) return;
                    if (img.complete && img.naturalWidth > 0 && img.naturalWidth < 80) return;
                    push(img.currentSrc || img.getAttribute('src'), img.getAttribute('title'));
                });
            }
        } catch (e) { }
        return out;
    }

    function msgHasExtraImage(msg) {
        try {
            if (!msg || !msg.extra) return false;
            const media = Array.isArray(msg.extra.media) ? msg.extra.media : [];
            for (const m of media) {
                if (!m) continue;
                const u = String(m.url || '');
                if (u.length >= 8 && !/avatar|user-default|img\/ai4|spinner|loading|\.svg$/i.test(u)) return true;
            }
            if (typeof msg.extra.image === 'string' && msg.extra.image.length >= 8) return true;
            if (Array.isArray(msg.extra.image_swipes) && msg.extra.image_swipes.some(s => typeof s === 'string' && s.length >= 8)) return true;
            const bbi = msg.extra.bbiImage;
            if (bbi && typeof bbi === 'object') {
                for (const bag of Object.values(bbi)) {
                    if (!bag || typeof bag !== 'object') continue;
                    for (const list of Object.values(bag)) {
                        if (Array.isArray(list) && list.some(e => e && typeof e.path === 'string' && e.path.length > 1)) return true;
                    }
                }
            }
        } catch (e) { }
        return false;
    }

    function floorHasImage(mesId, msg) {
        if (msgHasExtraImage(msg)) return true;
        return floorImages(mesId, msg).length > 0;
    }

    // 这一层现在有几个生图 tag（墨影写在正文里的 <bbi_image>）。
    // 用来判断"点了之后到底有没有动静"：插件先写 tag 再出图，卡住的两种形态
    // （调用没生效 / 写了 tag 但没出图）在这里能分辨，不必干等超时。
    function floorTagCount(mesId) {
        try {
            const ctx = getSTContext();
            const msg = ctx && Array.isArray(ctx.chat) ? ctx.chat[mesId] : null;
            if (!msg) return 0;
            const text = String(msg.mes || '');
            const m = text.match(/<bbi_image\b/gi);
            return m ? m.length : 0;
        } catch (e) { return 0; }
    }

    // 与墨影 storage.ts 完全一致的 cyrb53 14 位哈希，用于直接从 message.extra.bbiImage 读取每个 <bbi_image> 槽位的真实出图状态
    function cyrb53Hash(text, seed = 0) {
        let h1 = 0xdeadbeef ^ seed;
        let h2 = 0x41c6ce57 ^ seed;
        for (let i = 0; i < text.length; i++) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
    }

    // 数据层槽位检查：不依赖任何 DOM 或 shadowRoot 渲染（手机切后台或楼层在视口外也能精准知道每个槽位是否已 ready）
    function floorDataSlotInfo(mesId) {
        const res = { total: 0, ready: 0, errors: 0, pending: 0, tags: [], tagRunning: false, bgRunning: false };
        try {
            const w = getHostWindow();
            const bbi = w && w.STBaiBaiImage;
            if (bbi && typeof bbi.isFloorTagRunning === 'function') {
                res.tagRunning = Boolean(bbi.isFloorTagRunning(mesId));
            }
            if (bbi && typeof bbi.isBackgroundGenRunning === 'function') {
                res.bgRunning = Boolean(bbi.isBackgroundGenRunning());
            }
            const ctx = getSTContext();
            const msg = ctx && Array.isArray(ctx.chat) ? ctx.chat[mesId] : null;
            if (!msg) return res;
            const text = String(msg.mes || '');
            const re = /<bbi_image>([\s\S]+?)<\/bbi_image>/gi;
            let m;
            while ((m = re.exec(text)) !== null) {
                const fullTag = String(m[0] || '').trim();
                const inner = String(m[1] || '').trim();
                if (inner && fullTag) res.tags.push(fullTag);
            }
            res.total = res.tags.length;
            if (res.total === 0) return res;

            const swipeKey = String(msg.swipe_id ?? 0);
            const bag = msg.extra && msg.extra.bbiImage && msg.extra.bbiImage[swipeKey];
            res.tags.forEach((fullTag, seq) => {
                const h = cyrb53Hash(fullTag);
                const innerRaw = fullTag.replace(/^<bbi_image>/i, '').replace(/<\/bbi_image>$/i, '').trim();
                const hFallback = innerRaw ? cyrb53Hash(innerRaw) : '';
                const list = bag && Array.isArray(bag[h]) ? bag[h] : (bag && hFallback && Array.isArray(bag[hFallback]) ? bag[hFallback] : []);
                const scoped = list.filter(e => e && (e.slotSeq === undefined || e.slotSeq === seq));
                const latest = scoped.length ? scoped[scoped.length - 1] : (list.length ? list[list.length - 1] : null);
                if (latest && latest.status === 'ready' && typeof latest.path === 'string' && latest.path.length > 1) {
                    res.ready++;
                } else if (latest && latest.status === 'error') {
                    res.errors++;
                } else {
                    res.pending++;
                }
            });
        } catch (e) { }
        return res;
    }

    function floorSlotInfo(mesId) {
        const res = { total: 0, busy: 0, ready: 0, errorBtns: [], errorTexts: [] };
        try {
            const el = getHostDocument().querySelector(`#chat .mes[mesid="${mesId}"]`);
            if (!el) return res;
            const slots = el.querySelectorAll('[data-bbi-slot], [data-bbi-image-slot], .bbi-image-slot');
            res.total = slots.length;
            slots.forEach((slot, seq) => {
                const host = (slot.matches && slot.matches('.bbi-card-host, .bbi-image-slot'))
                    ? slot
                    : (slot.querySelector('.bbi-card-host, .bbi-image-slot') || slot);
                const sr = host && host.shadowRoot;
                if (!sr) return;
                const fig = sr.querySelector('.bbi-figure');
                const phase = fig ? String(fig.getAttribute('data-phase') || '') : '';
                const isBusy = phase === 'queued' || phase === 'generating' ||
                    Boolean(sr.querySelector('.bbi-figure__busy, .bbi-figure__spin, .bbi-figure__bar-spin, .fa-spin, .fa-spinner'));
                const img = sr.querySelector('img.bbi-figure__img, img[src]');
                const srcVal = img ? String(img.getAttribute('src') || img.currentSrc || '') : '';
                const hasImg = phase === 'ready' || Boolean(srcVal && srcVal.length > 4 && !/spinner|loading/i.test(srcVal));
                if (isBusy) res.busy++;
                else if (hasImg) res.ready++;
                else {
                    const errEl = sr.querySelector('.bbi-figure__status--error, [data-error="1"], [class*="error"]');
                    if (errEl && errEl.textContent) res.errorTexts.push(errEl.textContent.replace(/重试$/, '').trim());
                    const isErrPhase = phase === 'error' || Boolean(errEl);
                    const allBtns = Array.from(sr.querySelectorAll('button, [role="button"], .bbi-figure__retry, .bbi-figure__generate, .bbi-figure__placeholder, .bbi-figure__empty'));
                    const retryBtn = sr.querySelector('.bbi-figure__retry') ||
                        (isErrPhase ? sr.querySelector('.bbi-figure__generate') : null) ||
                        allBtns.find(b => /重试|Retry/i.test(b.textContent || b.getAttribute('title') || ''));
                    if (retryBtn && isErrPhase) res.errorBtns.push({ seq, btn: retryBtn, isError: true });
                }
            });
        } catch (e) { }
        return res;
    }

    function floorBusy(mesId) {
        try {
            const dInfo = floorDataSlotInfo(mesId);
            if (dInfo.tagRunning) return true;
            const el = getHostDocument().querySelector(`#chat .mes[mesid="${mesId}"]`);
            const slotInfo = floorSlotInfo(mesId);
            if (slotInfo.busy > 0) return true;
            if (dInfo.total > 0 && dInfo.pending > 0 && dInfo.bgRunning) {
                if (slotInfo.total === 0 || slotInfo.errorBtns.length === 0) return true;
            }
            if (!el) return false;
            const act = el.querySelector('.bbi-tag-action');
            if (act && (act.dataset.running === '1' || /fa-spinner|fa-spin/.test(act.className || ''))) return true;
            if (el.querySelector('.mes_buttons .fa-spinner, .mes_buttons .fa-circle-notch, .mes_buttons .fa-spin, .extraMesButtons .fa-spinner, .extraMesButtons .fa-spin, .mes_img_refresh')) return true;
            const imgs = el.querySelectorAll('.mes_img, .mes_text img');
            for (const img of imgs) {
                if (img.closest('.avatar, .mesAvatarWrapper')) continue;
                const src = img.getAttribute('src') || '';
                if (src && !img.complete) return true;
            }
            return false;
        } catch (e) { return false; }
    }

    function scanFloorMap(book) {
        const map = Object.create(null);
        const b = book || currentBook;
        try { if (dbgOn()) (getHostWindow().__sfl = getHostWindow().__sfl || []).push('scan b=' + (b && b.id) + ' cur=' + (currentBook && currentBook.id) + ' same=' + (b === currentBook) + ' chatLen=' + (getSTContext()?.chat?.length)); } catch (e) { }
        const ctx = getSTContext();
        if (!b || !ctx || !Array.isArray(ctx.chat)) return map;

        const rulesKey = String(settings.customCleanRules || '');
        const domImgSet = new Set();
        try {
            const chatEl = getHostDocument().getElementById('chat');
            if (chatEl) {
                chatEl.querySelectorAll('.mes .mes_img, .mes .mes_text img').forEach(img => {
                    if (img.closest('.avatar, .mesAvatarWrapper')) return;
                    if (img.classList && img.classList.contains('error')) return;
                    if (img.complete && img.naturalWidth > 0 && img.naturalWidth < 80) return;
                    const u = String(img.currentSrc || img.getAttribute('src') || '');
                    if (!u || u.length < 8 || /avatar|user-default|img\/ai4|spinner|loading|\.svg$/i.test(u)) return;
                    const hostMes = img.closest('.mes');
                    if (hostMes) domImgSet.add(Number(hostMes.getAttribute('mesid')));
                });
            }
        } catch (e) { }

        for (let i = 0; i < ctx.chat.length; i++) {
            const msg = ctx.chat[i];
            if (!msg || msg.is_user || msg.is_system) continue;
            let idx = -1;
            let stale = false;

            const mark = getMark(msg);
            if (mark && mark.bookId === b.id) {
                // 正常路径：显式带书
                idx = Number(mark.chunkIndex);
                const chunk = b.chunks[idx];
                if (!chunk) continue;
                if (chunk._hashRules !== rulesKey || !chunk._expectHash) {
                    chunk._hashRules = rulesKey;
                    chunk._expectHash = hashText(formatChunkFloorText(chunk, idx));
                }
                stale = mark.hash !== chunk._expectHash;
            } else if (!mark) {
                // 无 mark 的旧楼层：只截取前 500 字符做轻量匹配，绝不复制或全文正则替换大段小说正文
                const head = typeof msg.mes === 'string' ? (msg.mes.length > 500 ? msg.mes.slice(0, 500) : msg.mes) : '';
                const m = head.match(/【第(\d+)节\s*·\s*([^】]*)】/);
                if (!m) continue;
                const guessed = parseInt(m[1], 10) - 1;
                const chunk = b.chunks[guessed];
                if (!chunk) continue;
                idx = guessed;
                stale = m[2].trim() !== chunk.title;
            } else {
                continue;
            }

            if (!(idx >= 0)) continue;
            const hasImgHere = msgHasExtraImage(msg) || domImgSet.has(i);
            if (map[idx]) {
                if (hasImgHere && !map[idx].hasImage) {
                    map[idx] = { mesId: i, hasImage: true, stale: stale };
                }
                continue;
            }
            map[idx] = { mesId: i, hasImage: hasImgHere, stale: stale };
        }
        return map;
    }

    function matchFloorHeaderFast(msg) {
        if (!msg || typeof msg.mes !== 'string') return null;
        const head = msg.mes.length > 500 ? msg.mes.slice(0, 500) : msg.mes;
        return head.match(/【第(\d+)节\s*·\s*([^】]*)】/);
    }

    function chunkIdxFromMesNode(node) {
        if (!node) return -1;
        const txtEl = node.querySelector ? (node.querySelector('.mes_text') || node) : node;
        const raw = String((txtEl && (txtEl.textContent || txtEl.innerText)) || '');
        const head = raw.length > 500 ? raw.slice(0, 500) : raw;
        const m = head.match(/【第(\d+)节\s*·\s*([^】]*)】/);
        return m ? (parseInt(m[1], 10) - 1) : -1;
    }

    // 认领无标记或同书旧 bookId 楼层，并自动合并清理同一节被重复导入的多余楼层（优先保留有配图的楼层）
    async function adoptLegacyFloors(book) {
        const b = book || currentBook;
        const ctx = getSTContext();
        if (!b || !ctx || !Array.isArray(ctx.chat)) return 0;
        let n = 0;
        const sameCard = Boolean(ctx.name2 && (ctx.name2 === b.cardName || ctx.name2 === b.title));
        for (let i = 0; i < ctx.chat.length; i++) {
            const msg = ctx.chat[i];
            if (!msg || msg.is_user || msg.is_system) continue;
            const mk = getMark(msg);
            if (mk) continue;
            const m = matchFloorHeaderFast(msg);
            let idx = -1;
            if (m) {
                const guessed = parseInt(m[1], 10) - 1;
                const chunk = b.chunks[guessed];
                if (chunk && (m[2].trim() === chunk.title || sameCard)) idx = guessed;
            } else if (mk && typeof mk.chunkIndex === 'number' && sameCard && b.chunks[mk.chunkIndex]) {
                idx = Number(mk.chunkIndex);
            }
            if (idx < 0) continue;
            const chunk = b.chunks[idx];
            if (chunk._expectHash === undefined) {
                chunk._expectHash = hashText(formatChunkFloorText(chunk, idx));
            }
            msg.extra = msg.extra || {};
            msg.extra[MARK_KEY] = {
                bookId: b.id, chunkIndex: idx,
                hash: (mk && mk.hash) || chunk._expectHash,
                createdAt: (mk && mk.createdAt) || nowMs(),
                v: VERSION,
                uiid: (mk && mk.uiid) || ('u' + (++uiidSeq) + '_' + nowMs()),
                legacy: true
            };
            n++;
        }
        dedupeChatByChunk(b);
        return n;
    }

    // 按节号去重：如果同一节（chunkIndex）在聊天里出现了两次，自动保留有图（或较早）的那一层，移除重复层！
    function dedupeChatByChunk(book) {
        const b = book || currentBook;
        const ctx = getSTContext();
        const doc = getHostDocument();
        if (!b || !ctx || !Array.isArray(ctx.chat)) return 0;
        const seenChunk = new Map(); // chunkIndex -> index in ctx.chat
        const toRemove = [];
        const sameCard = Boolean(ctx.name2 && (ctx.name2 === b.cardName || ctx.name2 === b.title));

        for (let i = 0; i < ctx.chat.length; i++) {
            const msg = ctx.chat[i];
            if (!msg || msg.is_user || msg.is_system) continue;
            let idx = -1;
            const mk = getMark(msg);
            if (mk) {
                if (mk.bookId === b.id) idx = Number(mk.chunkIndex);
                else continue;
            } else {
                const m = matchFloorHeaderFast(msg);
                if (m) idx = parseInt(m[1], 10) - 1;
            }
            if (!(idx >= 0)) continue;
            if (!seenChunk.has(idx)) {
                seenChunk.set(idx, i);
            } else {
                const prevI = seenChunk.get(idx);
                const prevMsg = ctx.chat[prevI];
                const prevHasImg = msgHasExtraImage(prevMsg) || /<bbi_image\b/i.test(String(prevMsg && prevMsg.mes || ''));
                const curHasImg = msgHasExtraImage(msg) || /<bbi_image\b/i.test(String(msg.mes || ''));
                if (curHasImg && !prevHasImg) {
                    toRemove.push(prevI);
                    seenChunk.set(idx, i);
                } else {
                    toRemove.push(i);
                }
            }
        }

        if (!toRemove.length) return 0;
        toRemove.sort((a, b) => b - a);
        for (const remIdx of toRemove) {
            const remMsg = ctx.chat[remIdx];
            const remUiid = getMark(remMsg) && getMark(remMsg).uiid;
            ctx.chat.splice(remIdx, 1);
            try {
                let el = remUiid ? doc.querySelector(`#chat .mes[data-uiid="${remUiid}"]`) : null;
                if (!el) el = doc.querySelector(`#chat .mes[mesid="${remIdx}"]`);
                if (el) el.remove();
            } catch (e) { }
        }
        try {
            const chatEl = doc.getElementById('chat');
            if (chatEl) syncMountedMesDom(chatEl, ctx.chat);
        } catch (e) { }
        return toRemove.length;
    }

    // 按"书 + 节号"直接找楼层（O(1) 标记比较，未标记楼层仅匹配前 500 字符头部）
    function findFloorByChunk(bookId, chunkIndex) {
        const ctx = getSTContext();
        if (!ctx || !Array.isArray(ctx.chat)) return -1;
        for (let i = 0; i < ctx.chat.length; i++) {
            const msg = ctx.chat[i];
            if (!msg || msg.is_user || msg.is_system) continue;
            const mk = getMark(msg);
            if (mk) {
                if (Number(mk.chunkIndex) === chunkIndex) {
                    if (mk.bookId === bookId) return i;
                }
                continue;
            }
            const m = matchFloorHeaderFast(msg);
            if (m && (parseInt(m[1], 10) - 1) === chunkIndex) {
                const b = currentBook;
                if (b && b.chunks && b.chunks[chunkIndex] && (m[2].trim() === b.chunks[chunkIndex].title || (ctx.name2 && (ctx.name2 === b.cardName || ctx.name2 === b.title)))) {
                    msg.extra = msg.extra || {};
                    msg.extra[MARK_KEY] = {
                        bookId: bookId || b.id,
                        chunkIndex: chunkIndex,
                        hash: b.chunks[chunkIndex]._expectHash || hashText(formatChunkFloorText(b.chunks[chunkIndex], chunkIndex)),
                        createdAt: nowMs(),
                        v: VERSION,
                        uiid: 'u' + (++uiidSeq) + '_' + nowMs()
                    };
                    return i;
                }
            }
        }
        return -1;
    }

    function tagUiid(mesId, uiid) {
        const el = getHostDocument().querySelector(`#chat .mes[mesid="${mesId}"]`);
        if (el && uiid) el.dataset.uiid = uiid;
    }

    // 老楼层没有 uiid：补一个并写回消息，之后排序才认得出它们
    function ensureUiids() {
        const ctx = getSTContext();
        const doc = getHostDocument();
        if (!ctx || !Array.isArray(ctx.chat)) return;
        for (let i = 0; i < ctx.chat.length; i++) {
            const mk = getMark(ctx.chat[i]);
            if (!mk) continue;
            if (!mk.uiid) mk.uiid = 'u' + (++uiidSeq) + '_' + nowMs();
            const el = doc.querySelector(`#chat .mes[mesid="${i}"]`);
            if (el && el.dataset.uiid !== mk.uiid) el.dataset.uiid = mk.uiid;
        }
    }

    function sortedDeployed(map) {
        return Object.keys(map).map(Number).sort((a, b) => a - b);
    }

    // 视口检测在滚动里每帧都会跑，不用 querySelectorAll 全量扫（几百层时那是几万次
    // getBoundingClientRect）。改成从中间那一点往上/下各找一层就停：视口正中的那一层
    // 必然在附近，命中即可返回。
    function detectVisible() {
        const doc = getHostDocument();
        const chatEl = doc.getElementById('chat');
        if (!chatEl) return null;
        const cr = chatEl.getBoundingClientRect();
        const focusY = cr.top + cr.height * 0.32;

        // 用 elementFromPoint 直接命中焦点行附近的节点；命中的可能是楼内元素，往上找 .mes
        let best = null;
        try {
            const probe = doc.elementFromPoint(cr.left + Math.min(cr.width / 2, (cr.width || 0) - 12), focusY);
            let n = probe;
            while (n && n !== chatEl) {
                if (n.classList && n.classList.contains('mes')) { best = n; break; }
                n = n.parentElement;
            }
        } catch (e) { }

        if (!best) {
            // 焦点处是空白（贴在文末、尾部余量里）时 elementFromPoint 命中的是 #chat 本身。
            // 这时取"焦点上方最近的一层"当作正在读的位置，别再往后附会。
            const kids = chatEl.children;
            let lo = 0, hi = kids.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const r = kids[mid].getBoundingClientRect();
                if (r.top <= focusY) lo = mid + 1; else hi = mid - 1;
            }
            for (let i = Math.min(lo, kids.length - 1); i >= 0 && i > lo - 60; i--) {
                const el = kids[i];
                if (el && el.classList && el.classList.contains('mes')) { best = el; break; }
            }
        }
        if (!best) return null;
        const mesId = parseInt(best.getAttribute('mesid'), 10);
        if (isNaN(mesId)) return null;
        const ctx = getSTContext();
        const msg = (ctx && Array.isArray(ctx.chat)) ? ctx.chat[mesId] : null;
        const mark = getMark(msg);
        let idx = mark ? Number(mark.chunkIndex) : -1;
        if (idx < 0 && msg) {
            const m = String(msg.mes || '').match(FLOOR_HEADER_RE);
            if (m) idx = parseInt(m[1], 10) - 1;
        }
        return { mesId, chunkIdx: idx };
    }

    // 视口顶端那一层（"正在读哪一节"以它为准）。
    // 用 32% 处的焦点当阅读位置会把"当前节"报成屏幕中段甚至更下面，
    // 上一节/下一节于是每次跳两三层。
    function detectTopFloor() {
        const chatEl = getHostDocument().getElementById('chat');
        if (!chatEl) return null;
        const cr = chatEl.getBoundingClientRect();
        // 探针要探进一点，不能贴在最上沿：楼层之间有几像素重叠，
        // 落点刚好在 0~6px 时，最上沿命中的往往是上一层的尾巴，
        // 于是"当前读到哪一节"整体偏小一节。
        const probeY = cr.top + 36;

        // 先看"当前楼层"标记：跳转刚落下时它就是要读的那一节，
        // 而重叠区按绘制顺序命中，会稳定地错报成上一层。
        try {
            const act = chatEl.querySelector(':scope > .mes.th-novel-active-floor');
            if (act) {
                const ar = act.getBoundingClientRect();
                if (ar.top >= cr.top - 8 && ar.top <= cr.top + 90) {
                    const id = parseInt(act.getAttribute('mesid'), 10);
                    const ctx0 = getSTContext();
                    const msg0 = (ctx0 && Array.isArray(ctx0.chat)) ? ctx0.chat[id] : null;
                    const mk0 = getMark(msg0);
                    if (mk0) return { mesId: id, chunkIdx: Number(mk0.chunkIndex) };
                }
            }
        } catch (e) { }
        let el = null;
        try {
            const hit = getHostDocument().elementFromPoint(Math.min(cr.left + 40, cr.right - 8), probeY);
            let n = hit;
            while (n && n !== chatEl) {
                if (n.classList && n.classList.contains('mes')) { el = n; break; }
                n = n.parentElement;
            }
        } catch (e) { }
        if (!el) {
            // 顺序是用 CSS order 排的，DOM 顺序不等于视觉顺序，只能按位置找。
            // 取"底边还在探针下方、且顶点最高"的那一层。
            let bestTop = Infinity;
            for (const n of chatEl.children) {
                if (!n.classList || !n.classList.contains('mes')) continue;
                const r = n.getBoundingClientRect();
                if (r.bottom <= probeY || r.height <= 0) continue;
                if (r.top < bestTop) { bestTop = r.top; el = n; }
            }
        }
        if (!el) return null;
        const mesId = parseInt(el.getAttribute('mesid'), 10);
        if (isNaN(mesId)) return null;
        const ctx = getSTContext();
        const msg = (ctx && Array.isArray(ctx.chat)) ? ctx.chat[mesId] : null;
        const mk = getMark(msg);
        const idx = mk ? Number(mk.chunkIndex) : -1;
        return { mesId, chunkIdx: idx };
    }

    // "当前读到哪一节"：以视口顶端那一层为准，取不到才退回焦点层。
    function currentChunkIndex() {
        if (!currentBook) return 0;
        const maxIdx = Math.max(0, (currentBook.chunks || []).length - 1);
        if (!userTookOver && jumpGuardUntil > nowMs()) {
            return Math.min(Math.max(0, currentBook.currentIndex || 0), maxIdx);
        }
        // 若目录弹窗正打开着，elementFromPoint 会命中目录遮罩层，此时直接取当前激活楼层标记或书籍记录进度（O(1) 零重排）
        if (panelEl && panelEl.isConnected) {
            const mk = markedChunkIdx();
            if (mk >= 0 && mk < currentBook.chunks.length) return mk;
            return Math.min(Math.max(0, currentBook.currentIndex || 0), maxIdx);
        }
        const vis = detectTopFloor() || detectVisible();
        if (vis && vis.chunkIdx >= 0 && vis.chunkIdx < currentBook.chunks.length) return vis.chunkIdx;
        return Math.min(Math.max(0, currentBook.currentIndex || 0), maxIdx);
    }

    // ============ 铺设楼层 ============
    function buildMessage(book, chunkIndex) {
        if (dbgOn() && window.__bm) window.__bm.push('build book=' + book.id + ' cur=' + (currentBook && currentBook.id) + ' inst=' + INST + ' chunk=' + chunkIndex);
        const ctx = getSTContext();
        const chunk = book.chunks[chunkIndex];
        const text = formatChunkFloorText(chunk, chunkIndex);
        const charName = (ctx && ctx.name2) || book.cardName || book.title || 'Novel';
        const msg = {
            name: charName,
            ch_name: charName,
            is_user: false,
            is_system: false,
            send_date: new Date().toISOString(),
            mes: text,
            swipes: [text],
            swipe_id: 0,
            extra: {}
        };
        msg.extra[MARK_KEY] = { bookId: book.id, chunkIndex, hash: hashText(text), createdAt: nowMs(), v: VERSION, uiid: 'u' + (++uiidSeq) + '_' + nowMs() };
        try {
            const idx = ctx && ctx.characterId !== undefined ? ctx.characterId : -1;
            const ch = (ctx && Array.isArray(ctx.characters) && ctx.characters[idx]) ? ctx.characters[idx] : null;
            if (ch && ch.avatar) msg.force_avatar = ch.avatar;
        } catch (e) { }
        return msg;
    }

    // 已铺则返回 mesId；未铺则铺楼并返回新 mesId。stale 会原地刷新正文。
    // 同一节正在铺设时，后来的调用等着复用，而不是再铺一层。
    // 触发者是两条独立路径：阅读器滚到底自动续铺，与目录/队列点名要这一节。
    // 两边都在同一帧里查到"还没铺"，于是各推一条消息 —— 同一节出现两层楼，
    // 生图按层号走就会同一节画两遍，目录也认不出哪层才是。
    const deployLocks = new Map(); // chunkIndex -> Promise<mesId>

    async function deployFloor(chunkIndex, opts) {
        if (isDead()) return -1;
        opts = opts || {};
        const book = opts.book || currentBook;
        if (dbgOn() && window.__dbg) window.__dbg.push('deploy(' + chunkIndex + ') book=' + (book && book.id) + ' cur=' + (currentBook && currentBook.id) + ' ' + STK());
        if (!book || !Array.isArray(book.chunks) || !book.chunks[chunkIndex]) return -1;

        if (!opts.batchMode) {
            const dupId = findFloorByChunk(book.id, chunkIndex);
            if (dupId >= 0) {
                const msg = (getSTContext()?.chat || [])[dupId];
                const mk = getMark(msg);
                const chunk = book.chunks[chunkIndex];
                if (mk && chunk) {
                    const rulesKey = String(settings.customCleanRules || '');
                    if (chunk._hashRules !== rulesKey || !chunk._expectHash) {
                        chunk._hashRules = rulesKey;
                        chunk._expectHash = hashText(formatChunkFloorText(chunk, chunkIndex));
                    }
                    if (mk.hash !== chunk._expectHash) await refreshStaleFloors(book, chunkIndex);
                }
                return dupId;
            }
        }

        const lockKey = book.id + '#' + chunkIndex;
        const running = deployLocks.get(lockKey);
        if (running) return running;

        const job = (async () => {
            try {
                return await deployFloorNow(book, chunkIndex, opts);
            } finally {
                deployLocks.delete(lockKey);
            }
        })();
        deployLocks.set(lockKey, job);
        return job;
    }

    async function deployFloorNow(book, chunkIndex, opts) {
        opts = opts || {};

        if (!opts.batchMode && !hasOpenChat() && !(await ensureOpenChat())) {
            notify('error', '还没打开聊天，也没能自动新建。请先在角色页开一个对话');
            return -1;
        }

        const ctx = getSTContext();
        if (!ctx || !Array.isArray(ctx.chat)) {
            notify('error', '拿不到酒馆聊天上下文，请先进入角色聊天界面');
            return -1;
        }

        if (typeof ctx.addOneMessage !== 'function') {
            notify('error', '酒馆没有暴露 addOneMessage，无法铺楼');
            return -1;
        }

        const chatElRef = getHostDocument().getElementById('chat');
        if (!opts.batchMode) {
            dedupeChat(ctx.chat);
            const alreadyId = findFloorByChunk(book.id, chunkIndex);
            if (alreadyId >= 0) return alreadyId;
        }

        const msg = buildMessage(book, chunkIndex);
        ctx.chat.push(msg);
        let mesId = ctx.chat.length - 1;
        const uiid = msg.extra[MARK_KEY].uiid;

        if (opts.chatOnly) {
            return mesId;
        }

        if (opts.batchMode) {
            // 批量按序补齐楼层快速通道：必须传入 forceId: mesId，防止 TauriTavern 虚拟列表下 addOneMessage 用 DOM 子节点数覆盖真实 mesid！
            ctx.addOneMessage(msg, { scroll: false, forceId: mesId });
            const lastMes = chatElRef ? chatElRef.querySelector(':scope > .mes:last-child') : null;
            if (lastMes) {
                lastMes.setAttribute('mesid', String(mesId));
                if (uiid) lastMes.dataset.uiid = uiid;
            } else {
                tagUiid(mesId, uiid);
            }
            return mesId;
        }

        const prevEls = chatElRef ? chatElRef.querySelectorAll(':scope > .mes') : null;
        const prevH = (prevEls && prevEls.length) ? prevEls[prevEls.length - 1].getBoundingClientRect().height : 0;

        const snapshot = new Set(chatElRef ? chatElRef.querySelectorAll(':scope > .mes') : []);
        const nodeNew = () => {
            if (!chatElRef) return null;
            for (const n of chatElRef.querySelectorAll(':scope > .mes')) if (!snapshot.has(n)) return n;
            return null;
        };
        const markNew = () => {
            const n = nodeNew();
            if (n) {
                n.setAttribute('mesid', String(mesId));
                if (uiid) n.dataset.uiid = uiid;
            } else {
                tagUiid(mesId, uiid);
            }
            return n;
        };
        if (opts.hold === false || queueRunning || bgGenScrollLockDepth > 0) {
            ctx.addOneMessage(msg, { scroll: false, forceId: mesId });
            markNew();
            if (!opts.skipReorder) {
                if (reorderTimer) { clearTimeout(reorderTimer); reorderTimer = null; }
                reorderNow(book.id);
                refreshSentinel();
            }
        } else {
            withFrozenScroll(() => {
                ctx.addOneMessage(msg, { scroll: false, forceId: mesId });
                const fresh = markNew();
                holdHeightUntilContent(fresh || (chatElRef && chatElRef.querySelector(':scope > .mes:last-child')), prevH);
                if (!opts.skipReorder) {
                    if (reorderTimer) { clearTimeout(reorderTimer); reorderTimer = null; }
                    reorderNow(book.id);
                }
                refreshSentinel();
            });
        }

        if (!opts.skipReorder) {
            const settledId = findFloorByChunk(book.id, chunkIndex);
            if (settledId >= 0) mesId = settledId;
        }

        if (!opts.skipSave && typeof ctx.saveChat === 'function') {
            try { await ctx.saveChat(); } catch (e) { }
        }
        return mesId;
    }

    function dedupeChat(chat) {
        if (!Array.isArray(chat)) return 0;
        const seen = new Set();
        let dup = 0;
        for (let i = 0; i < chat.length; i++) {
            const m = chat[i];
            if (seen.has(m)) { chat.splice(i, 1); i--; dup++; }
            else seen.add(m);
        }
        return dup;
    }

    // 同步校准 #chat 中当前挂载的所有 .mes DOM 节点的 mesid、data-uiid 与物理 DOM 顺序：
    // 解决 TauriTavern 虚拟列表重挂载节点后丢失 data-uiid、addOneMessage 按挂载节点数写错 mesid、以及负序 style.order 导致章节与楼层编号混乱的问题！
    function syncMountedMesDom(chatEl, chatArr) {
        if (!chatEl || !Array.isArray(chatArr) || !chatArr.length) return;
        try {
            const b = currentBook;
            const chunkToMesId = new Map();
            const uiidToMesId = new Map();
            for (let i = 0; i < chatArr.length; i++) {
                const msg = chatArr[i];
                const mk = getMark(msg);
                if (!mk) continue;
                if (!mk.uiid) mk.uiid = 'u' + (++uiidSeq) + '_' + nowMs();
                uiidToMesId.set(mk.uiid, i);
                if (!b || mk.bookId === b.id) {
                    chunkToMesId.set(Number(mk.chunkIndex), i);
                }
            }

            const mounted = [...chatEl.querySelectorAll(':scope > .mes')];
            if (!mounted.length) return;

            const seenMesId = new Map();
            for (const node of mounted) {
                let trueId = -1;
                // 优先级 1：直接按节点正文里的【第X节 · ...】标题反查真实楼层号（即使 TauriTavern 重挂载弄丢了 data-uiid 或写错了 mesid 也 100% 准确！）
                const cIdx = chunkIdxFromMesNode(node);
                if (node.dataset.uiid && uiidToMesId.has(node.dataset.uiid)) {
                    trueId = uiidToMesId.get(node.dataset.uiid);
                } else if (Number.isInteger(Number(node.getAttribute('mesid'))) &&
                    getMark(chatArr[Number(node.getAttribute('mesid'))])?.chunkIndex === cIdx) {
                    trueId = Number(node.getAttribute('mesid'));
                } else if (cIdx >= 0 && chunkToMesId.has(cIdx)) {
                    trueId = chunkToMesId.get(cIdx);
                } else {
                    const attrId = parseInt(node.getAttribute('mesid'), 10);
                    if (Number.isFinite(attrId) && attrId >= 0 && attrId < chatArr.length) {
                        trueId = attrId;
                    }
                }

                if (trueId >= 0 && trueId < chatArr.length) {
                    if (seenMesId.has(trueId)) {
                        // 移除同一楼层被重复渲染出来的多余 DOM 壳
                        try { node.remove(); } catch (e) { }
                        continue;
                    }
                    seenMesId.set(trueId, node);
                    if (node.getAttribute('mesid') !== String(trueId)) {
                        node.setAttribute('mesid', String(trueId));
                    }
                    const mk = getMark(chatArr[trueId]);
                    if (mk && mk.uiid && node.dataset.uiid !== mk.uiid) {
                        node.dataset.uiid = mk.uiid;
                    }
                    node.style.flex = '0 0 auto';
                    node.style.order = String(trueId);
                }
            }

            // 检查当前挂载的 .mes 物理 DOM 顺序是否严格按 mesid 递增；若有乱序则物理搬移对齐
            const validNodes = [...chatEl.querySelectorAll(':scope > .mes')];
            let domOutOfOrder = false;
            for (let k = 1; k < validNodes.length; k++) {
                const prevId = parseInt(validNodes[k - 1].getAttribute('mesid'), 10);
                const curId = parseInt(validNodes[k].getAttribute('mesid'), 10);
                if (Number.isFinite(prevId) && Number.isFinite(curId) && curId < prevId) {
                    domOutOfOrder = true;
                    break;
                }
            }
            if (domOutOfOrder) {
                const sortedNodes = validNodes.slice().sort((a, b) => {
                    return (parseInt(a.getAttribute('mesid'), 10) || 0) - (parseInt(b.getAttribute('mesid'), 10) || 0);
                });
                const sentinel = getHostDocument().getElementById('th-novel-sentinel');
                for (const n of sortedNodes) {
                    if (sentinel && sentinel.parentNode === chatEl) chatEl.insertBefore(n, sentinel);
                    else chatEl.appendChild(n);
                }
            }
        } catch (e) { }
    }

    // 确保从第 1 节（0）到 targetMaxIdx 的所有中间章节全部按严格递增顺序导入楼层中：
    // 1) 解决「在目录点击跳转不会把当前看的章节和目标章节中间的章节导入楼中」；
    // 2) 保证所有章节从 0 到 targetMaxIdx 连续无空洞，每节的楼层编号 #mesId 永久固定，彻底根治多次跳转后章节与楼编号错乱！
    async function ensureContiguousFloorsUpTo(book, targetMaxIdx, focusIdx) {
        const b = book || currentBook;
        if (!b || !Array.isArray(b.chunks) || !b.chunks.length) return;
        if (!hasOpenChat() && !(await ensureOpenChat())) return;
        const ctx = getSTContext();
        if (!ctx || !Array.isArray(ctx.chat)) return;

        await adoptLegacyFloors(b);
        const maxIdx = Math.min(b.chunks.length - 1, Math.max(0, Number(targetMaxIdx) || 0));

        const existingSet = new Set();
        for (let i = 0; i < ctx.chat.length; i++) {
            const mk = getMark(ctx.chat[i]);
            if (mk && mk.bookId === b.id) existingSet.add(Number(mk.chunkIndex));
        }

        const missing = [];
        for (let s = 0; s <= maxIdx; s++) {
            if (!existingSet.has(s)) missing.push(s);
        }

        if (missing.length > 0) {
            const fIdx = typeof focusIdx === 'number' ? focusIdx : maxIdx;
            // 若缺失节数在 80 节以内，全部直接创建并挂载；若跨度极大（>80 节），全部写入 ctx.chat 保证楼层编号连续，并重点挂载目标点前后窗口的 DOM
            const mountAllDom = missing.length <= 80;
            for (let k = 0; k < missing.length; k++) {
                if (isDead()) return;
                const s = missing[k];
                const mountDomHere = mountAllDom || (s >= fIdx - 6 && s <= maxIdx);
                await deployFloor(s, {
                    book: b,
                    hold: false,
                    skipSave: true,
                    skipReorder: true,
                    batchMode: true,
                    chatOnly: !mountDomHere
                });
                if ((k + 1) % 25 === 0) await sleep(0);
            }
        }

        if (reorderTimer) { clearTimeout(reorderTimer); reorderTimer = null; }
        reorderNow(b.id);
        refreshSentinel();
    }

    function placeFloorInOrder(bookId) {
        scheduleReorder(bookId);
    }

    let reorderTimer = null;
    function scheduleReorder(bookId) {
        if (reorderTimer) { clearTimeout(reorderTimer); reorderTimer = null; }
        const run = () => {
            reorderTimer = null;
            reorderNow(bookId);
        };
        if (document.querySelector('#chat .mes')) run();
        else reorderTimer = setTimeout(run, 40);
    }

    function reorderNow(bookId) {
        try {
            const ctx = getSTContext();
            const doc = getHostDocument();
            const chatEl = doc.getElementById('chat');
            if (!ctx || !Array.isArray(ctx.chat) || !chatEl) return;

            dedupeChat(ctx.chat);
            if (currentBook) dedupeChatByChunk(currentBook);
            ensureUiids();

            const marked = [];
            for (let i = 0; i < ctx.chat.length; i++) {
                const mk = getMark(ctx.chat[i]);
                if (mk) marked.push({ msg: ctx.chat[i], mk, pos: i });
            }
            if (!marked.length) return;

            const bookRank = new Map();
            for (const it of marked) {
                if (!bookRank.has(it.mk.bookId)) bookRank.set(it.mk.bookId, it.pos);
            }

            // 检查 ctx.chat 是否已经严格按 (bookRank, chunkIndex) 排好序且紧密排在末尾
            let alreadySorted = true;
            const firstMarkedPos = marked[0].pos;
            for (let k = 0; k < marked.length; k++) {
                if (marked[k].pos !== firstMarkedPos + k) { alreadySorted = false; break; }
                if (k > 0) {
                    const a = marked[k - 1], b = marked[k];
                    const ra = bookRank.get(a.mk.bookId), rb = bookRank.get(b.mk.bookId);
                    if (ra > rb || (ra === rb && Number(a.mk.chunkIndex) > Number(b.mk.chunkIndex))) {
                        alreadySorted = false;
                        break;
                    }
                }
            }

            if (!alreadySorted) {
                const top = rawTop(chatEl);
                const anchor = pickAnchor(chatEl);

                const orderedMarked = marked.slice().sort((a, b) => {
                    const ra = bookRank.get(a.mk.bookId);
                    const rb = bookRank.get(b.mk.bookId);
                    if (ra !== rb) return ra - rb;
                    return Number(a.mk.chunkIndex) - Number(b.mk.chunkIndex);
                });

                const markedSet = new Set(marked.map(x => x.msg));
                const next = [];
                const used = new Set();
                for (let i = 0; i < ctx.chat.length; i++) {
                    const msg = ctx.chat[i];
                    if (!markedSet.has(msg)) {
                        if (used.has(msg)) continue;
                        used.add(msg);
                        next.push(msg);
                    }
                }
                const seen = new Set();
                for (const it of orderedMarked) {
                    if (seen.has(it.msg)) continue;
                    seen.add(it.msg);
                    next.push(it.msg);
                }
                if (next.length) {
                    for (let i = 0; i < next.length; i++) ctx.chat[i] = next[i];
                    if (ctx.chat.length > next.length) ctx.chat.length = next.length;
                }

                syncMountedMesDom(chatEl, ctx.chat);
                if (!queueRunning && bgGenScrollLockDepth <= 0) {
                    if (jumpGuardUntil > 0 && nowMs() < jumpGuardUntil) reassertJump();
                    else correctToAnchor(chatEl, anchor, top);
                }
            } else {
                syncMountedMesDom(chatEl, ctx.chat);
            }
        } catch (e) { }
    }

    // 重新切分后，把仍在聊天里的旧楼层按新内容原地改写（若传 onlyChunkIndex 则只刷新该节，避免大书全表扫描卡顿）
    async function refreshStaleFloors(book, onlyChunkIndex) {
        const b = book || currentBook;
        if (!b) return 0;
        const ctx = getSTContext();
        const doc = getHostDocument();
        if (!ctx || !Array.isArray(ctx.chat)) return 0;

        const hasOnly = typeof onlyChunkIndex === 'number' && onlyChunkIndex >= 0;
        let changed = 0;
        const changedIds = [];
        const chatEl = doc.getElementById('chat');
        const saveTop = chatEl ? rawTop(chatEl) : 0;

        for (let i = 0; i < ctx.chat.length; i++) {
            const msg = ctx.chat[i];
            const mark = getMark(msg);
            if (!mark || mark.bookId !== b.id) continue;
            const idx = Number(mark.chunkIndex);
            if (hasOnly && idx !== onlyChunkIndex) continue;
            const chunk = b.chunks[idx];

            if (!chunk) {
                // 新切分下这个序号已不存在：清空正文留空壳，避免读者看到错位内容
                const text = `【第${idx + 1}节 · 已合并】\n\n（重新切分后本节内容已并入其他楼层）`;
                if (msg.mes !== text) { msg.mes = text; changed++; changedIds.push(i); }
                continue;
            }
            const want = formatChunkFloorText(chunk, idx);
            const wantHash = hashText(want);
            if (mark.hash === wantHash) continue;
            // 如果这一楼已经有墨影的 <bbi_image> 标签，只更新 mark.hash，别把已生成的生图标签冲掉
            if (/<bbi_image\b/i.test(String(msg.mes || ''))) {
                mark.hash = wantHash;
                continue;
            }
            if (msg.mes === want) {
                mark.hash = wantHash;
                continue;
            }
            msg.mes = want;
            if (Array.isArray(msg.swipes) && msg.swipes.length) msg.swipes[msg.swipe_id || 0] = want;
            msg.extra[MARK_KEY] = { bookId: b.id, chunkIndex: idx, hash: wantHash, createdAt: nowMs(), v: VERSION, uiid: mark.uiid };
            changed++;
            changedIds.push(i);
        }

        // 新切分后已经不存在的序号：楼层正文已被换成“已合并”，直接移除，避免读者翻到空壳（单节快速路径不移除其它节）
        let removed = 0;
        if (!hasOnly) {
            for (let i = ctx.chat.length - 1; i >= 0; i--) {
                const msg = ctx.chat[i];
                const mark = getMark(msg);
                if (!mark || mark.bookId !== b.id) continue;
                if (b.chunks[Number(mark.chunkIndex)]) continue;
                ctx.chat.splice(i, 1);
                const el = doc.querySelector(`#chat .mes[mesid="${i}"]`);
                if (el) el.remove();
                removed++;
            }
            if (removed) {
                doc.querySelectorAll('#chat .mes').forEach((el, i) => el.setAttribute('mesid', String(i)));
                placeFloorInOrder(b.id);
            }
        }

        if (changed > 0) {
            for (const i of changedIds) {
                const msg = ctx.chat[i];
                if (!msg) continue;
                const mark = getMark(msg);
                if (!mark || mark.bookId !== b.id) continue;
                const idx = Number(mark.chunkIndex);
                const chunk = b.chunks[idx];
                if (!chunk) continue;
                const want = formatChunkFloorText(chunk, idx);
                try {
                    const el = doc.querySelector(`#chat .mes[mesid="${i}"] .mes_text`);
                    if (el) {
                        el.innerHTML = (typeof ctx.messageFormatting === 'function')
                            ? ctx.messageFormatting(want, msg.name || ctx.name2, false, false, i)
                            : esc(want).replace(/\n/g, '<br>');
                    }
                } catch (e) { }
            }
            if (chatEl) setTopRaw(chatEl, saveTop);
            if (typeof ctx.saveChat === 'function') { try { await ctx.saveChat(); } catch (e) { } }
        }
        return changed;
    }

    async function removeFloorsOfBook(bookId) {
        const ctx = getSTContext();
        if (!ctx || !Array.isArray(ctx.chat)) return 0;
        let n = 0;
        for (let i = ctx.chat.length - 1; i >= 0; i--) {
            const mark = getMark(ctx.chat[i]);
            if (mark && mark.bookId === bookId) {
                ctx.chat.splice(i, 1);
                try {
                    const el = getHostDocument().querySelector(`#chat .mes[mesid="${i}"]`);
                    if (el) el.remove();
                } catch (e) { }
                n++;
            }
        }
        if (n && typeof ctx.saveChat === 'function') { try { await ctx.saveChat(); } catch (e) { } }
        // mesid 变了，DOM 属性也得跟着重编
        try {
            getHostDocument().querySelectorAll('#chat .mes').forEach((el, i) => el.setAttribute('mesid', String(i)));
        } catch (e) { }
        return n;
    }

    // ============ 生图：找按钮 → 触发 → 等图 ============
    function mesEl(mesId) {
        return getHostDocument().querySelector(`#chat .mes[mesid="${mesId}"]`);
    }

    function isExpander(el) {
        if (!el) return false;
        if (el.closest && el.closest('.extraMesButtonsHint')) return true;
        const cls = typeof el.className === 'string' ? el.className : '';
        return /extraMesButtonsHint|fa-ellipsis/i.test(cls);
    }

    function expandFloorMenu(mesEl) {
        if (!mesEl) return;
        try {
            const box = mesEl.querySelector('.extraMesButtons');
            const hint = mesEl.querySelector('.extraMesButtonsHint');
            if (box) {
                const disp = getHostWindow().getComputedStyle(box).display;
                if (disp === 'none' || !box.classList.contains('visible')) {
                    if (hint) hint.click();
                    box.style.display = 'flex';
                    box.classList.add('visible');
                }
            } else if (hint) {
                hint.click();
            }
        } catch (e) { }
    }

    function relativeSelector(el, root) {
        if (!el) return '';
        if (el.id) return '#' + CSS.escape(el.id);
        const keep = Array.from(el.classList || []).filter(c =>
            !/^(mes_button|fa-solid|fa-regular|fas|far|fa|interactable|visible|th-nv-btn)$/.test(c));
        if (keep.length) return '.' + keep.map(c => CSS.escape(c)).join('.');
        const title = el.getAttribute('title') || el.getAttribute('data-i18n');
        if (title) return `${el.tagName.toLowerCase()}[title="${title.replace(/"/g, '\\"')}"]`;
        const parts = [];
        let cur = el;
        while (cur && cur !== root && cur.parentElement && parts.length < 4) {
            const sibs = Array.from(cur.parentElement.children);
            parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${sibs.indexOf(cur) + 1})`);
            cur = cur.parentElement;
        }
        return parts.join(' > ');
    }

    function realClick(el) {
        if (!el) return false;
        try {
            el.dispatchEvent(new MouseEvent('click', { view: getHostWindow(), bubbles: true, cancelable: true, button: 0 }));
            return true;
        } catch (e) {
            try { el.click(); return true; } catch (err) { return false; }
        }
    }

    // 顺序即优先级：墨影（.bbi-tag-action）把图写进正文，优先；其后是通用 stable-diffusion 按钮
    const CANDIDATE_SELECTORS = [
        '.bbi-tag-action',
        '.extraMesButtons .bbi-tag-action',
        '.extraMesButtons .fa-palette',
        '.fa-palette',
        '.sd_message_gen',
        '.mes_button[title*="生图"]',
        '.mes_button[title*="配图"]',
        '.mes_button[title*="插图"]',
        '.mes_button[title*="画"]',
        '.mes_button[title*="Image" i]',
        '.extraMesButtons .fa-paintbrush',
        '.extraMesButtons .fa-image',
        '.extraMesButtons .fa-wand-magic-sparkles'
    ];

    // 返回 { ok, how, reason }
    async function triggerIllustration(mesId) {
        watchGenErrors();
        // 生图插件（墨影）要 getCurrentChatId()，没有聊天就只弹提示不生成。
        if (!hasOpenChat() && !(await ensureOpenChat())) {
            return { ok: false, reason: '没有打开的聊天，也没能自动新建，请先开一个对话' };
        }
        const doc = getHostDocument();
        const w = getHostWindow();
        const rawBoundSel = String(settings.boundBtnSelector || '').trim();
        const isDefaultBbiSel = !rawBoundSel ||
            rawBoundSel === '.bbi-tag-action' ||
            /extraMesButtonsHint|fa-ellipsis|sd_message_gen/.test(rawBoundSel);
        const customSel = (!isDefaultBbiSel && !isExpander({ className: rawBoundSel })) ? rawBoundSel : '';

        // 优先走墨影公开 API 直调（无需滚动视口、无需等待 DOM 按钮挂载、无需弹确认框，手机切后台也能 100% 触发）
        const bbi = w && w.STBaiBaiImage;
        if (!customSel && settings.boundBtnType !== 'global' && !(settings.boundSlashCmd && settings.boundSlashCmd.trim()) &&
            bbi && typeof bbi.requestFloorTags === 'function') {
            setGenError('');
            try {
                lastTagReqState = { mesId, pending: true, settledAt: 0, failed: false, reason: '' };
                const requestState = lastTagReqState;
                const p = Promise.resolve(bbi.requestFloorTags(mesId, { replace: true }));
                p.then(res => {
                    requestState.pending = false;
                    requestState.settledAt = nowMs();
                    if (res && res.status === 'failed' && Array.isArray(res.errors) && res.errors.length) {
                        const errStr = String(res.errors[0] || '自动生图 tag 失败');
                        requestState.failed = true;
                        requestState.reason = errStr;
                        setGenError(errStr);
                    }
                }).catch(err => {
                    const errStr = String((err && err.message) || err || '自动生图异常');
                    requestState.pending = false;
                    requestState.settledAt = nowMs();
                    requestState.failed = true;
                    requestState.reason = errStr;
                    setGenError(errStr);
                });
                await sleep(120);
                return { ok: true, how: 'api:requestFloorTags' };
            } catch (e) {
                lastTagReqState.pending = false;
            }
        }

        let el = mesEl(mesId);
        for (let i = 0; i < 8 && !el; i++) { await sleep(220); el = mesEl(mesId); }
        if (!el) return { ok: false, reason: `找不到 #${mesId} 楼` };

        expandFloorMenu(el);
        await sleep(160);

        const selectors = [];
        if (settings.boundBtnSelector && !isExpander({ className: settings.boundBtnSelector }) &&
            !/extraMesButtonsHint|fa-ellipsis/.test(settings.boundBtnSelector)) {
            selectors.push(settings.boundBtnSelector);
        }
        selectors.push(...CANDIDATE_SELECTORS);

        // 后台铺楼时插件的 MutationObserver 可能慢半拍才挂上 .bbi-tag-action，多等几拍
        for (let waitRound = 0; waitRound < 8; waitRound++) {
            el = mesEl(mesId) || el;
            expandFloorMenu(el);
            for (const sel of selectors) {
                let hit = null;
                try { hit = el.querySelector(sel); } catch (e) { continue; }
                if (!hit || isExpander(hit)) continue;
                const btn = hit.closest('.mes_button, button, a') || hit;
                setGenError('');
                const hadTags = /bbi-tag-action/.test(sel) && floorTagCount(mesId) > 0;
                if (realClick(btn)) {
                    if (hadTags) {
                        await sleep(140);
                        await confirmMoyingDialog();
                        await sleep(120);
                    } else {
                        await sleep(100);
                    }
                    return { ok: true, how: sel };
                }
            }
            if (settings.boundBtnType === 'global' || (settings.boundSlashCmd && settings.boundSlashCmd.trim())) break;
            await sleep(200);
        }

        // 如果目标楼层刚在后台铺好、墨影的 MutationObserver 还没来得及给它挂上 .bbi-tag-action，
        // 先派发一次 CHARACTER_MESSAGE_RENDERED 促使墨影挂载本楼按钮；若仍未挂上则借用空闲按钮触发
        if (!customSel) {
            try {
                const ctx = getSTContext();
                if (ctx && ctx.eventSource && ctx.event_types && ctx.event_types.CHARACTER_MESSAGE_RENDERED) {
                    try { await ctx.eventSource.emit(ctx.event_types.CHARACTER_MESSAGE_RENDERED, mesId); } catch (e) { }
                    await sleep(260);
                }
                el = mesEl(mesId) || el;
                const ownBtn = el && el.querySelector('.bbi-tag-action');
                if (ownBtn) {
                    setGenError('');
                    if (realClick(ownBtn)) {
                        await sleep(120);
                        return { ok: true, how: 'rendered:.bbi-tag-action' };
                    }
                }
            } catch (e) { }
        }

        if (settings.boundBtnType === 'global' && settings.boundBtnSelector) {
            try {
                const g = doc.querySelector(settings.boundBtnSelector);
                if (g && realClick(g)) return { ok: true, how: 'global:' + settings.boundBtnSelector };
            } catch (e) { }
        }

        const th = getTavernHelper();
        const slash = (typeof triggerSlash === 'function') ? triggerSlash
            : (th && typeof th.triggerSlash === 'function') ? th.triggerSlash : null;
        if (settings.boundSlashCmd && settings.boundSlashCmd.trim() && slash) {
            try {
                await slash(settings.boundSlashCmd.trim());
                return { ok: true, how: 'slash' };
            } catch (e) { }
        }
        return { ok: false, reason: '楼层上没找到生图按钮（可到目录里点「🔌 重新绑定按钮」选一次）' };
    }

    // 点掉插件的确认弹窗。
    //
    // 墨影的对话框是不用 window.confirm 的 Vue 组件，宿主在一个 id 为 bbi-app-host 的
    // shadowRoot 里（document.querySelector 直接找不到）。本楼已有 tag 时点按钮会弹
    // 「重新生成 tag」确认，不确认就一直不出图，150 秒后阅读器判超时——
    // 于是「有 tag 的楼层反而更难生」，批量重跑时几乎必挂。
    //
    // 关键细节：弹窗是 Vue 异步渲染的，点完按钮要等它**出现**才行。
    // 固定 sleep 一小段经常扑空（渲染慢一点就已经错过去了）。
    // 顺序上先点带 primary 的那个（确认），再兜底点「确定/重新生成」这类文字按钮；
    // 只点 shadowRoot 内、且只在它真的开着（遮罩存在）时点，避免误触别的东西。
    async function confirmMoyingDialog() {
        const doc = getHostDocument();
        const srOf = () => { const h = doc.getElementById('bbi-app-host'); return h && h.shadowRoot; };
        const maskOf = (sr) => (sr ? sr.querySelector('.bbi-modal-mask') : null);
        // 先等弹窗出现，最多约 2.5 秒。
        let sr = null;
        for (let i = 0; i < 25; i++) {
            sr = srOf();
            if (sr && maskOf(sr)) break;
            await sleep(100);
        }
        if (!sr || !maskOf(sr)) return false;
        for (let round = 0; round < 6; round++) {
            const mask = maskOf(sr);
            if (!mask) return true;
            const buttons = Array.from(sr.querySelectorAll('.bbi-modal-foot button'));
            const pick = buttons.find(b => /bbi-btn-primary/.test(b.className)) ||
                buttons.find(b => /重新生成|确定|确认|继续/.test(b.textContent || ''));
            if (!pick) return false;
            realClick(pick);
            // 等它自己关；关掉了就收工，没关就再找一轮（有的会换一屏文案）
            for (let i = 0; i < 25; i++) {
                await sleep(100);
                if (!maskOf(sr)) return true;
            }
        }
        return false;
    }

    // 等这一层真的把正文渲染出来（不是空壳）
    async function waitFloorText(mesId, budgetMs) {
        const deadline = nowMs() + (budgetMs || 2000);
        while (nowMs() < deadline) {
            const el = mesEl(mesId);
            if (el) {
                const body = el.querySelector('.mes_text') || el;
                const t = String(body.textContent || body.innerText || '').replace(/\s/g, '');
                if (t.length >= 20) return true;
            }
            if (isRealDocHidden()) return true;
            await sleep(120);
        }
        return false;
    }

    // 生图插件出错时只是弹一句 toast，不会抛异常：插件的按钮在"当前楼层不在视口里"
    // 或"没有聊天"时就会立刻回一句错误。干等满 150 秒才判失败太亏，
    // 这里盯住 toast 的错误文案，出现就提前收工。
    let lastGenError = '';
    function getGenError() {
        try { return String(getHostWindow().__thLastGenError || lastGenError || ''); } catch (e) { return lastGenError; }
    }
    function setGenError(v) {
        lastGenError = String(v || '');
        try { getHostWindow().__thLastGenError = lastGenError; } catch (e) { }
    }
    function watchGenErrors() {
        const w = getHostWindow();
        const hook = () => {
            try {
                const t = w.toastr;
                if (!t) return;
                if (t.__thHookedInst === INST) return;
                t.__thHookedInst = INST;
                for (const k of ['error', 'warning']) {
                    const origKey = '__thOrig_' + k;
                    if (typeof t[origKey] !== 'function' && typeof t[k] === 'function') {
                        t[origKey] = t[k].bind(t);
                    }
                    const orig = t[origKey];
                    if (typeof orig !== 'function') continue;
                    t[k] = function (...args) {
                        const msg = String(args[0] || '');
                        const title = String(args[1] || '');
                        // 忽略阅读器自身提示，以及插件「正在生成/请稍候/排队中/无需生图」等非错误状态提示，避免误判为致命错误而提前中断！
                        if (title !== '小说阅读器' && msg) {
                            const isBusyNotice = /正在|进行中|请稍候|请勿重复|队列|等待|无需|跳过|busy|running|wait|already/i.test(msg);
                            const isRealErr = k === 'error' || /失败|错误|异常|超时|不在视口|中断|error|failed|timeout/i.test(msg);
                            if (!isBusyNotice && isRealErr) {
                                setGenError(msg.slice(0, 200));
                            }
                        }
                        return orig.apply(this, args);
                    };
                }
            } catch (e) { }
        };
        hook();
        if (!w.toastr) { const id = setInterval(() => { hook(); if (w.toastr) clearInterval(id); }, 500); later(() => clearInterval(id), 6000); }
    }

    // ============ 手机后台保活（防锁屏/切后台断流） ============
    let bgWakeLock = null;
    let bgAudioCtx = null;
    let bgAudioOsc = null;
    let bgAudioEl = null;
    let bgRafOrig = null;
    let bgVisBound = false;

    function buildSilentWavUrl() {
        try {
            // 1.5s 8kHz 8-bit 微幅交替抖动 WAV（127/129 交替避免全 128 直线被安卓 Chromium SilentSinkSuspender 判定为纯静音挂起！）
            const rate = 8000, samples = 12000;
            const buf = new ArrayBuffer(44 + samples);
            const v = new DataView(buf);
            const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
            str(0, 'RIFF'); v.setUint32(4, 36 + samples, true); str(8, 'WAVE');
            str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
            v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
            str(36, 'data'); v.setUint32(40, samples, true);
            const bytes = new Uint8Array(buf, 44);
            for (let i = 0; i < samples; i++) bytes[i] = (i & 1) ? 129 : 127;
            const all = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < all.length; i += 4096) {
                bin += String.fromCharCode.apply(null, all.subarray(i, i + 4096));
            }
            return 'data:audio/wav;base64,' + btoa(bin);
        } catch (e) { return ''; }
    }

    async function acquireWakeLock() {
        try {
            const doc = getHostDocument();
            if (doc && (doc.hidden || doc.visibilityState === 'hidden')) return;
            const nav = getHostWindow().navigator || navigator;
            if (nav && nav.wakeLock && typeof nav.wakeLock.request === 'function' && !bgWakeLock) {
                bgWakeLock = await nav.wakeLock.request('screen');
                if (bgWakeLock && typeof bgWakeLock.addEventListener === 'function') {
                    bgWakeLock.addEventListener('release', () => { bgWakeLock = null; });
                }
            }
        } catch (e) { }
    }

    let bgIframeRafOrig = null;
    let bgLockRelease = null;
    const ioCallbackMap = new WeakMap();

    // 仅在新注册 .bbi-image-slot 的 IntersectionObserver.observe 时通知一次可见（滚动期间 0 触发、0 开销！）
    let restoreIoHook = null;
    function installIoBypassHook() {
        const win = getHostWindow();
        if (!win || !win.IntersectionObserver || win.IntersectionObserver.__thHooked) return;
        try {
            const OrigIO = win.IntersectionObserver;
            const origObserve = OrigIO.prototype.observe;

            const PatchedIO = function (cb, options) {
                const inst = new OrigIO(cb, options);
                try { ioCallbackMap.set(inst, cb); } catch (e) { }
                return inst;
            };
            PatchedIO.prototype = OrigIO.prototype;
            Object.setPrototypeOf(PatchedIO, OrigIO);
            PatchedIO.__thHooked = true;
            win.IntersectionObserver = PatchedIO;

            restoreIoHook = () => {
                if (win.IntersectionObserver === PatchedIO) win.IntersectionObserver = OrigIO;
                OrigIO.prototype.observe = origObserve;
                restoreIoHook = null;
            };
            OrigIO.prototype.observe = function (target) {
                const ret = origObserve.call(this, target);
                try {
                    if (queueRunning && target && target.nodeType === 1 && target.closest?.('#chat .mes') === mesEl(activeGenMesId)) {
                        const isBbiSlot = (target.matches && target.matches('[data-bbi-slot], [data-bbi-image-slot], .bbi-card-host, .bbi-image-slot')) ||
                            (target.querySelector && target.querySelector('[data-bbi-slot], [data-bbi-image-slot], .bbi-card-host, .bbi-image-slot'));
                        if (isBbiSlot) {
                            const cb = ioCallbackMap.get(this);
                            if (typeof cb === 'function') {
                                setTimeout(() => {
                                    try {
                                        cb([{
                                            target,
                                            isIntersecting: true,
                                            intersectionRatio: 1,
                                            boundingClientRect: target.getBoundingClientRect ? target.getBoundingClientRect() : {},
                                            intersectionRect: target.getBoundingClientRect ? target.getBoundingClientRect() : {},
                                            rootBounds: null,
                                            time: performance.now()
                                        }], this);
                                    } catch (e) { }
                                }, 25);
                            }
                        }
                    }
                } catch (e) { }
                return ret;
            };
        } catch (e) { }
    }

    function acquireBgWebLock() {
        if (bgLockRelease) return;
        try {
            const nav = (getHostWindow() && getHostWindow().navigator) || navigator;
            if (nav && nav.locks && typeof nav.locks.request === 'function') {
                nav.locks.request('th_novel_bg_keepalive_v61', () => new Promise(resolve => {
                    bgLockRelease = resolve;
                })).catch(() => { bgLockRelease = null; });
            }
        } catch (e) { }
    }

    function startBgKeepAlive() {
        if (settings.keepAliveBg === false) return;
        initOrigDocDescs();
        ensureBgWorker();
        if (!pipelineMode) installIoBypassHook();
        acquireWakeLock();
        acquireBgWebLock();
        const win = getHostWindow();
        const doc = getHostDocument();

        // Only the reader's sleep() uses the worker clock. Host timers keep their native IDs and cancellation semantics.
        // 2. 极低增益非零 PCM WebAudio + 循环微抖动 Audio + MediaSession，防止移动端 Chromium SilentSinkSuspender 挂起后台页面
        try {
            const AC = win.AudioContext || win.webkitAudioContext;
            if (AC && !bgAudioCtx) {
                bgAudioCtx = new AC();
                const osc = bgAudioCtx.createOscillator();
                const gain = bgAudioCtx.createGain();
                osc.frequency.value = 28;
                gain.gain.value = 0.001;
                osc.connect(gain);
                gain.connect(bgAudioCtx.destination);
                osc.start();
                bgAudioOsc = osc;
            }
            if (bgAudioCtx && bgAudioCtx.state === 'suspended') {
                bgAudioCtx.resume().catch(() => { });
            }
        } catch (e) { }
        try {
            if (!bgAudioEl && doc && doc.createElement) {
                const wav = buildSilentWavUrl();
                if (wav) {
                    const a = doc.createElement('audio');
                    a.src = wav;
                    a.loop = true;
                    a.volume = 0.02;
                    a.setAttribute('playsinline', '');
                    a.setAttribute('webkit-playsinline', '');
                    a.style.display = 'none';
                    (doc.body || doc.documentElement).appendChild(a);
                    bgAudioEl = a;
                }
            }
            if (bgAudioEl && bgAudioEl.paused) {
                const p = bgAudioEl.play();
                if (p && typeof p.catch === 'function') p.catch(() => { });
            }
            const nav = win.navigator || navigator;
            if (nav && nav.mediaSession) {
                nav.mediaSession.playbackState = 'playing';
            }
        } catch (e) { }
        if (!bgVisBound && doc) {
            bgVisBound = true;
            const onVisCapture = (ev) => {
                if (ev && ev.__thSynthetic) return;
                if (!queueRunning) return;
                if (!isRealDocHidden()) {
                    restoreUserViewportFromBg();
                    acquireWakeLock();
                } else if (activeGenMesId >= 0) {
                    alignFloorIntoViewportForGen(activeGenMesId);
                }
                try { if (bgAudioCtx && bgAudioCtx.state === 'suspended') bgAudioCtx.resume().catch(() => { }); } catch (e) { }
                try { if (bgAudioEl && bgAudioEl.paused) bgAudioEl.play().catch(() => { }); } catch (e) { }
                if (hasMoyingBgPending()) pumpMoyingBgQueue();
            };
            on(doc, 'visibilitychange', onVisCapture, true);
        }
    }

    function stopBgKeepAlive() {
        setDocVisibilitySpoof(false);
        restoreUserViewportFromBg();
        stopBgWorker();
        restoreIoHook?.();
        bgWaiters.length = 0;
        bgSavedUserTop = null;
        bgSavedUserAnchor = null;
        activeGenMesId = -1;
        try { if (bgLockRelease) { bgLockRelease(); bgLockRelease = null; } } catch (e) { }
        try { if (bgWakeLock) { bgWakeLock.release().catch(() => { }); bgWakeLock = null; } } catch (e) { }
        try { if (bgAudioOsc) { bgAudioOsc.stop(); bgAudioOsc.disconnect(); bgAudioOsc = null; } } catch (e) { }
        try { if (bgAudioCtx) { bgAudioCtx.close().catch(() => { }); bgAudioCtx = null; } } catch (e) { }
        try { if (bgAudioEl) { bgAudioEl.pause(); bgAudioEl.remove(); bgAudioEl = null; } } catch (e) { }
        try {
            const win = getHostWindow();
            if (bgRafOrig) { win.requestAnimationFrame = bgRafOrig; bgRafOrig = null; }
            if (bgIframeRafOrig && typeof window !== 'undefined') { window.requestAnimationFrame = bgIframeRafOrig; bgIframeRafOrig = null; }
            const restoreTimerBridge = (targetWin) => {
                if (!targetWin || !targetWin.__thOrigSetTimeout) return;
                targetWin.setTimeout = targetWin.__thOrigSetTimeout;
                targetWin.clearTimeout = targetWin.__thOrigClearTimeout;
                delete targetWin.__thOrigSetTimeout;
                delete targetWin.__thOrigClearTimeout;
            };
            restoreTimerBridge(win);
            if (typeof window !== 'undefined' && window !== win) restoreTimerBridge(window);
            if (win.__thBgPendingPump) { clearInterval(win.__thBgPendingPump); win.__thBgPendingPump = null; }
        } catch (e) { }
    }
    teardowns.push(stopBgKeepAlive);

    // 判断失败原因是否属于「被截断 / 中断 / 超时 / 临时故障」（需要留在本楼继续原地重试）
    function isTruncatedOrRetryable(reason) {
        const r = String(reason || '');
        if (!r) return true;
        if (/已停止|没有加载小说|铺设楼层失败|找不到.*生图按钮|没有打开的聊天|墨影已停用/.test(r)) return false;
        return true;
    }

    // 等这一层真的多出图片：以“张数变多”为准，不看 src 内容（同图重出也能识别）
    //
    // 两条时间线：
    //  · 总预算（设置里的单张最长等待）是**软**的 —— 只要插件还明确在忙（按钮转圈、
    //    图片在 loading），就一直等，最多到硬上限。上游偶尔一张要 180 秒以上，
    //    按硬预算 150 秒卡掉会把「正在出、马上就出」的那张判成失败，还白重跑一次。
    //  · 空闲计时：插件先写 tag 再出图，写 tag 那步失败时它只弹一句 info，不出图也不
    //    报错。所以「一段时间毫无变化」才是真卡住，这时立刻收手交给上层重试。
    const GEN_IDLE_MS = 105000;
    const GEN_HARD_MS = 480000;
    async function waitForNewImage(mesId, baselineCount, budgetSec) {
        const started = nowMs();
        let softDeadline = started + Math.max(30, budgetSec) * 1000;
        let lastTick = nowMs();
        const hardDeadline = started + GEN_HARD_MS;
        let quiet = 0;
        const tagBase = floorTagCount(mesId);
        let idleFrom = nowMs();
        let lastRealProgressAt = nowMs();
        let lastReadyCount = 0;
        let lastImgCount = baselineCount;
        let seenTag = 0;
        let errIdleTicks = 0;
        let slotRetries = 0;
        let lastSlotRetryAt = 0;
        let tagAppearedAt = tagBase > 0 ? nowMs() : 0;
        let lastResumeAt = 0;

        try {
            while (nowMs() < hardDeadline) {
                if (queueContextChanged()) return { ok: false, reason: '聊天或小说已切换' };
                const ctx = getSTContext();
                const msg = ctx && Array.isArray(ctx.chat) ? ctx.chat[mesId] : null;
                const imgs = floorImages(mesId, msg);
                const tags = floorTagCount(mesId);
                const dInfo = floorDataSlotInfo(mesId);
                const slotInfo = floorSlotInfo(mesId);
                const tagPromiseRunning = (lastTagReqState && lastTagReqState.mesId === mesId && lastTagReqState.pending);
                const busy = floorBusy(mesId) || tagPromiseRunning;

                if (tags !== tagBase + seenTag) {
                    seenTag = tags - tagBase;
                    idleFrom = nowMs();
                    lastRealProgressAt = nowMs();
                    errIdleTicks = 0;
                }
                if ((tags > 0 || dInfo.total > 0) && !tagAppearedAt) {
                    tagAppearedAt = nowMs();
                }
                if (dInfo.ready > lastReadyCount || imgs.length > lastImgCount) {
                    lastReadyCount = Math.max(lastReadyCount, dInfo.ready);
                    lastImgCount = Math.max(lastImgCount, imgs.length);
                    idleFrom = nowMs();
                    lastRealProgressAt = nowMs();
                    errIdleTicks = 0;
                }
                if (busy && (nowMs() - lastRealProgressAt < 150000)) {
                    idleFrom = nowMs();
                    errIdleTicks = 0;
                    softDeadline += Math.max(0, nowMs() - lastTick);
                }
                lastTick = nowMs();

                if (hasMoyingBgPending() && !dInfo.bgRunning && !dInfo.tagRunning && (nowMs() - lastResumeAt >= 4000)) {
                    lastResumeAt = nowMs();
                    try {
                        const bbi = getHostWindow()?.STBaiBaiImage;
                        if (bbi && typeof bbi.resumeBackgroundPending === 'function') {
                            Promise.resolve(bbi.resumeBackgroundPending()).catch(() => {});
                        }
                    } catch (e) { }
                }

                if (lastTagReqState && lastTagReqState.mesId === mesId && !lastTagReqState.pending && lastTagReqState.settledAt > 0 &&
                    (nowMs() - lastTagReqState.settledAt > 5000) && tags === 0 && dInfo.total === 0 && !busy && imgs.length <= baselineCount) {
                    return {
                        ok: false,
                        truncated: true,
                        reason: lastTagReqState.reason || getGenError() || '未生成配图标签，立即原地重试'
                    };
                }

                const elapsed = nowMs() - started;
                const hasFreshActivity = elapsed > 260 || seenTag !== 0 || imgs.length > baselineCount;
                const dataAllDone = !tagPromiseRunning && hasFreshActivity && dInfo.total > 0 && dInfo.ready >= dInfo.total && dInfo.pending === 0 && dInfo.errors === 0 && !dInfo.tagRunning;
                const domAllDone = tags > 0 && slotInfo.total > 0 &&
                    slotInfo.ready >= slotInfo.total && slotInfo.busy === 0 && slotInfo.errorBtns.length === 0 && imgs.length > baselineCount;
                const allSlotsDone = (tags > 0 || dInfo.total > 0)
                    ? (dataAllDone || domAllDone)
                    : (imgs.length > baselineCount && !busy);

                const slotWaitGap = slotRetries === 0 ? 800 : 2500;
                if (tags > 0 && !dInfo.tagRunning && !dInfo.bgRunning && slotInfo.busy === 0 && slotInfo.errorBtns.length > 0 &&
                    slotRetries < Math.max(6, tags * 3) && nowMs() - lastSlotRetryAt > slotWaitGap) {
                    slotRetries++;
                    lastSlotRetryAt = nowMs();
                    idleFrom = nowMs();
                    if (hasMoyingBgPending()) {
                        try {
                            const bbi = getHostWindow()?.STBaiBaiImage;
                            if (bbi && typeof bbi.resumeBackgroundPending === 'function') {
                                Promise.resolve(bbi.resumeBackgroundPending()).catch(() => {});
                            }
                        } catch (e) { }
                    }
                    const targetBtn = slotInfo.errorBtns[0];
                    if (targetBtn && targetBtn.btn) {
                        try { realClick(targetBtn.btn); } catch (e) { }
                    }
                    await sleep(900);
                    continue;
                }

                if (allSlotsDone && !busy) {
                    const isBg = isRealDocHidden();
                    const loaded = isBg || dataAllDone || imgs.every(x => {
                        const el = mesEl(mesId);
                        if (!el) return true;
                        const node = Array.from(el.querySelectorAll('img')).find(n => (n.getAttribute('src') || '') === x.url);
                        return !node || (node.complete && node.naturalWidth > 0);
                    });
                    if (loaded) {
                        quiet++;
                        if (quiet >= 2) return { ok: true, count: Math.max(imgs.length, dInfo.ready, slotInfo.ready) };
                    } else {
                        idleFrom = nowMs();
                    }
                } else {
                    quiet = 0;
                    const curErr = getGenError();
                    if (curErr || (dInfo.total > 0 && dInfo.errors > 0 && dInfo.pending === 0 && !busy)) {
                        seenTag = Math.max(seenTag, 0);
                        if (!busy && dInfo.ready < Math.max(1, dInfo.total) && imgs.length <= baselineCount && slotInfo.busy === 0) {
                            errIdleTicks++;
                            if (errIdleTicks >= 3) {
                                return {
                                    ok: false,
                                    truncated: true,
                                    reason: curErr || '图片槽位生成失败'
                                };
                            }
                        } else {
                            errIdleTicks = 0;
                            idleFrom = nowMs();
                        }
                    }
                }

                if (!busy && nowMs() - lastRealProgressAt > 160000 && !allSlotsDone) {
                    const slotErr = slotInfo.errorTexts.length ? slotInfo.errorTexts.join('；') : '';
                    return {
                        ok: false,
                        truncated: true,
                        reason: getGenError() || slotErr || (tags > 0 ? '槽位生图停滞超时，触发重试' : '生成标签响应超时，触发重试')
                    };
                }

                if (!busy && nowMs() - idleFrom > GEN_IDLE_MS) {
                    const grew = floorImages(mesId, msg).length > baselineCount && slotInfo.errorBtns.length === 0 && dInfo.pending === 0;
                    const slotErr = slotInfo.errorTexts.length ? slotInfo.errorTexts.join('；') : '';
                    return grew
                        ? { ok: true, count: floorImages(mesId, msg).length }
                        : { ok: false, truncated: true, reason: getGenError() || slotErr || (seenTag ? '写了 tag 但没出完图（卡住了）' : '调用后一直没有反应') };
                }
                if (!busy && nowMs() > softDeadline) {
                    const grew = floorImages(mesId, msg).length > baselineCount && slotInfo.errorBtns.length === 0 && dInfo.pending === 0;
                    const slotErr = slotInfo.errorTexts.length ? slotInfo.errorTexts.join('；') : '';
                    return grew ? { ok: true, count: floorImages(mesId, msg).length }
                        : { ok: false, truncated: true, reason: getGenError() || slotErr || `等待 ${budgetSec} 秒超时` };
                }
                await sleep(600);
            }
            const ctx = getSTContext();
            const dFinal = floorDataSlotInfo(mesId);
            const imgs = floorImages(mesId, ctx && Array.isArray(ctx.chat) ? ctx.chat[mesId] : null);
            const allDoneFinal = dFinal.total > 0 ? (dFinal.ready >= dFinal.total && dFinal.pending === 0) : (imgs.length > baselineCount);
            return { ok: allDoneFinal, truncated: true, reason: getGenError() || `等待 ${budgetSec} 秒超时` };
        } finally {
            setDocVisibilitySpoof(false);
        }
    }

    async function waitFloorIdle(mesId, budgetMs) {
        const deadline = nowMs() + Math.max(1000, budgetMs || 25000);
        while (nowMs() < deadline) {
            if (!floorBusy(mesId) && !(lastTagReqState.mesId===mesId && lastTagReqState.pending)) return true;
            if (queueContextChanged()) return false;
            await sleep(400);
        }
        return false;
    }

    async function illustrateOne(chunkIndex, opts) {
        opts = opts || {};
        const book = opts.book || currentBook;
        if (!book) return { ok: false, reason: '没有加载小说' };

        return await withBgGenScrollLock(async () => {
            let mesId = await deployFloor(chunkIndex, { book, hold: false });
            const settled = findFloorByChunk(book.id, chunkIndex);
            if (settled >= 0) mesId = settled;
            if (mesId < 0) return { ok: false, reason: '铺设楼层失败' };

            activeGenMesId = mesId;
            let restoreTargetRect = () => { };
            try {
                await alignFloorIntoViewportForGen(mesId);
                const targetEl = mesEl(mesId);
                if (targetEl) {
                    restoreTargetRect = tempPatchFloorRectInView(targetEl);
                    await waitFloorText(mesId, 2000);
                } else {
                    await sleep(200);
                }

                const ctx = getSTContext();
                const before = floorImages(mesId, ctx && Array.isArray(ctx.chat) ? ctx.chat[mesId] : null).length;
                const initDInfo = floorDataSlotInfo(mesId);
                if (opts.skipIfHasImage) {
                    if (initDInfo.total > 0 && initDInfo.ready >= initDInfo.total && initDInfo.pending === 0) {
                        return { ok: true, skipped: true, mesId };
                    }
                    if (initDInfo.total === 0 && before > 0) {
                        return { ok: true, skipped: true, mesId };
                    }
                }

                const baseAttempts = 1 + Math.max(0, Math.min(10, Number(settings.preGenRetry) || 0));
                const maxFloorAttempts = baseAttempts;
                let lastReason = '';
                let slotWakeAttempts = 0;

                for (let a = 0; a < maxFloorAttempts; a++) {
                    if (queueContextChanged() || (queueStop && a > 0)) return { ok: false, reason: '已停止或聊天已切换', mesId };
                    if (a >= baseAttempts && !isTruncatedOrRetryable(lastReason)) break;

                    const recheckId = findFloorByChunk(book.id, chunkIndex);
                    if (recheckId >= 0 && recheckId !== mesId) {
                        restoreTargetRect();
                        mesId = recheckId;
                        activeGenMesId = mesId;
                        const newEl = mesEl(mesId);
                        restoreTargetRect = newEl ? tempPatchFloorRectInView(newEl) : (() => { });
                    }

                    if (!(await waitFloorIdle(mesId, 25000))) {
                        return { ok: false, mesId, reason: '本层仍在生成，请稍后续跑，未重复提交' };
                    }

                    const curBefore = floorImages(mesId, ctx && Array.isArray(ctx.chat) ? ctx.chat[mesId] : null).length;
                    const dInfoNow = floorDataSlotInfo(mesId);
                    if (dInfoNow.total > 0) {
                        if (dInfoNow.ready >= dInfoNow.total && dInfoNow.pending === 0 && dInfoNow.errors === 0) {
                            return { ok: true, mesId, how: 'already-ready', retries: a };
                        }
                    } else if (curBefore > before) {
                        return { ok: true, mesId, how: 'already-ready', retries: a };
                    }

                    if (a > 0) {
                        const stepPrefix = (opts.stepIndex && opts.totalSteps) ? `[${opts.stepIndex}/${opts.totalSteps}] ` : '';
                        if (queueRunning && opts.stepIndex && opts.totalSteps) {
                            queueProgress = `${opts.stepIndex}/${opts.totalSteps}·重试${a}`;
                            updateHud();
                        }
                        notify('warning', `🔄 ${stepPrefix}#${mesId}楼（第 ${chunkIndex + 1} 节）生图未完成（${lastReason || '重试'}），留在本层原地重试（第 ${a} 次）…`);
                    }

                    const existingTags = floorTagCount(mesId);
                    const slotInfo = floorSlotInfo(mesId);
                    let trig = null;
                    if (a > 0 && (existingTags > 0 || dInfoNow.total > 0) && (dInfoNow.pending > 0 || dInfoNow.errors > 0) &&
                        (hasMoyingBgPending() || slotInfo.errorBtns.length > 0) && slotWakeAttempts < 2) {
                        slotWakeAttempts++;
                        setGenError('');
                        if (hasMoyingBgPending()) {
                            const bbi = getHostWindow()?.STBaiBaiImage;
                            if (bbi && typeof bbi.resumeBackgroundPending === 'function') {
                                try { await Promise.resolve(bbi.resumeBackgroundPending()); } catch (e) { }
                            }
                        }
                        if (slotInfo.errorBtns.length > 0) {
                            for (const item of slotInfo.errorBtns) {
                                if (item && item.btn) {
                                    try { realClick(item.btn); } catch (e) { }
                                }
                            }
                            trig = { ok: true, how: 'slot-retry' };
                        } else {
                            trig = { ok: true, how: 'resume-bg-pending' };
                        }
                    }
                    if (!trig) {
                        slotWakeAttempts = 0;
                        trig = await triggerIllustration(mesId);
                    }

                    if (!trig.ok) {
                        lastReason = trig.reason;
                        if (!isTruncatedOrRetryable(lastReason)) break;
                    } else {
                        const wait = await waitForNewImage(mesId, curBefore, Number(settings.preGenWaitSec) || 150);
                        if (wait.ok) {
                            const cd = Math.max(0, Number(settings.cooldownSec) || 0);
                            if (cd) await sleep(cd * 1000);
                            return { ok: true, mesId, how: trig.how, retries: a };
                        }
                        lastReason = wait.reason;
                    }

                    if (a + 1 < maxFloorAttempts) {
                        await sleep(isRealDocHidden() ? 3500 : 2200);
                    }
                }
                return { ok: false, mesId, reason: lastReason || '未出图' };
            } finally {
                restoreTargetRect();
                activeGenMesId = -1;
            }
        });
    }

    // ============ 队列 ============
    async function runQueue(indices, label) {
        if (queueRunning || queueStarting || appendInFlight) {
            notify('info', '任务正在进行，请等待结束或先停止当前队列'); return;
        }
        const api = getHostWindow()?.STBaiBaiImage?.novelReader;
        if (!api || api.version !== 1 || typeof api.planFloor !== 'function' || typeof api.generateFloor !== 'function') {
            notify('error', '需要安装配套的柏宝绘小说流水线补丁（novelReader v1）。当前插件没有后台楼层接口，已停止，未重复提交。');
            return;
        }
        queueStarting = true;
        try {
            if (!(await loadBook())) { notify('warning', '请先导入一本小说'); return; }
            if (!hasOpenChat() && !(await ensureOpenChat())) { notify('warning', '请先打开聊天'); return; }
            const book = currentBook;
            const targets = [...new Set(indices.map(Number))].filter(i=>Number.isInteger(i) && i>=0 && i<book.chunks.length).sort((a,b)=>a-b);
            if (!targets.length) { notify('warning','没有要生图的节'); return; }
            const ctx = getSTContext();
            queueContext = {bookId:book.id, chat:ctx.chat, chatId:ctx.getCurrentChatId?.() ?? null};
            queueRunning = true; queueStop = false; pipelineMode = true; lastQueueFailed=[];
            pipelineEvents=[];
            recordPipeline('queue-start',{count:targets.length,pluginVersion:getHostWindow()?.STBaiBaiImage?.pluginVersion||null});
            const remaining = new Set(targets);
            const pending = new Set();
            const stages = {};
            let done=0, planned=0, noImages=0;
            const checkpoint = () => {
                try { getHostWindow().localStorage.setItem('th_novel_queue_v62', JSON.stringify({v:3, bookId:book.id, chatId:queueContext.chatId, indices:[...remaining], stages, updatedAt:Date.now()})); } catch(e) { }
            };
            const progress = () => {
                queueProgress='tag '+planned+'/'+targets.length+' · 图 '+done+'/'+targets.length;
                updateQueueStatus(queueStop ? '正在停止：已提交的 '+pending.size+' 楼图片继续完成，未提交的保留' : queueProgress+' · 出图中 '+pending.size+' 楼');
            };
            const fail = (idx, reason) => {
                stages[idx]='failed';
                recordPipeline('failed',{section:idx+1,reason:String(reason).slice(0,400)});
                if (!queueContextChanged()) {
                    if (!lastQueueFailed.includes(idx)) lastQueueFailed.push(idx);
                    selectedChunkSet.add(idx);
                    notify('warning','第 '+(idx+1)+' 节：'+reason+'；保留已保存 tag，未重新调用 LLM');
                }
            };
            const finish = idx => {
                stages[idx]='ready'; done++;
                recordPipeline('ready',{section:idx+1});
                remaining.delete(idx);
                if (!queueContextChanged()) selectedChunkSet.delete(idx);
            };
            checkpoint(); saveUserViewportForBg(); startBgKeepAlive();
            queuePromise=(async()=>{
                // Data-only deployment: no viewport alignment, card mount or render-frame await.
                for (let step=0;step<targets.length;step++) {
                    if (queueStop || queueContextChanged()) return;
                    const id=await deployFloor(targets[step],{book,hold:false,skipSave:true,skipReorder:true,chatOnly:true});
                    if(id<0) throw new Error('第 '+(targets[step]+1)+' 节入楼失败');
                }
                if (queueContextChanged()) return;
                if(reorderTimer){clearTimeout(reorderTimer);reorderTimer=null;}
                reorderNow(book.id);
                await ctx.saveChat?.();
                try {
                    for(const idx of targets) {
                        if(queueStop || queueContextChanged()) break;
                        // Bounded lookahead: tag LLM stays serial; at most 3 floors await images.
                        // NovelAI's own gate still determines the number of network requests.
                        while(pending.size>=3 && !queueStop && !queueContextChanged()) await Promise.race([...pending]);
                        if(queueStop || queueContextChanged()) break;
                        const mesId=findFloorByChunk(book.id,idx);
                        if(mesId<0){fail(idx,'目标楼层已不存在');checkpoint();continue;}
                        stages[idx]='planning';progress();checkpoint();
                        recordPipeline('tag-start',{section:idx+1,mesId});
                        try {
                            const plan=await api.planFloor(mesId);
                            if(queueContextChanged()) break;
                            planned++;
                            recordPipeline('tag-saved',{section:idx+1,status:plan.status,count:plan.tagCount});
                            if(plan.status==='no-images') {
                                noImages++; finish(idx); checkpoint(); progress(); continue;
                            }
                            if(plan.status!=='tagged' || !(plan.tagCount>0)) throw new Error('tag 接口返回未确认的状态');
                            stages[idx]='images';checkpoint();
                            recordPipeline('images-submitted',{section:idx+1,mesId});
                            // Do not await image completion here. The next floor's LLM starts now.
                            let job;
                            job=Promise.resolve().then(()=>api.generateFloor(mesId)).then(result=>{
                                if(queueContextChanged()) return;
                                if(result.status!=='ready') throw new Error((result.failures||[]).map(x=>x.reason).join('；') || '图片生成未完成');
                                finish(idx);
                            }).catch(e=>fail(idx,e?.message||String(e))).finally(()=>{
                                pending.delete(job);checkpoint();progress();
                            });
                            pending.add(job);progress();
                        } catch(e) { fail(idx,e?.message||String(e)); checkpoint(); }
                    }
                } finally {
                    // Stop means no new floor submission; already accepted image work is observed to completion.
                    await Promise.allSettled([...pending]);
                }
            })();
            try {await queuePromise;}
            catch(e){notify('error','队列中断：'+(e?.message||e));}
            finally {
                checkpoint();
                const aborted = queueContextChanged();
                if(!aborted) {
                    remaining.forEach(i=>selectedChunkSet.add(i));
                    refreshPipelineView();
                    refreshHudMap();
                }
                queueRunning=false;queueStarting=false;queuePromise=null;
                stopBgKeepAlive();pipelineMode=false;queueContext=null;queueProgress='';
                if (aborted && remaining.size) {
                    const why = isDead() ? '脚本已重载' : '聊天或小说已切换';
                    recordPipeline('queue-aborted',{reason:why,completed:done,remaining:remaining.size});
                    updateQueueStatus('队列中止（'+why+'）：本轮完成 '+done+'/'+targets.length+' · 待处理 '+remaining.size+' 节（点「恢复待处理」继续）');
                } else {
                    updateQueueStatus('本轮完成 '+done+'/'+targets.length+' · 待处理 '+remaining.size+' 节'+(noImages?' · '+noImages+' 节无需配图':''));
                }
                recordPipeline('queue-finished',{completed:done,remaining:remaining.size,aborted});
                notify(remaining.size?'info':'success',queueStatus);
                if(panelEl && panelTab==='toc')renderPanel();
            }
        } finally {queueStarting=false;}
    }

    function stopQueue() {
        if (!queueRunning) return false;
        queueStop=true;
        recordPipeline('stop-requested',{});
        updateQueueStatus('正在停止：不再提交新楼层，等待已提交的 tag / 图片任务完成');
        return true;
    }

    function restoreQueueSelection() {
        try {
            const task=JSON.parse(getHostWindow().localStorage.getItem('th_novel_queue_v62') || 'null');
            const ctx=getSTContext();
            if (!task || task.bookId!==currentBook?.id || task.chatId!==(ctx?.getCurrentChatId?.() ?? null)) {
                notify('info','当前小说与聊天没有可续跑的任务'); return;
            }
            const valid=(task.indices || []).filter(i=>Number.isInteger(i) && i>=0 && i<currentBook.chunks.length);
            valid.forEach(i=>selectedChunkSet.add(i));
            notify('info','已勾选 '+valid.length+' 节待处理任务，点击「生成勾选」续跑');
            renderPanel();
        } catch(e) { notify('warning','无法读取上次任务'); }
    }

    async function queueNextN(count) {
        if (!(await loadBook())) { notify('warning', '请先导入一本小说'); return; }
        const map = scanFloorMap();
        const start = currentChunkIndex();
        const targets = [];
        for (let i = start; i < currentBook.chunks.length && targets.length < count; i++) {
            const f = map[i];
            if (f && f.hasImage) continue;
            targets.push(i);
        }
        if (!targets.length) {
            for (let i = start + 1; i < currentBook.chunks.length && targets.length < count; i++) targets.push(i);
        }
        if (!targets.length) { notify('info', '后面都已经有配图了'); return; }
        await runQueue(targets, '预生');
    }

    // ============ 悬浮胶囊 ============
    function refreshHudMap() { refreshSentinel(); }

    const HUD_ACT_BY_ID = {
        'hud-info': 'info', 'hud-toc': 'toc', 'hud-prev': 'prev', 'hud-next': 'next',
        'hud-gen': 'gen', 'hud-pure': 'pure', 'hud-min': 'min', 'hud-exp': 'exp',
    };
    let hudWriting = false;
    let hudMovedAt = 0;
    let hudDragging = false;

    function applyHudPosition(hud) {
        const doc = getHostDocument();
        const win = getHostWindow();
        const vw = win.innerWidth || 412;
        const vh = win.innerHeight || 800;
        const narrow = vw < 560;
        const custom = settings.hudPos && Number.isFinite(Number(settings.hudPos.x)) && Number.isFinite(Number(settings.hudPos.y))
            ? { x: Number(settings.hudPos.x), y: Number(settings.hudPos.y) }
            : null;
        if (custom) {
            const rect = hud.getBoundingClientRect();
            const w = Math.max(80, rect.width || 240);
            const h = Math.max(26, rect.height || 32);
            const cx = Math.round(Math.max(4, Math.min(vw - w - 4, custom.x)));
            const cy = Math.round(Math.max(4, Math.min(vh - h - 4, custom.y)));
            const posKey = `custom|${cx}|${cy}|${vw}|${vh}`;
            if (hud.dataset.posKey !== posKey) {
                hud.dataset.posKey = posKey;
                hud.style.position = 'fixed';
                hud.style.left = `${cx}px`;
                hud.style.top = `${cy}px`;
                hud.style.right = 'auto';
                hud.style.bottom = 'auto';
                hud.style.width = 'max-content';
                hud.style.zIndex = '1000001';
                hud.style.maxWidth = 'calc(100vw - 8px)';
                hud.style.justifyContent = 'flex-start';
            }
            return;
        }
        const tbEl = doc.getElementById('top-bar');
        let tbBottom = 0;
        try { tbBottom = tbEl ? Math.round(tbEl.getBoundingClientRect().bottom) : 0; } catch (e) { tbBottom = 0; }
        const topPx = settings.pureMode ? 6 : Math.max(40, tbBottom + 6);
        const posKey = topPx + '|' + (narrow && !settings.pureMode ? 'n' : 'w');
        if (hud.dataset.posKey !== posKey) {
            hud.dataset.posKey = posKey;
            hud.style.position = 'fixed';
            hud.style.top = `calc(${topPx}px + env(safe-area-inset-top,0px))`;
            hud.style.right = narrow && !settings.pureMode ? '6px' : '8px';
            hud.style.left = narrow && !settings.pureMode ? '6px' : 'auto';
            hud.style.bottom = 'auto';
            hud.style.width = '';
            hud.style.zIndex = '1000001';
            hud.style.maxWidth = 'calc(100vw - 16px)';
            hud.style.justifyContent = narrow && !settings.pureMode ? 'space-between' : 'flex-start';
        }
    }

    function bindHudDrag(hud) {
        if (hud.dataset.dragBound === '1') return;
        hud.dataset.dragBound = '1';
        const win = getHostWindow();
        let active = false;
        let moved = false;
        let startX = 0, startY = 0;
        let origLeft = 0, origTop = 0, boxW = 0, boxH = 0;

        const readXY = (ev) => {
            if (ev.touches && ev.touches.length) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
            if (ev.changedTouches && ev.changedTouches.length) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
            return { x: Number(ev.clientX) || 0, y: Number(ev.clientY) || 0 };
        };

        const onStart = (ev) => {
            if (ev.type === 'mousedown' && ev.button !== 0) return;
            const pt = readXY(ev);
            const r = hud.getBoundingClientRect();
            active = true;
            moved = false;
            startX = pt.x;
            startY = pt.y;
            origLeft = r.left;
            origTop = r.top;
            boxW = Math.max(60, r.width);
            boxH = Math.max(24, r.height);
        };

        const onMove = (ev) => {
            if (!active) return;
            const pt = readXY(ev);
            const dx = pt.x - startX;
            const dy = pt.y - startY;
            if (!moved && Math.hypot(dx, dy) > 5) {
                moved = true;
                hudDragging = true;
                hud.style.cursor = 'grabbing';
            }
            if (!moved) return;
            if (ev.cancelable) { try { ev.preventDefault(); } catch (e) { } }
            const vw = win.innerWidth || 412;
            const vh = win.innerHeight || 800;
            const nx = Math.round(Math.max(4, Math.min(vw - boxW - 4, origLeft + dx)));
            const ny = Math.round(Math.max(4, Math.min(vh - boxH - 4, origTop + dy)));
            settings.hudPos = { x: nx, y: ny };
            hud.dataset.posKey = '';
            applyHudPosition(hud);
            hudMovedAt = nowMs();
        };

        const onEnd = () => {
            if (!active) return;
            active = false;
            if (moved) {
                moved = false;
                hudDragging = false;
                hudMovedAt = nowMs();
                hud.style.cursor = 'grab';
                saveSettings();
            }
        };

        hud.addEventListener('pointerdown', onStart, { passive: true });
        on(win, 'pointermove', onMove, { passive: false });
        on(win, 'pointerup', onEnd, { passive: true });
        on(win, 'pointercancel', onEnd, { passive: true });
        hud.addEventListener('touchstart', onStart, { passive: true });
        on(win, 'touchmove', onMove, { passive: false });
        on(win, 'touchend', onEnd, { passive: true });
        hud.addEventListener('mousedown', onStart, { passive: true });
        on(win, 'mousemove', onMove, { passive: false });
        on(win, 'mouseup', onEnd, { passive: true });
        on(win, 'resize', () => { if (hud.isConnected) applyHudPosition(hud); }, { passive: true });
    }

    function updateHud() {
        const hw = getHostWindow();
        // 非 owner 实例不再渲染，避免旧代码把新 HUD 覆盖成旧标记
        if (hw.__thReaderV6Owner && hw.__thReaderV6Owner !== INST) return;
        const doc = getHostDocument();
        let hud = doc.getElementById('th-novel-hud');
        if (!settings.showFloatingHud) { if (hud) hud.remove(); return; }
        // 死实例的 HUD 留着，点击会落到旧闭包上；这里直接换新
        if (hud && hud.dataset.inst && hud.dataset.inst !== INST) { try { hud.remove(); } catch (e) { } hud = null; }
        if (!hud) {
            hud = doc.createElement('div');
            hud.id = 'th-novel-hud';
            (doc.body || doc.documentElement).appendChild(hud);
        }

        const tbEl = doc.getElementById('top-bar');
        if (!hud.dataset.skin) {
            hud.dataset.skin = '1';
            hud.style.background = 'rgba(24,24,37,.96)';
            hud.style.backdropFilter = 'blur(6px)';
            hud.style.border = '1px solid #45475a';
            hud.style.borderRadius = '18px';
            hud.style.padding = '4px 8px';
            hud.style.color = '#cdd6f4';
            hud.style.fontSize = '12px';
            hud.style.display = 'flex';
            hud.style.alignItems = 'center';
            hud.style.gap = '5px';
            hud.style.boxShadow = '0 4px 14px rgba(0,0,0,.5)';
            hud.style.fontFamily = 'system-ui,sans-serif';
            hud.style.userSelect = 'none';
            hud.style.touchAction = 'none';
            hud.style.cursor = 'grab';
        }
        applyHudPosition(hud);
        bindHudDrag(hud);

        // 顶栏展开/收起、旋转屏幕都会挪动落点，跟着重排一次。
        if (hud.dataset.tbBound !== '1' && tbEl) {
            hud.dataset.tbBound = '1';
            try {
                const ro = new ResizeObserver(() => { if (!hudWriting && hud.isConnected) requestAnimationFrame(() => { try { updateHud(); } catch (e) { } }); });
                ro.observe(tbEl);
                teardowns.push(() => { try { ro.disconnect(); } catch (e) { } });
            } catch (e) { }
        }

        const has = currentBook && Array.isArray(currentBook.chunks) && currentBook.chunks.length > 0;
        const total = has ? currentBook.chunks.length : 0;
        // 跳转过程中按"要跳去的那一节"显示：这时的视口还是旧位置，
        // 用视口判定会让胶囊一直停在起点那一节。
        const idx = has ? (jumping() ? Math.min(Math.max(0, currentBook.currentIndex || 0), total - 1) : currentChunkIndex()) : 0;

        // 老版本实例（无 owner 概念）可能还活在长驻页面里，会用旧标记把 HUD 冲掉，
        // 让按钮失去 data-act 从而点不动。这里盯住 HUD，被冲掉就自己重画一遍。
        if (hud.dataset.repairBound !== '1') {
            hud.dataset.repairBound = '1';
            const mo = new MutationObserver(() => {
                if (hudWriting || !hud.isConnected) return;
                if (hud.querySelector('[data-act]')) return;
                hudWriting = true;
                requestAnimationFrame(() => { hudWriting = false; try { updateHud(); } catch (e) { } });
            });
            mo.observe(hud, { childList: true });
            teardowns.push(() => { try { mo.disconnect(); } catch (e) { } });
        }

        if (hud.dataset.actBound !== '1') {
            hud.dataset.actBound = '1';
            hud.addEventListener('click', e => {
                if (hudDragging || (nowMs() - hudMovedAt < 350)) {
                    try { e.preventDefault(); e.stopPropagation(); } catch (err) { }
                    return;
                }
                const t = e.target;
                if (dbgOn()) (window.__dg = window.__dg || []).push('tgt=' + t.id + ' matches=' + (t.matches ? t.matches('[data-act]') : 'n/a') + ' attr=' + (t.getAttribute ? t.getAttribute('data-act') : 'n/a') + ' dsact=' + (t.dataset ? t.dataset.act : 'n/a') + ' inst=' + INST + ' hudInst=' + hud.dataset.inst + ' sameHud=' + (document.getElementById('th-novel-hud') === hud));
                const el = t.closest('[data-act]') || t.closest('#th-novel-hud > *');
                if (!el) { if (dbgOn() && window.__dg) window.__dg.push('no-el'); return; }
                const act = el.dataset.act || HUD_ACT_BY_ID[el.id];
                if (dbgOn() && window.__dg) window.__dg.push('act=' + act);
                if (!act) { if (dbgOn() && window.__dg) window.__dg.push('no-act id=' + el.id); return; }
                if (act === 'info' || act === 'toc') openPanel('toc');
                else if (act === 'prev') prevChunk();
                else if (act === 'next') nextChunk();
                else if (act === 'gen') { if (queueRunning) stopQueue(); else queueNextN(3); }
                else if (act === 'pure') togglePure();
                else if (act === 'min') { settings.hudMinimized = true; saveSettings(); updateHud(); }
                else if (act === 'exp') { settings.hudMinimized = false; saveSettings(); updateHud(); }
            });
        }

        // 结构没变就只改文字/配色，不重建节点。
        // 重建会让正在按的按钮在 pointerup 之前消失（表现为"点不动、要按两下"），
        // 滚动时每帧重建一次更是卡。
        const wantInfo = has ? `📖 ${idx + 1}/${total}` : '点此导入';
        const wantGen = queueRunning ? `⏹️ ${queueProgress}` : '🎨+3';
        const shell = settings.hudMinimized ? 'exp' : 'full';
        if (hud.dataset.shell === shell && hud.querySelector('[data-act]')) {
            if (settings.hudMinimized) {
                const e = hud.querySelector('#hud-exp');
                if (e) {
                    const want = `📖 ${has ? `${idx + 1}/${total}` : '小说'}`;
                    if (e.textContent !== want) e.textContent = want;
                    const hasActs = hud.querySelectorAll('[data-act]').length;
                    if (hasActs !== 1) { hud.dataset.shell = ''; updateHud(); return; }
                }
            }
            const info = hud.querySelector('#hud-info');
            if (info && info.textContent !== wantInfo) info.textContent = wantInfo;
            const gen = hud.querySelector('#hud-gen');
            if (gen) {
                if (gen.textContent !== wantGen) gen.textContent = wantGen;
                const bg = queueRunning ? '#f38ba8' : '#a6e3a1';
                if (gen.style.background !== bg) { gen.style.background = bg; }
            }
            const pure = hud.querySelector('#hud-pure');
            const wantPure = settings.pureMode ? '🔆' : '✨';
            if (pure && pure.textContent !== wantPure) pure.textContent = wantPure;
            hud.dataset.inst = INST;
            return;
        }
        hud.dataset.shell = shell;

        if (settings.hudMinimized) {
            hud.innerHTML = `<span id="hud-exp" data-act="exp" style="cursor:pointer;font-weight:700;color:#89b4fa;padding:2px 4px;" title="可按住拖动移动位置">📖 ${has ? `${idx + 1}/${total}` : '小说'}</span>`;
            hud.dataset.posKey = '';
            applyHudPosition(hud);
            return;
        }

        const genLabel = queueRunning ? `⏹️ ${queueProgress}` : '🎨+3';
        hud.innerHTML = `
            <span id="hud-info" data-act="info" title="按住胶囊任意位置可自由拖动" style="cursor:grab;color:#89b4fa;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">
                ${has ? `📖 ${idx + 1}/${total}` : '点此导入'}
            </span>
            <button class="th-nv-btn" data-act="prev" id="hud-prev" title="上一节">⬅️</button>
            <button class="th-nv-btn" data-act="next" id="hud-next" title="下一节">➡️</button>
            <button class="th-nv-btn" data-act="gen" id="hud-gen" style="background:${queueRunning ? '#f38ba8' : '#a6e3a1'};color:#11111b;font-weight:700;" title="排队给后面 3 节生图">${genLabel}</button>
            <button class="th-nv-btn blue" data-act="toc" id="hud-toc" title="目录 / 书架 / 导出">📑目录</button>
            <button class="th-nv-btn" data-act="pure" id="hud-pure" title="纯净模式">${settings.pureMode ? '🔆' : '✨'}</button>
            <span id="hud-min" data-act="min" style="cursor:pointer;color:#6c7086;padding:0 3px;" title="收起">✕</span>
        `;
        // 点击交给容器上的那份委托（上面 actBound 只绑一次、跨重绘一直有效）。
        // 这里**不要**再给每个按钮挂监听：重绘后旧监听随节点消失，新监听又加一份，
        // 加上容器委托就是一次点击触发两遍 —— 表现是点一下「下一节」跳两节。
        hud.dataset.inst = INST;
        hud.dataset.posKey = '';
        applyHudPosition(hud);
        if (dbgOn()) { (window.__uh = window.__uh || []).push(INST + '|' + hud.innerHTML.replace(/\s+/g, ' ').slice(0, 120)); (window.__uh).push(INST + ':' + (hud.innerHTML.includes('data-act') ? 'new' : 'old')); }
    }

    // 兜底自愈：真机上顶栏、键盘、安全区都可能把胶囊挤到看不见的地方，
    // 或者宿主自己改样式把它压到下层。发现"不可见/被压住"就重排一次。
    function healHud() {
        const hw = getHostWindow();
        if (hw.__thReaderV6Owner && hw.__thReaderV6Owner !== INST) return;
        if (isDead() || !settings.showFloatingHud || hudDragging) return;
        const doc = getHostDocument();
        const hud = doc.getElementById('th-novel-hud');
        if (!hud) { updateHud(); return; }
        if (hud.dataset.inst && hud.dataset.inst !== INST) { try { hud.remove(); } catch (e) { } updateHud(); return; }
        const win = getHostWindow();
        const vw = win.innerWidth, vh = win.innerHeight;
        const r = hud.getBoundingClientRect();
        const cs = win.getComputedStyle(hud);
        const gone = r.width < 20 || r.height < 10 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw
            || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.2;
        // 采样中点，被别的元素整条压住也算看不见（打开自己的目录弹窗或绑定条时除外）
        let covered = false;
        if (!gone && r.width > 20) {
            const x = Math.min(vw - 2, Math.max(2, r.left + r.width / 2));
            const y = Math.min(vh - 2, Math.max(2, r.top + r.height / 2));
            const hit = doc.elementFromPoint(x, y);
            const ownModal = hit && hit.closest && hit.closest('#th-novel-panel, #th-novel-bind-bar');
            covered = Boolean(hit) && !ownModal && !hud.contains(hit) && !(hit.closest && hit.closest('#th-novel-hud'));
        }
        if (gone || covered) { try { hud.remove(); } catch (e) { } updateHud(); }
    }

    function togglePure(force) {
        settings.pureMode = force === undefined ? !settings.pureMode : Boolean(force);
        saveSettings();
        injectStyles();
        updateHud();
    }

    // ============ 导航 ============
    async function goToChunk(chunkIndex, opts) {
        if (isDead()) return false;
        opts = opts || {};
        if (!currentBook || !currentBook.chunks) return;
        const idx = Math.max(0, Math.min(chunkIndex, currentBook.chunks.length - 1));
        if (queueRunning || queueStarting) {
            const existing=findFloorByChunk(currentBook.id,idx);
            if(existing<0){notify('info','生图期间先阅读已入楼章节，队列结束后可跳转新章节');return false;}
            currentBook.currentIndex=idx;
            saveProgressOnly(currentBook);
            await scrollToFloorStart(existing,false);
            return true;
        }
        try { const w = window; w.__gi = w.__gi || []; w.__gi.push('in=' + chunkIndex + ' idx=' + idx); } catch (e) { }
        window.__dbg = window.__dbg || [];
        if (dbgOn() && window.__dbg) window.__dbg.push('goToChunk in=' + chunkIndex + ' idx=' + idx + ' book=' + (currentBook && currentBook.id) + ' ' + STK());
        const myNavSeq = ++goToChunkSeq;
        const prevIdx = Math.max(0, Number(currentBook.currentIndex) || 0);
        currentBook.currentIndex = idx;
        currentBook.lastMesId = 0;

        jumpGen++;
        stopJumpHold();
        stopLanding();
        stopPin();
        if (jumpGuardUntil < nowMs() + 3000) jumpGuardUntil = nowMs() + 3000;
        updateHud();

        const prevAppendLock = appendInFlight;
        appendInFlight = true;
        let mesId = -1;
        try {
            const wantBelow = Math.min(6, Math.max(3, Math.round((viewHOf(getChatEl()) || 700) / 150)));
            const targetMaxIdx = Math.min(currentBook.chunks.length - 1, Math.max(prevIdx, idx) + wantBelow);
            // 自动将当前阅读章节与跳转目标章节之间的所有中间章节按严格顺序补齐入楼，使楼层序号永久连续不乱序！
            await ensureContiguousFloorsUpTo(currentBook, targetMaxIdx, idx);
            if (isDead() || myNavSeq !== goToChunkSeq) return false;

            mesId = findFloorByChunk(currentBook.id, idx);
            if (mesId < 0) {
                mesId = await deployFloor(idx, { skipSave: true });
            }
            const mapCheck = scanFloorMap(currentBook);
            if (mapCheck[idx] && mapCheck[idx].stale) {
                await refreshStaleFloors(currentBook, idx);
            }
            const finalId = findFloorByChunk(currentBook.id, idx);
            if (finalId >= 0) mesId = finalId;
            if (mesId < 0 || myNavSeq !== goToChunkSeq) return false;

            const ctx = getSTContext();
            if (ctx && typeof ctx.saveChat === 'function') {
                try { await ctx.saveChat(); } catch (e) { }
            }
        } finally {
            appendInFlight = prevAppendLock;
        }

        if (isDead() || myNavSeq !== goToChunkSeq) return false;
        currentBook.lastMesId = mesId;
        await saveBook(currentBook);
        if (isDead() || myNavSeq !== goToChunkSeq) return false;
        ensureTail();
        await scrollToFloorStart(mesId, false);
        if (isDead() || myNavSeq !== goToChunkSeq) return false;
        noteNav(idx);            // 落点就是下一次翻页的起点
        navPos = idx;
        landedUntil = nowMs() + 8000;
        // 标记写死在落点上：翻页起点与几何定位共用它，别让它在滚动过程中漂走
        markActiveFloor(mesId);
        updateHud();
        refreshHudMap();
        // 翻页是"一次到位"的操作。上方/下方楼层还会陆续成文把目标顶开，
        // 跟随循环按固定时长早就收手，所以落定后继续盯一段时间。
        watchLanding(idx);

        if (opts.illustrate) {
            // 先滚到位再触发，插件的按钮依赖楼层在视口内
            await sleep(220);
            const before = floorImages(mesId, (getSTContext() || {}).chat?.[mesId]).length;
            if (before === 0) {
                const trig = await triggerIllustration(mesId);
                notify(trig.ok ? 'success' : 'error', trig.ok ? `已触发【${currentBook.chunks[idx].title}】生图` : `触发失败：${trig.reason}`);
            } else {
                notify('info', '这一节已经有配图了');
            }
        }
    }

    // 上一次翻页的目标与时刻：短时间内连按沿它续接
    let navLastTarget = -1;
    let navAt = 0;
    // 刚跳完的这段时间里，滚动监听读到的是我们自己的写入引起的滚动，
    // 它按 32% 焦点判定、天生偏上一节，照着它改指针和锚点 = 每点一次倒退一节。
    let landedUntil = 0;

    // 落点守卫：跳完之后的一段时间（8 秒）把目标楼层钉在视口顶端。
    // 上方楼层陆续成文会把目标顶下去，靠几次定时补校正不够——成文是持续的，
    // 这里跟着 ResizeObserver 走，内容一变就重新对准；读者一动手就让位。
    let landingTimer = 0;
    let landingObserver = null;
    function watchLanding(idx) {
        stopLanding();
        const deadline = nowMs() + 8000;
        const align = () => {
            if (userTookOver) { stopLanding(); return; }
            const chatEl = getChatEl();
            const node = floorNodeOfChunk(idx);
            if (!chatEl || !node) return;
            const want = floorTopOffset(chatEl, node);
            const gap = node.getBoundingClientRect().top - chatEl.getBoundingClientRect().top;
            if (Math.abs(gap) > 10) setTopRaw(chatEl, want);
            // 标记跟着落点走：滚动监听在守卫期内不看，标记一旦漂走就再也回不来
            if (node.getAttribute('mesid') && !node.classList.contains('th-novel-active-floor')) markActiveFloor(Number(node.getAttribute('mesid')));
        };
        try {
            landingObserver = new ResizeObserver(() => { if (!userTookOver && nowMs() < deadline) align(); });
            const chatEl = getChatEl();
            if (chatEl) {
                landingObserver.observe(chatEl);
                for (const c of chatEl.children) landingObserver.observe(c);
            }
        } catch (e) { }
        const tick = () => {
            if (isDead() || userTookOver || nowMs() > deadline) { stopLanding(); return; }
            align();
            landingTimer = setTimeout(tick, 400);
        };
        landingTimer = setTimeout(tick, 300);
    }
    function stopLanding() {
        if (landingTimer) { clearTimeout(landingTimer); landingTimer = 0; }
        if (landingObserver) { try { landingObserver.disconnect(); } catch (e) { } landingObserver = null; }
    }

    function elStillThere(mesId) {
        return Boolean(getHostDocument().querySelector(`#chat .mes[mesid="${mesId}"]`));
    }

    function floorNodeOfChunk(idx) {
        const info = scanFloorMap()[idx];
        if (!info) return null;
        return getHostDocument().querySelector(`#chat .mes[mesid="${info.mesId}"]`);
    }

    // 「上一节 / 下一节」的起点。
    //
    // 只用视口顶端：currentIndex 会被「触底预接」推到读者还没看到的一节，
    // 而"当前楼层"标记在尾部余量/空壳区会落到后面好几层，两者都不稳。
    // 连按时沿上一次的目标续接——刚跳完的一瞬视口还在路上，不续接就会连点原地不动。
    // 视口顶端那一节。
    //
    // 不用 elementFromPoint：楼层之间有重叠（正文块的外边距/负偏移），探针会稳定地
    // 命中上面那一层的尾巴，于是每次"下一节"都倒退一两节。
    // 这里按几何选"顶边最贴近视口顶端"的那一层：偏 +4px 时目标自己最近，
    // 偏 -34px 时目标仍然是最近的（上层差了四百多像素），不会被误判成上一层。
    // 翻页起点 = 上一次的落点。
    //
    // 几何探针（elementFromPoint / 最近顶边）在落点偏 ±40px 时都会指向上一层，
    // 于是"下一节"变成原地或倒退。上一跳落在哪一节是确定的，直接沿它走最可靠；
    // 只有读者自己滑远了（视口与它相差超过 2 节）才改用视口。
    // 翻页起点 = 书籍指针（currentBook.currentIndex）。
    //
    // 指针是唯一"由我们写、不受渲染时序影响"的位置：goToChunk 落点和滚动监听的
    // 用户滑动都会写它。几何探针在落点偏几十像素时必然指向上一层，不能当起点。
    // 唯一的例外是「触底预接」会把指针推到读者还没看到的一节，超出上一跳两节以上
    // 就说明是预接推进，退回上一跳的落点。
    // 翻页起点 = 当前楼层标记所指的那一节。
    //
    // 标记只有三处会写：goToChunk 落点、目录点击、以及读者自己滑动时的滚动监听。
    // 它不受渲染时序影响（几何读数在落点偏几十像素时必然指向上一层），
    // 也不会被"触底预接"往前推（那是 currentIndex 的毛病）。
    // 翻页位置：由我们自己的点击推进，一步一格。
    //
    // 不能用视口读数——它在落点偏几十像素时必然指向上一层，也不能用 currentIndex
    // ——它会被触底预接往前推。这里维护一个显式的整数位置：
    //   · 每次翻页按 ±1 走，走过去立即落位；
    //   · 读者自己滑了（滚动监听换了节）才从标记重新同步。
    let navPos = -1;

    function syncNavPos() {
        if (!currentBook) return 0;
        const maxIdx = Math.max(0, (currentBook.chunks || []).length - 1);
        const mk = markedChunkIdx();
        if (mk >= 0 && (navPos < 0 || Math.abs(mk - navPos) > 1)) navPos = mk;
        if (navPos < 0) navPos = Math.min(Math.max(0, currentBook.currentIndex || 0), maxIdx);
        return Math.min(Math.max(0, navPos), maxIdx);
    }

    // 当前楼层标记指向的节号（没有标记返回 -1）
    function markedChunkIdx() {
        const m = getHostDocument().querySelector('#chat .mes.th-novel-active-floor');
        return m ? chunkIndexOfMesEl(m) : -1;
    }

    function noteNav(target) { navLastTarget = target; navAt = nowMs(); }

    // 跳转还在进行时点击：等它收手再算起点。动画途中的几何是中间态，
    // 任何来源这时都会答错，连按就变成"跳两节"或"原地不动"。
    async function settleJump(budgetMs) {
        const deadline = nowMs() + (budgetMs || 9000);
        let n0 = 0;
        while (jumping() && nowMs() < deadline) {
            n0++;
            if (queueStop) return;
            await sleep(120);
        }
        try { const w = window; w.__sj2 = w.__sj2 || []; w.__sj2.push('loops=' + n0 + ' still=' + jumping() + ' jg=' + (typeof jumpGuardUntil)); } catch (e) { }
        await sleep(220);
    }

    // 落定后把连按窗口重新起算：settleJump 自己可能就等了好几秒，
    // 不重置的话第二次点击已经没有"上一次目标"可用，只能退回视口重新猜。
    function refreshNavClock() { if (navLastTarget >= 0) navAt = nowMs(); }

    async function prevChunk() {
        if (!currentBook) return;
        syncNavPos();
        if (navPos <= 0) { notify('info', '已经是第一节'); return; }
        navPos -= 1;
        noteNav(navPos);
        await goToChunk(navPos);
    }
    async function nextChunk() {
        if (!currentBook) return;
        syncNavPos();
        if (navPos >= currentBook.chunks.length - 1) { notify('info', '已经是最后一节'); return; }
        navPos += 1;
        noteNav(navPos);
        await goToChunk(navPos);
    }

    // ============ 滚动监听 ============
    function installScrollSpy() {
        const chatEl = getChatEl();
        installChatHooks();
        const token = INST + '/' + MY_GEN;
        if (!chatEl || chatEl.dataset.thNovelSpyV6 === token) return;
        chatEl.dataset.thNovelSpyV6 = token;

        // 手指/滚轮一介入就放弃自动定位；惯性滚动不触发这些事件，所以只打断真正的操作
        const surrenderToUser = () => {
            userTookOver = true;
            noteGesture();
            stopLanding();
            if (smoothTarget === null) return;
            smoothTarget = null;
            smoothUntil = 0;
            frozenTop = rawTop(chatEl);
        };
        on(chatEl, 'touchstart', surrenderToUser, { passive: true, capture: true });
        on(chatEl, 'mousedown', surrenderToUser, { passive: true, capture: true });
        on(chatEl, 'wheel', surrenderToUser, { passive: true, capture: true });
        on(chatEl, 'scroll', () => {
            // 跳转/追加期间由定位逻辑负责，别让这里改写阅读位置
            if (smoothTarget !== null) {
                if (nowMs() > smoothUntil) smoothTarget = null; else return;
            }
            if (pinObserver) return;
            if (!currentBook) return;
            // 跳转跟随窗口里视口还在路上：这时的滚动是我们自己写的，
            // 不该拿它去改写阅读位置（否则跳远距离时序号会被沿途楼层一路改回去）。
            if (jumping()) return;

            // 用户自己动手了：把冻结值改成用户当前位置
            frozenTop = rawTop(chatEl);

            const vis = detectVisible();
            if (!vis) return;
            const changed = vis.mesId !== lastVisible.mesId;
            lastVisible = vis;
            if (changed) {
                markActiveFloor(vis.mesId);
                if (vis.chunkIdx >= 0 && vis.chunkIdx < currentBook.chunks.length) {
                    currentBook.currentIndex = vis.chunkIdx;
                    currentBook.lastMesId = vis.mesId;
                    // 只有读者自己动手滑出来的位移才改写翻页起点。
                    // 落定后的滚动多半来自我们的落点校正，读数又偏上一节，
                    // 照单全收会让"下一节"一路往回退。
                    if (nowMs() - lastGestureAt < 1200) noteNav(vis.chunkIdx);
                }
                // 跳转跟随窗口里视口还在路上，胶囊按目标节显示，别被旧位置改写
                if (!jumping()) updateHud();
            }
        }, { passive: true });

        // 停止滚动后落盘 + 兜底补接
        on(chatEl, 'scroll', debounce(() => {
            if (isDead()) return;
            if (smoothTarget !== null || pinObserver) return;
            if (currentBook) {
                currentBook.lastScrollTop = rawTop(chatEl);
                // 滚动只写进度；整本（几 MB）留到停稳久一点再写
                saveProgressOnly(currentBook);
                scheduleFullSave();
            }
            const dist = chatEl.scrollHeight - rawTop(chatEl) - chatEl.clientHeight;
            if (dist <= 260) triggerAutoAppend();
        }, 260), { passive: true });
    }

    function debounce(fn, ms) {
        let t = 0;
        return function () {
            clearTimeout(t);
            t = setTimeout(fn, ms);
        };
    }

    // 停手 1.5 秒才整本落盘一次（大书写一次要 100ms 上下）
    let fullSaveTimer = 0;
    function scheduleFullSave() {
        if (fullSaveTimer) clearTimeout(fullSaveTimer);
        fullSaveTimer = setTimeout(() => {
            fullSaveTimer = 0;
            if (!isDead() && currentBook) saveBook(currentBook);
        }, 1500);
    }
    teardowns.push(() => { if (fullSaveTimer) clearTimeout(fullSaveTimer); });

    // ============ 导入 ============
    function pickFile() {
        if (queueRunning || queueStarting || appendInFlight) { notify('info','请先等待当前任务结束'); return; }
        document.body.dataset.lastPick = INST + '/' + MY_GEN + '/' + (window.__thReaderV6Gen||'-');
        if (dbgOn()) (globalThis.__imp = globalThis.__imp || []).push('PICK gen=' + MY_GEN + ' inst=' + INST + ' dead=' + isDead());
        const doc = getHostDocument();
        const old = doc.getElementById('th-novel-file-v6');
        if (old) old.remove();
        const input = doc.createElement('input');
        input.id = 'th-novel-file-v6';
        input.type = 'file';
        input.accept = '.txt,.md,text/plain';
        input.style.display = 'none';
        input.dataset.inst = INST;
        if (dbgOn()) (globalThis.__imp = globalThis.__imp || []).push('WIRED gen=' + MY_GEN + ' inst=' + INST);
        input.addEventListener('change', async () => {
            if (dbgOn()) (globalThis.__imp = globalThis.__imp || []).push('CHANGE gen=' + MY_GEN + ' inst=' + INST + ' target=' + (input.dataset.inst||'-') + ' inputs=' + doc.querySelectorAll('#th-novel-file-v6').length + ' wand=' + doc.querySelectorAll('#th-wand-import').length + ' files=' + (input.files && input.files.length));
            const f = input.files && input.files[0];
            if (!f) return;
            input.remove();
            await importFile(f);
        });
        (doc.body || doc.documentElement).appendChild(input);
        input.click();
    }

    async function importFile(file) {
        try {
            if (dbgOn()) (globalThis.__imp = globalThis.__imp || []).push('IMPORTFILE gen=' + MY_GEN + ' inst=' + INST + ' dead=' + isDead());
            if (dbgOn() && globalThis.__cbs) globalThis.__cbs.push('IMPORTFILE in ' + file.name + ' gen=' + MY_GEN + ' dead=' + isDead() + ' cur=' + (currentBook && currentBook.id));
            notify('info', `正在读取《${file.name}》…`);
            const raw = decodeBuffer(await file.arrayBuffer());
            const title = file.name.replace(/\.(txt|md)$/i, '').trim() || '未命名小说';
            const rawChapters = parseChapters(raw);

            if (!rawChapters.length) { notify('error', '没从文件里解析出内容'); return; }
            const chars = rawChapters.reduce((a, c) => a + c.content.length, 0);

            const existed = await listBooks();
            const prevSameBook = existed.find(b => b.title === title);
            const id = prevSameBook ? prevSameBook.id : ('book_' + hashText(title + '_' + (file.size || chars)));
            const resumeIdx = prevSameBook ? Math.max(0, Number(prevSameBook.currentIndex) || 0) : 0;

            const book = {
                id, title, cardName: title,
                sizeBytes: file.size || chars,
                createdAt: prevSameBook ? (prevSameBook.createdAt || nowMs()) : nowMs(),
                currentIndex: resumeIdx,
                lastMesId: prevSameBook ? (prevSameBook.lastMesId || 0) : 0,
                lastScrollTop: prevSameBook ? (prevSameBook.lastScrollTop || 0) : 0,
                appliedChunkSize: Number(settings.chunkSize) || 0,
                rawChapters, chunks: []
            };
            const r = buildChunks(book);
            if (!book.chunks.length) { notify('error', '切分后没有内容'); return; }

            importInFlight = true;
            try {
                currentBook = book; __cbSet?.(currentBook, 'p5');
                pinnedBookId = id;
                settings.activeBookId = id;
                await saveBook(book);
                await saveSettings();
                selectedChunkSet.clear();

                if (settings.autoCreateCard && book.cardName) {
                    await ensureCard(book.cardName, book.title);
                    await waitChatReady(book.cardName, 9000);
                }

                await adoptLegacyFloors(book);

                const targetStartIdx = Math.min(book.currentIndex || 0, book.chunks.length - 1);
                const deployStart = async () => {
                    await deployFloor(0, { book });
                    if (book.chunks.length > 1) {
                        await deployFloor(1, { book });
                    }
                };
                if (!Object.keys(scanFloorMap(book)).length) {
                    await deployStart();
                }
                if (!Object.keys(scanFloorMap(book)).length) {
                    await waitChatReady(book.cardName, 8000);
                    await sleep(600);
                    await deployStart();
                }
                refreshHudMap();
                await goToChunk(targetStartIdx);

            notify('success', `《${title}》已导入：${rawChapters.length} 章 → ${book.chunks.length} 节，内容保留 ${(r.coverage * 100).toFixed(1)}%`);
            if (r.coverage < 0.985) notify('warning', `切分覆盖率偏低（${(r.coverage * 100).toFixed(1)}%），建议在目录里换成更小的每节字数后重试`);
            } finally {
                importInFlight = false;
            }
        } catch (err) {
            console.error('[reader] 导入失败', err);
            notify('error', `导入失败：${err && err.message ? err.message : err}`);
        }
    }

    // 等聊天就位：卡已经切过去、并且聊天已经有内容且拿到了 chatId。
    async function waitChatReady(cardName, budgetMs) {
        const deadline = nowMs() + (budgetMs || 8000);
        while (nowMs() < deadline) {
            const ctx = getSTContext();
            const sameCard = !cardName || !ctx || ctx.name2 === cardName;
            if (sameCard && hasOpenChat()) {
                // 再稳一拍：紧接着的那一下还可能被重排
                await sleep(400);
                return true;
            }
            await sleep(150);
        }
        return false;
    }

    async function ensureCard(cardName, novelTitle) {
        const hw = getHostWindow();
        const th = getTavernHelper();
        const createFn = (typeof createOrReplaceCharacter === 'function') ? createOrReplaceCharacter
            : (th && th.createOrReplaceCharacter);
        const getFn = (typeof getCharacter === 'function') ? getCharacter : (th && th.getCharacter);

        let exists = false;
        try { if (getFn) exists = Boolean(await getFn(cardName)); } catch (e) { }
        if (!exists && createFn) {
            try {
                await createFn(cardName, {
                    description: settings.defaultCardPrompt + `\n当前绑定小说：《${novelTitle}》`,
                    first_messages: [`📖 欢迎阅读《${novelTitle}》。右上角胶囊可翻章、开目录、生图与导出。`]
                });
                notify('success', `已创建同名角色卡【${cardName}】`);
            } catch (e) { }
        }

        try {
            const ctx = getSTContext();
            if (ctx && ctx.name2 === cardName) return true;
            if (ctx && Array.isArray(ctx.characters) && typeof ctx.selectCharacterById === 'function') {
                const i = ctx.characters.findIndex(c => c && c.name === cardName);
                if (i >= 0) { await ctx.selectCharacterById(String(i)); await sleep(700); return true; }
            }
            const slash = (typeof triggerSlash === 'function') ? triggerSlash : (th && th.triggerSlash);
            if (slash) { await slash(`/go ${cardName}`); await sleep(700); return true; }
        } catch (e) { }
        return false;
    }

    // 当前有没有真的开着一个聊天。
    // 光能 push 进 ctx.chat 是不够的：墨影取图存路径靠 getCurrentChatId()，
    // 没有它就只弹一句"当前没有打开的聊天，本次没有生成生图 tag"，楼铺出来也不带图。
    function hasOpenChat() {
        const ctx = getSTContext();
        if (!ctx) return false;
        try { if (typeof ctx.getCurrentChatId === 'function') return Boolean(ctx.getCurrentChatId()); } catch (e) { }
        // 老版本没有这个 API 时退回"有聊天内容且不是未选角色"
        return Boolean(ctx.name2) && Array.isArray(ctx.chat) && ctx.chat.length > 0;
    }

    // 没有打开聊天就把它补上：先回到这本小说的角色卡（选卡会自动带出它的聊天），
    // 卡也没有就新建一张。直接 /newchat 是不行的——关掉聊天后酒馆处于"没选角色"状态，
    // 这时 /newchat 什么也不做。
    let openingChat = null;
    async function ensureOpenChat() {
        if (hasOpenChat()) return true;
        if (openingChat) { try { await openingChat; } catch (e) { } return hasOpenChat(); }
        const run = async () => {
            const ctx = getSTContext();
            if (!ctx) return false;
            const want = (currentBook && (currentBook.cardName || currentBook.title)) || '';
            let idx = -1;
            if (want && Array.isArray(ctx.characters)) {
                idx = ctx.characters.findIndex(c => c && c.name === want);
            }
            if (idx < 0 && want) {
                // 卡被删了就重建，不再往下摆烂
                await ensureCard(want, (currentBook && currentBook.title) || want);
                const c2 = getSTContext();
                if (c2 && Array.isArray(c2.characters)) idx = c2.characters.findIndex(c => c && c.name === want);
            }
            if (idx >= 0 && typeof ctx.selectCharacterById === 'function') {
                try { await ctx.selectCharacterById(String(idx)); } catch (e) { }
                for (let i = 0; i < 24; i++) { await sleep(250); if (hasOpenChat()) return true; }
            }
            if (hasOpenChat()) return true;
            // 角色已经在选了，只是没有聊天文件
            try { if (typeof ctx.executeSlashCommands === 'function') await ctx.executeSlashCommands('/newchat'); } catch (e) { }
            for (let i = 0; i < 20; i++) { await sleep(250); if (hasOpenChat()) return true; }
            return false;
        };
        openingChat = run();
        const ok = await openingChat;
        openingChat = null;
        return ok;
    }

    // 当前聊天里被铺楼的书（去重）
    function floorOwners() {
        const ctx = getSTContext();
        if (!ctx || !Array.isArray(ctx.chat)) return [];
        const set = new Set();
        for (const m of ctx.chat) {
            const mk = m && m.extra && m.extra[MARK_KEY];
            if (mk && mk.bookId) set.add(mk.bookId);
        }
        return Array.from(set);
    }

    // 载入当前书；不抢别的书
    async function loadBook() {
        // 被新实例拆掉之后，boot 里还没走完的 await 会继续往下跑；
        // 这时它再去 loadBook 就会把用户刚导入的那本换成旧的。
        if (isDead()) return false;
        // 导入正在跑：无条件保持手上这本。
        // 注意不能加"本聊天没有它的楼层"之类的条件——如果聊天里还躺着上一本书的楼层，
        // 那些楼层会让这里误判成"当前该是那本旧书"，于是新铺的楼层全被打上新书的号都没了。
        if (importInFlight && currentBook) {
            return Boolean(currentBook.chunks && currentBook.chunks.length);
        }
        // 这段里有一串 await。等回来的时候，用户可能已经导入/切到另一本书了，
        // 再按进场时的快照去覆盖，就会把刚导入的那本顶掉（楼层被打上旧书号成孤儿、目录全空）。
        const entryBook = currentBook;
        const entryPin = pinnedBookId;
        // 进场之后只要有人换过书（导入会同时改 currentBook 和 pinnedBookId），
        // 就把决定权让给它，别用进场时的旧快照覆盖。
        const overtaken = () => Boolean((currentBook && currentBook !== entryBook) || pinnedBookId !== entryPin);
        if (!settingsLoaded) await loadSettings();
        if (isDead()) return false;
        if (overtaken()) { applyProgress(currentBook); return true; }
        const ctx = getSTContext();
        const cardName = ctx ? ctx.name2 : '';
        const books = await listBooks();
        if (isDead()) return false;
        if (overtaken()) { applyProgress(currentBook); return true; }
        if (!books.length) { currentBook = null; __cbSet?.(currentBook, 'p5'); return false; }

        // 优先级（从可靠到不可靠）：
        //   1. 当前聊天里铺着哪本书的楼层 —— 最硬的事实
        //   2. 内存里的当前书 —— 导入/切书刚发生过时就是它，不能被下面的旧值顶掉
        //   3. settings.activeBookId、卡片名、第一本
        // 原先只看 activeBookId/卡片名时，导入途中触发的 CHAT_CHANGED 会把它换成别的书，
        // 于是刚铺的楼层全带上了错书号，变成孤儿。
        const owners = await floorOwners();
        // 0) 刚刚导入/续读的那本书钉死优先，直到用户显式换书。
        const pinWins = pinnedBookId && books.some(b => b.id === pinnedBookId)
            && (importInFlight || owners.length === 0 || owners.includes(pinnedBookId));
        if (overtaken()) { applyProgress(currentBook); return true; }
        if (pinWins) {
            const __k = (currentBook && currentBook.id === pinnedBookId) ? currentBook : await getBook(pinnedBookId);
            if (dbgOn() && window.__bm) window.__bm.push('loadBook pin -> ' + (__k && __k.id) + ' from ' + (currentBook && currentBook.id) + ' inst=' + INST);
            currentBook = __k; __cbSet?.(currentBook, 'p5');
            if (currentBook) {
                applyProgress(currentBook);
                if (settings.activeBookId !== currentBook.id) { settings.activeBookId = currentBook.id; await saveSettings(); }
                return Boolean(currentBook.chunks && currentBook.chunks.length);
            }
        }
        if (dbgOn() && window.__bm) window.__bm.push('loadBook entry cur=' + (currentBook && currentBook.id) + ' owners=' + owners.join('|') + ' pin=' + pinnedBookId + ' active=' + settings.activeBookId + ' inst=' + INST);
        if (owners.length === 1 && books.some(b => b.id === owners[0])) {
            if (!currentBook || currentBook.id !== owners[0]) {
                currentBook = await getBook(owners[0]); __cbSet?.(currentBook, 'p5');
            } else {
                applyProgress(currentBook);
            }
            if (currentBook) { settings.activeBookId = currentBook.id; await saveSettings(); }
        } else if (currentBook) {
            applyProgress(currentBook);
            if (settings.activeBookId !== currentBook.id) {
                settings.activeBookId = currentBook.id;
                await saveSettings();
            }
        } else if (settings.activeBookId) {
            currentBook = await getBook(settings.activeBookId); __cbSet?.(currentBook, 'p5');
        }

        if (dbgOn() && window.__bm) window.__bm.push('loadBook exit cur=' + (currentBook && currentBook.id) + ' inst=' + INST);
        if (!currentBook) {
            const byCard = cardName ? books.find(b => b.cardName === cardName || b.title === cardName) : null;
            currentBook = byCard || books[0]; __cbSet?.(currentBook, 'p5');
            if (currentBook) { settings.activeBookId = currentBook.id; await saveSettings(); }
        }
        if (!currentBook) return false;
        // 走到这里说明"当前书"已经被确定，钉住它，避免下一次调用又漂走
        if (dbgOn() && window.__bm) window.__bm.push('PINNED ' + currentBook.id + ' inst=' + INST + ' ' + STK());
        pinnedBookId = currentBook.id;

        await adoptLegacyFloors(currentBook);

        // 只有切分参数变了才重切，且不因“当前书已铺楼”而反复重写正文
        const limit = Math.max(0, Number(settings.chunkSize) || 0);
        if (!Array.isArray(currentBook.chunks) || !currentBook.chunks.length) {
            buildChunks(currentBook);
            await saveBook(currentBook);
            if (dbgOn() && window.__bm) window.__bm.push('setBook ' + currentBook.id + ' inst=' + INST);
        }
        settings.chunkSize = Number(currentBook.appliedChunkSize) || 0;
        return Boolean(currentBook.chunks && currentBook.chunks.length);
    }

    // ============ 导出（含插图，位置严格对应） ============
    // 手写 store-only ZIP：不依赖任何外部库，也不会被 CSP 拦
    function crc32Table() {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[i] = c >>> 0;
        }
        return t;
    }
    const CRC_TABLE = crc32Table();

    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function utf8(str) { return new TextEncoder().encode(str); }

    // 文本走 deflate-raw 压缩（图片本身已压缩，以及 EPUB 规范要求首文件 mimetype 必须保持 method=0 无压缩 store）。
    async function maybeDeflate(data, name) {
        if (name === 'mimetype') return { data, method: 0 };
        if (typeof CompressionStream !== 'function') return { data, method: 0 };
        if (/\.(png|jpe?g|webp|gif|avif)$/i.test(name)) return { data, method: 0 };
        try {
            const cs = new CompressionStream('deflate-raw');
            const writer = cs.writable.getWriter();
            writer.write(data);
            writer.close();
            const out = new Uint8Array(await new Response(cs.readable).arrayBuffer());
            if (out.length >= data.length) return { data, method: 0 };
            return { data: out, method: 8 };
        } catch (e) {
            return { data, method: 0 };
        }
    }

    async function buildZip(entries) {
        const parts = [];
        const central = [];
        let offset = 0;

        for (const e of entries) {
            const nameBytes = utf8(e.name);
            const raw = e.data instanceof Uint8Array ? e.data : utf8(String(e.data || ''));
            const packed = await maybeDeflate(raw, e.name);
            const crc = crc32(raw);
            const compSize = packed.data.length;
            const size = raw.length;

            const local = new Uint8Array(30 + nameBytes.length);
            const lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);
            lv.setUint16(6, 0x0800, true);
            lv.setUint16(8, packed.method, true);
            lv.setUint16(10, 0, true);
            lv.setUint16(12, 0x21, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, compSize, true);
            lv.setUint32(22, size, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);
            local.set(nameBytes, 30);
            parts.push(local, packed.data);

            const cd = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(cd.buffer);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(8, 0x0800, true);
            cv.setUint16(10, packed.method, true);
            cv.setUint16(12, 0, true);
            cv.setUint16(14, 0x21, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, compSize, true);
            cv.setUint32(24, size, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);
            cv.setUint16(32, 0, true);
            cv.setUint16(34, 0, true);
            cv.setUint16(36, 0, true);
            cv.setUint32(38, 0, true);
            cv.setUint32(42, offset, true);
            cd.set(nameBytes, 46);
            central.push(cd);

            offset += local.length + compSize;
        }

        const centralSize = central.reduce((a, c) => a + c.length, 0);
        const endRec = new Uint8Array(22);
        const ev = new DataView(endRec.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(8, entries.length, true);
        ev.setUint16(10, entries.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);

        return new Blob([...parts, ...central, endRec], { type: 'application/zip' });
    }

    function extFromUrl(url, fallback) {
        const m = String(url).match(/\.(png|jpe?g|webp|gif|avif)(?:\?|#|$)/i);
        if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
        const d = String(url).match(/^data:image\/([a-z]+)[;,]?/i);
        if (d) return d[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        const b = String(url).match(/^data:[^;]+;base64,/);
        return b ? (fallback || 'png') : (fallback || 'png');
    }

    async function urlToBytes(url) {
        const u = String(url || '');
        if (!u) return null;
        try {
            if (/^data:/i.test(u)) {
                const b64 = u.split(',')[1] || '';
                const bin = atob(b64);
                const out = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                return out;
            }
            if (/^blob:/i.test(u)) {
                const r = await fetch(u);
                return new Uint8Array(await r.arrayBuffer());
            }
            const r = await fetch(u, { credentials: 'include' });
            if (!r.ok) return null;
            return new Uint8Array(await r.arrayBuffer());
        } catch (e) { return null; }
    }

    function safeName(s) {
        return String(s || 'untitled').replace(/[\\/:*?"<>|\n\r\t]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90) || 'untitled';
    }

    // 收集每一节的插图（含 data / 文件地址），按节序号归位
    async function collectImages(book, chunkIndices) {
        const ctx = getSTContext();
        const map = scanFloorMap(book);
        const byChunk = new Map();
        let total = 0, failed = 0;

        for (const idx of chunkIndices) {
            const info = map[idx];
            if (!info) continue;
            const msg = ctx && Array.isArray(ctx.chat) ? ctx.chat[info.mesId] : null;
            const list = floorImages(info.mesId, msg);
            if (!list.length) continue;

            const got = [];
            for (const img of list) {
                const bytes = await urlToBytes(img.url);
                if (!bytes || !bytes.length) { failed++; continue; }
                got.push({ bytes, ext: extFromUrl(img.url), title: img.title });
                total++;
            }
            if (got.length) byChunk.set(idx, got);
        }
        return { byChunk, total, failed };
    }

    function composeMarkdown(book, chunkIndices, imgIndex, opts) {
        const lines = [];
        const imgTotal = chunkIndices.reduce((a, i) => a + (imgIndex.byChunk.get(i) || []).length, 0);
        const prefix = opts.imgPrefix || '';
        lines.push('# ' + book.title, '');
        lines.push('> 导出自酒馆小说配图阅读器 v' + VERSION + ' · ' + new Date().toLocaleString());
        lines.push('> 共 ' + chunkIndices.length + ' 节，插图 ' + imgTotal + ' 张', '');
        let lastChapter = null;

        for (const idx of chunkIndices) {
            const chunk = book.chunks[idx];
            if (!chunk) continue;
            if (opts.splitByChapter && chunk.chapterTitle && chunk.chapterTitle !== lastChapter) {
                lastChapter = chunk.chapterTitle;
                lines.push('## ' + chunk.chapterTitle, '');
            } else if (!opts.splitByChapter) {
                lines.push('### 第' + (idx + 1) + '节 · ' + chunk.title, '');
            }
            lines.push(chunk.content, '');
            for (const im of (imgIndex.byChunk.get(idx) || [])) {
                lines.push('![' + (im.title || chunk.title) + '](' + prefix + im.rel + ')', '');
            }
        }
        return lines.join('\n');
    }

    function composeHtml(book, chunkIndices, imgIndex, opts) {
        const body = [];
        const pageImgs = chunkIndices.reduce((a, i) => a + (imgIndex.byChunk.get(i) || []).length, 0);
        body.push(`<header><h1>${esc(book.title)}</h1><p class="meta">导出自酒馆小说配图阅读器 v${VERSION} · ${esc(new Date().toLocaleString())} · ${chunkIndices.length} 节 · ${pageImgs} 图</p></header>`);
        let lastChapter = null;
        for (const idx of chunkIndices) {
            const chunk = book.chunks[idx];
            if (!chunk) continue;
            if (opts.splitByChapter && chunk.chapterTitle && chunk.chapterTitle !== lastChapter) {
                lastChapter = chunk.chapterTitle;
                body.push(`<h2>${esc(chunk.chapterTitle)}</h2>`);
            } else if (!opts.splitByChapter) {
                body.push(`<h3>第${idx + 1}节 · ${esc(chunk.title)}</h3>`);
            }
            body.push(`<article class="chunk">${esc(chunk.content).replace(/\n/g, '<br>')}</article>`);
            for (const im of (imgIndex.byChunk.get(idx) || [])) {
                body.push(`<figure><img src="${esc(im.rel)}" alt="${esc(im.title || chunk.title)}" loading="lazy"><figcaption>${esc(chunk.title)}</figcaption></figure>`);
            }
        }
        return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(book.title)}</title>
<style>
  body{max-width:44em;margin:0 auto;padding:2em 1.2em 6em;background:#16161e;color:#d7d8e5;
       font-family:"Noto Serif SC","Songti SC",serif;line-height:1.95;font-size:17px}
  header{border-bottom:1px solid #333;padding-bottom:1em;margin-bottom:2em}
  h1{font-size:1.7em;margin:.2em 0;color:#a9c1ff}
  h2{font-size:1.25em;margin:2.4em 0 .8em;color:#ffd48f;border-left:3px solid #ffd48f;padding-left:.6em}
  h3{font-size:1.05em;margin:1.8em 0 .6em;color:#9fd6a6}
  .meta{color:#7c7f96;font-size:.82em}
  .chunk{text-indent:2em;margin:0 0 1.1em}
  figure{margin:1.4em 0;text-align:center}
  figure img{max-width:100%;border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.5)}
  figcaption{color:#7c7f96;font-size:.78em;margin-top:.4em}
</style></head><body>
${body.join('\n')}
</body></html>`;
    }

    function escXml(s) {
        return String(s == null ? '' : s)
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function mimeOfExt(ext) {
        const e = String(ext || 'png').toLowerCase();
        if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
        if (e === 'webp') return 'image/webp';
        if (e === 'gif') return 'image/gif';
        if (e === 'avif') return 'image/avif';
        if (e === 'svg') return 'image/svg+xml';
        return 'image/png';
    }

    function renderChunkXhtmlBody(book, floorMap, idx, chunkImgs, imgPathPrefix) {
        const chunk = book.chunks[idx];
        if (!chunk) return '';
        const ctx = getSTContext();
        const info = floorMap ? floorMap[idx] : null;
        const msg = (info && ctx && Array.isArray(ctx.chat)) ? ctx.chat[info.mesId] : null;
        const rawMes = msg && typeof msg.mes === 'string' ? msg.mes : '';
        const imgs = Array.isArray(chunkImgs) ? chunkImgs.slice() : [];
        const usedImgIdx = new Set();

        const renderImgTag = (im, captionText) => {
            const alt = escXml(im.title || captionText || chunk.title || '插图');
            return `<div class="epub-illust"><img src="${escXml(imgPathPrefix + im.rel)}" alt="${alt}"/></div>`;
        };

        const out = [];
        if (rawMes && /<bbi_image>[\s\S]+?<\/bbi_image>/i.test(rawMes) && imgs.length > 0) {
            let bodyMes = rawMes.replace(/^\s*【第\d+节\s*·\s*[^】]*】\s*/, '');
            const tagRe = /<bbi_image>([\s\S]+?)<\/bbi_image>/gi;
            let lastPos = 0;
            let match;
            let seq = 0;
            while ((match = tagRe.exec(bodyMes)) !== null) {
                const seg = bodyMes.slice(lastPos, match.index);
                for (const line of seg.split('\n')) {
                    const t = line.trim();
                    if (t) out.push(`<p>${escXml(t)}</p>`);
                }
                const promptRaw = String(match[1] || '').trim();
                let picked = -1;
                if (promptRaw) {
                    picked = imgs.findIndex((im, k) => !usedImgIdx.has(k) && im.title && im.title.trim() === promptRaw);
                }
                if (picked < 0 && seq < imgs.length && !usedImgIdx.has(seq)) {
                    picked = seq;
                }
                if (picked < 0) {
                    picked = imgs.findIndex((_, k) => !usedImgIdx.has(k));
                }
                if (picked >= 0) {
                    usedImgIdx.add(picked);
                    out.push(renderImgTag(imgs[picked], chunk.title));
                }
                seq++;
                lastPos = tagRe.lastIndex;
            }
            const tailSeg = bodyMes.slice(lastPos);
            for (const line of tailSeg.split('\n')) {
                const t = line.trim();
                if (t) out.push(`<p>${escXml(t)}</p>`);
            }
        } else {
            for (const line of String(chunk.content || '').split('\n')) {
                const t = line.trim();
                if (t) out.push(`<p>${escXml(t)}</p>`);
            }
        }

        imgs.forEach((im, k) => {
            if (!usedImgIdx.has(k)) {
                out.push(renderImgTag(im, chunk.title));
            }
        });
        return out.join('\n');
    }

    async function buildEpubBlob(book, floorMap, indices, namedImgs, opts) {
        const entries = [];
        entries.push({ name: 'mimetype', data: 'application/epub+zip' });

        entries.push({
            name: 'META-INF/container.xml',
            data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
        });

        entries.push({
            name: 'OEBPS/style.css',
            data: `body {
  font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif;
  line-height: 1.85;
  margin: 0;
  padding: 0 3%;
  word-wrap: break-word;
}
h1, h2, h3 {
  line-height: 1.35;
  margin: 1.2em 0 0.8em;
  page-break-after: avoid;
}
h1 { font-size: 1.45em; text-align: center; }
h2 { font-size: 1.25em; border-left: 3px solid #6b8afd; padding-left: 0.5em; }
h3 { font-size: 1.08em; }
p {
  text-indent: 2em;
  margin: 0 0 0.75em;
  text-align: justify;
}
.epub-meta {
  text-indent: 0;
  text-align: center;
  color: #888;
  font-size: 0.85em;
  margin-bottom: 1.5em;
}
.epub-illust {
  margin: 1.2em auto;
  text-align: center;
  page-break-inside: avoid;
}
.epub-illust img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}`
        });

        const groups = [];
        const groupMap = new Map();
        for (const idx of indices) {
            const chunk = book.chunks[idx];
            if (!chunk) continue;
            const chapTitle = (opts.splitByChapter !== false)
                ? String(chunk.chapterTitle || chunk.title || `第${idx + 1}节`).trim()
                : `第${idx + 1}节 · ${chunk.title}`;
            if (!groupMap.has(chapTitle)) {
                const g = { title: chapTitle, list: [] };
                groupMap.set(chapTitle, g);
                groups.push(g);
            }
            groupMap.get(chapTitle).list.push(idx);
        }

        const imageManifestItems = [];
        let firstImageRel = '';
        let imgSeq = 0;
        for (const list of namedImgs.values()) {
            for (const im of list) {
                imgSeq++;
                const itemId = `img_${String(imgSeq).padStart(4, '0')}`;
                const mType = mimeOfExt(im.ext);
                const props = (imgSeq === 1) ? ' properties="cover-image"' : '';
                if (imgSeq === 1) firstImageRel = im.rel;
                imageManifestItems.push(`    <item id="${itemId}" href="${escXml(im.rel)}" media-type="${mType}"${props}/>`);
                entries.push({ name: `OEBPS/${im.rel}`, data: im.bytes });
            }
        }

        const chapterManifestItems = [];
        const spineItemRefs = [];
        const ncxNavPoints = [];
        const navLiItems = [];
        let playOrder = 1;

        const coverImgHtml = firstImageRel
            ? `<div class="epub-illust"><img src="../${escXml(firstImageRel)}" alt="${escXml(book.title)}"/></div>`
            : '';
        const titlePageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>${escXml(book.title)}</title>
  <link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body>
  <h1>${escXml(book.title)}</h1>
  <p class="epub-meta">导出自酒馆小说配图阅读器 v${VERSION} · 共 ${groups.length} 章 (${indices.length} 节) · 插图 ${imgSeq} 张</p>
  ${coverImgHtml}
</body>
</html>`;
        entries.push({ name: 'OEBPS/Text/titlepage.xhtml', data: titlePageXhtml });
        chapterManifestItems.push(`    <item id="titlepage" href="Text/titlepage.xhtml" media-type="application/xhtml+xml"/>`);
        spineItemRefs.push(`    <itemref idref="titlepage"/>`);
        ncxNavPoints.push(`    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
      <navLabel><text>扉页 · ${escXml(book.title)}</text></navLabel>
      <content src="Text/titlepage.xhtml"/>
    </navPoint>`);
        navLiItems.push(`        <li><a href="Text/titlepage.xhtml">扉页 · ${escXml(book.title)}</a></li>`);
        playOrder++;

        groups.forEach((g, gIdx) => {
            const chapNum = String(gIdx + 1).padStart(4, '0');
            const chapId = `chap_${chapNum}`;
            const href = `Text/chapter_${chapNum}.xhtml`;
            const sectionsHtml = [];
            sectionsHtml.push(`  <h2>${escXml(g.title)}</h2>`);

            for (const cIdx of g.list) {
                const c = book.chunks[cIdx];
                if (!c) continue;
                if (g.list.length > 1) {
                    sectionsHtml.push(`  <h3>第${cIdx + 1}节 · ${escXml(c.title)}</h3>`);
                }
                const cImgs = opts.includeImages ? (namedImgs.get(cIdx) || []) : [];
                sectionsHtml.push(renderChunkXhtmlBody(book, floorMap, cIdx, cImgs, '../'));
            }

            const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>${escXml(g.title)}</title>
  <link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body>
${sectionsHtml.join('\n')}
</body>
</html>`;
            entries.push({ name: `OEBPS/${href}`, data: xhtml });
            chapterManifestItems.push(`    <item id="${chapId}" href="${href}" media-type="application/xhtml+xml"/>`);
            spineItemRefs.push(`    <itemref idref="${chapId}"/>`);
            ncxNavPoints.push(`    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
      <navLabel><text>${escXml(g.title)}</text></navLabel>
      <content src="${href}"/>
    </navPoint>`);
            navLiItems.push(`        <li><a href="${href}">${escXml(g.title)}</a></li>`);
            playOrder++;
        });

        const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>${escXml(book.title)} 目录</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escXml(book.title)} 目录</h1>
    <ol>
${navLiItems.join('\n')}
    </ol>
  </nav>
</body>
</html>`;
        entries.push({ name: 'OEBPS/nav.xhtml', data: navXhtml });

        const bookUuid = `urn:uuid:th-novel-${hashText(book.id + '_' + book.title)}-v61`;
        const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escXml(bookUuid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escXml(book.title)}</text></docTitle>
  <navMap>
${ncxNavPoints.join('\n')}
  </navMap>
</ncx>`;
        entries.push({ name: 'OEBPS/toc.ncx', data: tocNcx });

        const isoNow = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        const coverMeta = imgSeq > 0 ? `\n    <meta name="cover" content="img_0001"/>` : '';
        const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escXml(bookUuid)}</dc:identifier>
    <dc:title>${escXml(book.title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>酒馆小说配图阅读器 v${VERSION}</dc:creator>
    <meta property="dcterms:modified">${isoNow}</meta>${coverMeta}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${chapterManifestItems.join('\n')}
${imageManifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItemRefs.join('\n')}
  </spine>
</package>`;
        entries.push({ name: 'OEBPS/content.opf', data: contentOpf });

        const zipBlob = await buildZip(entries);
        return {
            blob: new Blob([await zipBlob.arrayBuffer()], { type: 'application/epub+zip' }),
            chapterCount: groups.length,
            imageCount: imgSeq
        };
    }

    async function exportBook(opts) {
        if (!currentBook) { notify('warning', '请先导入一本小说'); return; }
        const book = currentBook;
        const map = scanFloorMap(book);

        let indices = book.chunks.map((_, i) => i);
        if (!opts.includeUnillustrated) indices = indices.filter(i => map[i] && map[i].hasImage);
        if (!indices.length) { notify('warning', '没有可导出的内容'); return; }

        notify('info', `正在整理《${book.title}》${indices.length} 节…`);
        let imgIndex = { byChunk: new Map(), total: 0, failed: 0 };
        if (opts.includeImages) {
            imgIndex = await collectImages(book, indices);
            if (imgIndex.failed) notify('warning', `${imgIndex.failed} 张图读取失败已跳过`);
        }

        const base = safeName(book.title);

        if (opts.format === 'epub') {
            const named = new Map();
            let seq = 0;
            for (const idx of indices) {
                const imgs = imgIndex.byChunk.get(idx) || [];
                if (!imgs.length) continue;
                named.set(idx, imgs.map(im => {
                    seq++;
                    return { ...im, rel: `images/illust_${String(seq).padStart(4, '0')}.${im.ext}` };
                }));
            }
            const epubRes = await buildEpubBlob(book, map, indices, named, opts);
            const filename = `${base}_${epubRes.imageCount > 0 ? '插图版_' : ''}${new Date().toISOString().slice(0, 10)}.epub`;
            saveBlob(epubRes.blob, filename);
            notify('success', `📕 已导出 EPUB 电子书：共 ${epubRes.chapterCount} 章（${indices.length} 节），内嵌配图 ${epubRes.imageCount} 张`);
            return;
        }

        if (opts.format === 'txt') {
            const lines = [`《${book.title}》`, ''];
            const withImg = opts.includeImages && imgIndex.total > 0;
            if (withImg) lines.push(`（本书已配图 ${imgIndex.total} 张，图片在 images/ 下；下方 [插图] 行是它的相对路径）`, '');

            let seq = 0;
            const named = new Map();
            for (const idx of indices) {
                const imgs = imgIndex.byChunk.get(idx) || [];
                if (!imgs.length) continue;
                named.set(idx, imgs.map(im => {
                    seq++;
                    return { ...im, rel: `${String(seq).padStart(4, '0')}_${safeName(chunkTitleOf(book, idx))}.${im.ext}` };
                }));
            }

            for (const idx of indices) {
                const chunk = book.chunks[idx];
                if (!chunk) continue;
                lines.push(chunk.title, '', chunk.content, '');
                for (const im of (named.get(idx) || [])) lines.push(`[插图] images/${im.rel}`, '');
            }
            const txtBody = '\uFEFF' + lines.join('\n');

            if (withImg) {
                const entries = [{ name: `${base}.txt`, data: txtBody }];
                for (const list of named.values()) for (const im of list) entries.push({ name: `images/${im.rel}`, data: im.bytes });
                saveBlob(await buildZip(entries), `${base}_加图_${new Date().toISOString().slice(0, 10)}.zip`);
                notify('success', `已导出 TXT + ${imgIndex.total} 张图（ZIP）`);
            } else {
                saveBlob(new Blob([txtBody], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
                notify('success', `已导出 TXT（${indices.length} 节）`);
            }
            return;
        }

        // 统一给图片分配稳定文件名（节序号 + 章节名），正文与文件实体共用同一份映射
        const named = new Map();
        let seq = 0;
        for (const idx of indices) {
            const imgs = imgIndex.byChunk.get(idx) || [];
            if (!imgs.length) continue;
            named.set(idx, imgs.map(im => {
                seq++;
                return { ...im, rel: `images/${String(seq).padStart(4, '0')}_${safeName(chunkTitleOf(book, idx))}.${im.ext}` };
            }));
        }
        const bucket = { byChunk: named, total: seq };

        const isHtml = opts.format === 'zip-html';
        const entries = [];

        const groups = new Map();
        for (const idx of indices) {
            const chunk = book.chunks[idx];
            if (!chunk) continue;
            const key = isHtml ? safeName(chunk.chapterTitle || '正文') : (opts.splitByChapter ? safeName(chunk.chapterTitle || '正文') : '');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(idx);
        }

        if (isHtml) {
            let n = 1;
            const pageNames = [];
            for (const [key, list] of groups) {
                const name = `chapter_${String(n).padStart(3, '0')}_${key || '正文'}.html`;
                pageNames.push(name);
                entries.push({ name, data: composeHtml(book, list, bucket, { splitByChapter: false }) });
                n++;
            }
            entries.push({ name: 'index.html', data: buildIndex(book, pageNames) });
        } else {
            entries.push({ name: `${base}.md`, data: composeMarkdown(book, indices, bucket, opts) });
            if (opts.splitByChapter) {
                let n = 1;
                for (const [key, list] of groups) {
                    entries.push({
                        name: `chapters/${String(n).padStart(3, '0')}_${key || '正文'}.md`,
                        data: composeMarkdown(book, list, bucket, { splitByChapter: false, imgPrefix: '../' })
                    });
                    n++;
                }
            }
        }

        if (opts.includeImages) {
            for (const list of named.values()) {
                for (const im of list) entries.push({ name: im.rel, data: im.bytes });
            }
        }

        const blob = await buildZip(entries);
        saveBlob(blob, `${base}_含配图_${new Date().toISOString().slice(0, 10)}.zip`);
        notify('success', `已导出 ZIP：${entries.length} 个文件，其中配图 ${bucket.total} 张`);
    }

    function chunkTitleOf(book, idx) {
        const c = book && book.chunks ? book.chunks[idx] : null;
        return c ? (c.chapterTitle || c.title) : 'sec';
    }

    function buildIndex(book, names) {
        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(book.title)} 目录</title>
<style>body{background:#16161e;color:#d7d8e5;font-family:system-ui,sans-serif;padding:2em;line-height:2}
a{color:#a9c1ff;text-decoration:none}a:hover{text-decoration:underline}</style></head>
<body><h1>${esc(book.title)}</h1><p>共 ${names.length} 章</p><ol>
${names.map(n => `<li><a href="${esc(n)}">${esc(n.replace(/^chapter_\d+_/, '').replace(/\.html$/, ''))}</a></li>`).join('\n')}
</ol></body></html>`;
    }
    // ============ 面板（目录 / 书架 / 导出 / 设置） ============
    let panelEl = null;
    let panelTab = 'toc';
    let tocQuery = '';
    const foldedChapters = new Set();

    function closePanel() {
        if (panelEl) { panelEl.remove(); panelEl = null; }
    }

    async function openPanel(tab) {
        window.__op = window.__op || [];
        if (dbgOn() && window.__op) window.__op.push('enter tab=' + tab + ' panel=' + Boolean(panelEl) + ' cur=' + (currentBook && currentBook.id) + ' inst=' + INST);
        // 打开面板前先确保有书；但保证"用哪本"和外面一致
        const before = currentBook && currentBook.id;
        panelTab = tab || 'toc';
        if (!currentBook) { await loadBook(); }
        else if (panelTab === 'toc' && !(currentBook.chunks && currentBook.chunks.length)) { await loadBook(); }
        // 面板不会换书；万一有别的东西换了，回滚到用户手上那本。
        // loadBook 失败时 currentBook 可能是 null，这里不能直接解引用。
        if (before && pinnedBookId && (!currentBook || currentBook.id !== before)) {
            const back = await getBook(before);
            if (back) { currentBook = back; __cbSet?.(currentBook, 'p7'); }
        }
        if (dbgOn() && window.__op) window.__op.push('afterLoad cur=' + (currentBook && currentBook.id) + ' panel=' + Boolean(panelEl));
        tocNeedsFocusCurrent = (panelTab === 'toc');
        if (panelEl) { renderPanel(); return; }
        const doc = getHostDocument();
        panelEl = doc.createElement('div');
        panelEl.id = 'th-novel-panel';
        panelEl.style.cssText = 'position:fixed;inset:0;z-index:1000002;background:rgba(0,0,0,.78);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:8px;font-family:system-ui,sans-serif;';
        panelEl.addEventListener('keydown', e=>{ if(e.key==='Escape') closePanel(); });
        panelEl.addEventListener('mousedown', e => { if (e.target === panelEl) closePanel(); });
        (doc.body || doc.documentElement).appendChild(panelEl);
        if (dbgOn() && window.__op) window.__op.push('created');
        renderPanel();
        if (dbgOn() && window.__op) window.__op.push('rendered rows=' + (panelEl ? panelEl.querySelectorAll('[data-gen]').length : -1) + ' inDoc=' + Boolean(panelEl && panelEl.isConnected));
    }

    function renderPanel() {
        if (!panelEl) return;
        const prevListEl = panelEl.querySelector('#th-novel-toc-list');
        const savedTocScroll = prevListEl ? prevListEl.scrollTop : null;
        const tools=panelEl.querySelector('.th-nv-tools');
        if(tools) panelEl.dataset.toolsOpen=String(tools.open);
        panelEl.innerHTML = '';
        if (savedTocScroll !== null) panelEl.dataset.savedTocScroll = String(savedTocScroll);
        else delete panelEl.dataset.savedTocScroll;
        const doc = getHostDocument();
        const card = doc.createElement('div');
        card.className='th-nv-card';
        card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true'); card.setAttribute('aria-label','小说阅读与配图');
        card.style.cssText = 'width:100%;max-width:580px;height:90vh;background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 14px 36px rgba(0,0,0,.65);';

        const tabs = [
            ['toc', '目录配图'],
            ['shelf', '书架'],
            ['export', '导出'],
            ['settings', '设置']
        ];
        const head = doc.createElement('div');
        head.className='th-nv-head';
        head.style.cssText = 'padding:10px 12px;background:#181825;border-bottom:1px solid #313244;display:flex;justify-content:space-between;align-items:center;gap:8px;';
        head.innerHTML = `<div class="th-nv-row">${tabs.map(([k, t]) =>
            `<button class="th-nv-btn" data-tab="${k}" aria-selected="${panelTab === k}" style="${panelTab === k ? 'background:#89b4fa;color:#11111b;font-weight:700;border:none;' : ''}">${t}</button>`
        ).join('')}</div><button class="th-nv-btn" id="panel-close">关闭</button>`;
        head.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
            panelTab = b.dataset.tab;
            if (panelTab === 'toc') tocNeedsFocusCurrent = true;
            renderPanel();
        }));
        head.querySelector('#panel-close').addEventListener('click', closePanel);
        head.querySelector('#panel-close').setAttribute('aria-label','关闭小说面板');

        const body = doc.createElement('div');
        body.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';

        card.appendChild(head);
        card.appendChild(body);
        panelEl.appendChild(card);

        if (panelTab === 'toc') renderToc(body);
        else if (panelTab === 'shelf') renderShelf(body);
        else if (panelTab === 'export') renderExport(body);
        else renderSettings(body);
    }

    // ---------- 目录 ----------
    function renderToc(body) {
        const doc = getHostDocument();
        if (!currentBook || !currentBook.chunks) {
            body.innerHTML = `<div style="padding:40px;text-align:center;color:#6c7086;">还没有导入小说。到「📚 书架」里导入一本 TXT。</div>`;
            return;
        }
        const map = scanFloorMap();
        const illustrated = Object.values(map).filter(v => v.hasImage).length;
        const deployed = Object.keys(map).length;
        const cov = typeof currentBook.coverage === 'number' ? (currentBook.coverage * 100).toFixed(1) : '—';

        const bar = doc.createElement('div');
        bar.className='th-nv-toolbar';
        bar.innerHTML = `
            <div><h2 class="th-nv-booktitle">${esc(currentBook.title)}</h2>
            <div class="th-nv-summary">${currentBook.rawChapters?.length || 0} 章 / ${currentBook.chunks.length} 节　已入楼 ${deployed}　已配图 ${illustrated}　正文保留 ${cov}%</div></div>
            <div class="th-nv-row"><input class="th-nv-input" id="toc-search" aria-label="搜索章节或节号" placeholder="搜索章节名称或节号" value="${esc(tocQuery)}" style="flex:1">
                <button class="th-nv-btn" id="toc-mode">${selectionMode ? '完成多选':'多选模式'}</button></div>
            <details class="th-nv-tools" ${panelEl?.dataset.toolsOpen==='true' ? 'open':''}>
              <summary>批量选择与分节设置</summary>
              <div class="th-nv-toolbody">
                <div class="th-nv-row"><input class="th-nv-input" id="toc-range" aria-label="批选节号范围" placeholder="节号：1-10,15,20-25" value="${esc(batchRange)}" style="flex:1"><button class="th-nv-btn" id="toc-select-range">选中范围</button></div>
                <div class="th-nv-row"><span class="th-nv-label">从当前节起</span><input class="th-nv-input" id="toc-batch-count" type="number" min="1" max="${currentBook.chunks.length}" value="${batchCount}" style="width:80px" aria-label="连续选择节数"><button class="th-nv-btn" id="toc-sel3">连续选择</button><button class="th-nv-btn" id="toc-sel-unimg">已入楼缺图</button></div>
                <div class="th-nv-row"><button class="th-nv-btn" id="toc-visible">全选筛选结果</button><button class="th-nv-btn" id="toc-invert">反选筛选结果</button><button class="th-nv-btn" id="toc-clear">清空勾选</button><button class="th-nv-btn" id="toc-failed">上轮失败</button><button class="th-nv-btn" id="toc-resume">恢复待处理</button><button class="th-nv-btn" id="toc-diagnostics">导出队列诊断</button></div>
                <div class="th-nv-row"><label class="th-nv-label" for="toc-filter">筛选</label><select class="th-nv-input" id="toc-filter"><option value="all">全部节</option><option value="missing">全部缺图</option><option value="undeployed">未入楼</option><option value="deployed">已入楼</option><option value="illustrated">已配图</option></select><button class="th-nv-btn" id="toc-fold">${foldedChapters.size ? '全部展开':'全部折叠'}</button></div>
                <div class="th-nv-row"><label class="th-nv-label" for="toc-size">每节约</label><input class="th-nv-input" id="toc-size" type="number" inputmode="numeric" min="0" max="50000" step="1" value="${currentBook.appliedChunkSize ?? settings.chunkSize}" style="width:108px" list="toc-size-presets"><datalist id="toc-size-presets"><option value="600"><option value="1200"><option value="2000"><option value="3000"><option value="0"></datalist><span class="th-nv-label">字（0 为整章）</span><button class="th-nv-btn" id="toc-resplit">应用分节</button></div>
                <span class="th-nv-label">50～50000 字，优先按段落或句末分节，短尾段合并；不是精确字数。</span>
                <button class="th-nv-btn" id="toc-bind">绑定生图按钮 · ${esc(settings.boundBtnSelector)}</button>
              </div>
            </details>`;
        body.appendChild(bar);
        bar.querySelector('#toc-filter').value=tocFilter;
        const dock=doc.createElement('div');
        dock.className='th-nv-dock';
        dock.innerHTML=`<div id="toc-queue-status" role="status" aria-live="polite">${esc(queueStatus)}</div><div class="th-nv-actions"><button class="th-nv-btn blue" id="toc-deploy10">${selectedChunkSet.size ? '入楼勾选 '+selectedChunkSet.size+' 节':'往后入楼 10 节'}</button><button class="th-nv-btn primary" id="toc-run">生成勾选 (<span id="toc-count">${selectedChunkSet.size}</span>)</button><button class="th-nv-btn danger" id="toc-stop" ${queueRunning ? '':'style="display:none"'}>停止队列</button></div><span class="th-nv-label">tag 保存后处理下一楼 · NovelAI 沿用插件并发限制</span>`;
        const controls={querySelector:sel=>bar.querySelector(sel)||dock.querySelector(sel)};

        const list = doc.createElement('div');
        list.id = 'th-novel-toc-list';
        list.dataset.all = String(currentBook.chunks.length);
        list.style.cssText = 'flex:1;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:5px;position:relative;';
        body.appendChild(list);
        body.appendChild(dock);

        const frag = doc.createDocumentFragment();
        const prevSavedScroll = (panelEl && panelEl.dataset.savedTocScroll !== undefined) ? Number(panelEl.dataset.savedTocScroll) : null;

        const q = tocQuery.trim().toLowerCase();
        let lastChapter = null;
        const chapterMap = new Map();
        currentBook.chunks.forEach((chunk, idx) => {
            const key = chunk.chapterTitle || chunk.title;
            if (!chapterMap.has(key)) chapterMap.set(key, []);
            chapterMap.get(key).push(idx);
        });

        const matchIdx = (idx) => {
            const floor=map[idx];
            if (tocFilter==='missing' && floor?.hasImage) return false;
            if (tocFilter==='undeployed' && floor) return false;
            if (tocFilter==='deployed' && !floor) return false;
            if (tocFilter==='illustrated' && !floor?.hasImage) return false;
            if (!q) return true;
            const chunk = currentBook.chunks[idx];
            const chapterKey = chunk.chapterTitle || chunk.title;
            return chunk.title.toLowerCase().includes(q)
                || chapterKey.toLowerCase().includes(q)
                || String(idx + 1) === q;
        };

        const curIdx = currentChunkIndex();
        // 每次刚打开目录时，确保当前正在读的这一章处于展开状态，避免当前节被折叠看不见
        if (tocNeedsFocusCurrent && currentBook.chunks[curIdx]) {
            const curChapKey = currentBook.chunks[curIdx].chapterTitle || currentBook.chunks[curIdx].title;
            foldedChapters.delete(curChapKey);
        }

        currentBook.chunks.forEach((chunk, idx) => {
            if (!matchIdx(idx)) return;
            const chapterKey = chunk.chapterTitle || chunk.title;
            const siblings = chapterMap.get(chapterKey) || [idx];
            const firstIdx = siblings[0];

            if (settings.tocGroupByChapter) {
                if (lastChapter !== chapterKey) {
                    lastChapter = chapterKey;
                    const fold = foldedChapters.has(chapterKey);
                    const head = doc.createElement('div');
                    head.className='th-nv-chapter';
                    head.style.cssText = 'padding:5px 8px;margin-top:6px;border-radius:6px;background:#181825;border-left:3px solid #45475a;display:flex;align-items:center;gap:7px;font-size:12px;color:#f9e2af;font-weight:700;';
                    head.innerHTML = `
                        <span class="th-nv-fold" style="cursor:pointer;width:14px;text-align:center;color:#6c7086;">${fold ? '▸' : '▾'}</span>
                        <span class="th-nv-gochap" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;">📕 ${esc(chapterKey)}</span>
                        <span style="color:#6c7086;font-weight:400;flex-shrink:0;">${siblings.length} 节</span>
                        <input type="checkbox" class="th-nv-chk" data-chapter="1" ${siblings.every(x => selectedChunkSet.has(x)) ? 'checked' : ''} title="整章勾选" style="width:14px;height:14px;cursor:pointer;flex-shrink:0;">
                        <button class="th-nv-btn" data-chaptergen="1" style="background:#f9e2af;color:#11111b;border:none;font-weight:700;flex-shrink:0;padding:2px 6px;" title="整章排队生图">🎨</button>
                    `;
                    head.querySelector('.th-nv-fold').addEventListener('click', e => {
                        e.stopPropagation();
                        if (foldedChapters.has(chapterKey)) foldedChapters.delete(chapterKey);
                        else foldedChapters.add(chapterKey);
                        renderPanel();
                    });
                    head.querySelector('.th-nv-gochap').addEventListener('click', async () => {
                        closePanel();
                        await goToChunk(firstIdx);
                    });
                    head.querySelector('[data-chapter]').addEventListener('click', e => {
                        e.stopPropagation();
                        const on = e.target.checked;
                        siblings.forEach(x => { if (on) selectedChunkSet.add(x); else selectedChunkSet.delete(x); });
                        const c = controls.querySelector('#toc-count');
                        if (c) c.textContent = String(selectedChunkSet.size);
                        const dBtn = controls.querySelector('#toc-deploy10');
                        if (dBtn) dBtn.textContent = selectedChunkSet.size ? `📥 批量铺入勾选的 (${selectedChunkSet.size}节)` : '📥 往后批量铺入 10 节';
                        renderPanel();
                    });
                    head.querySelector('[data-chaptergen]').addEventListener('click', async e => {
                        e.stopPropagation();
                        closePanel();
                        await runQueue(siblings.slice(), '整章');
                    });
                    frag.appendChild(head);
                }
                if (foldedChapters.has(chapterKey) && !q) return;
            }

            const info = map[idx];
            const isCur = idx === curIdx;
            const checked = selectedChunkSet.has(idx);

            const row = doc.createElement('div');
            // 带上节号：测试与外部脚本要能按节找到这一行，不用解析文字
            row.dataset.idx = String(idx);
            row.dataset.selected=String(selectedChunkSet.has(idx));
            row.setAttribute('aria-current',String(idx===curIdx));
            row.className = 'th-nv-row';
            row.style.cssText = `padding:7px 9px;border-radius:7px;display:flex;align-items:center;gap:8px;font-size:12px;
                background:${checked ? '#2a2b3d' : (isCur ? '#313244' : '#181825')};
                border:1px solid ${checked ? '#a6e3a1' : (isCur ? '#89b4fa' : '#313244')};
                color:${isCur ? '#89b4fa' : '#cdd6f4'};cursor:pointer;`;
            if (settings.tocGroupByChapter) row.style.marginLeft = '12px';

            let badge = '⏳ 未入楼';
            let badgeColor = '#a2b6c9';
            if (info) {
                if (info.hasImage) { badge = `🖼️ #${info.mesId}`; badgeColor = '#a6e3a1'; }
                else { badge = `✅ #${info.mesId}`; badgeColor = '#89b4fa'; }
            }

            row.innerHTML = `
                <input type="checkbox" class="th-nv-chk" ${checked ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer;flex-shrink:0;">
                <span class="th-nv-chunktitle" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:${isCur ? 700 : 400};">${idx + 1}. ${esc(chunk.title)}</span>
                <span class="th-nv-length" style="color:#a2b6c9;flex-shrink:0;">${chunk.content.length}字</span>
                <span style="color:${badgeColor};flex-shrink:0;">${badge}</span>
                <button class="th-nv-btn" data-gen="1" style="background:#f9e2af;color:#11111b;border:none;font-weight:700;flex-shrink:0;">🎨</button>
            `;

            row.addEventListener('click', async () => { if(selectionMode) { chk.click(); return; } closePanel(); await goToChunk(idx); });
            const chk = row.querySelector('.th-nv-chk');
            chk.addEventListener('click', e => {
                e.stopPropagation();
                row.dataset.selected=String(chk.checked);
                if (chk.checked) selectedChunkSet.add(idx); else selectedChunkSet.delete(idx);
                row.style.background = chk.checked ? '#2a2b3d' : (isCur ? '#313244' : '#181825');
                row.style.borderColor = chk.checked ? '#a6e3a1' : (isCur ? '#89b4fa' : '#313244');
                const c = controls.querySelector('#toc-count');
                if (c) c.textContent = String(selectedChunkSet.size);
                const dBtn = controls.querySelector('#toc-deploy10');
                if (dBtn) dBtn.textContent = selectedChunkSet.size ? `📥 批量铺入勾选的 (${selectedChunkSet.size}节)` : '📥 往后批量铺入 10 节';
            });
            row.querySelector('[data-gen]').addEventListener('click', async e => {
                e.stopPropagation();
                closePanel();
                await runQueue([idx], '单节');
            });

            frag.appendChild(row);
        });

        if (!frag.childNodes.length) {
            list.innerHTML = `<div style="padding:30px;text-align:center;color:#6c7086;">没有匹配的章节</div>`;
        } else {
            list.appendChild(frag);
        }

        // 事件
        controls.querySelector('#toc-sel3').addEventListener('click', () => {
            const base = currentChunkIndex();
            for (let i = base; i < Math.min(currentBook.chunks.length,base+batchCount); i++) selectedChunkSet.add(i);
            renderPanel();
        });
        controls.querySelector('#toc-sel-unimg').addEventListener('click', () => {
            Object.keys(map).forEach(k => { if (!map[k].hasImage) selectedChunkSet.add(Number(k)); });
            renderPanel();
        });
        controls.querySelector('#toc-clear').addEventListener('click', () => { selectedChunkSet.clear(); renderPanel(); });
        controls.querySelector('#toc-run').addEventListener('click', async () => {
            if (!selectedChunkSet.size) { notify('warning', '先勾选要生图的节'); return; }
            const list = Array.from(selectedChunkSet);
            closePanel();
            await runQueue(list, '勾选');
        });
        controls.querySelector('#toc-stop').addEventListener('click', () => stopQueue());
        controls.querySelector('#toc-deploy10').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (queueRunning || queueStarting || appendInFlight) { notify('info','请先等待当前任务结束'); return; }
            if (!currentBook || !Array.isArray(currentBook.chunks) || !currentBook.chunks.length) {
                notify('warning', '请先导入一本小说');
                return;
            }
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                await adoptLegacyFloors(currentBook);
                const latestMap = scanFloorMap(currentBook);
                let toDeploy = [];

                if (selectedChunkSet.size > 0) {
                    toDeploy = Array.from(selectedChunkSet)
                        .map(Number)
                        .filter(i => i >= 0 && i < currentBook.chunks.length && !latestMap[i])
                        .sort((a, b) => a - b);
                    if (!toDeploy.length) {
                        notify('info', `勾选的 ${selectedChunkSet.size} 节全部已在楼层中，无需重复铺入`);
                        return;
                    }
                } else {
                    const base = currentChunkIndex();
                    for (let i = base; i < currentBook.chunks.length && toDeploy.length < 10; i++) {
                        if (!latestMap[i]) toDeploy.push(i);
                    }
                    if (!toDeploy.length) {
                        for (let i = 0; i < base && toDeploy.length < 10; i++) {
                            if (!latestMap[i]) toDeploy.push(i);
                        }
                    }
                    if (!toDeploy.length) {
                        notify('info', '全书所有章节均已铺入楼层！');
                        return;
                    }
                }

                const prevLock = appendInFlight;
                appendInFlight = true;
                let deployedCount = 0;
                try {
                    for (let k = 0; k < toDeploy.length; k++) {
                        const idx = toDeploy[k];
                        btn.textContent = `⏳ 正在铺楼 (${k + 1}/${toDeploy.length})…`;
                        const mId = await deployFloor(idx, {
                            book: currentBook,
                            hold: false,
                            skipSave: true,
                            skipReorder: true,
                            batchMode: true
                        });
                        if (mId >= 0) deployedCount++;
                    }
                    if (reorderTimer) { clearTimeout(reorderTimer); reorderTimer = null; }
                    reorderNow(currentBook.id);
                    dedupeChatByChunk(currentBook);
                    refreshSentinel();
                    ensureTail();
                    const ctx = getSTContext();
                    if (ctx && typeof ctx.saveChat === 'function') {
                        try { await ctx.saveChat(); } catch (err) { }
                    }
                } finally {
                    appendInFlight = prevLock;
                }

                const firstSec = toDeploy[0] + 1;
                const lastSec = toDeploy[toDeploy.length - 1] + 1;
                notify('success', `📥 已成功批量铺入 ${deployedCount} 节（第 ${firstSec} ~ ${lastSec} 节）`);
                updateHud();
                renderPanel();
            } catch (err) {
                notify('error', '批量铺楼出错：' + (err && err.message ? err.message : err));
            } finally {
                btn.disabled = false;
            }
        });
        controls.querySelector('#toc-bind').addEventListener('click', () => { closePanel(); startBind(); });
        controls.querySelector('#toc-fold').addEventListener('click', () => {
            if (foldedChapters.size) foldedChapters.clear();
            else Array.from(new Set(currentBook.chunks.map(c => c.chapterTitle || c.title))).forEach(k => foldedChapters.add(k));
            renderPanel();
        });
        controls.querySelector('#toc-search').addEventListener('input', e => {
            tocQuery = e.target.value;
            const pos = e.target.selectionStart;
            renderPanel();
            const again = panelEl.querySelector('#toc-search');
            if (again) { again.focus(); again.setSelectionRange(pos, pos); }
        });
        controls.querySelector('#toc-resplit').addEventListener('click', async () => {
            const size = Number(controls.querySelector('#toc-size').value);
            await resplit(size);
            renderPanel();
        });
        controls.querySelector('#toc-mode').addEventListener('click',()=>{ selectionMode=!selectionMode; renderPanel(); });
        controls.querySelector('#toc-range').addEventListener('input',e=>batchRange=e.target.value);
        controls.querySelector('#toc-batch-count').addEventListener('change',e=>{
            batchCount=Math.max(1,Math.min(currentBook.chunks.length,Math.floor(Number(e.target.value)||10)));
            e.target.value=batchCount;
        });
        controls.querySelector('#toc-select-range').addEventListener('click',()=>{
            try { parseSectionRange(batchRange,currentBook.chunks.length).forEach(i=>selectedChunkSet.add(i)); renderPanel(); }
            catch(e) { notify('warning',e.message); }
        });
        controls.querySelector('#toc-filter').addEventListener('change',e=>{ tocFilter=e.target.value; renderPanel(); });
        controls.querySelector('#toc-visible').addEventListener('click',()=>{ currentBook.chunks.forEach((_,i)=>{if(matchIdx(i)) selectedChunkSet.add(i);}); renderPanel(); });
        controls.querySelector('#toc-invert').addEventListener('click',()=>{ currentBook.chunks.forEach((_,i)=>{if(matchIdx(i)) {if(selectedChunkSet.has(i))selectedChunkSet.delete(i);else selectedChunkSet.add(i);}}); renderPanel(); });
        controls.querySelector('#toc-failed').addEventListener('click',()=>{lastQueueFailed.forEach(i=>selectedChunkSet.add(i));renderPanel();});
        controls.querySelector('#toc-resume').addEventListener('click',restoreQueueSelection);
        controls.querySelector('#toc-diagnostics').addEventListener('click',exportPipelineDiagnostics);
        if(queueRunning || queueStarting) {
            ['#toc-run','#toc-deploy10','#toc-resplit','#toc-bind'].forEach(id=>controls.querySelector(id).disabled=true);
        }

        const shouldFocusCur = tocNeedsFocusCurrent && !q;
        tocNeedsFocusCurrent = false;
        const applyTocScroll = (focusCurrent) => {
            if (!list.isConnected) return;
            if (focusCurrent) {
                const curRow = list.querySelector(`[data-idx="${curIdx}"]`);
                if (curRow) {
                    const listRect = list.getBoundingClientRect ? list.getBoundingClientRect() : null;
                    const rowRect = curRow.getBoundingClientRect ? curRow.getBoundingClientRect() : null;
                    let targetTop = 0;
                    if (listRect && rowRect && listRect.height > 0 && (rowRect.top !== listRect.top || curRow.offsetTop === undefined)) {
                        targetTop = list.scrollTop + (rowRect.top - listRect.top);
                    } else if (typeof curRow.offsetTop === 'number' && curRow.offsetTop > 0) {
                        targetTop = curRow.offsetTop - (list.offsetTop || 0);
                    } else {
                        const allRows = [...list.children];
                        const rowPos = allRows.indexOf(curRow);
                        if (rowPos > 0) targetTop = rowPos * 36;
                    }
                    const viewH = list.clientHeight || (listRect && listRect.height) || 420;
                    list.scrollTop = Math.max(0, Math.round(targetTop - viewH * 0.25));
                    return;
                }
            }
            if (prevSavedScroll !== null && Number.isFinite(prevSavedScroll)) {
                list.scrollTop = prevSavedScroll;
            }
        };
        applyTocScroll(shouldFocusCur);
        requestAnimationFrame(() => applyTocScroll(shouldFocusCur));
    }

    async function resplit(size) {
        if (!currentBook) return;
        if (queueRunning || queueStarting || appendInFlight) { notify('warning','请先等待当前任务结束'); return; }
        if (!Number.isInteger(size) || size<0 || size>50000 || (size>0 && size<50)) {
            notify('warning','请输入 50～50000 的整数；0 表示整章不切'); return;
        }
        const book=currentBook;
        if (book.appliedChunkSize===size) { notify('info','分节字数没有变化'); return; }
        const ctx=getSTContext();
        const floors=(ctx?.chat || []).filter(m=>getMark(m)?.bookId===book.id);
        if (floors.length && !ask('重新分节会把现有 '+floors.length+' 个楼层保留为旧版（正文和配图均保留），并在书架保存旧版。新分节需重新入楼、配图。继续？')) return;
        if (floors.length) {
            const archive=JSON.parse(JSON.stringify(book));
            archive.id=book.id+'_edition_'+Date.now();
            archive.title=book.title+'（重切前 '+(book.appliedChunkSize || '整章')+'字版）';
            archive.createdAt=Date.now();
            if (!(await saveBook(archive))) { notify('error','旧版保存失败，已取消重切'); return; }
            floors.forEach(m=>{ m.extra[MARK_KEY]={...getMark(m), bookId:archive.id}; });
            await ctx.saveChat?.();
        }
        const anchor=book.chunks[book.currentIndex || 0];
        settings.chunkSize=size;
        const result=buildChunks(book);
        if (anchor) {
            const found=book.chunks.findIndex(c=>c.chapterIndex===anchor.chapterIndex && c.start<=anchor.start && c.end>anchor.start);
            book.currentIndex=Math.max(0,found);
        }
        await saveSettings();
        await saveBook(book);
        // A new edition needs one own floor so future chat reloads retain its identity.
        if (floors.length) await deployFloor(book.currentIndex || 0, {book, hold:false});
        selectedChunkSet.clear();
        foldedChapters.clear();
        tocNeedsFocusCurrent=true;
        updateHud(); refreshHudMap(); refreshSentinel();
        notify('success','已重切为 '+book.chunks.length+' 节，正文保留 '+(result.coverage*100).toFixed(1)+'%。旧楼层和配图保留在旧版。');
    }

    // ---------- 书架 ----------
    async function renderShelf(body) {
        const doc = getHostDocument();
        const books = await listBooks();
        const total = books.reduce((a, b) => a + (b.sizeBytes || 0), 0);

        const bar = doc.createElement('div');
        bar.style.cssText = 'padding:10px 12px;background:#11111b;border-bottom:1px solid #313244;display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:12px;flex-wrap:wrap;';
        bar.innerHTML = `<span style="color:#a6adc8;">📚 ${books.length} 本 · ${formatBytes(total)}</span>
            <span class="th-nv-row">
                <button class="th-nv-btn primary" id="shelf-import">+ 导入 TXT</button>
                <button class="th-nv-btn danger" id="shelf-clear">清空全部</button>
            </span>`;
        body.appendChild(bar);

        const list = doc.createElement('div');
        list.style.cssText = 'flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;';
        body.appendChild(list);

        if (!books.length) {
            list.innerHTML = `<div style="padding:40px;text-align:center;color:#6c7086;">书架是空的</div>`;
        }

        books.forEach(b => {
            const isCur = currentBook && currentBook.id === b.id;
            const card = doc.createElement('div');
            card.style.cssText = `padding:10px 12px;border-radius:9px;background:${isCur ? '#313244' : '#181825'};border:1px solid ${isCur ? '#89b4fa' : '#313244'};display:flex;flex-direction:column;gap:6px;font-size:12px;`;
            const chunks = (b.chunks || []).length;
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
                    <div>
                        <div style="font-weight:700;color:${isCur ? '#89b4fa' : '#cdd6f4'};">《${esc(b.title)}》${isCur ? '（当前）' : ''}</div>
                        <div style="color:#a6adc8;margin-top:3px;">${(b.rawChapters || []).length} 章 → ${chunks} 节 · ${formatBytes(b.sizeBytes)} · 读到 ${(b.currentIndex || 0) + 1}/${chunks}</div>
                    </div>
                    <span class="th-nv-row">
                        <button class="th-nv-btn primary" data-read="1">📖 续读</button>
                        <button class="th-nv-btn danger" data-del="1">🗑️</button>
                    </span>
                </div>`;
            card.querySelector('[data-read]').addEventListener('click', async () => {
                if (queueRunning || queueStarting || appendInFlight) { notify('info','请先等待当前任务结束'); return; }
                currentBook = b; __cbSet?.(currentBook, 'p7');
                pinnedBookId = b.id;
                settings.activeBookId = b.id;
                await saveSettings();
                closePanel();
                if (settings.autoCreateCard && b.cardName) await ensureCard(b.cardName, b.title);
                await goToChunk(b.currentIndex || 0);
            });
            card.querySelector('[data-del]').addEventListener('click', async () => {
                if (queueRunning || queueStarting || appendInFlight) { notify('info','请先等待当前任务结束'); return; }
                if (!ask(`删除《${b.title}》？`)) return;
                await deleteBook(b.id);
                if (currentBook && currentBook.id === b.id) {
                    const rest = await listBooks();
                    currentBook = rest[0] || null; __cbSet?.(currentBook, 'p7');
                    settings.activeBookId = currentBook ? currentBook.id : '';
                    await saveSettings();
                    updateHud();
                }
                renderPanel();
            });
            list.appendChild(card);
        });

        bar.querySelector('#shelf-import').addEventListener('click', () => { closePanel(); pickFile(); });
        bar.querySelector('#shelf-clear').addEventListener('click', async () => {
            if (queueRunning || queueStarting || appendInFlight) { notify('info','请先等待当前任务结束'); return; }
            if (!books.length) return;
            if (!ask(`清空全部 ${books.length} 本书？（已铺进聊天的楼层会一起移除）`)) return;
            for (const b of books) await deleteBook(b.id);
            const ctx = getSTContext();
            if (ctx) {
                for (let i = (ctx.chat || []).length - 1; i >= 0; i--) {
                    const m = getMark(ctx.chat[i]);
                    if (m) { ctx.chat.splice(i, 1); const el = mesEl(i); if (el) el.remove(); }
                }
                if (typeof ctx.saveChat === 'function') { try { await ctx.saveChat(); } catch (e) { } }
            }
            currentBook = null; __cbSet?.(currentBook, 'p7');
            settings.activeBookId = '';
            await saveSettings();
            updateHud();
            renderPanel();
        });
    }

    // ---------- 导出 ----------
    function renderExport(body) {
        const doc = getHostDocument();
        if (!currentBook) {
            body.innerHTML = `<div style="padding:40px;text-align:center;color:#6c7086;">先导入并选择一本小说</div>`;
            return;
        }
        const map = scanFloorMap();
        const withImg = Object.values(map).filter(v => v.hasImage).length;

        const wrap = doc.createElement('div');
        wrap.style.cssText = 'padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;font-size:13px;';
        wrap.innerHTML = `
            <div style="background:#181825;border:1px solid #89b4fa;border-radius:9px;padding:11px;display:flex;flex-direction:column;gap:8px;">
                <b style="color:#89b4fa;">💾 导出《${esc(currentBook.title)}》</b>
                <div style="color:#a6adc8;font-size:12px;line-height:1.6;">
                    支持直接导出标准 <b>.epub</b> 图文混排电子书（所有配图按正文剧情段落原位内嵌，手机/平板阅读器可直接打开带图阅读），当前这部小说有 <b style="color:#a6e3a1;">${withImg}</b> 节已配图。
                </div>
                <label class="th-nv-row" style="cursor:pointer;color:#a6e3a1;font-weight:700;">
                    <input type="radio" name="expfmt" value="epub" ${(!settings.exportFormat || settings.exportFormat === 'epub') ? 'checked' : ''}> 📕 EPUB 电子书（图文混排直读，强烈推荐）
                </label>
                <label class="th-nv-row" style="cursor:pointer;">
                    <input type="radio" name="expfmt" value="zip-md" ${settings.exportFormat === 'zip-md' ? 'checked' : ''}> ZIP + Markdown（带图压缩包）
                </label>
                <label class="th-nv-row" style="cursor:pointer;">
                    <input type="radio" name="expfmt" value="zip-html" ${settings.exportFormat === 'zip-html' ? 'checked' : ''}> ZIP + 分章 HTML（带图，可直接双击看）
                </label>
                <label class="th-nv-row" style="cursor:pointer;">
                    <input type="radio" name="expfmt" value="txt" ${settings.exportFormat === 'txt' ? 'checked' : ''}> 纯 TXT（图片写成路径）
                </label>
                <hr style="border:none;border-top:1px solid #313244;">
                <label class="th-nv-row" style="cursor:pointer;"><input type="checkbox" id="exp-img" ${settings.exportIncludeImages ? 'checked' : ''}> 打包插图文件</label>
                <label class="th-nv-row" style="cursor:pointer;"><input type="checkbox" id="exp-unimg" ${settings.exportIncludeUnillustrated ? 'checked' : ''}> 连同没有配图的节一起导出</label>
                <label class="th-nv-row" style="cursor:pointer;"><input type="checkbox" id="exp-split" ${settings.exportSplitByChapter ? 'checked' : ''}> 额外按章拆分文件</label>
                <button class="th-nv-btn primary" id="exp-go" style="padding:9px;font-size:14px;">开始导出</button>
                <div id="exp-log" style="color:#a6adc8;font-size:12px;min-height:16px;"></div>
            </div>
            <div style="color:#6c7086;font-size:12px;line-height:1.7;">
                说明：插图取自楼层的原始图片附件（不是屏幕截图），文件名含节序号和章节名，
                与正文的插入位置一一对应。若某张图读取失败会跳过并在日志里计数。
            </div>
        `;
        body.appendChild(wrap);

        wrap.querySelectorAll('input[name="expfmt"]').forEach(r => r.addEventListener('change', () => {
            settings.exportFormat = r.value; saveSettings();
        }));
        wrap.querySelector('#exp-img').addEventListener('change', e => { settings.exportIncludeImages = e.target.checked; saveSettings(); });
        wrap.querySelector('#exp-unimg').addEventListener('change', e => { settings.exportIncludeUnillustrated = e.target.checked; saveSettings(); });
        wrap.querySelector('#exp-split').addEventListener('change', e => { settings.exportSplitByChapter = e.target.checked; saveSettings(); });

        wrap.querySelector('#exp-go').addEventListener('click', async e => {
            const btn = e.currentTarget;
            const log = wrap.querySelector('#exp-log');
            btn.disabled = true;
            log.textContent = '正在处理…';
            try {
                await exportBook({
                    format: settings.exportFormat === 'txt' ? 'txt' : settings.exportFormat,
                    includeImages: wrap.querySelector('#exp-img').checked,
                    includeUnillustrated: wrap.querySelector('#exp-unimg').checked,
                    splitByChapter: wrap.querySelector('#exp-split').checked
                });
                log.textContent = '已开始下载';
            } catch (err) {
                log.textContent = '失败：' + (err && err.message ? err.message : err);
            } finally {
                btn.disabled = false;
            }
        });
    }

    // ---------- 设置 ----------
    function renderSettings(body) {
        const doc = getHostDocument();
        const wrap = doc.createElement('div');
        wrap.style.cssText = 'padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;font-size:13px;';
        wrap.innerHTML = `
            <div style="background:#181825;border-radius:9px;padding:11px;display:flex;flex-direction:column;gap:9px;">
                <b style="color:#89b4fa;">阅读</b>
                <label class="th-nv-row" style="cursor:pointer;"><input type="checkbox" id="s-bottom" ${settings.autoAppendOnBottom ? 'checked' : ''}> 触底预接下一节</label>
                <label class="th-nv-row" style="cursor:pointer;"><input type="checkbox" id="s-pure" ${settings.pureMode ? 'checked' : ''}> 纯净阅读模式</label>
                <label class="th-nv-row" style="cursor:pointer;"><input type="checkbox" id="s-swipe" ${settings.lockSwipeReroll ? 'checked' : ''}> 禁用左右滑重生成（防误触）</label>
                <label class="th-nv-row" style="cursor:pointer;"><input type="checkbox" id="s-hud" ${settings.showFloatingHud ? 'checked' : ''}> 显示右上角胶囊（可按住自由拖动）</label>
                <button class="th-nv-btn" id="s-reset-hud" style="align-self:flex-start;">📍 重置右上角胶囊位置</button>
                <div class="th-nv-row"><span>预接提前量</span><input class="th-nv-input" id="s-look" type="number" min="200" max="3000" step="100" value="${settings.preGenLookahead}" style="width:90px;">px</div>
                <div class="th-nv-row" style="color:#6c7086;font-size:12px;">越接近底部越省心，但太高会提前铺很多楼</div>
            </div>
            <div style="background:#181825;border-radius:9px;padding:11px;display:flex;flex-direction:column;gap:9px;">
                <b style="color:#89b4fa;">生图</b>
                <label class="th-nv-row" style="cursor:pointer;"><input type="checkbox" id="s-bgkeep" ${settings.keepAliveBg !== false ? 'checked' : ''}> 手机后台辅助（系统休眠后可恢复待处理任务）</label>
                <div class="th-nv-row"><span>单张最长等待</span><input class="th-nv-input" id="s-wait" type="number" min="20" max="600" value="${settings.preGenWaitSec}" style="width:90px;">秒</div>
                <div class="th-nv-row"><span>失败重试</span><input class="th-nv-input" id="s-retry" type="number" min="0" max="10" value="${settings.preGenRetry}" style="width:90px;">次（被截断时自动留在本层重试）</div>
                <div class="th-nv-row"><span>出图后冷却</span><input class="th-nv-input" id="s-cd" type="number" min="0" max="30" value="${settings.cooldownSec}" style="width:90px;">秒</div>
                <div class="th-nv-row"><span>生图按钮选择器</span><input class="th-nv-input" id="s-sel" value="${esc(settings.boundBtnSelector)}" style="flex:1;min-width:120px;"></div>
                <div class="th-nv-row"><span>附加斜杠命令</span><input class="th-nv-input" id="s-slash" placeholder="/sd …" value="${esc(settings.boundSlashCmd)}" style="flex:1;min-width:120px;"></div>
                <button class="th-nv-btn" id="s-bind">🔌 点击绑定生图按钮</button>
            </div>
            <div style="background:#181825;border-radius:9px;padding:11px;display:flex;flex-direction:column;gap:9px;">
                <b style="color:#89b4fa;">文本清洗</b>
                <div class="th-nv-row"><input class="th-nv-input" id="s-clean" value="${esc(settings.customCleanRules)}" style="flex:1;"></div>
                <div style="color:#6c7086;font-size:12px;">逗号分隔的字符串，会从正文里整体删掉（例如残留的 /q）</div>
            </div>
            <div style="background:#181825;border-radius:9px;padding:11px;display:flex;flex-direction:column;gap:9px;">
                <b style="color:#89b4fa;">数据</b>
                <div style="color:#a6adc8;font-size:12px;">小说存在浏览器 IndexedDB（${DB_NAME}），不上传任何服务器。</div>
                <button class="th-nv-btn danger" id="s-remove-floors">移除本书在聊天里的所有楼层</button>
                <div style="color:#6c7086;font-size:12px;">退出重来时从这里清理，比手动一层层删快</div>
            </div>
        `;
        body.appendChild(wrap);

        const bindChk = (id, key, cb) => wrap.querySelector(id).addEventListener('change', e => {
            settings[key] = e.target.checked; saveSettings(); if (cb) cb();
        });
        bindChk('#s-bottom', 'autoAppendOnBottom');
        bindChk('#s-pure', 'pureMode', () => { injectStyles(); updateHud(); });
        bindChk('#s-swipe', 'lockSwipeReroll', () => injectStyles());
        bindChk('#s-hud', 'showFloatingHud', () => updateHud());
        bindChk('#s-bgkeep', 'keepAliveBg');
        wrap.querySelector('#s-reset-hud').addEventListener('click', () => {
            settings.hudPos = null;
            saveSettings();
            updateHud();
            notify('success', '已重置胶囊位置到右上角');
        });

        const bindNum = (id, key, min, max, after) => wrap.querySelector(id).addEventListener('change', e => {
            const v = Number(e.target.value);
            settings[key] = Math.min(max, Math.max(min, isNaN(v) ? settings[key] : v));
            e.target.value = settings[key];
            saveSettings(); if (after) after();
        });
        bindNum('#s-look', 'preGenLookahead', 200, 3000, () => { if (sentinelObserver) { sentinelObserver.disconnect(); initialiseSentinel(); refreshSentinel(); } });
        bindNum('#s-wait', 'preGenWaitSec', 20, 600);
        bindNum('#s-retry', 'preGenRetry', 0, 10);
        bindNum('#s-cd', 'cooldownSec', 0, 30);

        wrap.querySelector('#s-sel').addEventListener('change', e => { settings.boundBtnSelector = e.target.value.trim(); saveSettings(); });
        wrap.querySelector('#s-slash').addEventListener('change', e => { settings.boundSlashCmd = e.target.value.trim(); saveSettings(); });
        wrap.querySelector('#s-clean').addEventListener('change', e => { settings.customCleanRules = e.target.value; saveSettings(); });
        wrap.querySelector('#s-bind').addEventListener('click', () => { closePanel(); startBind(); });
        wrap.querySelector('#s-remove-floors').addEventListener('click', async () => {
            if (!currentBook) return;
            if (!ask('移除本书在聊天里的所有楼层？（小说本身保留在书架）')) return;
            const n = await removeFloorsOfBook(currentBook.id);
            notify('success', `已移除 ${n} 层`);
            renderPanel();
        });
    }

    // ---------- 绑定按钮 ----------
    function startBind() {
        const doc = getHostDocument();
        doc.querySelectorAll('#chat .mes').forEach(expandFloorMenu);

        const banner = doc.createElement('div');
        banner.id = 'th-novel-bind-banner';
        banner.style.cssText = 'position:fixed;top:12px;left:50%;z-index:1000003;transform:translateX(-50%);z-index:100000;background:#a6e3a1;color:#11111b;padding:10px 14px;border-radius:10px;font-weight:700;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.45);display:flex;gap:10px;align-items:center;max-width:94vw;';
        banner.innerHTML = `<span>🎯 请点一下楼层上的【生图按钮】（三个点已展开）</span><button class="th-nv-btn" id="bind-cancel" style="background:#11111b;color:#fff;border:none;">取消</button>`;
        (doc.body || doc.documentElement).appendChild(banner);

        const done = (msg) => {
            doc.removeEventListener('click', onClick, true);
            banner.remove();
            notify('success', msg);
        };
        function onClick(e) {
            if (banner.contains(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            const hit = e.target.closest('button, a, .mes_button, i, span') || e.target;
            if (isExpander(hit) || isExpander(e.target)) {
                const host = hit.closest('#chat .mes');
                if (host) expandFloorMenu(host);
                notify('info', '菜单已展开，继续点那个生图图标');
                return;
            }
            const host = hit.closest('#chat .mes');
            if (host) {
                settings.boundBtnType = 'floor';
                settings.boundBtnSelector = relativeSelector(hit, host);
            } else {
                settings.boundBtnType = 'global';
                settings.boundBtnSelector = relativeSelector(hit, doc.body);
            }
            saveSettings();
            done(`已绑定：${settings.boundBtnSelector}`);
        }
        banner.querySelector('#bind-cancel').addEventListener('click', () => { doc.removeEventListener('click', onClick, true); banner.remove(); });
        later(() => on(doc, 'click', onClick, true), 120);
    }

    // ============ 菜单入口 ============
    function injectWandMenu() {
        const doc = getHostDocument();
        const menu = doc.getElementById('extensionsMenu');
        let exists = doc.getElementById('th-novel-wand-v6');
        // 菜单框可能是被已经死掉的实例留下的（它 3s 的定时器会把删掉的框再塞回来），
        // 那种框上的点击闭包属于旧实例，这里直接重建成自己的。
        if (exists && exists.dataset.inst !== INST + '/' + MY_GEN) { try { exists.remove(); } catch (e) { } exists = null; }
        if (!menu || exists) return;

        const box = doc.createElement('div');
        box.id = 'th-novel-wand-v6';
        box.dataset.inst = INST + '/' + MY_GEN;
        box.style.cssText = 'border-top:1px solid rgba(255,255,255,.12);margin-top:4px;padding-top:4px;';
        const items = [
            ['fa-book-open', '📚 目录 / 生图 / 导出', () => openPanel('toc')],
            ['fa-file-import', '📂 导入小说 TXT', () => pickFile()],
            ['fa-palette', '🎨 排队给后 3 节生图', () => queueNextN(3)],
            ['fa-expand', '✨ 切换纯净阅读', () => togglePure()]
        ];
        items.forEach(([icon, text, fn], i) => {
            const row = doc.createElement('div');
            row.className = 'list-group-item flex-container flexGap5 interactable';
            row.id = 'th-wand-' + ['toc', 'import', 'pregen', 'pure'][i];
            row.style.cssText = 'cursor:pointer;align-items:center;padding:8px 12px;';
            row.innerHTML = `<i class="fa-solid ${icon}" style="width:18px;text-align:center;color:#89b4fa;"></i><span>${text}</span>`;
            row.addEventListener('click', () => { if (dbgOn()) (globalThis.__imp = globalThis.__imp || []).push('CLICK ' + row.id + ' gen=' + MY_GEN + ' inst=' + INST + ' dead=' + isDead()); menu.style.display = 'none'; fn(); });
            box.appendChild(row);
        });
        menu.appendChild(box);
    }

    // ============ 启动 ============
    async function boot() {
        if (booted) return;
        booted = true;

        const doc = getHostDocument();
        // 上一份实例的所有副作用先杀掉，否则两套一起铺楼 / 一起抢视口。
        // 注意：teardown 存在 window 上会被后来的实例覆盖，一旦有一次覆盖丢失，
        // 最早那套的 2.5s 定时器就会用旧代码重刷 HUD（表现为按钮偶发失去 data-act）。
        // 改为登记表，boot 时把历史实例全部拆掉，并指定唯一 owner。
        try {
            const hw = getHostWindow();
            // 兼容更早的构建：它们只登记了单个 __thReaderV6Cleanup
            try { hw.__thReaderV6Cleanup?.(); } catch (e) { }
            hw.__thReaderV6Cleanup = null;
            const reg = (hw.__thReaderV6Instances = hw.__thReaderV6Instances || []);
            // 自己已经同步登记过了，别把自己也拆了
            const all = reg.splice(0);
            const stale = all.filter(fn => fn !== teardown);
            try { if (dbgOn()) (hw.__tdreg = hw.__tdreg || []).push('gen=' + MY_GEN + ' reg=' + all.length + ' stale=' + stale.length + ' selfIncluded=' + String(all.includes(teardown))); } catch (e) { }
            for (const fn of stale) { try { fn(); } catch (e) { } }
            reg.push(teardown);
            hw.__thReaderV6Owner = INST;
            if (hw.Element && hw.Element.prototype && hw.Element.prototype.__thOrigBbiRect) {
                hw.Element.prototype.getBoundingClientRect = hw.Element.prototype.__thOrigBbiRect;
                delete hw.Element.prototype.__thOrigBbiRect;
            }
            if (hw.__thBgPendingPump) {
                clearInterval(hw.__thBgPendingPump);
                hw.__thBgPendingPump = null;
            }
        } catch (e) { }
        try { if (typeof replaceScriptButtons === 'function') replaceScriptButtons([]); } catch (e) { }

        await loadSettings();
        injectStyles();
        installChatHooks();
        installScrollSpy();
        injectWandMenu();
        // 刚刷新页面时 #extensionsMenu 可能还没建出来，等 3s 间隔太慢（点导入会扑空），
        // 前几秒密集补几次。
        for (const d of [150, 400, 900, 1600, 2600]) later(() => { if (!doc.getElementById('th-novel-wand-v6')) injectWandMenu(); }, d);
        updateHud();

        every(3000, () => {
            injectWandMenu();
            if (!doc.getElementById('th-novel-hud') && settings.showFloatingHud) updateHud();
            healHud();
        });

        const ok = await loadBook();
        if (ok) {
            refreshHudMap();
            const map = scanFloorMap();
            const list = sortedDeployed(map);
            if (list.length) {
                const target = map[currentBook.currentIndex] ? currentBook.currentIndex : list[0];
                const mesId = map[target] ? map[target].mesId : map[list[0]].mesId;
                setTimeout(() => scrollToFloorStart(mesId, false), 260);
            }
            refreshSentinel();
        }
        updateHud();

        try {
            if (typeof eventOn === 'function' && typeof tavern_events !== 'undefined' && tavern_events.CHAT_CHANGED) {
                eventOn(tavern_events.CHAT_CHANGED, () => {
                    setTimeout(retryRestore, 700);
                });
            }
        } catch (e) { }

        on(doc, 'visibilitychange', (ev) => {
            if (ev && ev.__thSynthetic) return;
            if (!isRealDocHidden()) { installScrollSpy(); updateHud(); refreshSentinel(); }
        });
    }

    async function retryRestore() {
        if (isDead()) return;
        if (!(await loadBook())) { updateHud(); return; }
        installScrollSpy();
        refreshHudMap();
        const map = scanFloorMap();
        if (map[currentBook.currentIndex]) scrollToFloorStart(map[currentBook.currentIndex].mesId, false);
        refreshSentinel();
        updateHud();
        injectStyles();
        injectWandMenu();
    }

    // 供控制台/测试使用的调试入口
    try {
        const hw = getHostWindow();
        if (!hw.__apiTrap) { hw.__apiTrap = []; try { let _v = hw.__thReaderV6; Object.defineProperty(hw, '__thReaderV6Probe', { configurable: true, get() { return _v; }, set(nv) { _v = nv; hw.__apiTrap.push('SET by gen=' + MY_GEN + ' hasInst=' + Boolean(nv && nv.inst) + ' ' + STK()); } }); } catch (e) { } }
        hw.__thReaderV6 = {
            gen: MY_GEN, inst: INST, dbgBook: () => [currentBook && currentBook.id, _cb && _cb.id, currentBook === _cb], dbgGeom: () => ({ fz: freezeDepth, jg: jumpGuardUntil, uto: userTookOver, pin: Boolean(pinObserver), smooth: smoothTarget, st: rawTop(getChatEl()), sh: getChatEl() && getChatEl().scrollHeight, ch: getChatEl() && getChatEl().clientHeight, tail: tailPx }),
            get settings() { return settings; },
            set cooldown(v) { settings.cooldownSec = v; },
            get book() { return currentBook; },
            parseSectionRange, restoreQueueSelection, detectVisible, detectTopFloor, currentChunkIndex, scanFloorMap, floorImages, buildChunks, runQueue, exportBook, triggerAutoAppend, deployFloor, goToChunk, triggerIllustration, illustrateOne, refreshStaleFloors, loadBook, scrollToFloorStart, removeFloorsOfBook, openPanel, closePanel, pickFile, resplit,
            get queueRunning() { return queueRunning; }
        };
        try { if (dbgOn() && hw.__apiTrap) hw.__apiTrap.push('assign gen=' + MY_GEN + ' sameWin=' + (hw === window) + ' apiInst=' + String(hw.__thReaderV6 && hw.__thReaderV6.inst)); } catch (e) { }
    } catch (e) { }

    on(getHostDocument(),'visibilitychange',()=>{
        if(!isRealDocHidden())refreshPipelineView();
    });
    boot();
})();




