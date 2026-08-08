// @vitest-environment happy-dom

import { createApp, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AgentWindow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('呈现五步引导、角色缺失错误与API设置页，并把引导状态保存到酒馆设置', async () => {
    const saveSettingsDebounced = vi.fn(async () => undefined);
    vi.stubGlobal('SillyTavern', {
      extensionSettings: {},
      groupId: '',
      saveSettingsDebounced,
    });
    vi.stubGlobal('getCurrentCharacterName', () => null);
    vi.stubGlobal('getCurrentCharacterId', () => null);
    vi.stubGlobal('toastr', { error: vi.fn() });
    const { default: AgentWindow } = await import('./AgentWindow.vue');
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(AgentWindow);
    app.mount(root);
    await vi.waitFor(() => expect(root.textContent).toContain('快速引导 1 / 5'));
    expect(root.textContent).toContain('先打开角色卡');
    const skip = [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === '跳过');
    skip?.click();
    await vi.waitFor(() => expect(root.textContent).not.toContain('快速引导 1 / 5'));
    expect(saveSettingsDebounced).toHaveBeenCalled();
    await vi.waitFor(() => expect(root.textContent).toContain('请先打开一张角色卡'));

    const apiTab = [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === 'API');
    apiTab?.click();
    await nextTick();
    expect(root.textContent).toContain('接口类型只决定协议');
    expect(root.textContent).toContain('保存（不测试连接）');
    expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toBe('{}');
    app.unmount();
  });
});
