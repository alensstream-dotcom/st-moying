import { describe, expect, it, vi } from 'vitest';
import { applyWardrobeChoices } from './wardrobeChoice';
import { emptyCharFields, type CharTagEntry } from './charTags';
import type { ClothingState } from '@/autoTag/outfitTimeline';
import type { STMessage } from '@/st/context';

vi.mock('@/st/context', () => ({ getContext: () => ({ chat: [], chatMetadata: {} }) }));

const entry = (name: string): CharTagEntry => ({
  name,
  fields: { ...emptyCharFields(), sex: '1girl' },
  raw: '',
  nl: '',
  source: 'manual',
  desc: '',
  history: [],
});

function message(name: string, text = '她站在门口。', bind = true): STMessage {
  let hash = 2166136261;
  for (const c of text.replace(/\s+/g, '')) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return {
    mes: text,
    swipe_id: 0,
    extra: {
      bbiWardrobeChoices: [
        {
          id: 'c1',
          name,
          swipe: 0,
          hash: (hash >>> 0).toString(36),
          suit: bind
            ? {
                id: 'suit-1',
                name,
                title: '白衬衣',
                mode: 'always',
                slot: 'top',
                pieces: [{ id: 'suit-1-top', design: 'white shirt', state: { location: 'worn' } }],
              }
            : null,
        },
      ],
    },
  } as unknown as STMessage;
}

describe('衣柜面板绑定按档案主名落账', () => {
  it('面板里选「晚晴」也写到「林晚晴」那条账上', () => {
    const state: ClothingState = new Map();
    applyWardrobeChoices(state, message('晚晴'), undefined, [entry('林晚晴')]);
    expect([...state.keys()]).toEqual(['林晚晴']);
    expect(state.get('林晚晴')?.suitMode).toBe('always');
  });

  it('解绑同样按主名找，住了别名也不会留下解不掉的绑定', () => {
    const state: ClothingState = new Map();
    applyWardrobeChoices(state, message('林晚晴'), undefined, [entry('林晚晴')]);
    applyWardrobeChoices(state, message('晚晴', '第二天早上。', false), undefined, [entry('林晚晴')]);
    expect(state.get('林晚晴')?.suitMode).toBeUndefined();
  });
});
