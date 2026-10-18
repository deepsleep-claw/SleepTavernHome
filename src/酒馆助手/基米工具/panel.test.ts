import { createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import Panel from './Panel.vue';
import { SettingsSchema, SETTINGS_KEY } from './config';
import { useJimiStore } from './settings';
import { installVariables } from './test-helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('saves all settings to script variables and exposes five injection modes and multiple output paths', async () => {
  const variables = installVariables({ unrelated: 3, [SETTINGS_KEY]: SettingsSchema.parse({}) });
  const pinia = createPinia();
  const store = useJimiStore(pinia);
  const mount = document.createElement('div');
  document.body.append(mount);
  const app = createApp(Panel).use(pinia);
  app.mount(mount);
  const control = (name: string) =>
    [...mount.querySelectorAll('label')]
      .find(label => label.querySelector('span')?.textContent === name)
      ?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  const change = async (name: string, value: string) => {
    const input = control(name)!;
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await nextTick();
  };
  try {
    store.open = true;
    await nextTick();
    await nextTick();
    const enabled = mount.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(variables.get()[SETTINGS_KEY].enabled).toBe(true);
    expect([...control('提示词注入方式')!.querySelectorAll('option')].map(option => option.textContent)).toEqual([
      '不注入',
      '注入系统提示词',
      '注入User',
      '注入Assistant',
      '注入System',
    ]);
    expect(control('注入深度')).toBeUndefined();
    await change('提示词注入方式', 'user');
    await change('注入深度', '-1');
    await change('模型名称包含', 'MyGemini');
    await change('正文字段路径（每行一个）', 'thinking\ntext');
    await change(
      '参数 JSON Schema',
      '{"type":"object","properties":{"thinking":{"type":"string"},"text":{"type":"string"}},"required":["thinking","text"]}',
    );
    [...mount.querySelectorAll('button')].find(button => button.textContent === '保存设置')!.click();
    await nextTick();
    expect(variables.get()[SETTINGS_KEY]).toMatchObject({
      enabled: true,
      modelNameIncludes: 'MyGemini',
      promptMode: 'user',
      promptDepth: -1,
      tools: [{ outputPaths: ['thinking', 'text'] }],
    });
    expect(variables.get().unrelated).toBe(3);
    expect(mount.textContent).toContain('已保存到脚本变量');
    await change('参数 JSON Schema', '{');
    const previous = variables.get();
    [...mount.querySelectorAll('button')].find(button => button.textContent === '保存设置')!.click();
    await nextTick();
    expect(store.error).not.toBe('');
    expect(variables.get()).toEqual(previous);
    await change('提示词注入方式', 'none');
    expect(control('注入深度')).toBeUndefined();
    mount.querySelector<HTMLButtonElement>('button[aria-label="关闭基米工具设置"]')!.click();
    await nextTick();
    expect(store.open).toBe(false);
    expect(mount.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    app.unmount();
  }
});
