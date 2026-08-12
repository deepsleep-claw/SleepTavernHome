import { describe, expect, it } from 'vitest';
import { applyUnifiedPatch, createUnifiedPatch, summarizeUnifiedPatch } from './unified-patch';

describe('applyUnifiedPatch', () => {
  it('支持文件头、多Hunk、增删行与CRLF输入', () => {
    const patch = [
      '--- a/file.md',
      '+++ b/file.md',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '+TWO',
      '@@ -4,1 +4,2 @@',
      ' four',
      '+five',
    ].join('\r\n');
    expect(applyUnifiedPatch('one\r\ntwo\r\nthree\r\nfour\r\n', patch)).toBe('one\r\nTWO\r\nthree\r\nfour\r\nfive\r\n');
  });

  it('支持空文件插入且保留原文件换行约定', () => {
    expect(applyUnifiedPatch('', '@@ -0,0 +1,1 @@\n+first\n\\ No newline at end of file')).toBe('first');
    expect(applyUnifiedPatch('one\n', '@@ -1 +1,0 @@\n-one')).toBe('');
  });

  it('接受末尾换行，并在行号漂移时按精确上下文重新定位', () => {
    const patch = '@@ -2,2 +2,2 @@\n alpha\n-beta\n+BETA\n';
    expect(applyUnifiedPatch('preface\nalpha\nbeta\nomega\n', patch)).toBe('preface\nalpha\nBETA\nomega\n');
  });

  it('校验文件头，拒绝多文件和Git扩展操作', () => {
    expect(() =>
      applyUnifiedPatch('one\n', '--- a/other.md\n+++ b/other.md\n@@ -1 +1 @@\n-one\n+two\n', '/target.md'),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PATCH' }));
    expect(() =>
      applyUnifiedPatch(
        'one\n',
        '--- a/one.md\n+++ b/one.md\n@@ -1 +1 @@\n-one\n+two\n--- a/two.md\n+++ b/two.md\n@@ -1 +1 @@\n-a\n+b\n',
      ),
    ).toThrowError(/一个文件/u);
    expect(() =>
      applyUnifiedPatch('one\n', 'diff --git a/a.md b/b.md\nsimilarity index 100%\nrename from a.md\nrename to b.md\n'),
    ).toThrowError(/移动|Hunk/u);
  });

  it('生成可往返的正向和反向补丁及行数摘要', () => {
    const before = 'one\ntwo\nthree\n';
    const after = 'one\nTWO\nthree\nfour\n';
    const forward = createUnifiedPatch('/character/description.md', before, after);
    const inverse = createUnifiedPatch('/character/description.md', after, before);
    expect(applyUnifiedPatch(before, forward, '/character/description.md')).toBe(after);
    expect(applyUnifiedPatch(after, inverse, '/character/description.md')).toBe(before);
    expect(summarizeUnifiedPatch(forward, '/character/description.md')).toEqual({
      addedLines: 2,
      hunkCount: 1,
      removedLines: 1,
    });
  });

  it.each([
    ['   ', 'INVALID_PATCH'],
    ['not a patch', 'INVALID_PATCH'],
    ['@@ malformed @@\n+x', 'INVALID_PATCH'],
    ['@@ -1 +1 @@\n?bad', 'INVALID_PATCH'],
    ['@@ -4 +4 @@\n+x', 'INVALID_PATCH'],
    ['@@ -1 +1 @@\n-missing\n+new', 'INVALID_PATCH'],
  ])('拒绝非法或不匹配的Patch', (patch, code) => {
    expect(() => applyUnifiedPatch('one\ntwo', patch)).toThrowError(expect.objectContaining({ code }));
  });
});
