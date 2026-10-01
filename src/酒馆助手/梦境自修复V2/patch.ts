export type Patch = {
  index: number;
  find?: string;
  head?: string;
  tail?: string;
  replace: string;
  block: boolean;
};

export type PatchRecord = {
  patch_index: number;
  index: number;
  before: string;
  after: string;
  left: string;
  right: string;
  reverted: boolean;
};

type Range = { start: number; end: number };
type Edit = Range & { patch: Patch };

export function reportRanges(message: string): Range[] {
  return [...message.matchAll(/<dream_self_check\b[^>]*>[\s\S]*?<\/dream_self_check>/gi)].map(match => ({
    start: match.index!,
    end: match.index! + match[0].length,
  }));
}

export function stripReports(message: string): string {
  return message.replace(/<dream_self_check\b[^>]*>[\s\S]*?<\/dream_self_check>/gi, '');
}

export function parsePatches(text: string): { patches: Patch[]; errors: string[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const patches: Patch[] = [];
  const errors: string[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < lines.length) {
    if (!lines[cursor].trim()) {
      cursor++;
      continue;
    }
    const current = index++;
    const first = lines[cursor++].match(/^\s*(FIND|HEAD):[ \t]*(.*?)\s*$/i);
    if (!first || !first[2]) {
      errors.push(`补丁 ${current + 1} 缺少有效的 FIND 或 HEAD。`);
      continue;
    }
    const patch: Patch = { index: current, replace: '', block: false };
    if (first[1].toUpperCase() === 'FIND') {
      patch.find = first[2];
    } else {
      patch.head = first[2];
      const tail = lines[cursor]?.match(/^\s*TAIL:[ \t]*(.*?)\s*$/i);
      if (!tail?.[1]) {
        errors.push(`补丁 ${current + 1} 缺少 TAIL。`);
        continue;
      }
      cursor++;
      patch.tail = tail[1];
    }
    if (/^\s*<REPLACE_BLOCK>\s*$/i.test(lines[cursor] ?? '')) {
      patch.block = true;
      cursor++;
      const start = cursor;
      while (cursor < lines.length && !/^\s*<\/REPLACE_BLOCK>\s*$/i.test(lines[cursor])) cursor++;
      if (cursor === lines.length) {
        errors.push(`补丁 ${current + 1} 的 REPLACE_BLOCK 未闭合。`);
        break;
      }
      patch.replace = lines.slice(start, cursor++).join('\n');
    } else {
      const replacement = lines[cursor]?.match(/^\s*REPLACE:[ \t]?(.*)$/i);
      if (!replacement) {
        errors.push(`补丁 ${current + 1} 缺少 REPLACE。`);
        continue;
      }
      cursor++;
      patch.replace = replacement[1];
    }
    // 非块模式的后续正文不能被误当作已完成的单行补丁。
    let next = cursor;
    while (next < lines.length && !lines[next].trim()) next++;
    if (next < lines.length && !/^\s*(FIND|HEAD):/i.test(lines[next])) {
      errors.push(`补丁 ${current + 1} 含有未包裹的多行内容。`);
      while (cursor < lines.length && !/^\s*(FIND|HEAD):/i.test(lines[cursor])) cursor++;
      continue;
    }
    patches.push(patch);
  }
  return { patches, errors };
}

function occurrences(text: string, needle: string): number[] {
  if (!needle) return [];
  const result: number[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) result.push(i);
  return result;
}

function paragraphs(message: string): Range[] {
  const result: Range[] = [];
  for (const line of message.matchAll(/[^\r\n]+/g)) {
    const add = (text: string, offset: number) => {
      const trimmed = text.trim();
      if (trimmed)
        result.push({ start: offset + text.indexOf(trimmed), end: offset + text.indexOf(trimmed) + trimmed.length });
    };
    add(line[0], line.index!);
    const opening = line[0].match(/^\s*<(?:dream_body|dream_plot|dream_parallel_event)\b[^>]*>/i);
    const closing = line[0].match(/<\/(?:dream_body|dream_plot|dream_parallel_event)>\s*$/i);
    if (opening || closing) {
      const start = opening?.[0].length ?? 0;
      const end = closing?.index ?? line[0].length;
      if (end > start) add(line[0].slice(start, end), line.index! + start);
    }
  }
  return result;
}

function intersects(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

export function applyPatches(message: string, patch_text: string) {
  const parsed = parsePatches(patch_text);
  const errors = [...parsed.errors];
  const protected_ranges = reportRanges(message);
  const edits: Edit[] = [];
  for (const patch of parsed.patches) {
    const matches: Range[] = [];
    if (patch.block && patch.head && patch.tail) {
      const heads = occurrences(message, patch.head).filter(
        start => !protected_ranges.some(range => start >= range.start && start < range.end),
      );
      const tails = occurrences(message, patch.tail).filter(
        start => !protected_ranges.some(range => intersects({ start, end: start + patch.tail!.length }, range)),
      );
      for (const [i, start] of heads.entries()) {
        const ends = tails.filter(
          end => end >= start + patch.head!.length && end + patch.tail!.length <= (heads[i + 1] ?? message.length),
        );
        if (ends.length === 1) matches.push({ start, end: ends[0] + patch.tail.length });
        else if (ends.length > 1) errors.push(`补丁 ${patch.index + 1} 的首尾配对有歧义。`);
      }
    } else {
      for (const range of paragraphs(message)) {
        const value = message.slice(range.start, range.end);
        if (patch.find ? value === patch.find : value.startsWith(patch.head!) && value.endsWith(patch.tail!))
          matches.push(range);
      }
    }
    const allowed = matches.filter(
      range => !protected_ranges.some(protected_range => intersects(range, protected_range)),
    );
    if (allowed.length === 0) errors.push(`补丁 ${patch.index + 1} 未匹配到可替换内容。`);
    for (const range of allowed) {
      if (message.slice(range.start, range.end) === patch.replace) continue;
      if (
        !edits.some(
          edit => edit.start === range.start && edit.end === range.end && edit.patch.replace === patch.replace,
        )
      )
        edits.push({ ...range, patch });
    }
  }
  const conflicts = new Set<Edit>();
  for (let i = 0; i < edits.length; i++) {
    for (let j = i + 1; j < edits.length; j++) {
      if (intersects(edits[i], edits[j])) {
        conflicts.add(edits[i]);
        conflicts.add(edits[j]);
      }
    }
  }
  for (const index of new Set([...conflicts].map(edit => edit.patch.index)))
    errors.push(`补丁 ${index + 1} 与其他补丁重叠。`);
  const accepted = edits.filter(edit => !conflicts.has(edit)).sort((a, b) => a.start - b.start);
  let result = message;
  for (const edit of [...accepted].reverse())
    result = result.slice(0, edit.start) + edit.patch.replace + result.slice(edit.end);
  let shift = 0;
  const records: PatchRecord[] = accepted.map(edit => {
    const index = edit.start + shift;
    shift += edit.patch.replace.length - (edit.end - edit.start);
    return {
      patch_index: edit.patch.index,
      index,
      before: message.slice(edit.start, edit.end),
      after: edit.patch.replace,
      left: result.slice(Math.max(0, index - 48), index),
      right: result.slice(index + edit.patch.replace.length, index + edit.patch.replace.length + 48),
      reverted: false,
    };
  });
  return { message: result, records, errors, success_count: records.length, skipped_count: errors.length };
}

export function reversePatches(message: string, source_records: PatchRecord[]) {
  const records = source_records.map(record => ({ ...record }));
  const errors: string[] = [];
  let result = message;
  let success_count = 0;
  for (const record of [...records].reverse()) {
    if (record.reverted) continue;
    let index = record.index;
    const at_index = record.after
      ? result.slice(index, index + record.after.length) === record.after
      : result.slice(Math.max(0, index - record.left.length), index) === record.left;
    if (!at_index) {
      const candidates = record.after
        ? occurrences(result, record.after).filter(
            start =>
              result.slice(Math.max(0, start - record.left.length), start) === record.left &&
              result.slice(start + record.after.length, start + record.after.length + record.right.length) ===
                record.right,
          )
        : [];
      if (candidates.length !== 1) {
        errors.push(`补丁 ${record.patch_index + 1} 的修复内容已变化，无法定位还原。`);
        continue;
      }
      index = candidates[0];
    }
    result = result.slice(0, index) + record.before + result.slice(index + record.after.length);
    record.reverted = true;
    success_count++;
  }
  return { message: result, records, errors, success_count, skipped_count: errors.length };
}
