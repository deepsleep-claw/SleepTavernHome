import { parse, stringify } from 'yaml';
import { WorkspaceError } from '../workspace/types';
import type { WorldbookKeyword } from './types';

export type SerializedKeyword =
  | { type: 'regex'; flags: string; pattern: string }
  | { type: 'text'; value: string };

export function encodeWorkspaceSegment(value: string): string {
  const encoded = [...value]
    .map(character => {
      const code = character.codePointAt(0) ?? 0;
      return character === '%' || character === '/' || character === '\\' || code <= 0x1f || code === 0x7f
        ? `%${code.toString(16).toUpperCase().padStart(2, '0')}`
        : character;
    })
    .join('');
  if (encoded === '' || encoded === '.' || encoded === '..') {
    return [...value].map(character => `%${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()}`).join('') || '%00';
  }
  return encoded;
}

export function decodeWorkspaceSegment(value: string): string {
  if (value === '%00') {
    return '';
  }
  return value.replace(/%([\dA-F]{2,6})/giu, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

export function slugifyFileName(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  return slug || fallback;
}

export function serializeYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0, sortMapEntries: true }).trimEnd() + '\n';
}

export function parseYamlObject(content: string, path: string): Record<string, unknown> {
  try {
    const value: unknown = parse(content);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('内容必须是YAML对象。');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new WorkspaceError('INVALID_PATCH', `无法解析${path}：${error instanceof Error ? error.message : String(error)}`, path);
  }
}

export function serializeFrontmatter(metadata: Record<string, unknown>, body: string): string {
  return `---\n${serializeYaml(metadata)}---\n${body}`;
}

export function parseFrontmatter(content: string, path: string): { body: string; metadata: Record<string, unknown> } {
  const normalized = content.replace(/\r\n?/gu, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/u);
  if (!match) {
    throw new WorkspaceError('INVALID_PATCH', `文件缺少合法的YAML Frontmatter：${path}`, path);
  }
  return { body: match[2], metadata: parseYamlObject(match[1], path) };
}

export function serializeKeyword(keyword: WorldbookKeyword): SerializedKeyword {
  return keyword instanceof RegExp
    ? { flags: keyword.flags, pattern: keyword.source, type: 'regex' }
    : { type: 'text', value: keyword };
}

export function parseKeyword(value: unknown, path: string): WorldbookKeyword {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkspaceError('INVALID_PATCH', `关键字必须是结构化对象：${path}`, path);
  }
  const item = value as Record<string, unknown>;
  if (item.type === 'text' && typeof item.value === 'string') {
    return item.value;
  }
  if (item.type === 'regex' && typeof item.pattern === 'string' && typeof item.flags === 'string') {
    try {
      return new RegExp(item.pattern, item.flags);
    } catch (error) {
      throw new WorkspaceError(
        'INVALID_PATTERN',
        `无效的正则关键字：${error instanceof Error ? error.message : String(error)}`,
        path,
      );
    }
  }
  throw new WorkspaceError('INVALID_PATCH', `无法识别的关键字结构：${path}`, path);
}
