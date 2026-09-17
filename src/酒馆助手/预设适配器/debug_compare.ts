import type { DebugContentReference, SquashDebugRecord } from '../压缩相邻消息/debug_types';

export type DebugRow = Record<string, unknown>;
export type ReadDebugContent = (record_id: string, content_id: string) => Promise<string | undefined>;
export type ComparedEntry = {
  key: string;
  row: DebugRow;
  text: string;
  start: number;
  end: number;
  start_units: number;
  end_units: number;
};
export type ComparisonSide = {
  id: string;
  entries: ComparedEntry[];
  text: string;
  chars: number;
  miss_index: number | null;
};
export type DebugComparison = {
  left: ComparisonSide;
  right: ComparisonSide;
  prefix_chars: number;
  different_chat: boolean;
  difference?: { left_text: string; right_text: string; prefix_units: number };
};
export type ComparisonView = {
  current: ComparisonSide;
  other: ComparisonSide;
  prefix_chars: number;
  missed_chars: number;
  ratio: number | null;
  first_difference_message: number | null;
  different_chat: boolean;
  difference?: { current_text: string; other_text: string; prefix_units: number };
};

export function textCharacters(text: string): number {
  let count = 0;
  for (const _character of text) count++;
  return count;
}
export function isDebugObject(value: unknown): value is DebugRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function debugValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
export function debugRows(value: unknown): { key: string; row: DebugRow }[] {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    const row = isDebugObject(item) && isDebugObject(item.row) ? item.row : item;
    return {
      key: isDebugObject(item) && typeof item.key === 'string' ? item.key : String(index),
      row: isDebugObject(row) ? row : { 值: row },
    };
  });
}
export async function loadDebugText(
  record_id: string,
  row: DebugRow | DebugContentReference,
  read: ReadDebugContent,
): Promise<string> {
  if (typeof row.详细内容缓存键 === 'string') {
    const value = await read(record_id, row.详细内容缓存键);
    if (value === undefined) throw Error('完整正文已不可用，请选择仍保留完整内容的记录。');
    return value;
  }
  if (typeof row.详细内容 !== 'string') throw Error('记录没有完整正文，无法进行字数对比。');
  if (typeof row.详细内容长度 === 'number' && row.详细内容长度 !== row.详细内容.length) {
    throw Error('记录只保留了正文预览，无法据此估算缓存命中。');
  }
  return row.详细内容;
}
async function loadSide(record: SquashDebugRecord, read: ReadDebugContent): Promise<ComparisonSide> {
  if (!Array.isArray(record.state.total_rows)) throw Error('记录缺少总排序正文。');
  const rows = debugRows(record.state.total_rows);
  const texts = await Promise.all(rows.map(entry => loadDebugText(record.id, entry.row, read)));
  let chars = 0;
  let units = 0;
  const entries = rows.map((entry, index) => {
    const text = texts[index];
    const start = chars;
    const start_units = units;
    chars += textCharacters(text);
    units += text.length;
    return { ...entry, text, start, end: chars, start_units, end_units: units };
  });
  return { id: record.id, entries, text: texts.join(''), chars, miss_index: null };
}
export async function compareDebugRecords(
  leftRecord: SquashDebugRecord,
  rightRecord: SquashDebugRecord,
  read: ReadDebugContent,
): Promise<DebugComparison> {
  const [left, right] = await Promise.all([loadSide(leftRecord, read), loadSide(rightRecord, read)]);
  let units = 0;
  let prefix_chars = 0;
  while (
    units < left.text.length &&
    units < right.text.length &&
    left.text.codePointAt(units) === right.text.codePointAt(units)
  ) {
    units += left.text.codePointAt(units)! > 0xffff ? 2 : 1;
    prefix_chars++;
  }
  for (const side of [left, right]) {
    const index = side.entries.findIndex(entry => entry.end > prefix_chars);
    side.miss_index = index === -1 ? null : index;
  }
  const left_miss = left.miss_index === null ? undefined : left.entries[left.miss_index];
  const right_miss = right.miss_index === null ? undefined : right.entries[right.miss_index];
  const start = Math.min(left_miss?.start_units ?? units, right_miss?.start_units ?? units);
  return {
    left,
    right,
    prefix_chars,
    different_chat:
      !!leftRecord.generation?.chat_id &&
      !!rightRecord.generation?.chat_id &&
      leftRecord.generation.chat_id !== rightRecord.generation.chat_id,
    difference:
      left_miss || right_miss
        ? {
            left_text: left.text.slice(start, left_miss?.end_units ?? left.text.length),
            right_text: right.text.slice(start, right_miss?.end_units ?? right.text.length),
            prefix_units: units - start,
          }
        : undefined,
  };
}
export function comparisonForRecord(comparison: DebugComparison, id: string): ComparisonView | undefined {
  if (comparison.left.id !== id && comparison.right.id !== id) return undefined;
  const is_left = comparison.left.id === id;
  const current = is_left ? comparison.left : comparison.right;
  const other = is_left ? comparison.right : comparison.left;
  return {
    current,
    other,
    prefix_chars: comparison.prefix_chars,
    missed_chars: current.chars - comparison.prefix_chars,
    ratio: current.chars ? comparison.prefix_chars / current.chars : null,
    first_difference_message: current.miss_index === null ? null : current.miss_index + 1,
    different_chat: comparison.different_chat,
    difference: comparison.difference
      ? {
          current_text: is_left ? comparison.difference.left_text : comparison.difference.right_text,
          other_text: is_left ? comparison.difference.right_text : comparison.difference.left_text,
          prefix_units: comparison.difference.prefix_units,
        }
      : undefined,
  };
}
export function comparisonRowState(view: ComparisonView | undefined, index: number): 'hit' | 'miss' | undefined {
  if (!view || index >= view.current.entries.length) return undefined;
  if (view.current.miss_index === null || index < view.current.miss_index) return 'hit';
  return index === view.current.miss_index ? 'miss' : undefined;
}
