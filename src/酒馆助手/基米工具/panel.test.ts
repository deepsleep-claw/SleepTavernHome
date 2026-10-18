import { createPinia } from 'pinia';
import { createApp, nextTick, reactive } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import { mountExtensionSettings } from '../现代化界面/extension-settings-module';
import Panel from './Panel.vue';
import { SettingsSchema, SETTINGS_KEY } from './config';
import { useJimiStore } from './settings';
import { installVariables } from './test-helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  sessionStorage.clear();
});

it('appears in modern extension navigation when mounted after the navigation is active', async () => {
  const variables = installVariables({ [SETTINGS_KEY]: SettingsSchema.parse({}) });
  document.body.innerHTML = `
    <div id="rm_extensions_block" class="openDrawer">
      <div class="extensions_block">
        <div id="extensions_settings">
          <div id="squash-settings" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>压缩相邻消息</b></div>
            <div class="inline-drawer-content">设置</div>
          </div>
        </div>
        <div id="extensions_settings2"></div>
      </div>
    </div>`;
  const toggleDrawer = (event: Event) => {
    const header = (event.target as Element).closest('.inline-drawer-toggle');
    const content = header?.parentElement?.querySelector<HTMLElement>(':scope > .inline-drawer-content');
    if (content) content.style.display = content.style.display === 'none' ? 'block' : 'none';
  };
  document.addEventListener('click', toggleDrawer);
  const modern = mountExtensionSettings(
    reactive({ is_active: true, settings: { modernExtensionSettings: true } }) as Parameters<
      typeof mountExtensionSettings
    >[0],
  );
  const mount = document.createElement('div');
  mount.id = 'jimi-tools-settings';
  document.querySelector('#extensions_settings2')!.append(mount);
  const app = createApp(Panel).use(createPinia());
  app.mount(mount);
  const content = mount.querySelector<HTMLElement>('.inline-drawer-content')!;
  content.style.display = 'none';
  try {
    expect(mount.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-extension-key="id:jimi-tools-settings"]')?.textContent).toBe('基米工具');
    });
    variables.set({ [SETTINGS_KEY]: SettingsSchema.parse({ modelNameIncludes: 'UpdatedGemini' }) });
    document.querySelector<HTMLButtonElement>('[data-extension-key="id:jimi-tools-settings"]')!.click();
    await vi.waitFor(() => {
      expect(mount.classList.contains('th-modern-extension-host-active')).toBe(true);
      expect(content.style.display).toBe('block');
      expect(mount.querySelector<HTMLInputElement>('input[maxlength="128"]')!.value).toBe('UpdatedGemini');
    });
    expect(document.querySelector('#squash-settings')?.classList.contains('th-modern-extension-host-hidden')).toBe(
      true,
    );
  } finally {
    modern.destroy();
    app.unmount();
    document.removeEventListener('click', toggleDrawer);
  }
});

it('saves all settings to script variables and exposes five injection modes and multiple output paths', async () => {
  const variables = installVariables({ unrelated: 3, [SETTINGS_KEY]: SettingsSchema.parse({}) });
  const pinia = createPinia();
  const store = useJimiStore(pinia);
  const mount = document.createElement('div');
  document.body.innerHTML = '<div id="extensions_settings2"></div>';
  document.querySelector('#extensions_settings2')!.append(mount);
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
    expect(document.querySelector('#extensions_settings2 .inline-drawer-header b')?.textContent).toBe('基米工具');
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
  } finally {
    app.unmount();
  }
});
