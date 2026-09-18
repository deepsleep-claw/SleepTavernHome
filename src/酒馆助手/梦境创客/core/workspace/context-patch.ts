import { normalizeWorkspacePath } from './path';
import { WorkspaceError } from './types';

type PatchLine = { kind: ' ' | '+' | '-'; text: string };
type PatchHunk = { anchors: string[]; atEnd: boolean; lines: PatchLine[]; patchLine: number };
type SourceLine = { ending: string; text: string };
type LineIndex = Map<string, number[]>;

function invalid(message: string, path: string): never {
  throw new WorkspaceError('INVALID_PATCH', message, path);
}

function parseContextPatch(patch: string, path: string): PatchHunk[] {
  const lines = patch.replace(/\r\n?/gu, '\n').trim().split('\n');
  if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') {
    invalid('补丁须以*** Begin Patch开始、*** End Patch结束，内部使用*** Update File: 路径和@@上下文片段。', path);
  }
  const header = lines[1]?.match(/^\*\*\* Update File: (.+)$/u);
  if (!header) invalid('补丁第2行须为*** Update File: 路径。', path);
  if (normalizeWorkspacePath(header[1].trim()) !== normalizeWorkspacePath(path)) {
    invalid(`补丁文件头指向${header[1]}，与工具参数${path}不一致。`, path);
  }
  const hunks: PatchHunk[] = [];
  let hunk: PatchHunk = { anchors: [], atEnd: false, lines: [], patchLine: 3 };
  const finish = () => {
    if (!hunk.lines.some(line => line.kind !== ' ')) {
      invalid(`补丁第${hunk.patchLine}行开始的片段没有实际修改。`, path);
    }
    hunks.push(hunk);
  };
  for (let index = 2; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (hunk.atEnd) invalid(`补丁第${index + 1}行：*** End of File须位于最后一个片段末尾。`, path);
    if (line === '@@' || line.startsWith('@@ ')) {
      if (hunk.lines.length > 0) {
        finish();
        hunk = { anchors: [], atEnd: false, lines: [], patchLine: index + 1 };
      }
      if (line.startsWith('@@ ') && line.slice(3).trim() !== '') hunk.anchors.push(line.slice(3));
      continue;
    }
    if (line === '*** End of File') {
      hunk.atEnd = true;
      continue;
    }
    if (line.startsWith('*** ')) invalid(`补丁第${index + 1}行：一次调用只能修改一个已有文件。`, path);
    if (line === '') {
      hunk.lines.push({ kind: ' ', text: '' });
    } else if (line[0] === ' ' || line[0] === '+' || line[0] === '-') {
      hunk.lines.push({ kind: line[0], text: line.slice(1) });
    } else {
      invalid(`补丁第${index + 1}行缺少上下文空格、+或-前缀：${line.slice(0, 160)}`, path);
    }
  }
  finish();
  return hunks;
}

function sourceLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  for (const match of content.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/gu)) {
    if (match[0] === '') break;
    lines.push({ ending: match[2], text: match[1] });
  }
  return lines;
}

function indexLines(lines: SourceLine[], trimEnd: boolean): LineIndex {
  const result: LineIndex = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const text = trimEnd ? lines[index].text.trimEnd() : lines[index].text;
    const positions = result.get(text);
    if (positions) positions.push(index);
    else result.set(text, [index]);
  }
  return result;
}

function lowerBound(positions: number[], minimum: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (positions[mid] < minimum) low = mid + 1;
    else high = mid;
  }
  return low;
}

function locate(
  source: SourceLine[],
  index: LineIndex,
  expected: string[],
  from: number,
  atEnd: boolean,
  trimEnd: boolean,
  limit: number,
): number[] {
  const pattern = trimEnd ? expected.map(line => line.trimEnd()) : expected;
  const matches = (start: number) =>
    pattern.every((line, offset) => {
      const actual = source[start + offset].text;
      return line === (trimEnd ? actual.trimEnd() : actual);
    });
  if (atEnd) {
    const start = source.length - pattern.length;
    return start >= from && matches(start) ? [start] : [];
  }
  // 先用片段中最稀少的一行缩小候选范围，避免每个片段都扫描整份大文件。
  let positions: number[] | undefined;
  let offset = 0;
  for (let line = 0; line < pattern.length; line += 1) {
    const candidates = index.get(pattern[line]);
    if (!candidates) return [];
    if (!positions || candidates.length < positions.length) {
      positions = candidates;
      offset = line;
    }
  }
  if (!positions) return [];
  const found: number[] = [];
  for (let candidate = lowerBound(positions, from + offset); candidate < positions.length; candidate += 1) {
    const start = positions[candidate] - offset;
    if (start + pattern.length > source.length) break;
    if (matches(start)) found.push(start);
    if (found.length >= limit) break;
  }
  return found;
}

/** 以原文件为定位基准验证全部片段，再一次性生成结果；上下文保留原始空白与换行。 */
export function applyContextPatch(content: string, patch: string, path: string): string {
  const hunks = parseContextPatch(patch, path);
  const source = sourceLines(content);
  const exactIndex = indexLines(source, false);
  let whitespaceIndex: LineIndex | undefined;
  const find = (expected: string[], from: number, atEnd: boolean, limit: number) => {
    const exact = locate(source, exactIndex, expected, from, atEnd, false, limit);
    if (exact.length > 0) return exact;
    whitespaceIndex ??= indexLines(source, true);
    return locate(source, whitespaceIndex, expected, from, atEnd, true, limit);
  };
  const ending = source.find(line => line.ending !== '')?.ending ?? '\n';
  const output: SourceLine[] = [];
  let cursor = 0;
  for (let number = 0; number < hunks.length; number += 1) {
    const hunk = hunks[number];
    const label = `第${number + 1}个片段（补丁第${hunk.patchLine}行）`;
    let from = cursor;
    for (const anchor of hunk.anchors) {
      const [position] = find([anchor], from, false, 1);
      if (position === undefined) {
        invalid(
          `${label}找不到锚点${JSON.stringify(anchor.slice(0, 160))}。请用search_files查找完整原文行，再分段read_file。`,
          path,
        );
      }
      from = position + 1;
    }
    const expected = hunk.lines.filter(line => line.kind !== '+').map(line => line.text);
    let start: number;
    if (expected.length === 0) {
      if (hunk.atEnd) start = source.length;
      else if (hunk.anchors.length > 0 || source.length === 0) start = from;
      else invalid(`${label}仅有新增行，请提供插入位置的上下文、@@锚点或*** End of File。`, path);
    } else {
      const positions = find(expected, from, hunk.atEnd, hunk.anchors.length > 0 ? 1 : 5);
      if (positions.length === 0) {
        let nearby = from;
        let frequency = Infinity;
        for (let offset = 0; offset < expected.length; offset += 1) {
          if (!expected[offset].trim()) continue;
          const candidates = exactIndex.get(expected[offset]) ?? whitespaceIndex?.get(expected[offset].trimEnd());
          if (!candidates || candidates.length >= frequency) continue;
          const candidate = candidates[lowerBound(candidates, from + offset)];
          if (candidate !== undefined) {
            nearby = candidate - offset;
            frequency = candidates.length;
          }
        }
        const excerpt = expected
          .slice(0, 3)
          .map(line => line.slice(0, 160))
          .join('\n');
        const actual = source
          .slice(nearby, nearby + 3)
          .map(line => line.text.slice(0, 160))
          .join('\n');
        invalid(
          `${label}上下文不匹配，期望${JSON.stringify(excerpt)}，文件第${nearby + 1}行附近实际为${JSON.stringify(actual)}。可用read_file offset=${Math.max(1, nearby - 2)} limit=30读取定位区域；各片段须按文件顺序且不重叠。`,
          path,
        );
      }
      if (positions.length > 1) {
        invalid(
          `${label}有多个匹配位置：文件第${positions.map(position => position + 1).join('、')}行。请增加上下文或使用@@完整原文行作为锚点。`,
          path,
        );
      }
      start = positions[0];
    }
    for (; cursor < start; cursor += 1) output.push(source[cursor]);
    for (const line of hunk.lines) {
      if (line.kind === '+') output.push({ ending, text: line.text });
      else {
        if (line.kind === ' ') output.push(source[cursor]);
        cursor += 1;
      }
    }
  }
  for (; cursor < source.length; cursor += 1) output.push(source[cursor]);
  const finalEnding = source.at(-1)?.ending ?? ending;
  return output
    .map((line, index) => line.text + (index === output.length - 1 ? finalEnding : line.ending || ending))
    .join('');
}
