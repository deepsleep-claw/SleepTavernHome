import { checkMinimumVersion } from '@util/common';
import { initPanel } from './panel';
import { SCRIPT_NAME, useDreamExtractionStore, type DreamExtractionSettings } from './store';

const REASONING_RECORD_KEYS = [
  'reasoning',
  'reasoningContent',
  'reasoning_content',
  'reasoningText',
  'reasoning_text',
  'thinking',
  'thoughts',
];
const REASONING_VALUE_KEYS = ['content', 'text', 'message', 'value', ...REASONING_RECORD_KEYS];

function toReasoningText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const text = value
      .map(item => toReasoningText(item))
      .filter((item): item is string => item !== undefined && item.trim() !== '')
      .join('\n');
    return text || undefined;
  }
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of REASONING_VALUE_KEYS) {
    const text = toReasoningText(record[key]);
    if (text?.trim()) {
      return text;
    }
  }
  return undefined;
}

function getReasoningContent(message: ChatMessage): string | undefined {
  const raw_message = SillyTavern.chat[message.message_id];
  const records = [message.extra, message.data, raw_message?.extra];

  for (const record of records) {
    for (const key of REASONING_RECORD_KEYS) {
      const text = toReasoningText(record?.[key]);
      if (text?.trim()) {
        return text;
      }
    }
  }

  return undefined;
}

function compileRegex(source: string, name: string): RegExp | null | undefined {
  if (!source.trim()) {
    return undefined;
  }
  try {
    return new RegExp(source, 'm');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(`${name}无效：${message}`, SCRIPT_NAME);
    console.warn(`[${SCRIPT_NAME}] ${name}无效：${source}`, error);
    return null;
  }
}

function extractBySettings(reasoning_content: string, settings: DreamExtractionSettings): string | undefined {
  const start_regex = compileRegex(settings.start_regex, '开头正则表达式');
  if (start_regex == null) {
    return undefined;
  }

  const start_match = start_regex.exec(reasoning_content);
  if (!start_match) {
    return undefined;
  }

  const start_index = start_match.index;
  const after_start_index = start_index + start_match[0].length;
  const end_regex = compileRegex(settings.end_regex, '结尾正则表达式');
  if (end_regex === undefined) {
    return reasoning_content.slice(start_index).trimEnd();
  }
  if (end_regex === null) {
    return undefined;
  }

  const end_match = end_regex.exec(reasoning_content.slice(after_start_index));
  if (!end_match) {
    return undefined;
  }

  const end_index = after_start_index + end_match.index + end_match[0].length;
  return reasoning_content.slice(start_index, end_index).trimEnd();
}

async function fillEmptyMessageFromReasoning(message_id: number): Promise<void> {
  const store = useDreamExtractionStore();
  if (!store.should_enable) {
    return;
  }

  const message = getChatMessages(message_id)[0];
  if (!message || message.role !== 'assistant') {
    return;
  }
  if (message.message.trim()) {
    return;
  }

  const reasoning_content = getReasoningContent(message);
  if (!reasoning_content?.trim()) {
    console.info(`[${SCRIPT_NAME}] 第 ${message_id} 楼正文为空，但没有可用的思考内容。`);
    return;
  }

  const dream_plot = extractBySettings(reasoning_content, store.settings);
  if (!dream_plot) {
    console.info(`[${SCRIPT_NAME}] 第 ${message_id} 楼正文为空，但没有从思考内容中提取到匹配文本。`);
    return;
  }

  await setChatMessages([{ message_id, message: dream_plot }], { refresh: 'affected' });
  console.info(`[${SCRIPT_NAME}] 已将第 ${message_id} 楼思考中的匹配内容写入正文。`);
}

$(() => {
  checkMinimumVersion('4.0.0', SCRIPT_NAME);
  const { destroy: destroyPanel } = initPanel();

  const event = eventMakeLast(
    tavern_events.MESSAGE_RECEIVED,
    errorCatched((message_id: number) => fillEmptyMessageFromReasoning(message_id)),
  );

  $(window).on('pagehide', () => {
    event.stop();
    destroyPanel();
  });
});
