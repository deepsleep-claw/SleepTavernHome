import { describe, expect, it } from 'vitest';
import { prepareJavascriptBody } from './javascript-source';

async function evaluate(source: string) {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  return await new AsyncFunction(prepareJavascriptBody(source))();
}

describe('JavaScript completion results', () => {
  it.each([
    ['(async () => { await Promise.resolve(); return { answer: 42 }; })();', { answer: 42 }],
    ['async function main() { return 7; } main();', 7],
    ['const value = await Promise.resolve(8); value;', 8],
    ['return await Promise.resolve(9);', 9],
    ['await Promise.resolve(10)', 10],
    ['({ value: 11 }) // result', { value: 11 }],
  ])('等待并返回 %s', async (source, expected) => {
    expect(await evaluate(source)).toEqual(expected);
  });

  it('不重复执行失败的异步函数', async () => {
    await expect(evaluate('(async () => { throw new Error("async failed"); })()')).rejects.toThrow('async failed');
  });
  it('没有完成值时返回 undefined', async () => {
    expect(await evaluate('const value = 1;')).toBeUndefined();
  });
});
