/**
 * 输出预算的护栏。
 *
 * 截断的根因不是「写得长」,是**契约 + 思考清单把输入和输出一起撑爆**:实测 6 条系统消息
 * 合计约 4 万字符(思考清单 7.9k、任务契约 22.8k),模型照着清单逐条自证就能写两千 token
 * 的思考块,之后 JSON 必然断在半路。
 *
 * 这里钉住两件事,防止以后再加规则时把预算又吃回去:
 * 1. 降载版(lean)必须显著短于完整版——它是截断后的重试路径,短不下来就救不回。
 * 2. 完整版本身也不能无限膨胀。
 */

import { describe, expect, it } from 'vitest';
import { buildAutoTagMessages } from '@/autoTag/prompt';
import type { AutoTagSettings, AutoTagPrompts } from '@/state/settings';
import type { STContext } from '@/st/context';

function context(): STContext {
  return {
    chat: [
      { name: 'User', is_user: true, is_system: false, mes: '上一层' },
      { name: 'Char', is_user: false, is_system: false, mes: '她推开门。\n\n雨声很轻。\n\n他看着她。' },
    ],
    chatMetadata: {},
    name1: 'User',
    name2: 'Char',
    getCurrentChatId: () => 'chat-a',
    getRequestHeaders: () => ({}),
    saveMetadataDebounced: () => undefined,
    saveChat: async () => undefined,
    eventSource: { on: () => undefined },
    eventTypes: {} as never,
  };
}

const options: AutoTagSettings = {
  enabled: true,
  contextMessages: 2,
  minImages: 1,
  maxImages: 3,
  retryCount: 0,
  autoGenerate: true,
  jailbreakTier: 'strong',
  lore: {
    enabled: false,
    maxNsfw: 3,
    wardrobeLimit: 0,
    poseLimit: 0,
    faces: false,
    faceLimit: 0,
    thumbModel: '',
    thumbIntervalMs: 10000,
  },
  prompts: {} as AutoTagPrompts,
};

const total = (messages: Array<{ content: string }>) =>
  messages.reduce((sum, m) => sum + m.content.length, 0);

describe('输出预算护栏', () => {
  it('降载版明显短于完整版(思考清单与长解释都要被砍掉)', async () => {
    const full = await buildAutoTagMessages(context(), 1, options, null);
    const lean = await buildAutoTagMessages(context(), 1, options, null, undefined, '', '', undefined, undefined, undefined, undefined, undefined, undefined, true, undefined);
    // 少说也要砍掉四分之一,否则重试等于原样再断一次。
    expect(total(lean)).toBeLessThan(total(full) * 0.85);
  });

  it('降载版保留协议骨架(位置/角色/服装仍然要得到)', async () => {
    const lean = await buildAutoTagMessages(context(), 1, options, null, undefined, '', '', undefined, undefined, undefined, undefined, undefined, undefined, true, undefined);
    const text = lean.map((m) => m.content).join('\n');
    expect(text).toContain('<bbi_image>');
    expect(text).toContain('outfitChanges');
    expect(text).toContain('position');
    expect(text).toContain('【精简思考清单（本次为截断后的重试）】');
    expect(text).not.toContain('⟪');
  });

  it('完整版整体仍压得住(超过 45000 字符就该考虑再裁)', async () => {
    const full = await buildAutoTagMessages(context(), 1, options, null);
    expect(total(full)).toBeLessThan(45000);
  });
});
