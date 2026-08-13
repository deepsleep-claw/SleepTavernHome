// @vitest-environment happy-dom

import { createApp, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultModelSettings } from '../../../core/provider/model-catalog';
import type { ApiProvider } from '../../../core/provider/provider-config';
import ApiSettings from './ApiSettings.vue';

const runtimeMock = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock('../../composables/runtime', () => ({
  useDreamCardAgent: () => runtimeMock.context,
}));

const provider: ApiProvider = {
  baseURL: 'https://example.test/v1',
  enabled: true,
  id: 'provider-a',
  interfaceType: 'openai-responses',
  models: [{
    compatibilityMode: 'standard',
    enabled: true,
    id: 'model-a',
    modelId: 'model-a',
    modelSettings: defaultModelSettings(),
    name: '模型 A',
  }],
  name: 'Provider A',
  secrets: { algorithm: 'AES-GCM', ciphertext: '', iterations: 1, iv: '', salt: '', version: 1 },
};

let mounted: { root: HTMLElement; unmount: () => void } | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted?.root.remove();
  mounted = undefined;
  vi.unstubAllGlobals();
});

describe('ApiSettings', () => {
  it('在列表顶部新建、左对齐展示 Provider，并通过行尾按钮二次确认删除', async () => {
    const success = vi.fn();
    const removeProvider = vi.fn(async () => undefined);
    const saveProvider = vi.fn(async () => provider);
    vi.stubGlobal('toastr', { error: vi.fn(), success, warning: vi.fn() });
    runtimeMock.context = {
      action: async (callback: () => unknown) => {
        await callback();
        return true;
      },
      runtime: {
        removeProvider,
        revealProvider: vi.fn(async () => ({ apiKey: '', extraParameters: { format: 'yaml', text: '' }, headers: {} })),
        saveProvider,
      },
      state: shallowRef({ defaultModelSelection: undefined, providers: [provider] }),
    };

    const root = document.createElement('div');
    root.className = 'dca-app';
    document.body.append(root);
    const app = createApp(ApiSettings);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };
    await vi.waitFor(() => expect(root.querySelector('.dca-provider-select')?.textContent).toContain('Provider A'));

    const newButton = root.querySelector<HTMLButtonElement>('.dca-provider-new')!;
    const providerItem = root.querySelector<HTMLElement>('.dca-provider-item')!;
    expect(newButton.textContent).toContain('新建 Provider');
    expect(newButton.compareDocumentPosition(providerItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(providerItem.querySelector('.dca-provider-select span')?.textContent).toContain('1 个模型');

    const saveButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '保存 Provider')!;
    saveButton.click();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Provider“Provider A”已保存。', '梦境创客'));

    root.querySelector<HTMLButtonElement>('.dca-provider-delete')!.click();
    await nextTick();
    expect(root.querySelector('.dca-provider-confirm')?.textContent).toContain('Provider“Provider A”');
    expect(removeProvider).not.toHaveBeenCalled();

    const confirm = [...root.querySelectorAll<HTMLButtonElement>('.dca-provider-confirm button')].find(button => button.textContent?.trim() === '确认删除')!;
    confirm.click();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Provider“Provider A”已删除。', '梦境创客'));
    expect(removeProvider).toHaveBeenCalledWith('provider-a');
  });
});
