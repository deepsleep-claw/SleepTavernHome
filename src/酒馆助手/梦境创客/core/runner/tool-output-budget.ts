import { estimateTokens, estimateToolOutputTokens } from './context';
import { modelToolOutput, richToolOutput, type ToolResultOutput } from './tool-output';

export const MAX_TOOL_RESULT_TOKENS = 16_000;
export const MAX_TOOL_BATCH_TOKENS = 48_000;
const OUTPUT_NOTICE = '工具结果已按上下文预算截断。请缩小路径、关键词或读取范围后继续获取；下方仅为结果片段。';

function prefixWithinTokens(text: string, tokens: number): string {
  if (tokens <= 0) return '';
  let low = 0;
  let high = Math.min(text.length, tokens * 3);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(text.slice(0, middle)) <= tokens) low = middle;
    else high = middle - 1;
  }
  if (low < text.length && /[\uD800-\uDBFF]/u.test(text[low - 1] ?? '')) low -= 1;
  return text.slice(0, low);
}

function scalarText(output: Exclude<ToolResultOutput, { type: 'content' }>): string {
  const value = output.type === 'execution-denied' ? (output.reason ?? '') : output.value;
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

/** 媒体按语义计数；被裁剪的文本保留显式提示和有界预览。 */
export function limitToolOutput(output: unknown, tokens: number): unknown {
  const original = modelToolOutput(output);
  const budget = Math.max(0, Math.floor(tokens));
  if (original.type !== 'content') {
    const text = scalarText(original);
    if (text.length <= budget * 3 && estimateToolOutputTokens(original) <= budget) return output;
    const notice = prefixWithinTokens(OUTPUT_NOTICE, budget);
    const prefix = prefixWithinTokens(text, Math.max(0, budget - estimateTokens(notice) - 2));
    const value = prefix ? `${notice}\n${prefix}` : notice;
    return richToolOutput(
      { type: original.type.startsWith('error-') ? 'error-text' : 'text', value },
      { truncated: true, warning: OUTPUT_NOTICE, preview: prefix.slice(0, 2_000), originalCharacters: text.length },
    );
  }
  let fits = 0;
  for (const part of original.value) {
    if (part.type === 'text' && part.text.length > budget * 3) {
      fits = budget + 1;
      break;
    }
    fits += estimateToolOutputTokens({ type: 'content', value: [part] });
    if (fits > budget) break;
  }
  if (fits <= budget) return output;
  const notice = prefixWithinTokens(OUTPUT_NOTICE, budget);
  let remaining = Math.max(0, budget - estimateTokens(notice));
  const value: typeof original.value = [];
  for (const part of original.value) {
    if (part.type === 'text') {
      const text = prefixWithinTokens(part.text, remaining);
      if (text) {
        value.push({ ...part, text });
        remaining -= estimateTokens(text);
      }
    } else {
      const cost = estimateToolOutputTokens({ type: 'content', value: [part] });
      if (cost <= remaining) {
        value.push(part);
        remaining -= cost;
      }
    }
  }
  if (notice) value.push({ type: 'text', text: notice });
  return richToolOutput(value.length ? { type: 'content', value } : { type: 'text', value: notice }, {
    truncated: true,
    warning: OUTPUT_NOTICE,
  });
}

export class ToolOutputBudget {
  constructor(private remaining: number) {}

  take(output: unknown, remainingCalls: number, toolName: string): unknown {
    const framing = 8 + estimateTokens(toolName);
    const share = Math.max(
      0,
      Math.min(MAX_TOOL_RESULT_TOKENS, Math.floor(this.remaining / Math.max(1, remainingCalls)) - framing),
    );
    const bounded = limitToolOutput(output, share);
    this.remaining = Math.max(0, this.remaining - framing - estimateToolOutputTokens(modelToolOutput(bounded)));
    return bounded;
  }
}
