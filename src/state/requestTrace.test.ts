import { describe, expect, it } from 'vitest';
import { recordRequest, requestTraces, safeRequest } from './requestTrace';

describe('final request diagnostics', () => {
  it('keeps real character prompts and scalars while removing credentials and reference bytes', () => {
    expect(safeRequest({ input: 'scene', parameters: { seed: 42, v4_prompt: { caption: 'face' },
      reference_image_multiple: ['binary'], token: 'SECRET' }, Authorization: 'SECRET' }))
      .toEqual({ input: 'scene', parameters: { seed: 42, v4_prompt: { caption: 'face' },
        reference_image_multiple: '[reference data omitted]', token: '[redacted]' }, Authorization: '[redacted]' });
  });
  it('takes detached bounded snapshots', () => {
    const input = { parameters: { seed: 1 } };
    recordRequest(input);
    input.parameters.seed = 2;
    expect(requestTraces[0].body).toEqual({ parameters: { seed: 1 } });
    for (let i = 0; i < 30; i++) recordRequest({ input: `${i}` });
    expect(requestTraces).toHaveLength(20);
  });
});
