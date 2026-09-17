export type GenerationHistoryMessage = {
  message_id: number;
  swipe_id: number;
  is_hidden: boolean;
  content: string;
};

export type GenerationHistory<T extends GenerationHistoryMessage> = {
  type: string;
  all: T[];
  messages: T[];
  injection_messages: T[];
  anchors: T[];
};

export function selectGenerationHistory<T extends GenerationHistoryMessage>(
  all: T[],
  {
    type = 'normal',
    regenerate_target_id,
    continue_prefill = false,
  }: {
    type?: string;
    regenerate_target_id?: number;
    continue_prefill?: boolean;
  } = {},
): GenerationHistory<T> {
  let messages = all.filter(message => !message.is_hidden);
  if (type === 'swipe') messages = messages.slice(0, -1);
  if (type === 'regenerate' && regenerate_target_id !== undefined) {
    messages = messages.filter(message => message.message_id !== regenerate_target_id);
  }
  const continuation = type === 'continue' ? messages.at(-1) : undefined;
  // 续写预填充先移出尾消息；普通续写在深度注入后才移动它。
  const injection_messages = continuation && continue_prefill ? messages.slice(0, -1) : messages;
  const anchors = messages.filter(message => message !== continuation && message.content.trim().length > 0);
  return { type, all: [...all], messages, injection_messages, anchors };
}

export function generationAnchorDepth<T extends GenerationHistoryMessage>(
  history: GenerationHistory<T>,
  anchor: { message_id: number | null; swipe_id: number | null },
): number | undefined {
  const matches = (message: T) =>
    message.message_id === anchor.message_id && message.swipe_id === (anchor.swipe_id ?? 0);
  if (!history.anchors.some(matches)) return undefined;
  const index = history.injection_messages.findIndex(matches);
  return index < 0 ? undefined : history.injection_messages.length - index - 1;
}
