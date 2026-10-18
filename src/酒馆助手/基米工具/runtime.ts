import {
  REQUEST_KEY,
  injectPrompt,
  injectRequest,
  shouldActivate,
} from '../../../projects/tool-output-bridge/src/shared/config';
import { describeError, requestConfig, SCRIPT_NAME, type Settings } from './config';
import { createHelperFetch } from './fetch';

export interface RuntimeOptions {
  host: { fetch: typeof fetch; document: { baseURI: string } };
  settings: () => Settings;
  model: () => { model: string; chat_completion_source: string };
  warning: (message: string) => void;
}

export function createJimiRuntime(options: RuntimeOptions): { destroy: () => void } {
  const subscriptions: EventOnReturn[] = [];
  const warned = new Set<string>();
  let generationType: string | null = null;
  let active = true;
  const warn = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    options.warning(message);
    console.warn(`[${SCRIPT_NAME}]`, message);
  };
  const settings = () => {
    try {
      return requestConfig(options.settings());
    } catch (error) {
      warn(`配置读取失败：${describeError(error)}`);
      return null;
    }
  };
  subscriptions.push(
    eventOn(tavern_events.GENERATION_STARTED, type => {
      generationType = type;
      warned.clear();
      options.warning('');
    }),
  );
  subscriptions.push(
    eventOn(tavern_events.GENERATION_ENDED, () => {
      generationType = null;
    }),
  );
  subscriptions.push(
    eventOn(tavern_events.GENERATION_STOPPED, () => {
      generationType = null;
    }),
  );
  subscriptions.push(
    eventMakeLast(tavern_events.CHAT_COMPLETION_PROMPT_READY, ({ chat, dryRun }) => {
      if (!active || (!dryRun && generationType === null)) return;
      const config = settings();
      if (config && shouldActivate({ ...options.model(), type: generationType ?? 'normal' }, config))
        injectPrompt(chat, config);
    }),
  );
  subscriptions.push(
    eventMakeLast(tavern_events.CHAT_COMPLETION_SETTINGS_READY, body => {
      if (!active || body.dry_run || body.dryRun) return;
      const config = settings();
      if (!config || !shouldActivate({ ...body, type: body.type ?? generationType ?? 'normal' }, config)) return;
      if (!Array.isArray(body.messages)) {
        warn('聊天请求缺少消息列表。');
        return;
      }
      Object.assign(body, injectRequest(body, config, warn));
      body[REQUEST_KEY] = config;
    }),
  );
  const previousFetch = options.host.fetch;
  const helperFetch = createHelperFetch(previousFetch.bind(options.host), options.host.document.baseURI);
  const wrapped: typeof fetch = (input, init) =>
    active ? helperFetch(input, init) : previousFetch.call(options.host, input, init);
  options.host.fetch = wrapped;
  return {
    destroy() {
      active = false;
      for (const subscription of subscriptions) subscription.stop();
      if (options.host.fetch === wrapped) options.host.fetch = previousFetch;
    },
  };
}
