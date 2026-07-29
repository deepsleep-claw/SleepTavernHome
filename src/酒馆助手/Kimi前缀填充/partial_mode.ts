import type { useKimiPartialModeStore } from './store';
import { SCRIPT_NAME } from './store';

type KimiPartialModeStore = ReturnType<typeof useKimiPartialModeStore>;
type PartialSendingMessage = SillyTavern.SendingMessage & { partial?: boolean };
type ChatCompletionSettings = {
  messages?: SillyTavern.SendingMessage[];
  dryRun?: boolean;
  dry_run?: boolean;
  json_schema?: {
    value?: Record<string, unknown>;
  };
  response_format?: {
    type?: string;
  };
  tools?: unknown[];
};

function hasStructuredOutput(settings: ChatCompletionSettings): boolean {
  const schema = settings.json_schema?.value;
  if (schema && Object.keys(schema).length > 0) {
    return true;
  }
  return ['json_object', 'json_schema'].includes(settings.response_format?.type ?? '');
}

function hasToolContext(settings: ChatCompletionSettings, messages: SillyTavern.SendingMessage[]): boolean {
  return (
    (Array.isArray(settings.tools) && settings.tools.length > 0) ||
    messages.some(
      message => message.role === 'tool' || (Array.isArray(message.tool_calls) && message.tool_calls.length > 0),
    )
  );
}

export function initializeKimiPartialMode(store: KimiPartialModeStore): { destroy: () => void } {
  const dry_run_messages = new WeakSet<SillyTavern.SendingMessage[]>();
  const prompt_event = eventMakeLast(
    tavern_events.CHAT_COMPLETION_PROMPT_READY,
    ({ chat, dryRun }: { chat: SillyTavern.SendingMessage[]; dryRun: boolean }) => {
      if (dryRun) {
        dry_run_messages.add(chat);
      }
    },
  );
  const completion_event = eventMakeLast(
    tavern_events.CHAT_COMPLETION_SETTINGS_READY,
    (settings: ChatCompletionSettings) => {
      if (!store.should_enable || !store.enabled || settings.dryRun === true || settings.dry_run === true) {
        return;
      }

      const messages = settings.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        return;
      }
      if (dry_run_messages.has(messages)) {
        return;
      }
      if (hasStructuredOutput(settings) || hasToolContext(settings, messages)) {
        return;
      }

      const last_message = messages.at(-1) as PartialSendingMessage | undefined;
      if (last_message?.role !== 'assistant' || typeof last_message.content !== 'string' || !last_message.content) {
        return;
      }

      last_message.partial = true;
      console.debug(`[${SCRIPT_NAME}] 已为末尾 assistant 消息启用 Partial Mode。`);
    },
  );

  return {
    destroy: () => {
      prompt_event.stop();
      completion_event.stop();
    },
  };
}
