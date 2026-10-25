import type { FilePart, ModelMessage } from 'ai';
import { canonicalStringify } from '../transaction/canonical';

export type ModelTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
};

export type ContextUsage = {
  apiInputTokens?: number;
  apiOutputTokens?: number;
  apiCacheReadTokens?: number;
  apiCacheWriteTokens?: number;
  apiReasoningTokens?: number;
  apiTotalTokens?: number;
  assistantTokens: number;
  contextWindow: number;
  estimatedTokens?: number;
  estimatedDeltaTokens?: number;
  toolSchemaTokens?: number;
  measurement?: 'api' | 'estimated';
  ratio: number;
  remainingTokens: number;
  systemTokens: number;
  thresholdTokens: number;
  toolTokens: number;
  totalTokens: number;
  userTokens: number;
};

export type ApiUsageBaseline = ModelTokenUsage & {
  /** 版本 2 的锚点是请求发出时的输入，输出用量只用于展示。 */
  version?: 2;
  estimatedTokens: number;
  inputTokens: number;
  toolSchemaTokens?: number;
};

function tokenNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function normalizeTokenUsage(usage: ModelTokenUsage): ModelTokenUsage {
  const result: ModelTokenUsage = {};
  for (const key of [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
  ] as const) {
    const value = tokenNumber(usage[key]);
    if (value !== undefined) result[key] = value;
  }
  if (
    result.inputTokens === undefined &&
    result.totalTokens !== undefined &&
    result.outputTokens !== undefined &&
    result.totalTokens >= result.outputTokens
  )
    result.inputTokens = result.totalTokens - result.outputTokens;
  return result;
}

export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : canonicalStringify(value);
  const chinese = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length;
  return Math.max(1, Math.ceil((text.length + chinese) / 3));
}

function filePartTokens(part: FilePart): number {
  if (part.mediaType.toLocaleLowerCase().startsWith('image/')) return 1_200;
  if (typeof part.data === 'object' && 'type' in part.data && part.data.type === 'text')
    return estimateTokens(part.data.text);
  const data =
    typeof part.data === 'object' && 'type' in part.data && part.data.type === 'data' ? part.data.data : part.data;
  const encodedLength =
    typeof data === 'string' ? data.length : data instanceof Uint8Array ? (data.byteLength * 4) / 3 : 0;
  const bytes = Math.ceil(encodedLength * 0.75);
  return part.mediaType.toLocaleLowerCase().startsWith('text/')
    ? Math.max(1, Math.ceil(bytes / 3))
    : 1_000 + Math.ceil(bytes / 1_024);
}

function messageTokens(message: ModelMessage): number {
  if (typeof message.content === 'string') return 4 + estimateTokens(message.content);
  return message.content.reduce((total, part) => {
    if (part.type === 'text' || part.type === 'reasoning') return total + estimateTokens(part.text);
    if (part.type === 'file') return total + filePartTokens(part);
    if (part.type === 'image') return total + 1_200;
    if (part.type === 'tool-call') return total + estimateTokens({ name: part.toolName, input: part.input });
    if (part.type === 'tool-result') return total + estimateTokens({ name: part.toolName, output: part.output });
    return total;
  }, 4);
}

export function measureContext(
  messages: ModelMessage[],
  contextWindow: number,
  apiBaseline?: ApiUsageBaseline,
  toolSchemaTokens = 0,
): ContextUsage {
  const totals = { assistant: 0, system: 0, tool: 0, user: 0 };
  for (const message of messages) totals[message.role] += messageTokens(message);
  const schemas = tokenNumber(toolSchemaTokens) ?? 0;
  const estimatedTokens = totals.assistant + totals.system + totals.tool + totals.user + schemas;
  const baseline =
    apiBaseline?.version === 2 &&
    tokenNumber(apiBaseline.estimatedTokens) !== undefined &&
    (tokenNumber(apiBaseline.inputTokens) ?? 0) > 0
      ? apiBaseline
      : undefined;
  const estimatedDeltaTokens = baseline ? estimatedTokens - baseline.estimatedTokens : 0;
  // API 输入包含服务端格式与工具定义；仅增量估算该请求之后的内容，避免重复叠加缓存和隐藏推理用量。
  const totalTokens = baseline ? Math.max(0, baseline.inputTokens + estimatedDeltaTokens) : estimatedTokens;
  return {
    apiInputTokens: baseline?.inputTokens,
    apiOutputTokens: baseline?.outputTokens,
    apiCacheReadTokens: baseline?.cacheReadTokens,
    apiCacheWriteTokens: baseline?.cacheWriteTokens,
    apiReasoningTokens: baseline?.reasoningTokens,
    apiTotalTokens: baseline?.totalTokens,
    assistantTokens: totals.assistant,
    contextWindow,
    estimatedTokens,
    estimatedDeltaTokens,
    toolSchemaTokens: schemas,
    measurement: baseline ? 'api' : 'estimated',
    ratio: totalTokens / contextWindow,
    remainingTokens: Math.max(0, contextWindow - totalTokens),
    systemTokens: totals.system,
    thresholdTokens: Math.floor(contextWindow * 0.7),
    toolTokens: totals.tool,
    totalTokens,
    userTokens: totals.user,
  };
}

export function decideContext(usage: ContextUsage, outputReserve = 4096): 'compact' | 'continue' {
  return usage.totalTokens >= usage.thresholdTokens || usage.remainingTokens < outputReserve ? 'compact' : 'continue';
}

export function outputTokenBudget(contextWindow: number, inputTokens: number, maximum = 32_000): number {
  const margin = Math.min(1_000, Math.floor(contextWindow * 0.05));
  return Math.max(0, Math.min(maximum, Math.floor(contextWindow - inputTokens - margin)));
}

export { compactModelMessages } from './context-compaction';
