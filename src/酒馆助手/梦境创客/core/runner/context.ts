import type { ModelMessage } from 'ai';
import { canonicalStringify } from '../transaction/canonical';

export type ContextUsage = {
  assistantTokens: number;
  contextWindow: number;
  ratio: number;
  remainingTokens: number;
  systemTokens: number;
  thresholdTokens: number;
  toolTokens: number;
  totalTokens: number;
  userTokens: number;
};

export type ContextDecision = 'compact' | 'continue' | 'users-exhausted';

export function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(canonicalStringify(value).length / 4));
}

export function measureContext(messages: ModelMessage[], contextWindow: number): ContextUsage {
  const totals = { assistant: 0, system: 0, tool: 0, user: 0 };
  for (const message of messages) totals[message.role] += estimateTokens(message);
  const totalTokens = totals.assistant + totals.system + totals.tool + totals.user;
  return {
    assistantTokens: totals.assistant,
    contextWindow,
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

export function compactModelMessages(messages: ModelMessage[], summary: string): ModelMessage[] {
  const systems = messages.filter(
    message =>
      message.role === 'system' &&
      !(typeof message.content === 'string' && message.content.startsWith('【上下文压缩摘要】')),
  );
  const users = messages.filter(message => message.role === 'user');
  let latestAssistant = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant' && !isCompactCall(messages[index])) {
      latestAssistant = index;
      break;
    }
  }
  const latestChain =
    latestAssistant < 0
      ? []
      : messages
          .slice(latestAssistant)
          .filter(message => message.role !== 'user' && !isCompactCall(message) && !isCompactResult(message));
  return [
    ...systems,
    { content: `【上下文压缩摘要】\n${summary}`, role: 'system' as const },
    ...users,
    ...latestChain,
  ];
}
