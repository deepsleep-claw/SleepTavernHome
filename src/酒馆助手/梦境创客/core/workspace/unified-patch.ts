import {
  applyPatch,
  createTwoFilesPatch,
  FILE_HEADERS_ONLY,
  parsePatch,
  type StructuredPatch,
} from 'diff';
import { normalizeWorkspacePath } from './path';
import { WorkspaceError } from './types';

export type UnifiedPatchSummary = {
  addedLines: number;
  hunkCount: number;
  removedLines: number;
};

function normalizeHeaderPath(input: string): string {
  const withoutPrefix = input.replace(/^[ab]\//u, '');
  return normalizeWorkspacePath(withoutPrefix.startsWith('/') ? withoutPrefix : `/${withoutPrefix}`);
}

function rejectUnsupportedPatch(index: StructuredPatch, expectedPath?: string): void {
  if (index.isBinary) {
    throw new WorkspaceError('INVALID_PATCH', 'apply_patch不支持二进制Patch。', expectedPath);
  }
  if (
    index.isRename ||
    index.isCopy ||
    index.isCreate ||
    index.isDelete ||
    index.oldMode !== undefined ||
    index.newMode !== undefined
  ) {
    throw new WorkspaceError(
      'INVALID_PATCH',
      'apply_patch只修改一个已有文本文件；创建、删除、移动、复制或修改文件模式请使用对应文件工具。',
      expectedPath,
    );
  }
  if (index.hunks.length === 0) {
    throw new WorkspaceError('INVALID_PATCH', 'Patch中没有可应用的Hunk。', expectedPath);
  }
  if (
    index.hunks.some(
      hunk =>
        !Number.isFinite(hunk.oldStart) ||
        !Number.isFinite(hunk.newStart) ||
        !Number.isFinite(hunk.oldLines) ||
        !Number.isFinite(hunk.newLines),
    )
  ) {
    throw new WorkspaceError('INVALID_PATCH', 'Patch包含不合法的Hunk头。', expectedPath);
  }
  if (!index.hunks.some(hunk => hunk.lines.some(line => line.startsWith('+') || line.startsWith('-')))) {
    throw new WorkspaceError('INVALID_PATCH', 'Patch中没有实际修改。', expectedPath);
  }
  if (!expectedPath) return;
  const normalizedExpected = normalizeWorkspacePath(expectedPath);
  for (const headerPath of [index.oldFileName, index.newFileName]) {
    if (!headerPath) continue;
    if (headerPath === '/dev/null') {
      throw new WorkspaceError('INVALID_PATCH', 'apply_patch不能创建或删除文件。', normalizedExpected);
    }
    if (normalizeHeaderPath(headerPath) !== normalizedExpected) {
      throw new WorkspaceError(
        'INVALID_PATCH',
        `Patch文件头指向${headerPath}，与工具参数${normalizedExpected}不一致。`,
        normalizedExpected,
      );
    }
  }
}

export function parseUnifiedPatch(patch: string, expectedPath?: string): StructuredPatch {
  let parsed: StructuredPatch[];
  try {
    parsed = parsePatch(patch);
  } catch (error) {
    throw new WorkspaceError(
      'INVALID_PATCH',
      `无法解析Unified Diff：${error instanceof Error ? error.message : String(error)}`,
      expectedPath,
    );
  }
  if (parsed.length !== 1) {
    throw new WorkspaceError('INVALID_PATCH', '一次apply_patch只能包含一个文件。', expectedPath);
  }
  const [index] = parsed;
  rejectUnsupportedPatch(index, expectedPath);
  return index;
}

/**
 * 严格应用标准Unified Diff。
 *
 * fuzzFactor保持为0：上下文和删除行必须精确匹配；但允许Hunk在行号漂移后按精确上下文重新定位。
 */
export function applyUnifiedPatch(content: string, patch: string, expectedPath?: string): string {
  const index = parseUnifiedPatch(patch, expectedPath);
  const sourceLineCount = content === '' ? 0 : content.split(/\r\n|\n|\r/u).length - (/[\r\n]$/u.test(content) ? 1 : 0);
  if (index.hunks.some(hunk => hunk.oldStart > sourceLineCount + (hunk.oldLines > 0 ? 0 : 1))) {
    throw new WorkspaceError('INVALID_PATCH', 'Patch定位超出当前文件范围。', expectedPath);
  }
  const result = applyPatch(content, index, { autoConvertLineEndings: true, fuzzFactor: 0 });
  if (result === false) {
    throw new WorkspaceError(
      'INVALID_PATCH',
      'Patch无法应用：文件内容已变化，或Hunk上下文与当前文件不匹配。请重新读取文件后生成新Patch。',
      expectedPath,
    );
  }
  const withoutCrlf = content.replace(/\r\n/gu, '');
  if (content.includes('\r\n') && !withoutCrlf.includes('\n') && !withoutCrlf.includes('\r')) {
    return result.replace(/\r\n?|\n/gu, '\n').replace(/\n/gu, '\r\n');
  }
  return result;
}

/** 为操作日志、Diff和Undo生成训练数据中最常见的标准Unified Diff。 */
export function createUnifiedPatch(path: string, before: string, after: string): string {
  const normalizedPath = normalizeWorkspacePath(path);
  return createTwoFilesPatch(normalizedPath, normalizedPath, before, after, '', '', {
    context: 3,
    headerOptions: FILE_HEADERS_ONLY,
  });
}

export function summarizeUnifiedPatch(patch: string, expectedPath?: string): UnifiedPatchSummary {
  const index = parseUnifiedPatch(patch, expectedPath);
  let addedLines = 0;
  let removedLines = 0;
  for (const hunk of index.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) addedLines += 1;
      else if (line.startsWith('-')) removedLines += 1;
    }
  }
  return { addedLines, hunkCount: index.hunks.length, removedLines };
}
