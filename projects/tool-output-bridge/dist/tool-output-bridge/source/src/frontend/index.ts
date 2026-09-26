import { CONFIG_KEY, REQUEST_KEY, PLUGIN_ID, DEFAULT_CONFIG, configFromPreset, globalConfigFromSettings, shouldActivate, validateConfig, type BridgeConfig, type GlobalConfig } from '../shared/config';
import { bridgeFetch, type BackendStatus } from './fetch';
import { mountPanel } from './panel';

const scope = globalThis as any;

async function start(): Promise<void> {
  const getContext = () => scope.SillyTavern?.getContext?.();
  const context = getContext();
  if (!context?.eventSource || !context?.getPresetManager || !context?.extensionSettings) throw new Error('此宿主缺少预设或扩展设置接口。');
  scope.__toolOutputBridge?.destroy();
  const delegate = window.fetch.bind(window);
  let backend: BackendStatus | null = null;
  const subscriptions: [string, (...args: any[]) => void][] = [];
  const manager = () => getContext().getPresetManager('openai');
  const current = () => configFromPreset(manager()?.readPresetExtensionField({ path: CONFIG_KEY }));
  const globals = () => globalConfigFromSettings(getContext().extensionSettings[CONFIG_KEY]);
  const element = document.createElement('div'); element.id = 'tool-output-bridge-settings';
  const container = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
  if (!container) throw new Error('没有找到扩展设置面板。');
  container.append(element);
  const panel = mountPanel(element, {
    save: async (value: BridgeConfig, name: string) => {
      const preset = manager();
      if (preset?.getSelectedPresetName() !== name) throw new Error('当前预设已切换，请重新确认配置。');
      const { enabled: _enabled, modelNameIncludes: _model, ...settings } = value;
      await preset.writePresetExtensionField({ name, path: CONFIG_KEY, value: settings });
    },
    saveGlobal: (value: GlobalConfig) => {
      const settings = globalConfigFromSettings(value);
      const ctx = getContext();
      ctx.extensionSettings[CONFIG_KEY] = settings;
      ctx.saveSettingsDebounced();
      return settings;
    },
    probe: async () => {
      try {
        const response = await delegate(`/api/plugins/${PLUGIN_ID}/status`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
        const status = response.ok ? await response.json() : null;
        backend = status?.id === PLUGIN_ID && status?.host && status?.version?.split('.')[0] === '0' ? status : null;
      } catch { backend = null; }
      return backend;
    },
  });
  const refresh = () => {
    try {
      const ctx = getContext();
      panel.loadGlobal(globals(), ctx.getChatCompletionModel?.(ctx.chatCompletionSettings) ?? '', ctx.chatCompletionSettings?.chat_completion_source ?? '');
    } catch (error) { panel.state.error = String(error); }
  };
  const load = () => {
    try { panel.load(current(), manager()?.getSelectedPresetName() ?? ''); }
    catch (error) { panel.load(DEFAULT_CONFIG, manager()?.getSelectedPresetName() ?? ''); panel.state.error = `预设配置读取失败：${String(error)} 请修正面板配置并保存。`; }
    refresh();
  };
  const listen = (name: string | undefined, listener: (...args: any[]) => void) => {
    if (!name) return; context.eventSource.on(name, listener); subscriptions.push([name, listener]);
  };
  const events = context.eventTypes ?? context.event_types ?? {};
  listen(events.CHAT_COMPLETION_SETTINGS_READY, body => {
    const global = globals();
    if (shouldActivate(body, global)) body[REQUEST_KEY] = validateConfig({ ...current(), ...global });
  });
  for (const event of new Set([events.OAI_PRESET_CHANGED_AFTER, events.PRESET_CHANGED, events.PRESET_RENAMED, events.APP_READY])) listen(event, load);
  for (const event of new Set([events.CHATCOMPLETION_SOURCE_CHANGED, events.CHATCOMPLETION_MODEL_CHANGED, events.SETTINGS_UPDATED, events.EXTENSION_SETTINGS_LOADED, events.SETTINGS_LOADED_AFTER])) listen(event, refresh);
  const wrapped = bridgeFetch(delegate, document.baseURI, () => backend);
  window.fetch = wrapped;
  scope.__toolOutputBridge = { destroy() {
    if (window.fetch === wrapped) window.fetch = delegate;
    for (const [name, listener] of subscriptions) context.eventSource.removeListener(name, listener);
    panel.destroy(); element.remove();
  } };
  load(); await panel.probe();
}

const ready = () => { void start().catch(error => { console.error('[基米工具]', error); scope.toastr?.error(String(error), '基米工具'); }); };
if (scope.jQuery) scope.jQuery(ready); else ready();
