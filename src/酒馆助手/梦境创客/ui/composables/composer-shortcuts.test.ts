import { expect, it } from 'vitest';
import { composerShortcut, fileMention, isCompressionCommand } from './composer-shortcuts';

it('补全只匹配输入位置的指令或引用，并正确编码文件链接', () => {
  expect(composerShortcut('/压', 2)).toMatchObject({ kind: 'command', query: '压' });
  expect(composerShortcut('参考 @note', 8)).toMatchObject({ kind: 'reference', query: 'note', start: 3 });
  expect(composerShortcut('mail@example.com', 16)).toBeUndefined();
  expect(fileMention('/files/a b(1).md')).toBe('[a b(1).md](/files/a%20b%281%29.md)');
  expect(isCompressionCommand('/压缩')).toBe(true);
  expect(isCompressionCommand('/压缩后继续')).toBe(false);
});

it('输入开头的指令和参数支持补全，光标在词中时替换整个词', () => {
  expect(composerShortcut('第一行\n/mod', 8)).toBeUndefined();
  expect(composerShortcut('\n  /mod', 7)).toMatchObject({ kind: 'command', query: 'mod', start: 3 });
  expect(composerShortcut('/model GPT', 10)).toMatchObject({
    kind: 'argument',
    query: 'GPT',
    command: { id: 'model' },
  });
  expect(composerShortcut('/skill demo 处理任务', 16)).toBeUndefined();
  expect(composerShortcut('参考 @note 尾部', 6)).toMatchObject({ kind: 'reference', query: 'no', start: 3, end: 8 });
  expect(composerShortcut('```\n/model', 10)).toBeUndefined();
  expect(composerShortcut('`@note', 6)).toBeUndefined();
  expect(isCompressionCommand('/compact 保留人物关系')).toBe(true);
});
