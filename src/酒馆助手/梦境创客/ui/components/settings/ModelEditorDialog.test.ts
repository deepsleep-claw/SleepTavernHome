// @vitest-environment happy-dom
import { createApp, h, nextTick, shallowRef } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import ModelEditorDialog from './ModelEditorDialog.vue';
import { defaultModelSettings } from '../../../core/provider/model-catalog';
import type { ApiModel, ApiProvider } from '../../../core/provider/provider-config';

const mock = vi.hoisted(() => ({ context: undefined as unknown }));
vi.mock('../../composables/runtime', () => ({ useDreamCardAgent: () => mock.context }));
let cleanup = () => {};
afterEach(() => cleanup());
const request = { bodyParameters: { text: '' }, excludedBodyParameters: { text: '' }, requestHeaders: { text: '' } };
const model: ApiModel = {
  id: 'model-a',
  name: 'Model A',
  modelId: 'a',
  enabled: true,
  compatibilityMode: 'standard',
  modelSettings: defaultModelSettings(),
};
const provider: ApiProvider = {
  id: 'provider-a',
  name: 'Provider A',
  models: [model],
  baseURL: 'https://example.test',
  enabled: true,
  interfaceType: 'openai-chat',
  secrets: { algorithm: 'AES-GCM', ciphertext: '', iv: '', salt: '', iterations: 1, version: 1 },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function mount(overrides: Record<string, unknown>) {
  const props = shallowRef<{ open: boolean; model?: ApiModel; provider: ApiProvider }>({ open: true, model, provider });
  const saved = vi.fn();
  mock.context = {
    runtime: { revealModel: async () => request, ...overrides },
    action: async (work: () => unknown) => {
      await work();
      return true;
    },
  };
  const root = document.createElement('div');
  root.className = 'dca-app';
  document.body.append(root);
  const mountPoint = document.createElement('div');
  root.append(mountPoint);
  const app = createApp({ render: () => h(ModelEditorDialog, { ...props.value, onSaved: saved }) });
  app.mount(mountPoint);
  cleanup = () => {
    app.unmount();
    root.remove();
  };
  await nextTick();
  await nextTick();
  const save = () => root.querySelector<HTMLButtonElement>('footer .dca-btn-primary')!.click();
  return { root, props, saved, save };
}

it('切换模型后，迟到的读取不会混入前一模型的请求配置', async () => {
  const first = deferred<typeof request>();
  const revealModel = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({ ...request, requestHeaders: { text: 'X-Model: B' } });
  const view = await mount({ revealModel });
  view.props.value = { ...view.props.value, model: { ...model, id: 'model-b', name: 'Model B', modelId: 'b' } };
  await nextTick();
  await nextTick();
  first.resolve({ ...request, requestHeaders: { text: 'X-Model: A' } });
  await nextTick();
  await nextTick();
  expect(view.root.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('Model B');
  expect([...view.root.querySelectorAll<HTMLTextAreaElement>('textarea')].map(x => x.value)).toContain('X-Model: B');
});

it('保存去重，关闭重开后的旧回执不会关闭新编辑器', async () => {
  const pending = deferred<ApiModel>();
  const saveModel = vi.fn(() => pending.promise);
  const view = await mount({ saveModel });
  view.save();
  view.save();
  expect(saveModel).toHaveBeenCalledTimes(1);
  view.props.value = { ...view.props.value, open: false };
  await nextTick();
  view.props.value = { ...view.props.value, open: true };
  await nextTick();
  pending.resolve(model);
  await nextTick();
  await nextTick();
  await nextTick();
  expect(view.saved).not.toHaveBeenCalled();
});

it('保存期间继续修改时保留编辑器和新输入', async () => {
  const pending = deferred<ApiModel>();
  const view = await mount({ saveModel: () => pending.promise });
  view.save();
  const name = view.root.querySelector<HTMLInputElement>('input[type="text"]')!;
  name.value = 'new edit';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  pending.resolve(model);
  await vi.waitFor(() => expect(view.root.textContent).toContain('仍有新修改待保存'));
  expect(name.value).toBe('new edit');
  expect(view.saved).not.toHaveBeenCalled();
});

async function fill(view: Awaited<ReturnType<typeof mount>>, label: string, value: string) {
  const field = [...view.root.querySelectorAll('label')].find(
    item => item.querySelector('span')?.textContent === label,
  )!;
  const input = field.querySelector<HTMLInputElement>('input')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  await nextTick();
}

it('新模型继续输入具体版本后更新模板，未知名称不保留旧模板上限', async () => {
  const view = await mount({});
  view.props.value = { ...view.props.value, model: undefined };
  await nextTick();
  await nextTick();
  await fill(view, '实际模型 ID', 'grok-4');
  expect(view.root.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('2000000');
  await fill(view, '实际模型 ID', 'grok-4.7');
  expect(view.root.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('500000');
  expect(view.root.textContent).toContain('Grok 4.7');
  await fill(view, '实际模型 ID', 'unknown-model');
  expect(view.root.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('0');
});

it('手动修改模板字段后，更改模型名称不会覆盖自定义配置', async () => {
  const view = await mount({});
  view.props.value = { ...view.props.value, model: undefined };
  await nextTick();
  await nextTick();
  await fill(view, '实际模型 ID', 'grok-4.7');
  await fill(view, '上下文窗口', '123456');
  await fill(view, '实际模型 ID', 'k3.1-pro');
  expect(view.root.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('123456');
});

it('编辑已有模型时保留原参数，不因新模板出现而自动覆盖', async () => {
  const view = await mount({});
  await fill(view, '上下文窗口', '654321');
  await fill(view, '实际模型 ID', 'grok-4.7');
  expect(view.root.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('654321');
});
