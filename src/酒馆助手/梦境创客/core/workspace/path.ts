import { WorkspaceError } from './types';

function containsControlCharacter(value: string): boolean {
  return [...value].some(character => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

export function normalizeWorkspacePath(input: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new WorkspaceError('INVALID_PATH', '文件路径不能为空。', input);
  }
  if (containsControlCharacter(input) || input.includes('\\')) {
    throw new WorkspaceError('INVALID_PATH', `非法文件路径：${input}`, input);
  }

  const withRoot = input.startsWith('/') ? input : `/${input}`;
  const segments = withRoot.split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      throw new WorkspaceError('INVALID_PATH', `路径不能越过工作区根目录：${input}`, input);
    }
    normalized.push(segment);
  }
  return normalized.length === 0 ? '/' : `/${normalized.join('/')}`;
}

export function isSameOrDescendant(path: string, parent: string): boolean {
  const normalizedPath = normalizeWorkspacePath(path);
  const normalizedParent = normalizeWorkspacePath(parent);
  return normalizedParent === '/' || normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

export function parentWorkspacePath(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  if (normalized === '/') {
    return '/';
  }
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

export function workspaceBasename(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return normalized === '/' ? '/' : normalized.slice(normalized.lastIndexOf('/') + 1);
}
