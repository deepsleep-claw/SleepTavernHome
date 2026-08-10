import type { ModelMessage } from 'ai';
import type { PendingRunnerStep, RunnerEvent } from './agent-runner';
import type { RunnerToolCall } from './step-executor';

function toolCalls(message: ModelMessage): RunnerToolCall[] {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return [];
  return message.content.flatMap(part =>
    part.type === 'tool-call' ? [{ input: part.input, toolCallId: part.toolCallId, toolName: part.toolName }] : [],
  );
}

export function recoverPendingRunnerStep(
  messages: ModelMessage[],
  events: RunnerEvent[],
): PendingRunnerStep | undefined {
  let latestCalls: RunnerToolCall[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    latestCalls = toolCalls(messages[index]);
    if (latestCalls.length > 0) break;
  }
  if (latestCalls.length === 0) return undefined;
  const completed = new Set(
    events
      .filter(event => event.type === 'tool-completed' || event.type === 'tool-failed')
      .map(event => event.call.toolCallId),
  );
  let nextCall = 0;
  while (nextCall < latestCalls.length && completed.has(latestCalls[nextCall].toolCallId)) nextCall += 1;
  if (nextCall >= latestCalls.length) return undefined;
  return {
    calls: latestCalls,
    compacting: latestCalls.some(call => call.toolName === 'compact_context'),
    nextCall,
  };
}
