import { describe, expect, it } from 'vitest';
import { applyContextPatch } from './context-patch';

const path = '/files/界面.js';
const patch = (body: string) => `*** Begin Patch\n*** Update File: ${path}\n${body}\n*** End Patch`;
const apply = (source: string, body: string) => applyContextPatch(source, patch(body), path);

describe('上下文补丁', () => {
  it('用小补丁修改六万行文件的多处内容，不依赖绝对行号', () => {
    const lines = Array.from({ length: 60_000 }, (_, index) => `const value${index} = ${index};`);
    const body =
      '@@\n-const value17 = 17;\n+const value17 = 18;\n@@\n-const value59980 = 59980;\n+const value59980 = 59981;';
    const content = ['// 新增的开头', ...lines, ''].join('\n');
    expect(apply(content, body)).toBe(
      content.replace('value17 = 17', 'value17 = 18').replace('value59980 = 59980', 'value59980 = 59981'),
    );
  });

  it('通过顺序锚点定位嵌套函数，并保留同名函数的其他内容', () => {
    const source = 'class A {\n  run() {\n    return 0;\n  }\n}\nclass B {\n  run() {\n    return 0;\n  }\n}\n';
    const result = apply(source, '@@ class B {\n@@   run() {\n-    return 0;\n+    return 1;');
    expect(result).toBe(source.replace('class B {\n  run() {\n    return 0;', 'class B {\n  run() {\n    return 1;'));
  });

  it('重复片段报告候选行，完整锚点选中其后的第一个片段', () => {
    const source = 'first\nold\nsecond\nold\n';
    expect(() => apply(source, '@@\n-old\n+new')).toThrow(/第1个片段.*第2、4行/u);
    expect(apply(source, '@@ first\n-old\n+new')).toBe('first\nnew\nsecond\nold\n');
    expect(apply(source, '@@ second\n-old\n+new')).toBe('first\nold\nsecond\nnew\n');
  });

  it('空行可直接作为上下文，新增与删除空行按前缀区分', () => {
    expect(apply('start\n\nold\nend\n', '@@\n start\n\n-old\n+new\n+\n end')).toBe('start\n\nnew\n\nend\n');
    expect(apply('start\n\nend\n', '@@\n start\n-\n end')).toBe('start\nend\n');
  });

  it('精确匹配优先，行尾空白可容错，保留未修改的上下文空白', () => {
    expect(apply('title  \nold\n', '@@\n title\n-old\n+new')).toBe('title  \nnew\n');
    expect(apply('old  \nold\n', '@@\n-old\n+new')).toBe('old  \nnew\n');
    expect(() => apply('  old\n', '@@\n-old\n+new')).toThrow(/上下文不匹配/u);
  });

  it('保留CRLF、混合换行和文件末尾换行约定', () => {
    expect(apply('one\r\ntwo\r\n', '@@\n-one\n+ONE')).toBe('ONE\r\ntwo\r\n');
    expect(apply('one\r\ntwo', '@@\n-two\n+TWO')).toBe('one\r\nTWO');
    expect(apply('one\r\ntwo\nthree', '@@\n-two\n+TWO')).toBe('one\r\nTWO\r\nthree');
    expect(apply('one\r\ntwo\nthree', '@@\n-three\n+THREE')).toBe('one\r\ntwo\nTHREE');
  });

  it('文件末尾标记限定最后一次匹配，也支持追加和空文件插入', () => {
    expect(apply('old\nkeep\nold\n', '@@\n-old\n+new\n*** End of File')).toBe('old\nkeep\nnew\n');
    expect(apply('tail', '@@\n+next\n*** End of File')).toBe('tail\nnext');
    expect(apply('', '@@\n+first')).toBe('first\n');
    expect(apply('tail\n', '@@ tail\n+next')).toBe('tail\nnext\n');
    expect(apply('only\n', '@@\n-only')).toBe('');
    expect(() => apply('old\nkeep\n', '@@\n-old\n+new\n*** End of File')).toThrow(/上下文不匹配/u);
  });

  it('上下文和删除内容不匹配时给出片段、原文与分段读取建议', () => {
    expect(() => apply('title\nchanged\n', '@@ title\n-old\n+new')).toThrow(
      /第1个片段.*补丁第3行.*old.*read_file offset=1 limit=30/u,
    );
    expect(() => apply('title\nold\n', '@@ missing\n-old\n+new')).toThrow(/找不到锚点.*missing.*search_files/u);
    const content = 'padding\n'.repeat(50_000) + 'unique title\nchanged\n';
    expect(() => apply(content, '@@\n unique title\n-old\n+new')).toThrow(/第50001行.*changed.*offset=49998/u);
  });

  it.each([
    ['@@\n+new', '插入位置'],
    ['@@\n old', '实际修改'],
    ['@@\n?wrong', '第4行缺少'],
    ['@@\n-old\n+new\n*** Update File: /files/other.md', '一个已有文件'],
    ['@@\n-old\n+new\n*** End of File\n@@\n+x', '最后一个片段末尾'],
  ])('拒绝不完整或含糊的片段：%s', (body, message) => {
    expect(() => apply('old\n', body)).toThrow(message);
  });

  it('校验补丁边界与目标路径', () => {
    expect(() => applyContextPatch('old\n', 'missing envelope', path)).toThrow(/Begin Patch/u);
    expect(() => applyContextPatch('old\n', patch('@@\n-old\n+new'), '/files/other.js')).toThrow(/文件头.*不一致/u);
  });
});
