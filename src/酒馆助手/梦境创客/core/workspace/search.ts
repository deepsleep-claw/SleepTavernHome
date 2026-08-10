import { normalizeWorkspacePath } from './path';
import { WorkspaceError, type SearchMatch, type SearchQuery, type SearchResult, type WorkspaceFile } from './types';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function globToRegex(glob: string): RegExp {
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
  const regexMode = query.mode === 'regex' || (query.mode === undefined && query.fixedStrings === false);
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
      matchedFiles.add(file.path);
      matches.push({
        column: (match.index ?? 0) + 1,
        contextAfter: lines.slice(index + 1, index + 1 + contextAfter),
        contextBefore: lines.slice(Math.max(0, index - contextBefore), index),
        line: index + 1,
        path: file.path,
        text: lines[index],
      });
      if (matches.length >= maxResults) {
        truncated = true;
        break outer;
      }
    }
  }

  return { matchedFiles: matchedFiles.size, matches, returnedMatches: matches.length, truncated };
}
