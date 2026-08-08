import { WorkspaceError } from './types';

type Hunk = {
  lines: string[];
  newStart: number;
  oldStart: number;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

function parseHunks(input: string): Hunk[] {
  const lines = input.replace(/\r\n?/gu, '\n').split('\n');
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;

  for (const line of lines) {
    const header = line.match(HUNK_HEADER);
    if (header) {
      current = { lines: [], newStart: Number(header[2]), oldStart: Number(header[1]) };
      hunks.push(current);
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line === '\\ No newline at end of file') {
      continue;
    }
    if (!current) {
      if (line.trim() === '') {
        continue;
      }
      throw new WorkspaceError('INVALID_PATCH', 'Patch缺少合法的Hunk头。');
    }
    if (![' ', '+', '-'].includes(line[0] ?? '')) {
      throw new WorkspaceError('INVALID_PATCH', `无法识别的Patch行：${line}`);
    }
    current.lines.push(line);
  }

  if (hunks.length === 0) {
    throw new WorkspaceError('INVALID_PATCH', 'Patch中没有可应用的修改。');
  }
  return hunks;
}

export function applyUnifiedPatch(content: string, patch: string): string {
  const hadTrailingNewline = content.endsWith('\n');
  const source = content === '' ? [] : content.replace(/\r\n?/gu, '\n').split('\n');
  if (hadTrailingNewline) {
    source.pop();
  }
  let offset = 0;

  for (const hunk of parseHunks(patch)) {
    const start = hunk.oldStart - 1 + offset;
    if (start < 0 || start > source.length) {
      throw new WorkspaceError('INVALID_PATCH', `Patch定位超出文件范围：旧文件第${hunk.oldStart}行。`);
    }

    const replacement: string[] = [];
    let cursor = start;
    for (const line of hunk.lines) {
      const marker = line[0];
      const text = line.slice(1);
      if (marker === ' ' || marker === '-') {
        if (source[cursor] !== text) {
          throw new WorkspaceError(
            'INVALID_PATCH',
            `Patch上下文不匹配：期望“${text}”，实际为“${source[cursor] ?? '<文件结尾>'}”。`,
          );
        }
        if (marker === ' ') {
          replacement.push(text);
        }
        cursor += 1;
      } else {
        replacement.push(text);
      }
    }
    const removed = cursor - start;
    source.splice(start, removed, ...replacement);
    offset += replacement.length - removed;
  }

  const result = source.join('\n');
  return hadTrailingNewline && result !== '' ? `${result}\n` : result;
}
