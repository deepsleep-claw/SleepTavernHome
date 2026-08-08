import { describe, expect, it } from 'vitest';
import { applyUnifiedPatch } from './unified-patch';

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
      '\\ No newline at end of file',
    ].join('\r\n');
    expect(applyUnifiedPatch('one\r\ntwo\r\nthree\r\nfour\r\n', patch)).toBe('one\nTWO\nthree\nfour\nfive\n');
  });

  it('支持空文件插入且保留原文件换行约定', () => {
    expect(applyUnifiedPatch('', '@@ -1,0 +1,1 @@\n+first')).toBe('first');
    expect(applyUnifiedPatch('one\n', '@@ -1 +1,0 @@\n-one')).toBe('');
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
