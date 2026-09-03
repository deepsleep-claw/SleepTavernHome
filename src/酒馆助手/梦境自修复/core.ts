export const DREAM_SELF_REPAIR_VARIABLE_KEY = 'dream_self_repair';
export const DREAM_SELF_REPAIR_ACTION_EVENT = 'dream-self-repair:action';
export const DREAM_SELF_REPAIR_RESULT_EVENT = 'dream-self-repair:result';
export const DREAM_SELF_REPAIR_STATE_REQUEST_EVENT = 'dream-self-repair:state-request';
export const DREAM_SELF_REPAIR_STATE_EVENT = 'dream-self-repair:state';

export type RepairTargetKind = 'dream_body' | 'dream_parallel_event';
export type RepairStatus = 'idle' | 'applied' | 'partially_reverted' | 'reverted';
export type RepairAction = 'auto' | 'repatch' | 'reverse';

export type PatchDefinition = {
  find: string;
  replace: string;
  source_index: number;
};

export type PatchRecord = {
  patch_index: number;
  before: string;
  after: string;
  target: RepairTargetKind;
  occurrence: number;
  index: number;
  left_context: string;
  right_context: string;
  reverted: boolean;
};

export type RepairRunResult = {
  action: RepairAction;
  success_count: number;
  skipped_count: number;
  errors: string[];
};

export type RepairState = {
  version: 1;
  status: RepairStatus;
  records: PatchRecord[];
  last_result: RepairRunResult;
};

export type ParsedSelfCheck = {
  content: string;
  review: string;
  patch: string;
  start: number;
  end: number;
};

export type ApplyPatchResult = {
  message: string;
  records: PatchRecord[];
  success_count: number;
  skipped_count: number;
  errors: string[];
};

export type ReversePatchResult = {
  message: string;
  records: PatchRecord[];
  success_count: number;
  skipped_count: number;
  errors: string[];
};

type MessageTarget = {
  kind: RepairTargetKind;
  occurrence: number;
  content: string;
  content_start: number;
};

type ParsedPatchText = {
  definitions: PatchDefinition[];
  errors: string[];
};

const CONTEXT_LENGTH = 64;
const SELF_CHECK_PATTERN = /<dream_self_check\b[^>]*>([\s\S]*?)<\/dream_self_check>/gi;
const TARGET_PATTERN = /<(dream_body|dream_parallel_event)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const SIMPLE_THINKING_PATTERN = /<simple_thinking\b[^>]*>[\s\S]*?<\/simple_thinking>/gi;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function trimOuterNewlines(value: string): string {
  return value.replace(/^\n+|\n+$/g, '');
}

function extractTagContent(content: string, tag: 'review' | 'patch'): string | undefined {
  const matched = content.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return matched?.[1];
}

export function extractLastSelfCheck(message: string): ParsedSelfCheck | undefined {
  let result: ParsedSelfCheck | undefined;
  const matcher = new RegExp(SELF_CHECK_PATTERN.source, SELF_CHECK_PATTERN.flags);
  let matched: RegExpExecArray | null;

  while ((matched = matcher.exec(message)) !== null) {
    const content = matched[1];
    const patch = extractTagContent(content, 'patch');
    if (patch !== undefined) {
      result = {
        content,
        review: extractTagContent(content, 'review') ?? '',
        patch,
        start: matched.index,
        end: matched.index + matched[0].length,
      };
    }
    if (matched[0].length === 0) {
      matcher.lastIndex += 1;
    }
  }

  return result;
}

export function parsePatchText(patch_text: string): ParsedPatchText {
  const normalized = trimOuterNewlines(normalizeLineEndings(patch_text));
  if (!normalized.trim()) {
    return { definitions: [], errors: ['Patch 内容为空。'] };
  }

  const blocks = normalized.split(/\n[ \t]*\n(?=FIND:[ \t]*)/);
  const definitions: PatchDefinition[] = [];
  const errors: string[] = [];

  blocks.forEach((block, block_index) => {
    const matched = block.match(/^FIND:[ \t]*([\s\S]*?)\nREPLACE:[ \t]?([\s\S]*)$/);
    if (!matched) {
      errors.push(`第 ${block_index + 1} 个 Patch 不符合 FIND/REPLACE 格式。`);
      return;
    }

    if (!matched[1]) {
      errors.push(`第 ${block_index + 1} 个 Patch 的 FIND 为空。`);
      return;
    }

    definitions.push({
      find: matched[1],
      replace: matched[2],
      source_index: block_index,
    });
  });

  return { definitions, errors };
}

function findMessageTargets(message: string): MessageTarget[] {
  const occurrences: Record<RepairTargetKind, number> = {
    dream_body: 0,
    dream_parallel_event: 0,
  };
  const matcher = new RegExp(TARGET_PATTERN.source, TARGET_PATTERN.flags);
  const targets: MessageTarget[] = [];
  let matched: RegExpExecArray | null;

  while ((matched = matcher.exec(message)) !== null) {
    const kind = matched[1].toLowerCase() as RepairTargetKind;
    const content = matched[2];
    const content_offset = matched[0].indexOf('>') + 1;
    const content_start = matched.index + content_offset;

    if (kind === 'dream_body') {
      targets.push({ kind, occurrence: occurrences[kind]++, content, content_start });
    } else {
      const thinking_matcher = new RegExp(SIMPLE_THINKING_PATTERN.source, SIMPLE_THINKING_PATTERN.flags);
      let thinking: RegExpExecArray | null;
      let cursor = 0;
      let has_thinking = false;

      while ((thinking = thinking_matcher.exec(content)) !== null) {
        has_thinking = true;
        if (thinking.index > cursor) {
          targets.push({
            kind,
            occurrence: occurrences[kind]++,
            content: content.slice(cursor, thinking.index),
            content_start: content_start + cursor,
          });
        }
        cursor = thinking.index + thinking[0].length;
        if (thinking[0].length === 0) {
          thinking_matcher.lastIndex += 1;
        }
      }

      if (!has_thinking || cursor < content.length) {
        targets.push({
          kind,
          occurrence: occurrences[kind]++,
          content: content.slice(cursor),
          content_start: content_start + cursor,
        });
      }
    }
    if (matched[0].length === 0) {
      matcher.lastIndex += 1;
    }
  }

  return targets;
}

function replaceMessageRange(message: string, start: number, length: number, replacement: string): string {
  return `${message.slice(0, start)}${replacement}${message.slice(start + length)}`;
}

function applyDefinition(
  message: string,
  definition: PatchDefinition,
  regex: RegExp,
): { message: string; record: PatchRecord } | undefined {
  for (const target of findMessageTargets(message)) {
    const matched = regex.exec(target.content);
    if (!matched) {
      continue;
    }

    const before = matched[0];
    const index = matched.index;
    const absolute_index = target.content_start + index;
    const left_context = target.content.slice(Math.max(0, index - CONTEXT_LENGTH), index);
    const right_context = target.content.slice(index + before.length, index + before.length + CONTEXT_LENGTH);

    return {
      message: replaceMessageRange(message, absolute_index, before.length, definition.replace),
      record: {
        patch_index: definition.source_index,
        before,
        after: definition.replace,
        target: target.kind,
        occurrence: target.occurrence,
        index,
        left_context,
        right_context,
        reverted: false,
      },
    };
  }

  return undefined;
}

export function applyPatchText(message: string, patch_text: string): ApplyPatchResult {
  const parsed = parsePatchText(patch_text);
  const errors = [...parsed.errors];
  const records: PatchRecord[] = [];
  let patched_message = message;

  parsed.definitions.forEach(definition => {
    let regex: RegExp;
    try {
      regex = new RegExp(definition.find, 'm');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`第 ${definition.source_index + 1} 个 Patch 的 FIND 不是有效正则：${detail}`);
      return;
    }

    const applied = applyDefinition(patched_message, definition, regex);
    if (!applied) {
      errors.push(`第 ${definition.source_index + 1} 个 Patch 未匹配到正文。`);
      return;
    }

    patched_message = applied.message;
    records.push(applied.record);
  });

  return {
    message: patched_message,
    records,
    success_count: records.length,
    skipped_count: errors.length,
    errors,
  };
}

function findAllOccurrences(content: string, needle: string): number[] {
  if (!needle) {
    return [];
  }

  const indices: number[] = [];
  let index = content.indexOf(needle);
  while (index !== -1) {
    indices.push(index);
    index = content.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return indices;
}

function contextMatchLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[left.length - count - 1] === right[right.length - count - 1]) {
    count += 1;
  }
  return count;
}

function prefixMatchLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[count] === right[count]) {
    count += 1;
  }
  return count;
}

function scoreCandidate(content: string, index: number, after_length: number, record: PatchRecord): number {
  const left = content.slice(Math.max(0, index - record.left_context.length), index);
  const right = content.slice(index + after_length, index + after_length + record.right_context.length);
  const context_score = contextMatchLength(left, record.left_context) + prefixMatchLength(right, record.right_context);
  return context_score * 10_000 - Math.abs(index - record.index);
}

function locateEmptyAfter(content: string, record: PatchRecord): number {
  const expected_index = Math.min(Math.max(record.index, 0), content.length);
  const combined_context = `${record.left_context}${record.right_context}`;
  if (combined_context) {
    const candidates = findAllOccurrences(content, combined_context).map(index => index + record.left_context.length);
    if (candidates.length > 0) {
      return candidates.sort((left, right) => Math.abs(left - record.index) - Math.abs(right - record.index))[0];
    }
  }

  return expected_index;
}

function locateRecordedAfter(content: string, record: PatchRecord): number | undefined {
  if (!record.after) {
    return locateEmptyAfter(content, record);
  }

  if (content.slice(record.index, record.index + record.after.length) === record.after) {
    return record.index;
  }

  const candidates = findAllOccurrences(content, record.after);
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.sort(
    (left, right) =>
      scoreCandidate(content, right, record.after.length, record) -
      scoreCandidate(content, left, record.after.length, record),
  )[0];
}

export function reversePatchRecords(message: string, source_records: PatchRecord[]): ReversePatchResult {
  const records = source_records.map(record => ({ ...record }));
  const errors: string[] = [];
  let restored_message = message;
  let success_count = 0;

  for (let record_index = records.length - 1; record_index >= 0; record_index -= 1) {
    const record = records[record_index];
    if (record.reverted) {
      continue;
    }

    const target = findMessageTargets(restored_message).find(
      candidate => candidate.kind === record.target && candidate.occurrence === record.occurrence,
    );
    if (!target) {
      errors.push(`第 ${record.patch_index + 1} 个 Patch 的目标正文已不存在。`);
      continue;
    }

    const index = locateRecordedAfter(target.content, record);
    if (index === undefined) {
      errors.push(`第 ${record.patch_index + 1} 个 Patch 的 after 文本已不存在。`);
      continue;
    }

    restored_message = replaceMessageRange(
      restored_message,
      target.content_start + index,
      record.after.length,
      record.before,
    );
    record.reverted = true;
    success_count += 1;
  }

  return {
    message: restored_message,
    records,
    success_count,
    skipped_count: errors.length,
    errors,
  };
}

export function getRepairStatus(records: PatchRecord[]): RepairStatus {
  if (records.length === 0) {
    return 'idle';
  }

  const reverted_count = records.filter(record => record.reverted).length;
  if (reverted_count === 0) {
    return 'applied';
  }
  if (reverted_count === records.length) {
    return 'reverted';
  }
  return 'partially_reverted';
}

export function isRepairState(value: unknown): value is RepairState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<RepairState>;
  const statuses: RepairStatus[] = ['idle', 'applied', 'partially_reverted', 'reverted'];
  const actions: RepairAction[] = ['auto', 'repatch', 'reverse'];
  const run_result = candidate.last_result;

  return (
    candidate.version === 1 &&
    typeof candidate.status === 'string' &&
    statuses.includes(candidate.status as RepairStatus) &&
    Array.isArray(candidate.records) &&
    candidate.records.every(record => {
      if (!record || typeof record !== 'object') {
        return false;
      }
      const item = record as Partial<PatchRecord>;
      return (
        typeof item.patch_index === 'number' &&
        typeof item.before === 'string' &&
        typeof item.after === 'string' &&
        (item.target === 'dream_body' || item.target === 'dream_parallel_event') &&
        typeof item.occurrence === 'number' &&
        typeof item.index === 'number' &&
        typeof item.left_context === 'string' &&
        typeof item.right_context === 'string' &&
        typeof item.reverted === 'boolean'
      );
    }) &&
    !!run_result &&
    typeof run_result === 'object' &&
    actions.includes(run_result.action) &&
    typeof run_result.success_count === 'number' &&
    typeof run_result.skipped_count === 'number' &&
    Array.isArray(run_result.errors) &&
    run_result.errors.every(error => typeof error === 'string')
  );
}
