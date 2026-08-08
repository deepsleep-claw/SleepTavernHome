import { describe, expect, it } from 'vitest';
import {
  decodeWorkspaceSegment,
  encodeWorkspaceSegment,
  parseFrontmatter,
  parseKeyword,
  parseYamlObject,
  serializeFrontmatter,
  slugifyFileName,
} from './serde';

describe('mapping serde', () => {
  it('安全编码目录片段并保留常见可读名称', () => {
    expect(encodeWorkspaceSegment('学院/主书')).toBe('学院%2F主书');
    expect(decodeWorkspaceSegment('学院%2F主书')).toBe('学院/主书');
    expect(encodeWorkspaceSegment('..')).toBe('%2E%2E');
    expect(encodeWorkspaceSegment('a%b\\c')).toBe('a%25b%5Cc');
    expect(encodeWorkspaceSegment('\u0001')).toBe('%01');
    expect(decodeWorkspaceSegment('%00')).toBe('');
    expect(slugifyFileName('  /? ', 'entry')).toBe('entry');
  });

  it('Frontmatter允许正文继续包含分隔线', () => {
    const content = serializeFrontmatter({ name: '测试' }, '正文\n---\n后文');
    expect(parseFrontmatter(content, '/entry.md')).toEqual({ body: '正文\n---\n后文', metadata: { name: '测试' } });
  });

  it('拒绝非对象YAML、缺失Frontmatter和未知关键字', () => {
    expect(() => parseYamlObject('- one', '/bad.yaml')).toThrowError(expect.objectContaining({ code: 'INVALID_PATCH' }));
    expect(() => parseFrontmatter('plain', '/bad.md')).toThrowError(expect.objectContaining({ code: 'INVALID_PATCH' }));
    expect(() => parseKeyword({ type: 'unknown' }, '/bad.md')).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATCH' }),
    );
    expect(() => parseKeyword('plain', '/bad.md')).toThrowError(expect.objectContaining({ code: 'INVALID_PATCH' }));
  });
});
