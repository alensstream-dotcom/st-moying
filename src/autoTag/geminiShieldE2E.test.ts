import { describe, expect, it } from 'vitest';
import { repairQuotes, shieldMessages, shieldText } from '@/autoTag/geminiShield';
import { parseImagePlan } from '@/autoTag/protocol';
import { prepareTargetText } from '@/autoTag/clean';

const STORY = [
  '林晚晴把外套脱下来挂在椅背上，露出里面的白衬衫。',
  '她伸手握住他的肉棒，低下头含了进去。',
  '他按住她的后脑，抽送得越来越深，最后射在她嘴里，她咽了下去。',
].join('\n');

const USER = `【角色固定外貌库】\n- 林晚晴: 1girl, long black hair\n\n--- 目标正文｜Char ---\n${STORY}`;

describe('gemini 档端到端:屏蔽 → 输出 → 还原', () => {
  it('模型抄的屏蔽版 after 还原后仍能定位到原文那一句', () => {
    const prepared = prepareTargetText(STORY, []);
    const { messages, story } = shieldMessages([{ role: 'user', content: USER }]);
    expect(messages[0].content).not.toContain('肉棒');
    expect(story?.source).toBe(USER);

    // 模拟模型抄第二句的屏蔽版 after。
    const quoted = shieldText(STORY.split('\n')[1] ?? '');
    expect(quoted).not.toContain('肉棒');
    expect(quoted).toContain('那一根');

    const raw = JSON.stringify({
      images: [{ position: 'P2', after: quoted, tag: '1girl, 1boy, close-up, kneeling' }],
      changes: [],
    });

    // 还原后 after 能逐字命中原文,落位到第二句那一行。
    const fixed = repairQuotes(raw, story);
    expect(fixed).toContain('她伸手握住他的肉棒');
    const plan = parseImagePlan(fixed, prepared.segments, 0, 4, STORY);
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0]?.sourceLine).toBe(1);
  });

  it('不还原时退回 position,不会整楼报错', () => {
    const prepared = prepareTargetText(STORY, []);
    const quoted = shieldText(STORY.split('\n')[1] ?? '');
    const raw = JSON.stringify({
      images: [{ position: 'P2', after: quoted, tag: '1girl, 1boy, close-up' }],
      changes: [],
    });
    const plan = parseImagePlan(raw, prepared.segments, 0, 4, STORY);
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0]?.sourceLine).toBe(1);
  });

  it('服装证据被还原后能命中原文,换装不会被静默丢弃', () => {
    const { story } = shieldMessages([{ role: 'user', content: USER }]);
    const shielded = shieldText('她伸手握住他的肉棒');
    const fixed = repairQuotes(`{"outfitChanges":[{"name":"林晚晴","evidence":"${shielded}"}]}`, story);
    const parsed = JSON.parse(fixed) as { outfitChanges: Array<{ evidence: string }> };
    expect(STORY).toContain(parsed.outfitChanges[0]?.evidence ?? '');
  });
});
