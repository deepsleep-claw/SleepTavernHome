import { describe, expect, it } from 'vitest';
import { searchWorkspaceFiles } from './search';
import type { WorkspaceFile } from './types';

const searchFiles: WorkspaceFile[] = [
  {
    content: 'Alpha\nbeta\nALPHA',
    mediaType: 'text/plain',
    path: '/a/one.txt',
    readonly: false,
    resourceId: 'one',
  },
  {
    content: 'alpha in markdown',
    mediaType: 'text/markdown',
    path: '/a/nested/two.md',
    readonly: false,
    resourceId: 'two',
  },
  {
    content: 'alpha outside',
    mediaType: 'text/plain',
    path: '/b/three.txt',
    readonly: false,
    resourceId: 'three',
  },
];

describe('searchWorkspaceFiles', () => {
  it('处理大小写、路径、问号与单星Glob', () => {
    const result = searchWorkspaceFiles(searchFiles, {
      caseSensitive: true,
      glob: 'a/*.txt',
      path: '/a',
      pattern: 'Alpha',
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ column: 1, line: 1, path: '/a/one.txt' });

    expect(searchWorkspaceFiles(searchFiles, { glob: 'a/one.tx?', pattern: 'alpha' }).matches).toHaveLength(2);
    expect(searchWorkspaceFiles(searchFiles, { glob: '**/*.md', pattern: 'alpha' }).matches).toHaveLength(1);
    expect(searchWorkspaceFiles(searchFiles, { glob: 'a/**.md', pattern: 'alpha' }).matches).toHaveLength(1);
  });

  it('限制上下文与结果数量并忽略根外文件', () => {
    const result = searchWorkspaceFiles(searchFiles, {
      contextLines: 999,
      maxResults: 0,
      path: '/a/one.txt',
      pattern: 'alpha',
    });
    expect(result).toMatchObject({ matchedFiles: 1, returnedMatches: 1, truncated: true });
    expect(result.matches[0].contextAfter).toEqual(['beta', 'ALPHA']);
  });

  it('报告非法正则和Glob', () => {
    expect(() => searchWorkspaceFiles(searchFiles, { pattern: '[' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATTERN' }),
    );
    expect(() => searchWorkspaceFiles(searchFiles, { glob: '../*.md', pattern: 'x' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_GLOB' }),
    );
    expect(() => searchWorkspaceFiles(searchFiles, { glob: 'a\\*.md', pattern: 'x' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_GLOB' }),
    );
  });
});
