/**
 * 已建档角色的「直接复用」判定。
 *
 * 用户的原话是:剧情里写出来的形象,和库里已有的形象差不多的时候,就直接拿库里那条来用。
 * 代码层对应两件事:
 * - 素材库候选层(loreIndex):正文外形与某条同人/脸型骨相多维重合 → 标 pinned 顶到第一位;
 * - 本文件:正文外形与**已经建档的角色**多维重合 → 直接点名「这段就是她」,
 *   让模型照抄档案、不要另起一条 field:"new"。
 *
 * 为什么值得单独做:建档走的是「AI 自己补全」,同一个角色换一句描写就可能被重新编一张脸
 * (发色从银白变灰白、瞳色从紫变蓝),而库里明明已经有一条更早、更权威的记录。
 * 判据只认档案里的固定字段(hair/eyes/body/extra),不看 name——正文常常不写名字。
 */
import { CHAR_TAG_FIELDS, type CharTagEntry } from '@/state/charTags';
import { LOOK_DIMENSION_LABEL, compareLook, isLookPin, scanLook } from '@/data/lookMatch';

export interface CharReuse {
  name: string;
  /** 命中的维度中文名。 */
  dimensions: string;
  /** 命中的维度数,多者优先。 */
  matched: number;
}

/** 档案侧参与比对的字段:只取长期不变的外形,outfit 会把「今天穿了什么」也算进相似度。 */
const LOOK_FIELDS = CHAR_TAG_FIELDS.filter(field => field === 'hair' || field === 'eyes' || field === 'body' || field === 'extra' || field === 'skin');

function entryLookText(entry: CharTagEntry): string {
  return LOOK_FIELDS.map(field => entry.fields[field] ?? '')
    .concat(entry.raw)
    .filter(Boolean)
    .join(', ');
}

/**
 * 在已建档角色里找与这段正文外形重合的人。
 *
 * 阈值与素材库同口径(三维起且无冲突),并且要求命中的维度里**至少含发色或瞳色**——
 * 光靠「精灵、巨乳、有痣」也够三维,但那可以是任意一个精灵巨乳角色,认错人比认不出更糟。
 */
export function findCharReuse(entries: readonly CharTagEntry[], text: string): CharReuse[] {
  const bodyLook = scanLook(text);
  if (!bodyLook.size) return [];
  const found: CharReuse[] = [];
  for (const entry of entries) {
    if (!entry.name.trim()) continue;
    const look = compareLook(bodyLook, scanLook(entryLookText(entry)));
    if (!isLookPin(look)) continue;
    if (!look.dimensions.includes('hairColor') && !look.dimensions.includes('eyeColor')) continue;
    found.push({
      name: entry.name,
      dimensions: look.dimensions.map(dimension => LOOK_DIMENSION_LABEL[dimension]).join('、'),
      matched: look.matched,
    });
  }
  found.sort((a, b) => b.matched - a.matched || a.name.localeCompare(b.name));
  return found;
}

/**
 * 渲染成注入块。空数组返回空串(不占上下文)。
 *
 * 措辞是断言式的:外形对上就要求「这段就是她」,因为这里命中的是档案里逐字记录的发色瞳色,
 * 不是气质相似。同时点明「若正文写了新变化,走 set 而不是 new」,免得模型为改一个发型重新建档。
 */
export function buildCharReuseBlock(reuse: readonly CharReuse[]): string {
  if (!reuse.length) return '';
  const lines = reuse.map(item => `- ${item.name}（发色/瞳色等逐项对上：${item.dimensions}）`);
  return [
    '【本段正文已对上的建档角色】[不要重新编脸]',
    '下面这些角色在库里有档案,而且正文写的发色、瞳色、体形、种族与档案逐项一致。用法:',
    '- 正文这一段写的就是他们本人:直接照抄档案字段画,不要另写一套外貌,也不要在 changes 里再输出 field:"new"。',
    '- 只有正文明确写了与档案不同的改动(换发型、变老、受伤留疤),才用 field:"set" 改对应的那一项;没写就一个字都不要改。',
    ...lines,
  ].join('\n');
}
