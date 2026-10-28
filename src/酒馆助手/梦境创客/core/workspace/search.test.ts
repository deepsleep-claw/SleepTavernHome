import { describe, expect, it } from 'vitest';
import { searchWorkspaceFiles, MAX_SEARCH_LINE_CHARACTERS, MAX_SEARCH_OUTPUT_CHARACTERS } from './search';
import type { WorkspaceFile } from './types';

const searchFiles: WorkspaceFile[] = [
  {
    content: 'Alpha\nbeta\nALPHA\nasterisk * and [literal]',
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
  it('超长匹配行只返回命中附近片段并保留原始行列位置', () => {
    const prefix = '中'.repeat(1_200_000);
    const result = searchWorkspaceFiles([{ ...searchFiles[0], content: prefix + 'TARGET' + '尾'.repeat(10_000) }], {
      pattern: 'TARGET',
    });
    expect(result.truncated).toBe(true);
    expect(result.matches[0]).toMatchObject({ line: 1, column: prefix.length + 1, textTruncated: true });
    expect(result.matches[0].text).toContain('TARGET');
    expect(result.matches[0].text.length).toBeLessThanOrEqual(MAX_SEARCH_LINE_CHARACTERS);
    expect(result.matches[0].textStartColumn).toBeGreaterThan(1);
  });
  it('上下文长行和大量命中同时受总输出限额约束', () => {
    const content = Array.from({ length: 120 }, (_, index) => `${index} TARGET ${'中'.repeat(20_000)}`).join('\n');
    const result = searchWorkspaceFiles([{ ...searchFiles[0], content }], {
      pattern: 'TARGET',
      contextLines: 5,
      maxResults: 500,
    });
    expect(result.truncated).toBe(true);
    expect(result.returnedMatches).toBeGreaterThan(0);
    expect(result.returnedMatches).toBeLessThan(120);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_SEARCH_OUTPUT_CHARACTERS);
    for (const match of result.matches)
      for (const line of [match.text, ...match.contextBefore, ...match.contextAfter])
        expect(line.length).toBeLessThanOrEqual(MAX_SEARCH_LINE_CHARACTERS);
  });
  it('前后文序列化超过限额时仍保留实际命中与最近的上下文', () => {
    const before = Array.from({ length: 5 }, (_, index) => `before-${index} ${'\t'.repeat(10_000)}`);
    const after = Array.from({ length: 5 }, (_, index) => `after-${index} ${'\t'.repeat(10_000)}`);
    const result = searchWorkspaceFiles([{ ...searchFiles[0], content: [...before, 'TARGET', ...after].join('\n') }], {
      pattern: 'TARGET',
      contextLines: 5,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ text: 'TARGET', line: 6, contextTruncated: true });
    expect(result.matches[0].contextBefore.at(-1)).toContain('before-4');
    expect(result.matches[0].contextAfter[0]).toContain('after-0');
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_SEARCH_OUTPUT_CHARACTERS);
  });
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
    expect(result.matches[0].contextAfter).toEqual(['beta', 'ALPHA', 'asterisk * and [literal]']);
  });

  it('默认按普通文本搜索，并仅在显式指定时启用正则', () => {
    expect(searchWorkspaceFiles(searchFiles, { pattern: '*' }).matches).toHaveLength(1);
    expect(searchWorkspaceFiles(searchFiles, { pattern: '[literal]' }).matches).toHaveLength(1);

    const regex = searchWorkspaceFiles(searchFiles, {
      caseSensitive: true,
      mode: 'regex',
      pattern: '^Alpha$',
    });
    expect(regex.matches).toEqual([expect.objectContaining({ line: 1, path: '/a/one.txt' })]);
  });

  it('支持多组包含Glob、排除Glob与独立的前后文行数', () => {
    const result = searchWorkspaceFiles(searchFiles, {
      contextAfter: 0,
      contextBefore: 1,
      excludeGlob: 'b/**',
      glob: ['**/*.txt', '**/*.md'],
      pattern: 'alpha',
    });
    expect(result.matchedFiles).toBe(2);
    expect(result.matches).toHaveLength(3);
    expect(result.matches).toContainEqual(
      expect.objectContaining({ contextAfter: [], contextBefore: ['beta'], line: 3, path: '/a/one.txt' }),
    );
  });

  it('报告非法正则和Glob', () => {
    expect(() => searchWorkspaceFiles(searchFiles, { mode: 'regex', pattern: '[' })).toThrowError(
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
