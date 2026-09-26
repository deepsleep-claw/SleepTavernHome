import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG, CONFIG_KEY, REQUEST_KEY } from '../src/shared/config';

test('panel keeps global model gating across preset switches and saves per-preset tools', async () => {
  const compiled = await build({ entryPoints: [resolve('src/frontend/index.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' } });
  const window = new Window({ url: 'http://localhost:8000' });
  const handlers = new Map<string, Function[]>();
  const presets: Record<string, any> = { A: { ...structuredClone(DEFAULT_CONFIG), enabled: false }, B: { ...structuredClone(DEFAULT_CONFIG), enabled: true } };
  const extensionSettings: Record<string, any> = {};
  let selected = 'A'; let model = 'google/GEMINI-test'; let saved = 0;
  const chatCompletionSettings = { chat_completion_source: 'custom' };
  const manager = {
    getSelectedPresetName: () => selected,
    readPresetExtensionField: ({ path }: any) => { assert.equal(path, CONFIG_KEY); return presets[selected]; },
    writePresetExtensionField: async ({ name = selected, path, value }: any) => { assert.equal(path, CONFIG_KEY); presets[name] = value; },
  };
  const fire = (name: string, body?: any) => handlers.get(name)?.forEach(cb => cb(body));
  const marked = (overrides = {}) => {
    const body: any = { type: 'normal', model, chat_completion_source: chatCompletionSettings.chat_completion_source, ...overrides };
    fire('ready', body); return body[REQUEST_KEY];
  };
  Object.assign(window, { structuredClone, TextDecoder, TextEncoder, ReadableStream, TransformStream, SillyTavern: { getContext: () => ({
    getPresetManager: () => manager, extensionSettings, chatCompletionSettings,
    getChatCompletionModel: () => model, saveSettingsDebounced: () => { saved++; },
    eventSource: { on: (name: string, cb: Function) => handlers.set(name, [...handlers.get(name) ?? [], cb]), removeListener: (name: string, cb: Function) => handlers.set(name, handlers.get(name)?.filter(listener => listener !== cb) ?? []) },
    eventTypes: { CHAT_COMPLETION_SETTINGS_READY: 'ready', OAI_PRESET_CHANGED_AFTER: 'preset', CHATCOMPLETION_SOURCE_CHANGED: 'source', CHATCOMPLETION_MODEL_CHANGED: 'model' },
  }) } });
  window.fetch = async () => new window.Response('{}', { status: 404 }) as any;
  window.document.body.innerHTML = '<div><select id="settings_preset_openai"></select></div><div id="extensions_settings2"></div>';
  const input = (label: string) => [...window.document.querySelectorAll('label')].find(element => element.textContent?.includes(label))!.querySelector('input')!;
  const change = async (element: any, value: string | boolean) => { if (typeof value === 'boolean') element.checked = value; else element.value = value; element.dispatchEvent(new window.Event('change')); await window.happyDOM.waitUntilComplete(); };
  try {
    window.eval(compiled.outputFiles[0].text);
    await window.happyDOM.waitUntilComplete();
    assert.ok(window.document.querySelector('.tob-panel.inline-drawer > .inline-drawer-toggle.inline-drawer-header'));
    assert.ok(window.document.querySelector('.tob-panel > .inline-drawer-content'));
    assert.match(window.document.body.textContent!, /当前适配：OpenAI 兼容工具/);
    assert.equal(marked(), undefined);
    selected = 'B'; fire('preset'); assert.equal(marked(), undefined);
    await change(input('启用基米工具'), true);
    assert.equal(extensionSettings[CONFIG_KEY].enabled, true);
    assert.equal(marked().enabled, true);
    assert.equal(marked({ model: 'another-model' }), undefined);
    assert.equal(marked({ type: 'quiet' }), undefined);
    selected = 'A'; fire('preset'); await window.happyDOM.waitUntilComplete();
    assert.equal(input('启用基米工具').checked, true); assert.equal(marked().enabled, true);
    assert.equal(presets.A.enabled, false);
    await change(input('模型名称包含'), 'Custom');
    assert.equal(marked(), undefined); model = 'vendor/CUSTOM-v2'; fire('model'); assert.equal(marked().enabled, true);
    chatCompletionSettings.chat_completion_source = 'vertexai'; fire('source'); await window.happyDOM.waitUntilComplete();
    assert.match(window.document.body.textContent!, /当前适配：Vertex 工具/);
    chatCompletionSettings.chat_completion_source = 'makersuite'; fire('source'); await window.happyDOM.waitUntilComplete();
    assert.match(window.document.body.textContent!, /当前适配：Gemini 原生工具/);
    await change(input('模型名称包含'), '  ');
    assert.equal(extensionSettings[CONFIG_KEY].modelNameIncludes, 'Custom');
    selected = 'B'; fire('preset'); await window.happyDOM.waitUntilComplete();
    const buttons = [...window.document.querySelectorAll('button')];
    buttons.find(button => button.textContent === '添加工具')!.click(); await window.happyDOM.waitUntilComplete();
    buttons.find(button => button.textContent === '保存到当前预设')!.click(); await window.happyDOM.waitUntilComplete();
    assert.equal(presets.B.tools.length, 2, window.document.body.textContent!); assert.equal(presets.A.tools.length, 1);
    assert.equal(presets.B.enabled, undefined); assert.equal(presets.B.modelNameIncludes, undefined);
    window.eval(compiled.outputFiles[0].text); await window.happyDOM.waitUntilComplete();
    assert.equal(input('启用基米工具').checked, true); assert.equal(input('模型名称包含').value, 'Custom');
    assert.equal(handlers.get('ready')!.length, 1);
    await change(input('启用基米工具'), false);
    assert.equal(marked(), undefined); assert.equal(saved, 3);
  } finally { (window as any).__toolOutputBridge?.destroy(); await window.happyDOM.close(); }
});
