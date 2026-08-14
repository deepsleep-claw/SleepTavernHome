// @vitest-environment happy-dom

import { createApp, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultModelSettings } from '../../../core/provider/model-catalog';
import type { ApiProvider } from '../../../core/provider/provider-config';
import SessionModelMenu from './SessionModelMenu.vue';

const runtimeMock = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock('../../composables/runtime', () => ({
  useDreamCardAgent: () => runtimeMock.context,
}));

const secrets = {
  algorithm: 'AES-GCM' as const,
  ciphertext: '',
  iterations: 1,
  iv: '',
  salt: '',
  version: 1 as const,
};

const providers: ApiProvider[] = [
  {
    baseURL: 'https://example.test/v1',
    enabled: true,
    id: 'provider-a',
    interfaceType: 'openai-responses',
    models: [
      {
        compatibilityMode: 'standard',
        enabled: true,
        id: 'model-a',
        modelId: 'gpt-test',
        modelSettings: defaultModelSettings(),
        name: '测试模型',
      },
      {
        compatibilityMode: 'standard',
        enabled: false,
        id: 'model-disabled',
        modelId: 'hidden-test',
        modelSettings: defaultModelSettings(),
        name: '隐藏模型',
      },
    ],
    name: '测试 Provider',
    secrets,
  },
];

let mounted: { root: HTMLElement; unmount: () => void } | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted?.root.remove();
  mounted = undefined;
});

describe('SessionModelMenu', () => {
  it('按 Provider 分组列出启用模型，并将选择写回当前会话', async () => {
    const selectSessionModel = vi.fn(async () => true);
    runtimeMock.context = {
      action: async (callback: () => unknown) => {
        await callback();
        return true;
      },
      runtime: { selectSessionModel, setModelControls: vi.fn(async () => true) },
      state: shallowRef({
        active: {
          modelControls: { reasoningEffort: 'auto', webSearch: false },
          status: 'completed',
        },
        busy: false,
        providers,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionModelMenu);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    root.querySelector<HTMLButtonElement>('.dca-session-model-trigger')?.click();
    await nextTick();
    expect(root.querySelector('.dca-model-menu-backdrop')?.tagName).toBe('DIV');
    const rootButtons = [...root.querySelectorAll<HTMLButtonElement>('.dca-model-menu-root > button')];
    rootButtons.find(button => button.textContent?.includes('模型'))?.click();
    await vi.waitFor(() => expect(root.querySelector('input[placeholder="搜索模型"]')).not.toBeNull());

    expect(root.querySelector('.dca-model-menu-panel > header')).toBeNull();
    const search = root.querySelector<HTMLInputElement>('input[placeholder="搜索模型"]')!;
    expect(search).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="返回模型与推理"]')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('button[aria-label="返回模型与推理"]')?.click();
    await vi.waitFor(() => expect(root.querySelector('.dca-model-menu-root')).not.toBeNull());
    [...root.querySelectorAll<HTMLButtonElement>('.dca-model-menu-root > button')]
      .find(button => button.textContent?.includes('模型'))
      ?.click();
    await vi.waitFor(() => expect(root.querySelector('input[placeholder="搜索模型"]')).not.toBeNull());
    expect(root.querySelector('.dca-model-menu-list')?.textContent).toContain('测试 Provider');
    expect(root.querySelector('.dca-model-menu-list')?.textContent).toContain('测试模型');
    expect(root.querySelector('.dca-model-menu-list')?.textContent).not.toContain('隐藏模型');

    search.value = '不存在的模型';
    search.dispatchEvent(new Event('input'));
    await nextTick();
    expect(root.querySelector('.dca-model-menu-list')?.textContent).toContain('没有匹配的模型');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await nextTick();

    const modelButton = [...root.querySelectorAll<HTMLButtonElement>('.dca-model-menu-list button')].find(button =>
      button.textContent?.includes('测试模型'),
    );
    modelButton?.click();
    expect(selectSessionModel).toHaveBeenCalledWith({ modelId: 'model-a', providerId: 'provider-a' });
    await vi.waitFor(() => expect(root.querySelector('.dca-model-menu-root')).not.toBeNull());
  });

  it('桌面分离模式直接展示模型列表，并在选择后关闭浮层', async () => {
    const selectSessionModel = vi.fn(async () => true);
    runtimeMock.context = {
      action: async (callback: () => unknown) => {
        await callback();
        return true;
      },
      runtime: { selectSessionModel, setModelControls: vi.fn(async () => true) },
      state: shallowRef({
        active: {
          modelControls: { reasoningEffort: 'auto', webSearch: false },
          status: 'completed',
        },
        busy: false,
        providers,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionModelMenu, { mode: 'model' });
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    root.querySelector<HTMLButtonElement>('.dca-session-model-trigger')?.click();
    await nextTick();
    expect(root.querySelector('.dca-model-menu-root')).toBeNull();
    expect(root.querySelector('.dca-model-menu-list')?.textContent).toContain('测试模型');
    const header = root.querySelector('.dca-model-subpage-header')!;
    expect(header.children).toHaveLength(3);
    expect(header.children[0].tagName).toBe('SPAN');
    expect(header.children[1].textContent).toBe('选择模型');

    const modelButton = [...root.querySelectorAll<HTMLButtonElement>('.dca-model-menu-list button')].find(button =>
      button.textContent?.includes('测试模型'),
    )!;
    modelButton.click();
    await vi.waitFor(() => expect(root.querySelector('.dca-model-menu-backdrop')).toBeNull());
    expect(selectSessionModel).toHaveBeenCalledWith({ modelId: 'model-a', providerId: 'provider-a' });
  });
});
