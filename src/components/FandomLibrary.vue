<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import {
  fandomCatalog,
  loadFandomCatalog,
  saveFandomIdentity,
  importFandomCatalog,
  exportFandomCatalog,
  type FandomMaterial,
} from '@/data/fandomCatalog';
const props = defineProps<{ actionLabel?: string }>();
const emit = defineEmits<{ select: [item: FandomMaterial]; saved: [] }>();
const revision = ref(0),
  query = ref(''),
  medium = ref(''),
  work = ref(''),
  page = ref(0),
  feedback = ref('');
const busy = ref(true);
const draft = ref({ name: '', roleTag: '', workTag: '', franchise: '', medium: '未分类' });
const all = computed(() => {
  revision.value;
  return fandomCatalog();
});
const media = computed(() => [...new Set(all.value.map((x) => x.medium))]);
const works = computed(() =>
  [
    ...new Set(all.value.filter((x) => !medium.value || x.medium === medium.value).map((x) => x.franchise)),
  ].sort((a, b) => a.localeCompare(b, 'zh')),
);
const results = computed(() =>
  all.value.filter(
    (x) =>
      (!medium.value || x.medium === medium.value) &&
      (!work.value || x.franchise === work.value) &&
      (!query.value.trim() ||
        [x.name, x.roleTag, x.workTag, x.franchise, ...x.aliases]
          .join(' ')
          .toLowerCase()
          .includes(query.value.trim().toLowerCase())),
  ),
);
const shown = computed(() => results.value.slice(page.value * 24, page.value * 24 + 24));
const identity = computed(() =>
  [draft.value.roleTag.trim(), draft.value.workTag.trim()].filter(Boolean).join(', '),
);
function pick(item: FandomMaterial) {
  draft.value = {
    name: item.name,
    roleTag: item.roleTag,
    workTag: item.workTag,
    franchise: item.franchise,
    medium: item.medium,
  };
}
async function commit(use: boolean) {
  if (busy.value) return;
  busy.value = true;
  try {
    const item = await saveFandomIdentity(draft.value);
    revision.value++;
    emit('saved');
    if (use) emit('select', item);
    feedback.value = use ? '已提交人物选择，后续请查看角色候选或固定结果' : '已收藏身份；没有修改当前人物';
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
function roll() {
  if (results.value.length) pick(results.value[Math.floor(Math.random() * results.value.length)]);
}
async function imported(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file || busy.value) return;
  busy.value = true;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('文件不能超过 25MB');
    const count = await importFandomCatalog(await file.text());
    revision.value++;
    emit('saved');
    feedback.value = `已读取 ${count} 条，按作品归组；已有中文名保持不变`;
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  } finally {
    input.value = '';
    busy.value = false;
  }
}
function download() {
  const url = URL.createObjectURL(new Blob([exportFandomCatalog()], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '墨影-同人身份目录.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
onMounted(async () => {
  try {
    await loadFandomCatalog();
    revision.value++;
  } finally {
    busy.value = false;
  }
});
</script>
<template>
  <section class="fandom-library">
    <fieldset :disabled="busy">
      <header>
        <h3>用谁的形象来画</h3>
        <p>只使用角色名＋作品名。选人不改你的画风和 NAI 配置。</p>
      </header>
      <div class="tools">
        <input
          v-model="query"
          class="bbi-input"
          placeholder="搜中文名、英文名或作品"
          @input="page = 0"
        /><select
          v-model="medium"
          class="bbi-input"
          @change="
            work = '';
            page = 0;
          "
        >
          <option value="">全部作品类型</option>
          <option v-for="m in media" :key="m">{{ m }}</option></select
        ><button class="bbi-btn" :disabled="!results.length" @click="roll">在当前范围随机选人</button>
      </div>
      <div class="catalog-layout">
        <aside>
          <button
            class="work"
            :class="{ active: !work }"
            @click="
              work = '';
              page = 0;
            "
          >
            全部作品 · {{ all.length }}</button
          ><button
            v-for="w in works"
            :key="w"
            class="work"
            :class="{ active: work === w }"
            @click="
              work = w;
              page = 0;
            "
          >
            {{ w }}
          </button>
        </aside>
        <div>
          <div class="identities">
            <button v-for="item in shown" :key="item.id" class="identity" @click="pick(item)">
              <strong>{{ item.name }}</strong
              ><span>{{ item.franchise }}</span
              ><small>{{ item.roleTag }}</small>
            </button>
          </div>
          <p v-if="!results.length">没有找到。可以在右侧填写角色与作品，或导入官方角色目录。</p>
          <div class="tools">
            <button class="bbi-btn" :disabled="!page" @click="page--">上一页</button
            ><span>{{ page + 1 }} / {{ Math.max(1, Math.ceil(results.length / 24)) }}</span
            ><button class="bbi-btn" :disabled="(page + 1) * 24 >= results.length" @click="page++">
              下一页
            </button>
          </div>
        </div>
        <div class="editor">
          <h4>固定的绘图身份</h4>
          <label>中文角色名<input v-model="draft.name" class="bbi-input" /></label
          ><label
            >英文角色标签<input v-model="draft.roleTag" class="bbi-input" placeholder="hatsune miku" /></label
          ><label
            >作品中文名<input v-model="draft.franchise" class="bbi-input" placeholder="VOCALOID" /></label
          ><label
            >英文作品标签<input v-model="draft.workTag" class="bbi-input" placeholder="vocaloid" /></label
          ><label
            >作品类型<select v-model="draft.medium" class="bbi-input">
              <option
                v-for="m in [...new Set([...media, '游戏', '动画／漫画', '小说／动画', '其他', '未分类'])]"
                :key="m"
              >
                {{ m }}
              </option>
            </select></label
          ><code>{{ identity || '角色名, 作品名' }}</code>
          <p>不会附加原图衣服、画师或另一套脸部描述。服装由剧情和衣橱决定。</p>
          <div class="tools">
            <button class="bbi-btn" @click="commit(false)">收藏身份</button
            ><button class="bbi-btn bbi-btn-primary" @click="commit(true)">
              {{ props.actionLabel || '作为定妆候选' }}
            </button>
          </div>
          <a
            v-if="draft.roleTag"
            :href="'https://animadex.net/?mode=characters&q=' + encodeURIComponent(identity)"
            target="_blank"
            rel="noopener noreferrer"
            >到 Animadex 认人 ↗</a
          >
        </div>
      </div>
      <p role="status">{{ feedback }}</p>
      <details>
        <summary>扩充目录与备份</summary>
        <p>
          内置常用角色可离线选择。Animadex 需跨域或官方导出授权，因此不伪装成已连接：可去原站浏览，或导入官方
          character / copyright CSV，插件会按作品归组。未知作品类型放入“未分类”。
        </p>
        <div class="tools">
          <label class="bbi-btn file"
            >导入 CSV / JSON<input type="file" accept=".csv,.json" @change="imported" /></label
          ><button class="bbi-btn" @click="download">导出身份目录</button
          ><a
            href="https://github.com/zetaneko/AnimaDex/blob/main/docs/import-from-site.md"
            target="_blank"
            rel="noopener noreferrer"
            >官方导出说明 ↗</a
          >
        </div>
      </details>
    </fieldset>
  </section>
</template>
<style scoped>
.fandom-library fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.fandom-library {
  margin: 16px 0;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}
.tools input {
  flex: 1;
  min-width: 160px;
}
.tools select {
  width: auto;
}
.catalog-layout {
  display: grid;
  grid-template-columns: 145px minmax(170px, 1fr) minmax(220px, 0.8fr);
  gap: 16px;
}
aside {
  max-height: 540px;
  overflow: auto;
  border-right: 1px solid #8884;
  padding-right: 8px;
}
.work {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  padding: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.work.active {
  background: #87a9bb22;
  border-left: 3px solid var(--bbi-accent, #87a9bb);
}
.identities {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.identity {
  text-align: left;
  color: inherit;
  border: 1px solid #8884;
  border-radius: 6px;
  padding: 12px;
  background: transparent;
  cursor: pointer;
}
.identity strong,
.identity span,
.identity small {
  display: block;
  overflow-wrap: anywhere;
}
.identity span {
  margin: 5px 0;
  font-size: 0.85em;
  opacity: 0.8;
}
.identity small {
  font-size: 0.8em;
  opacity: 0.6;
}
.editor {
  padding-left: 16px;
  border-left: 1px solid #8884;
}
label {
  display: block;
  margin: 8px 0;
}
label .bbi-input {
  display: block;
  width: 100%;
  margin-top: 4px;
}
code {
  display: block;
  padding: 12px;
  background: #87a9bb14;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.file {
  position: relative;
  overflow: hidden;
}
.file input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}
p {
  line-height: 1.65;
}
h3,
h4 {
  margin: 0 0 10px;
}
@media (max-width: 850px) {
  .catalog-layout {
    grid-template-columns: 125px 1fr;
  }
  .editor {
    grid-column: 1/-1;
    border-left: 0;
    border-top: 1px solid #8884;
    padding: 16px 0;
  }
}
@media (max-width: 480px) {
  .catalog-layout {
    grid-template-columns: 1fr;
  }
  aside {
    display: flex;
    max-height: 130px;
    flex-wrap: wrap;
    border: 0;
  }
  .work {
    width: auto;
  }
  .editor {
    grid-column: auto;
  }
}
</style>
