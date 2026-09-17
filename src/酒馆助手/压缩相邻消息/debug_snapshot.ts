import { hashGreenCacheContent } from './green_cache';
import type { DebugPromptMessage, DebugPromptPart, DebugPromptSnapshot } from './debug_types';

export function countTextCharacters(text: string): number {
  let count = 0;
  for (const _character of text) count++;
  return count;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function captureFinalPrompt(messages: SillyTavern.SendingMessage[]): DebugPromptSnapshot {
  let text_chars = 0;
  const textPart = (text: string): DebugPromptPart => {
    text_chars += countTextCharacters(text);
    return { kind: 'text', 详细内容: text };
  };
  const snapshots: DebugPromptMessage[] = messages.map(message => {
    const { content, ...metadata } = message;
    return {
      role: message.role,
      metadata: JSON.stringify(canonicalValue(metadata)),
      format: typeof content === 'string' ? 'text' : Array.isArray(content) ? 'parts' : 'empty',
      parts:
        typeof content === 'string'
          ? [textPart(content)]
          : (content ?? []).map(part =>
              part.type === 'text'
                ? textPart(part.text)
                : {
                    kind: 'other',
                    type: part.type,
                    signature: hashGreenCacheContent(JSON.stringify(canonicalValue(part))),
                  },
            ),
    };
  });
  return { version: 1, stage: 'after_squash', messages: snapshots, text_chars };
}
