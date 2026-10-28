import { normalizeWorkspacePath } from './path';
import { WorkspaceError, type SearchMatch, type SearchQuery, type SearchResult, type WorkspaceFile } from './types';

export const MAX_SEARCH_LINE_CHARACTERS = 2_000;
export const MAX_SEARCH_OUTPUT_CHARACTERS = 24_000;
const SEARCH_LIMIT_WARNING =
  '搜索结果已截断，超长行仅显示匹配附近的片段。请缩小路径、关键词或上下文范围后继续查找；片段不能作为完整原文行直接替换。';

function excerpt(text: string, column = 1): { text: string; start: number; truncated: boolean } {
  if (text.length <= MAX_SEARCH_LINE_CHARACTERS) return { text, start: 0, truncated: false };
  let start = Math.min(
    Math.max(0, column - 1 - Math.floor(MAX_SEARCH_LINE_CHARACTERS / 2)),
    text.length - MAX_SEARCH_LINE_CHARACTERS,
  );
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start])) start -= 1;
  let end = Math.min(text.length, start + MAX_SEARCH_LINE_CHARACTERS);
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end -= 1;
  return { text: text.slice(start, end), start, truncated: true };
}

function fitContext(match: SearchMatch, budget: number): number {
  let size = JSON.stringify(match).length + 1;
  // 优先保留命中行，并从距离命中最远的前后文开始缩减。
  while (size > budget && (match.contextBefore.length || match.contextAfter.length)) {
    if (match.contextBefore.length >= match.contextAfter.length) match.contextBefore.shift();
    else match.contextAfter.pop();
    match.contextTruncated = true;
    size = JSON.stringify(match).length + 1;
  }
  return size;
}

export function limitSearchResult(result: SearchResult): SearchResult {
  const matches: SearchMatch[] = [];
  let characters = 512;
  let truncated = result.truncated;
  for (const match of result.matches) {
    const startColumn = match.textStartColumn ?? 1;
    const text = excerpt(match.text, match.column - startColumn + 1);
    const before = match.contextBefore.map(line => excerpt(line));
    const after = match.contextAfter.map(line => excerpt(line));
    const textTruncated = text.truncated || match.textTruncated;
    const contextTruncated = match.contextTruncated || [...before, ...after].some(line => line.truncated);
    const bounded: SearchMatch = {
      ...match,
      text: text.text,
      contextBefore: before.map(line => line.text),
      contextAfter: after.map(line => line.text),
      ...(textTruncated ? { textTruncated: true, textStartColumn: startColumn + text.start } : {}),
      ...(contextTruncated ? { contextTruncated: true } : {}),
    };
    const size = fitContext(bounded, MAX_SEARCH_OUTPUT_CHARACTERS - characters);
    if (characters + size > MAX_SEARCH_OUTPUT_CHARACTERS) {
      truncated = true;
      break;
    }
    characters += size;
    matches.push(bounded);
    truncated ||= Boolean(textTruncated || bounded.contextTruncated);
  }
  return {
    matchedFiles: new Set(matches.map(match => match.path)).size,
    matches,
    returnedMatches: matches.length,
    truncated,
    ...(truncated ? { warning: SEARCH_LIMIT_WARNING } : {}),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function globToRegex(glob: string): RegExp {
  if (glob.includes('..') || glob.includes('\\')) {
    throw new WorkspaceError('INVALID_GLOB', `非法Glob：${glob}`);
  }
  let pattern = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] === '*') {
        index += 1;
        if (glob[index + 1] === '/') {
          index += 1;
          pattern += '(?:.*/)?';
        } else {
          pattern += '.*';
        }
      } else {
        pattern += '[^/]*';
      }
    } else if (character === '?') {
      pattern += '[^/]';
    } else {
      pattern += escapeRegex(character);
    }
  }
  return new RegExp(`${pattern}$`, 'u');
}

export function searchWorkspaceFiles(files: Iterable<WorkspaceFile>, query: SearchQuery): SearchResult {
  const root = normalizeWorkspacePath(query.path ?? '/');
  const defaultContext = Math.min(5, Math.max(0, query.contextLines ?? 0));
  const contextBefore = Math.min(5, Math.max(0, query.contextBefore ?? defaultContext));
  const contextAfter = Math.min(5, Math.max(0, query.contextAfter ?? defaultContext));
  const maxResults = Math.min(500, Math.max(1, query.maxResults ?? 100));
  const flags = query.caseSensitive ? 'u' : 'iu';
  const regexMode = query.mode === 'regex';
  let expression: RegExp;
  try {
    const source = regexMode ? query.pattern : escapeRegex(query.pattern);
    expression = new RegExp(query.wordMatch ? `\\b(?:${source})\\b` : source, flags);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new WorkspaceError(
      'INVALID_PATTERN',
      `无效正则：${detail}。若要搜索普通符号，请使用mode="literal"；只有正则表达式才使用mode="regex"。`,
    );
  }
  const compileGlobs = (value?: string | string[]) =>
    (value ? (Array.isArray(value) ? value : [value]) : []).map(item => globToRegex(item.replace(/^\/+/, '')));
  const includeGlobs = compileGlobs(query.glob);
  const excludeGlobs = compileGlobs(query.excludeGlob);
  const matches: SearchMatch[] = [];
  const matchedFiles = new Set<string>();
  let truncated = false;
  let resultCharacters = 512;

  const sortedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
  outer: for (const file of sortedFiles) {
    if (!(file.path === root || file.path.startsWith(`${root === '/' ? '' : root}/`))) {
      continue;
    }
    const relativePath = file.path.slice(1);
    if (includeGlobs.length > 0 && !includeGlobs.some(glob => glob.test(relativePath))) {
      continue;
    }
    if (excludeGlobs.some(glob => glob.test(relativePath))) {
      continue;
    }
    const lines = file.content.replace(/\r\n?/gu, '\n').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const match = expression.exec(lines[index]);
      if (!match) {
        continue;
      }
      const text = excerpt(lines[index], (match.index ?? 0) + 1);
      const before = lines.slice(Math.max(0, index - contextBefore), index).map(line => excerpt(line));
      const after = lines.slice(index + 1, index + 1 + contextAfter).map(line => excerpt(line));
      const candidate: SearchMatch = {
        column: (match.index ?? 0) + 1,
        contextAfter: after.map(line => line.text),
        contextBefore: before.map(line => line.text),
        line: index + 1,
        path: file.path,
        text: text.text,
        ...(text.truncated ? { textTruncated: true, textStartColumn: text.start + 1 } : {}),
        ...([...before, ...after].some(line => line.truncated) ? { contextTruncated: true } : {}),
      };
      const size = fitContext(candidate, MAX_SEARCH_OUTPUT_CHARACTERS - resultCharacters);
      if (resultCharacters + size > MAX_SEARCH_OUTPUT_CHARACTERS) {
        truncated = true;
        break outer;
      }
      resultCharacters += size;
      matchedFiles.add(file.path);
      matches.push(candidate);
      if (matches.length >= maxResults) {
        truncated = true;
        break outer;
      }
    }
  }

  return limitSearchResult({ matchedFiles: matchedFiles.size, matches, returnedMatches: matches.length, truncated });
}
