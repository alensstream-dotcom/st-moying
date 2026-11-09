<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import {
  INDEX_SOURCE,
  loadOnlineIndex,
  searchOnline,
  fetchExamples,
  onlineWardrobeSlot,
  type OnlineKind,
  type OnlineMaterial,
  type OnlineExample,
} from '@/data/onlineLibrary';
import { addCustomFandom, addCustomWardrobe, guessWardrobeCategory } from '@/data/customLore';
import { explainTags } from '@/state/characterStudio';

const props = defineProps<{ kind?: OnlineKind }>();
const emit = defineEmits<{ select: [item: OnlineMaterial]; saved: [] }>();
const kind = ref<OnlineKind>(props.kind ?? 'character');
const query = ref(''),
  status = ref('尚未连接。点击搜索时才下载索引，后续优先使用本机缓存。');
const busy = ref(false),
  page = ref(0),
  count = ref(0),
  cacheDate = ref('');
const matches = shallowRef<OnlineMaterial[]>([]),
  selected = shallowRef<OnlineMaterial>();
const examples = shallowRef<OnlineExample[]>([]),
  exampleStatus = ref('');
const localName = ref(''),
  tags = ref(''),
  franchise = ref('');
let controller: AbortController | undefined;
let mounted = true;
const visible = computed(() => matches.value.slice(page.value * 18, page.value * 18 + 18));
const pages = computed(() => Math.ceil(matches.value.length / 18));
const label = computed(() => (kind.value === 'character' ? '同人角色' : '服装'));
function stop() {
  controller?.abort();
}
function reset() {
  stop();
  selected.value = undefined;
  matches.value = [];
  examples.value = [];
  page.value = 0;
  status.value = '请输入关键词搜索，或留空浏览热门标签。';
  exampleStatus.value = '';
}
watch(kind, reset);
async function run(action: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  controller = new AbortController();
  try {
    await action(controller.signal);
  } catch (error) {
    if (mounted) status.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
    controller = undefined;
  }
}
async function search(refresh = false) {
  await run(async (signal) => {
    status.value = refresh ? '正在更新外部索引…' : '正在读取在线库 / 本机缓存…';
    const index = await loadOnlineIndex(signal, refresh);
    const found = await searchOnline(index, query.value, kind.value);
    if (!mounted || signal.aborted) return;
    count.value = index.rows.length;
    cacheDate.value = new Date(index.savedAt).toLocaleDateString();
    matches.value = found;
    selected.value = undefined;
    examples.value = [];
    page.value = 0;
    status.value = found.length
      ? `找到 ${found.length} 项。选择后可收藏或套用。`
      : '没有匹配项。中文别名可能尚未收录，请尝试英文 / 日文名或英文服装标签。';
  });
}
function pick(item: OnlineMaterial) {
  selected.value = item;
  tags.value = item.tags;
  localName.value = item.name;
  franchise.value = item.tags.match(/\(([^)]+)\)/)?.[1]?.replace(/_/g, ' ') ?? '';
  examples.value = [];
  exampleStatus.value = '';
}
function material(): OnlineMaterial | undefined {
  const item = selected.value;
  if (!item) return;
  const clean = tags.value.trim();
  if (!clean || /[\u3400-\u9fff<>\r\n]/.test(clean)) {
    status.value = '请保留有效英文标签；中文名填写在名称栏。';
    return;
  }
  return {
    ...item,
    name: localName.value.trim() || item.name,
    tags: clean,
    aliases: [...item.aliases, localName.value.trim()].filter(Boolean),
  };
}
function use() {
  const item = material();
  if (item) {
    emit('select', item);
    status.value = '已选择此素材，请在角色候选或穿搭套用区域确认后生效。';
  }
}
function save() {
  const item = material();
  if (!item) return;
  const note = `在线素材来源：${item.sourceUrl}；标签索引：${INDEX_SOURCE}。标签存在不代表 NAI 已学会此角色或服装。`;
  const result =
    kind.value === 'character'
      ? addCustomFandom({
          name: item.name,
          tags: item.tags,
          aliases: item.aliases.join(','),
          franchise: franchise.value.trim() || '在线导入（作品未标注）',
          note,
        })
      : addCustomWardrobe({
          name: item.name,
          tags: item.tags,
          aliases: item.aliases.join(','),
          category: guessWardrobeCategory(item.tags),
          slot: onlineWardrobeSlot(item.tags),
          nsfw: 1,
          note,
        });
  status.value = result.ok ? '已收藏到本地素材库；后续生图不需要连接外部网站。' : result.error || '收藏失败';
  if (result.ok) emit('saved');
}
async function pictures() {
  const item = selected.value;
  if (!item) return;
  await run(async (signal) => {
    exampleStatus.value = '正在连接 Danbooru 图库…';
    try {
      const list = await fetchExamples(item.tags, signal);
      if (!mounted || signal.aborted) return;
      examples.value = list;
      exampleStatus.value = list.length
        ? '例图仅供浏览，不会自动作为生成参考图。'
        : '没有可显示的日常例图，可打开来源网页查看。';
    } catch (error) {
      if (mounted)
        exampleStatus.value = `${error instanceof Error ? error.message : error}。标签收藏和套用仍可使用。`;
    }
  });
}
function outfit(example: OnlineExample) {
  if (!example.clothes) return;
  selected.value = {
    name: `例图 ${example.id} 服装`,
    tags: example.clothes,
    aliases: [],
    sourceUrl: example.sourceUrl,
    kind: 'wardrobe',
  };
  tags.value = example.clothes;
  localName.value = `例图 ${example.id} 服装`;
  status.value = '已提取衣物标签，请检查并组合；没有带入画师、画风或人物标签。';
}
function roll() {
  if (matches.value.length) pick(matches.value[Math.floor(Math.random() * matches.value.length)]);
}
onUnmounted(() => {
  mounted = false;
  stop();
});
</script>

<template>
  <section class="online-library" aria-label="在线素材库">
    <header>
      <div>
        <h3>在线{{ props.kind ? label : '同人角色与服装' }}库</h3>
        <p>搜索外部标签，收藏到本地，再套给角色。</p>
      </div>
      <a :href="INDEX_SOURCE" target="_blank" rel="noopener noreferrer">标签来源 ↗</a>
    </header>
    <div class="online-controls">
      <select v-if="!props.kind" v-model="kind" class="bbi-input" :disabled="busy" aria-label="在线库类型">
        <option value="character">同人角色</option>
        <option value="wardrobe">服装</option>
      </select>
      <input
        v-model="query"
        class="bbi-input online-query"
        :disabled="busy"
        :placeholder="kind === 'character' ? '中文 / 日文 / 英文角色名' : '服装关键词，如和服、汉服、dress'"
        @keydown.enter.prevent="search()"
      />
      <button class="bbi-btn bbi-btn-primary" :disabled="busy" @click="search()">搜索在线库</button>
      <button class="bbi-btn" :disabled="busy || !matches.length" @click="roll">随机挑一个</button>
      <button v-if="busy" class="bbi-btn" @click="stop">取消</button>
      <button v-else class="bbi-btn" @click="search(true)">更新索引</button>
    </div>
    <p role="status">
      {{ status }}
      <span v-if="count">缓存 {{ count.toLocaleString() }} 个角色与服装标签 · {{ cacheDate }}</span>
    </p>
    <p class="online-note">
      首次下载约数 MB；不发送聊天内容或 API 密钥，不调用 LLM /
      NAI。中文搜索使用本地词典与已收藏别名，未收录的名字请用英文或日文。
    </p>
    <div v-if="matches.length" class="online-results">
      <button
        v-for="item in visible"
        :key="item.tags"
        class="online-tag"
        :class="{ chosen: selected?.tags === item.tags }"
        :disabled="busy"
        @click="pick(item)"
      >
        <strong>{{ item.name }}</strong
        ><small>{{ explainTags(item.tags) }}</small>
      </button>
    </div>
    <div v-if="pages > 1" class="online-controls">
      <button class="bbi-btn" :disabled="page === 0 || busy" @click="page--">上一页</button
      ><span>{{ page + 1 }} / {{ pages }}</span
      ><button class="bbi-btn" :disabled="page + 1 >= pages || busy" @click="page++">下一页</button>
    </div>
    <section v-if="selected" class="online-selection">
      <h4>选中{{ label }} · {{ selected.name }}</h4>
      <label>收藏名称 / 中文别名<input v-model="localName" class="bbi-input" :disabled="busy" /></label>
      <label v-if="kind === 'character'"
        >所属作品（可选）<input v-model="franchise" class="bbi-input" :disabled="busy"
      /></label>
      <label>使用的英文标签<textarea v-model="tags" class="bbi-input" rows="3" :disabled="busy" /></label>
      <p>{{ explainTags(tags) }}</p>
      <p v-if="kind === 'character'">
        使用角色身份标签会带来其固有发色和装饰等特征；NAI 不一定认识所有角色。先预览定妆再采用。
      </p>
      <p v-else>这里是服装标签库，不是现成套装目录。可将部件加入穿搭组合后保存整套；穿脱状态由剧情记录。</p>
      <div class="online-controls">
        <button class="bbi-btn" :disabled="busy" @click="save">收藏到本地</button>
        <button class="bbi-btn bbi-btn-primary" :disabled="busy" @click="use">
          {{ kind === 'character' ? '作为同人候选' : '加入穿搭 / 套用' }}
        </button>
        <button class="bbi-btn" :disabled="busy" @click="pictures">加载日常例图</button>
        <a :href="selected.sourceUrl" target="_blank" rel="noopener noreferrer">打开来源图库 ↗</a>
      </div>
      <p role="status">{{ exampleStatus }}</p>
      <div v-if="examples.length" class="online-examples">
        <article v-for="example in examples" :key="example.id">
          <a :href="example.sourceUrl" target="_blank" rel="noopener noreferrer"
            ><img
              :src="example.preview"
              alt="外部素材例图，点击查看来源"
              loading="lazy"
              referrerpolicy="no-referrer"
          /></a>
          <button
            v-if="kind === 'wardrobe' && example.clothes"
            class="bbi-btn"
            :disabled="busy"
            @click="outfit(example)"
          >
            提取这套衣物标签
          </button>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.online-library {
  margin: 18px 0 24px;
  padding: 20px;
  border: 1px solid var(--bbi-border, #8885);
  border-left: 3px solid var(--bbi-accent, #87a9bb);
  border-radius: 8px;
  background: var(--bbi-bg-soft, #80808008);
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
h3 {
  font-size: 1.2rem;
  margin: 0 0 6px;
}
h4 {
  margin: 0 0 12px;
}
p {
  line-height: 1.65;
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.online-note,
small {
  opacity: 0.75;
  font-size: 0.85em;
}
.online-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 12px 0;
}
.online-query {
  flex: 1;
  min-width: 180px;
}
.online-controls select {
  width: auto;
}
.online-results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
  gap: 8px;
  margin: 16px 0;
}
.online-tag {
  color: inherit;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid #8884;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.online-tag strong,
.online-tag small {
  display: block;
}
.online-tag.chosen {
  border-color: var(--bbi-accent, #87a9bb);
  background: #87a9bb18;
}
.online-selection {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #8884;
}
label {
  display: block;
  margin: 10px 0;
}
label .bbi-input {
  display: block;
  width: 100%;
  margin-top: 5px;
}
.online-examples {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.online-examples article {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.online-examples img {
  width: 100%;
  height: 180px;
  object-fit: contain;
  background: #8881;
}
@media (max-width: 560px) {
  .online-library {
    padding: 12px;
  }
  .online-query {
    flex-basis: 100%;
  }
  .online-results {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
