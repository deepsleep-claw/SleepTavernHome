import { expect, it } from 'vitest';
import { composerShortcut, fileMention, isCompressionCommand } from './composer-shortcuts';

it('补全只匹配输入位置的指令或引用，并正确编码文件链接', () => {
  expect(composerShortcut('/压', 2)).toMatchObject({ kind: 'command', query: '压' });
  expect(composerShortcut('参考 @note', 8)).toMatchObject({ kind: 'file', query: 'note', start: 3 });
  expect(composerShortcut('mail@example.com', 16)).toBeUndefined();
  expect(fileMention('/files/a b(1).md')).toBe('[a b(1).md](/files/a%20b%281%29.md)');
  expect(isCompressionCommand('/压缩')).toBe(true);
  expect(isCompressionCommand('/压缩后继续')).toBe(false);
});
