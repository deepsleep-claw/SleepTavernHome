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
  models: [
    {
      compatibilityMode: 'standard',
      enabled: true,
      id: 'model-a',
      modelId: 'model-a',
      modelSettings: defaultModelSettings(),
      name: '模型 A',
    },
  ],
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

    const saveButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.trim() === '保存 Provider',
    )!;
    saveButton.click();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Provider“Provider A”已保存。', '梦境创客'));

    root.querySelector<HTMLButtonElement>('.dca-provider-delete')!.click();
    await nextTick();
    expect(root.querySelector('.dca-provider-confirm')?.textContent).toContain('Provider“Provider A”');
    expect(removeProvider).not.toHaveBeenCalled();

    const confirm = [...root.querySelectorAll<HTMLButtonElement>('.dca-provider-confirm button')].find(
      button => button.textContent?.trim() === '确认删除',
    )!;
    confirm.click();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Provider“Provider A”已删除。', '梦境创客'));
    expect(removeProvider).toHaveBeenCalledWith('provider-a');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const requestValues = {
  apiKey: '',
  bodyParameters: { text: 'old: true' },
  excludedBodyParameters: { text: '' },
  requestHeaders: { text: '' },
};

async function mountSettings(overrides: Record<string, unknown> = {}) {
  const state = shallowRef({
    defaultModelSelection: undefined,
    providers: [provider, { ...provider, id: 'provider-b', name: 'Provider B' }],
  });
  vi.stubGlobal('toastr', { success: vi.fn(), error: vi.fn(), warning: vi.fn() });
  runtimeMock.context = {
    action: async (work: () => Promise<unknown>) => {
      try {
        await work();
        return true;
      } catch {
        return false;
      }
    },
    runtime: { revealProvider: async () => requestValues, ...overrides },
    state,
  };
  const root = document.createElement('div');
  root.className = 'dca-app';
  document.body.append(root);
  const app = createApp(ApiSettings);
  app.mount(root);
  mounted = { root, unmount: () => app.unmount() };
  await nextTick();
  const save = () => root.querySelector<HTMLButtonElement>('.dca-api-provider-toolbar .dca-btn-primary')!.click();
  const input = (selector: string, value: string) => {
    const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return field;
  };
  return { root, save, input, state };
}

describe('API 设置编辑与保存', () => {
  it('迟到的读取保留新输入，并填充未编辑字段', async () => {
    const read = deferred<typeof requestValues>();
    const view = await mountSettings({ revealProvider: () => read.promise });
    const field = view.input('.dca-advanced-request textarea', 'edited: true');
    read.resolve({ ...requestValues, requestHeaders: { text: 'X-Test: old' } });
    await nextTick();
    await nextTick();
    expect(field.value).toBe('edited: true');
    expect(view.root.querySelectorAll<HTMLTextAreaElement>('.dca-advanced-request textarea')[2].value).toBe(
      'X-Test: old',
    );
  });

  it('A→B→A 后第一轮读取不能覆盖新一轮读取', async () => {
    const first = deferred<typeof requestValues>();
    const revealProvider = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ...requestValues, bodyParameters: { text: 'fresh: true' } });
    const view = await mountSettings({ revealProvider });
    const choices = view.root.querySelectorAll<HTMLButtonElement>('.dca-provider-select');
    choices[1].click();
    choices[0].click();
    await nextTick();
    first.resolve(requestValues);
    await nextTick();
    await nextTick();
    expect(view.root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('fresh: true');
  });

  it('保存未完成时重复点击只提交一次', async () => {
    const pending = deferred<ApiProvider>();
    const saveProvider = vi.fn(() => pending.promise);
    const view = await mountSettings({ saveProvider });
    view.save();
    view.save();
    pending.resolve(provider);
    await vi.waitFor(() => expect(toastr.success).toHaveBeenCalled());
    expect(saveProvider).toHaveBeenCalledTimes(1);
  });

  it('A 的保存回执不会切回 A 或清空 B 的 Key', async () => {
    const pending = deferred<ApiProvider>();
    const view = await mountSettings({ saveProvider: () => pending.promise });
    view.save();
    view.root.querySelectorAll<HTMLButtonElement>('.dca-provider-select')[1].click();
    await nextTick();
    const key = view.input('input[type="password"]', 'new-b-key');
    pending.resolve(provider);
    await vi.waitFor(() => expect(toastr.success).toHaveBeenCalled());
    expect(view.root.querySelector('.dca-provider-item.active strong')?.textContent).toBe('Provider B');
    expect(key.value).toBe('new-b-key');
  });

  it('新建保存期间继续输入，回执只绑定 ID 并保留新修改', async () => {
    const pending = deferred<ApiProvider>();
    const saveProvider = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(provider);
    const view = await mountSettings({ saveProvider });
    view.root.querySelector<HTMLButtonElement>('.dca-provider-new')!.click();
    view.input('.dca-provider-card input[type="text"]', 'first name');
    view.save();
    const name = view.input('.dca-provider-card input[type="text"]', 'later name');
    const key = view.input('input[type="password"]', 'later-key');
    pending.resolve({ ...provider, id: 'created', name: 'first name' });
    await vi.waitFor(() => expect(toastr.success).toHaveBeenCalled());
    expect(name.value).toBe('later name');
    expect(key.value).toBe('later-key');
    expect(view.root.textContent).toContain('仍有新修改待保存');
    view.save();
    expect(saveProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'created', name: 'later name', apiKey: 'later-key' }),
      expect.arrayContaining(['name', 'apiKey']),
    );
  });

  it('读取未完成时保存，只提交实际编辑的字段', async () => {
    const read = deferred<typeof requestValues>();
    const saveProvider = vi.fn(async () => provider);
    const view = await mountSettings({ revealProvider: () => read.promise, saveProvider });
    view.input('.dca-provider-card input[type="text"]', 'renamed');
    view.save();
    expect(saveProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'renamed' }), ['name']);
    read.resolve(requestValues);
  });

  it('保存失败后保留表单并允许再次提交', async () => {
    const saveProvider = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(provider);
    const view = await mountSettings({ saveProvider });
    const field = view.input('.dca-advanced-request textarea', 'keep: true');
    view.save();
    await vi.waitFor(() => expect(view.root.textContent).toContain('保存失败'));
    expect(field.value).toBe('keep: true');
    view.save();
    await vi.waitFor(() => expect(toastr.success).toHaveBeenCalled());
    expect(saveProvider).toHaveBeenCalledTimes(2);
  });
});
