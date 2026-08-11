import type { FilePart, ModelMessage } from 'ai';
import { canonicalStringify } from '../transaction/canonical';

export type ContextUsage = {
  apiInputTokens?: number;
  apiOutputTokens?: number;
  assistantTokens: number;
  contextWindow: number;
  estimatedDeltaTokens?: number;
  measurement?: 'api' | 'estimated';
  ratio: number;
  remainingTokens: number;
  systemTokens: number;
  thresholdTokens: number;
  toolTokens: number;
  totalTokens: number;
  userTokens: number;
};

export type ApiUsageBaseline = {
  estimatedTokens: number;
  inputTokens: number;
  outputTokens: number;
};

export type ContextDecision = 'compact' | 'continue' | 'users-exhausted';

export function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(canonicalStringify(value).length / 4));
}

function filePartTokens(part: FilePart): number {
  if (part.mediaType.toLocaleLowerCase().startsWith('image/')) return 1_200;
  if (typeof part.data === 'object' && 'type' in part.data && part.data.type === 'text') {
    return estimateTokens(part.data.text);
  }
  const data = typeof part.data === 'object' && 'type' in part.data && part.data.type === 'data'
    ? part.data.data
    : part.data;
  const encodedLength = typeof data === 'string' ? data.length : data instanceof Uint8Array ? data.byteLength * 4 / 3 : 0;
  const bytes = Math.ceil(encodedLength * 0.75);
  return part.mediaType.toLocaleLowerCase().startsWith('text/')
    ? Math.max(1, Math.ceil(bytes / 4))
    : 1_000 + Math.ceil(bytes / 1_024);
}

function messageTokens(message: ModelMessage): number {
  if (message.role !== 'user' || typeof message.content === 'string') return estimateTokens(message);
  return message.content.reduce((total, part) => {
    if (part.type === 'text') return total + estimateTokens(part.text);
    if (part.type === 'file') return total + filePartTokens(part);
    if (part.type === 'image') return total + 1_200;
    return total;
  }, 1);
}

export function measureContext(
  messages: ModelMessage[],
  contextWindow: number,
  apiBaseline?: ApiUsageBaseline,
): ContextUsage {
  const totals = { assistant: 0, system: 0, tool: 0, user: 0 };
  for (const message of messages) totals[message.role] += messageTokens(message);
  const estimatedTokens = totals.assistant + totals.system + totals.tool + totals.user;
  const estimatedDeltaTokens = apiBaseline ? estimatedTokens - apiBaseline.estimatedTokens : 0;
  const totalTokens = apiBaseline
    ? Math.max(0, apiBaseline.inputTokens + apiBaseline.outputTokens + estimatedDeltaTokens)
    : estimatedTokens;
  return {
    apiInputTokens: apiBaseline?.inputTokens,
    apiOutputTokens: apiBaseline?.outputTokens,
    assistantTokens: totals.assistant,
    contextWindow,
    estimatedDeltaTokens,
    measurement: apiBaseline ? 'api' : 'estimated',
    ratio: totalTokens / contextWindow,
    remainingTokens: Math.max(0, contextWindow - totalTokens),
    systemTokens: totals.system,
    thresholdTokens: Math.floor(contextWindow * 0.7),
    toolTokens: totals.tool,
    totalTokens,
    userTokens: totals.user,
  };
}

export function decideContext(usage: ContextUsage, outputReserve = 4096): ContextDecision {
  if (usage.userTokens >= usage.contextWindow * 0.8) return 'users-exhausted';
  if (usage.totalTokens >= usage.thresholdTokens || usage.remainingTokens < outputReserve) return 'compact';
  return 'continue';
}

function isCompactCall(message: ModelMessage): boolean {
  return (
    message.role === 'assistant' &&
    Array.isArray(message.content) &&
    message.content.some(part => part.type === 'tool-call' && part.toolName === 'compact_context')
  );
}

function isCompactResult(message: ModelMessage): boolean {
  return (
    message.role === 'tool' &&
    message.content.some(part => part.type === 'tool-result' && part.toolName === 'compact_context')
  );
}

export function compactModelMessages(
  messages: ModelMessage[],
  summary: string,
  headerMessageCount = 0,
  replacementHeader: ModelMessage[] = messages.slice(0, headerMessageCount),
): ModelMessage[] {
  const conversation = messages.slice(headerMessageCount);
  const systems = conversation.filter(
    message =>
      message.role === 'system' &&
      !(typeof message.content === 'string' && message.content.startsWith('【上下文压缩摘要】')),
  );
  const users = conversation.filter(message => message.role === 'user');
  let latestAssistant = -1;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role === 'assistant' && !isCompactCall(conversation[index])) {
      latestAssistant = index;
      break;
    }
  }
  const latestChain =
    latestAssistant < 0
      ? []
      : conversation
          .slice(latestAssistant)
          .filter(message => message.role !== 'user' && !isCompactCall(message) && !isCompactResult(message));
  return [
    ...replacementHeader,
    ...systems,
    { content: `【上下文压缩摘要】\n${summary}`, role: 'system' as const },
    ...users,
    ...latestChain,
  ];
}
