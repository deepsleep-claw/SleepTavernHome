import { expect, it } from 'vitest';
import { estimateToolOutputTokens } from './context';
import { modelToolOutput, richToolOutput } from './tool-output';
import { limitToolOutput, ToolOutputBudget } from './tool-output-budget';

it('大文本、JSON 和错误结果使用有界预览，正常结构保持完整', () => {
  const small = { path: '/file.md', ok: true };
  expect(limitToolOutput(small, 1000)).toBe(small);
  for (const output of [
    { content: '中'.repeat(1_200_000) },
    richToolOutput({ type: 'text', value: 'x'.repeat(1_200_000) }, {}),
    richToolOutput({ type: 'error-json', value: { detail: '中'.repeat(1_200_000) } }, {}),
  ]) {
    const limited = limitToolOutput(output, 1000);
    expect(estimateToolOutputTokens(modelToolOutput(limited))).toBeLessThanOrEqual(1000);
    expect(JSON.stringify(limited)).toContain('截断');
  }
});

it('图片以媒体预算保留完整编码，文本裁剪不会切坏媒体', () => {
  const data = 'A'.repeat(4_000_000);
  const image = { type: 'image-data' as const, data, mediaType: 'image/png' };
  const output = richToolOutput({ type: 'content', value: [image] }, { path: '/image.png' });
  expect(limitToolOutput(output, 2000)).toBe(output);
  const mixed = richToolOutput({ type: 'content', value: [image, { type: 'text', text: '中'.repeat(200_000) }] }, {});
  const limited = modelToolOutput(limitToolOutput(mixed, 3000));
  expect(estimateToolOutputTokens(limited)).toBeLessThanOrEqual(3000);
  expect(limited.type).toBe('content');
  if (limited.type === 'content') expect(limited.value).toContainEqual(image);
});

it('同一批返回共享预算，零余量也保留合法的工具结果', () => {
  const budget = new ToolOutputBudget(12_000);
  const outputs = Array.from({ length: 10 }, (_, index) =>
    budget.take({ content: '中'.repeat(100_000) }, 10 - index, 'read_file'),
  );
  expect(
    outputs.reduce<number>((total, output) => total + estimateToolOutputTokens(modelToolOutput(output)), 0),
  ).toBeLessThanOrEqual(12_000);
  expect(modelToolOutput(limitToolOutput({ content: 'large' }, 0))).toEqual({ type: 'text', value: '' });
});
