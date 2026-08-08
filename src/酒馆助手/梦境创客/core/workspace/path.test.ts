import { describe, expect, it } from 'vitest';
import { isSameOrDescendant, normalizeWorkspacePath, parentWorkspacePath, workspaceBasename } from './path';

describe('workspace path', () => {
  it('统一为大小写敏感的POSIX绝对路径', () => {
    expect(normalizeWorkspacePath('character//./Description.md')).toBe('/character/Description.md');
    expect(normalizeWorkspacePath('/')).toBe('/');
    expect(isSameOrDescendant('/A/file.md', '/a')).toBe(false);
    expect(isSameOrDescendant('/a', '/a')).toBe(true);
    expect(isSameOrDescendant('/a/b', '/')).toBe(true);
    expect(isSameOrDescendant('/ab', '/a')).toBe(false);
  });

  it('提供父路径与文件名', () => {
    expect(parentWorkspacePath('/')).toBe('/');
    expect(parentWorkspacePath('/a')).toBe('/');
    expect(parentWorkspacePath('/a/b.md')).toBe('/a');
    expect(workspaceBasename('/')).toBe('/');
    expect(workspaceBasename('/a/b.md')).toBe('b.md');
  });

  it.each(['', '  ', '/a/../b', '/bad\nname', 'C:\\bad'])('拒绝非法路径 %j', value => {
    expect(() => normalizeWorkspacePath(value)).toThrowError(expect.objectContaining({ code: 'INVALID_PATH' }));
  });

  it('在运行时拒绝非字符串路径', () => {
    expect(() => normalizeWorkspacePath(null as unknown as string)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATH' }),
    );
  });
});
