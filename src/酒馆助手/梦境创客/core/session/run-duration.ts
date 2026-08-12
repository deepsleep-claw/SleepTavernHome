import type { RunnerEvent } from '../runner/agent-runner';
import type { SessionUiItem } from './types';

const terminalStatuses = new Set(['completed', 'context-exhausted', 'failed', 'stopped'] as const);

type TerminalStatus = Exclude<NonNullable<SessionUiItem['runStatus']>, 'abnormal'>;
type TerminalEvent = Extract<RunnerEvent, { type: 'status' }> & { status: TerminalStatus };

function isTerminalEvent(event: RunnerEvent): event is TerminalEvent {
  return event.type === 'status' && terminalStatuses.has(event.status as TerminalStatus);
}

/**
 * 用当前用户轮次和Runner日志修复遗漏、或因分支重发复用旧时间而污染的整轮耗时。
 * 参数均应是当前会话自己的可变副本；函数会原地校准对应用户消息。
 */
export function repairPersistedRunDurations(
  ui: SessionUiItem[],
  events: RunnerEvent[],
): void {
  const users = ui.filter(item => item.kind === 'user' && item.checkpointId).sort((left, right) => left.at - right.at);
  const terminalEvents = events.filter(isTerminalEvent).sort((left, right) => left.at - right.at);

  users.forEach((user, index) => {
    const nextStartedAt = users[index + 1]?.at ?? Number.POSITIVE_INFINITY;
    const ended = terminalEvents
      .filter(event => event.at >= user.at && event.at < nextStartedAt)
      .at(-1);
    if (!ended) return;
    user.durationMs = Math.max(0, ended.at - user.at);
    user.runStatus = ended.status;
  });
}
