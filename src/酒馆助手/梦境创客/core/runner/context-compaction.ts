import type { ModelMessage } from 'ai';

export type CompactionSelection = {
  header: ModelMessage[];
  systems: ModelMessage[];
  groups: ModelMessage[][];
  preserved: ModelMessage[];
};

function isCompactCall(message: ModelMessage): boolean {
  return (
    message.role === 'assistant' &&
    Array.isArray(message.content) &&
    message.content.some(part => part.type === 'tool-call') &&
    message.content.filter(part => part.type === 'tool-call').every(part => part.toolName === 'compact_context')
  );
}

function withoutCompactCalls(messages: ModelMessage[]): ModelMessage[] {
  const removed = new Set(
    messages.flatMap(message =>
      isCompactCall(message) && Array.isArray(message.content)
        ? message.content.flatMap(part => (part.type === 'tool-call' ? [part.toolCallId] : []))
        : [],
    ),
  );
  return messages.flatMap((message): ModelMessage[] => {
    if (isCompactCall(message)) return [];
    if (message.role !== 'tool') return [message];
    const content = message.content.filter(part => part.type !== 'tool-result' || !removed.has(part.toolCallId));
    return content.length ? [{ ...message, content }] : [];
  });
}

export function selectCompaction(messages: ModelMessage[], headerMessageCount = 0): CompactionSelection {
  const conversation = withoutCompactCalls(messages.slice(headerMessageCount));
  const systems = conversation.filter(
    message => message.role === 'system' && !String(message.content).startsWith('【上下文压缩摘要】'),
  );
  const body = conversation.filter(message => !systems.includes(message));
  let user = -1;
  for (let index = body.length - 1; index >= 0; index--)
    if (body[index].role === 'user') {
      user = index;
      break;
    }
  let assistant = -1;
  for (let index = body.length - 1; index > user; index--)
    if (body[index].role === 'assistant') {
      assistant = index;
      break;
    }
  const preserved = [...(user >= 0 ? [body[user]] : []), ...(assistant >= 0 ? body.slice(assistant) : [])];
  const candidates = body.filter(message => !preserved.includes(message));
  const groups: ModelMessage[][] = [];
  let group: ModelMessage[] = [];
  // 整个助手批次及工具结果共同移动，签名和调用配对不会被摘要边界切开。
  for (const message of candidates) {
    if ((message.role === 'assistant' || message.role === 'user') && group.some(item => item.role === 'assistant')) {
      groups.push(group);
      group = [];
    }
    group.push(message);
  }
  if (group.length) groups.push(group);
  return { header: messages.slice(0, headerMessageCount), systems, groups, preserved };
}

export function reduceCompactionInput(selection: CompactionSelection): CompactionSelection | undefined {
  if (selection.groups.length < 2) return undefined;
  const retained = Math.max(1, Math.ceil(selection.groups.length / 3));
  return {
    ...selection,
    groups: selection.groups.slice(0, -retained),
    preserved: [...selection.groups.slice(-retained).flat(), ...selection.preserved],
  };
}

export function composeCompactedMessages(
  selection: CompactionSelection,
  summary: string,
  header = selection.header,
): ModelMessage[] {
  return [
    ...header,
    ...selection.systems,
    { content: `【上下文压缩摘要】\n${summary}`, role: 'system' },
    ...selection.preserved,
  ];
}

export function compactModelMessages(
  messages: ModelMessage[],
  summary: string,
  headerMessageCount = 0,
  replacementHeader = messages.slice(0, headerMessageCount),
): ModelMessage[] {
  return composeCompactedMessages(selectCompaction(messages, headerMessageCount), summary, replacementHeader);
}
