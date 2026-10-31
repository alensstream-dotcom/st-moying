import { describe, expect, it } from 'vitest';
import { diagnoseTruncation } from '@/autoTag/truncation';

describe('diagnoseTruncation', () => {
  it('passes a complete thinking block plus a balanced JSON object', () => {
    const raw = [
      '<thinking>',
      'E1 选定。',
      '</thinking>',
      '{"images":[{"position":"P1","sourceLine":1,"tag":"1girl, solo"}],"changes":[]}',
    ].join('\n');
    expect(diagnoseTruncation(raw)).toEqual({ truncated: false, reason: '' });
  });

  it('flags an unclosed thinking block', () => {
    const raw = '<thinking>\nA 事实账本:\n- 第一行\n- 第二';
    expect(diagnoseTruncation(raw)).toEqual({ truncated: true, reason: '思考块未闭合' });
  });

  it('flags a JSON object that never closes', () => {
    const raw = [
      '<thinking>ok</thinking>',
      '{"images":[{"position":"P1","sourceLine":1,"tag":"1girl","characters":[{"name":"林",',
    ].join('\n');
    expect(diagnoseTruncation(raw).truncated).toBe(true);
    expect(diagnoseTruncation(raw).reason).toContain('JSON 未闭合');
  });

  it('flags a tag string cut off mid-value', () => {
    const raw = '<thinking>ok</thinking>\n{"images":[{"position":"P1","sourceLine":1,"tag":"1girl, black th';
    expect(diagnoseTruncation(raw).truncated).toBe(true);
  });

  it('treats empty output as truncated (a refusal usually arrives as nothing)', () => {
    expect(diagnoseTruncation('   \n')).toEqual({ truncated: true, reason: '空输出' });
  });

  it('reports a truncated result when no JSON object was started', () => {
    const raw = '<thinking>ok</thinking>\n抱歉，我无法继续。';
    expect(diagnoseTruncation(raw)).toEqual({ truncated: true, reason: '没有 JSON 对象' });
  });

  it('ignores braces that live inside JSON strings', () => {
    const raw =
      '<thinking>ok</thinking>\n{"images":[{"position":"P1","sourceLine":1,"tag":"1girl, {brace} in tag","nl":"a {curly} smile"}],"changes":[]}';
    expect(diagnoseTruncation(raw).truncated).toBe(false);
  });

  it('does not treat a brace inside the thinking block as the JSON start', () => {
    const raw = '<thinking>ratio {1:2}</thinking>\n{"images":[],"changes":[]}';
    expect(diagnoseTruncation(raw).truncated).toBe(false);
  });

  it('flags over-closed JSON as a malformed tail', () => {
    const raw = '<thinking>ok</thinking>\n{"images":[]}}';
    expect(diagnoseTruncation(raw).truncated).toBe(true);
  });
});
