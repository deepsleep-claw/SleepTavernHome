import protocol from './prompts/protocol.md?raw';
import { reportRanges, stripReports } from './patch';
import type { Settings } from './settings';

export type MvuStatus = {
  available: boolean;
  enabled: boolean;
  mode: 'inline' | 'extra';
  busy: boolean;
  version: number;
};
export const NO_MVU: MvuStatus = { available: false, enabled: false, mode: 'inline', busy: false, version: 0 };

export function parsePattern(value: string): RegExp | undefined {
  if (!value.trim()) return undefined;
  const literal = value.match(/^\/([\s\S]*)\/([a-z]*)$/i);
  return literal ? new RegExp(literal[1], literal[2]) : new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

export function lastMatch(text: string, expression: RegExp): RegExpExecArray | undefined {
  const matcher = new RegExp(expression.source, expression.flags.replace(/[gy]/g, '') + 'g');
  let result: RegExpExecArray | undefined;
  let current: RegExpExecArray | null;
  while ((current = matcher.exec(text))) {
    result = current;
    if (!current[0].length) matcher.lastIndex++;
  }
  return result;
}

export function inspectMvu(message: string) {
  const source = stripReports(message);
  const complete = [
    ...source.matchAll(/<UpdateVariable\b[^>]*>(?:(?!<\/?UpdateVariable\b)[\s\S])*?<\/UpdateVariable>/gi),
  ];
  const remaining = source.replace(
    /<UpdateVariable\b[^>]*>(?:(?!<\/?UpdateVariable\b)[\s\S])*?<\/UpdateVariable>/gi,
    '',
  );
  return { complete: complete.length > 0, incomplete: /<\/?UpdateVariable\b/i.test(remaining) };
}

export function buildTask(settings: Settings, message: string, mvu: MvuStatus): string {
  const state = inspectMvu(message);
  const parts = [
    '本轮主输出已经完成。请处理下面的待修复消息。',
    '<dream_repair_target>',
    message,
    '</dream_repair_target>',
  ];
  if (mvu.enabled) {
    if (mvu.mode === 'extra')
      parts.push('【MVU 状态】独立模型解析将在修复完成后执行；本次格式补全无需生成变量更新块。');
    else if (state.complete && !state.incomplete)
      parts.push('【MVU 状态】已有完整的变量更新块，无需重复生成。内容修复可以通过补丁修正现有更新内容。');
    else if (settings.format)
      parts.push(
        '【MVU 状态】变量更新块缺失或不完整。请在格式补全中生成一份完整、成对闭合的 <UpdateVariable> 更新块，以修复后的事实为依据。',
      );
    else parts.push('【MVU 状态】变量更新块缺失或不完整，当前启用内容修复。');
  }
  if (settings.format) parts.push('【格式补全要求】', settings.format_prompt);
  if (settings.review) parts.push('【内容修复要求】', settings.review_prompt);
  parts.push(
    '【输出协议】',
    protocol.trim(),
    `本次启用模块：${[settings.format && '格式补全', settings.review && '内容修复'].filter(Boolean).join('、')}。`,
  );
  return parts.join('\n\n');
}

export function combinePrompts(
  prompts: RolePrompt[],
  task: string,
  settings: Pick<Settings, 'intercept' | 'tail'>,
): RolePrompt[] {
  if (!settings.intercept) return [...prompts, { role: 'user', content: task }];
  const expression = parsePattern(settings.tail);
  if (!expression) throw new Error('请填写尾部定位表达式，或关闭尾部替换。');
  const last = prompts.at(-1);
  if (!last || last.role !== 'user') throw new Error('请求末尾不是 user 消息，无法执行尾部替换。');
  const found = lastMatch(last.content, expression);
  if (!found) throw new Error('未找到尾部定位点，请调整定位表达式后重试。');
  return [
    ...prompts.slice(0, -1),
    { ...last, content: last.content.slice(0, found.index + found[0].length) + '\n\n' + task },
  ];
}

export function extractOutput(output: string, settings: Pick<Settings, 'format' | 'review'>) {
  const formats = [...output.matchAll(/<dream_append_format\b[^>]*>([\s\S]*?)<\/dream_append_format>/gi)];
  const reviews = [...output.matchAll(/<dream_self_check\b[^>]*>([\s\S]*?)<\/dream_self_check>/gi)];
  if (settings.format && formats.length !== 1) throw new Error('格式补全结果需要一组完整的 dream_append_format 标签。');
  if (settings.review && reviews.length !== 1) throw new Error('自检结果需要一组完整的 dream_self_check 标签。');
  const review = settings.review ? reviews[0][0] : '';
  const patch = review.match(/<patch\b[^>]*>([\s\S]*?)<\/patch>/i);
  if (settings.review && (!patch || !/<review\b[^>]*>[\s\S]*?<\/review>/i.test(review)))
    throw new Error('自检结果缺少完整的 review 或 patch。');
  return { append: settings.format ? formats[0][1].trim() : '', review, patch: patch?.[1] ?? '' };
}

/** 只移除更新块，保留其后的状态栏和审校报告。 */
export function removeMvuBlocks(message: string): string {
  const protected_ranges = reportRanges(message);
  const tokens = [...message.matchAll(/<\/?UpdateVariable\b[^>]*>/gi)].filter(
    token => !protected_ranges.some(range => token.index! >= range.start && token.index! < range.end),
  );
  const removals: { start: number; end: number }[] = [];
  let opening: number | undefined;
  for (const token of tokens) {
    if (!token[0].startsWith('</')) {
      if (opening !== undefined) removals.push({ start: opening, end: token.index! });
      opening = token.index;
    } else {
      removals.push({ start: opening ?? token.index!, end: token.index! + token[0].length });
      opening = undefined;
    }
  }
  if (opening !== undefined) {
    const suffix = message.slice(opening).search(/<(?!\/?(?:UpdateVariable|Analysis|Json_?Patch)\b)[a-z][^>]*>/i);
    removals.push({ start: opening, end: suffix >= 0 ? opening + suffix : message.length });
  }
  let result = message;
  for (const range of removals.reverse()) result = result.slice(0, range.start) + result.slice(range.end);
  return result;
}

export function appendResults(
  base: string,
  append: string,
  review: string,
  settings: Pick<Settings, 'insert_before'>,
  mvu: MvuStatus,
) {
  const existing = inspectMvu(base);
  if (mvu.enabled) {
    if (mvu.mode === 'extra' || (existing.complete && !existing.incomplete)) append = removeMvuBlocks(append).trim();
    else if (inspectMvu(append).complete) base = removeMvuBlocks(base).trimEnd();
  }
  const addition = [append, review].filter(Boolean).join('\n\n');
  if (!addition) return base;
  const expression = parsePattern(settings.insert_before);
  const match = expression && lastMatch(base, expression);
  const index = match?.index ?? base.length;
  return base.slice(0, index).trimEnd() + '\n\n' + addition + (index < base.length ? '\n\n' + base.slice(index) : '');
}
