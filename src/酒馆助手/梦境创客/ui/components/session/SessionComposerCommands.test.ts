// @vitest-environment happy-dom
import { createApp, nextTick, ref, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionComposer from './SessionComposer.vue';
import { defaultModelSettings } from '../../../core/provider/model-catalog';
import type { DreamCardAgentRuntimeState } from '../../../runtime/dream-card-agent-runtime';
import type { SessionInput } from '../../../core/session/input-submission';

const mock = vi.hoisted(() => ({ context: undefined as unknown }));
vi.mock('../../composables/runtime', () => ({ useDreamCardAgent: () => mock.context }));
let mounted: { app: ReturnType<typeof createApp>; root: HTMLElement } | undefined;
afterEach(() => {
  mounted?.app.unmount();
  mounted?.root.remove();
  mounted = undefined;
  vi.unstubAllGlobals();
});

async function composer() {
  const modelSettings = { ...defaultModelSettings(), reasoningEfforts: [{ id: 'high', name: '高' }] };
  const state = shallowRef({
    active: {
      sessionId: 'a',
      status: 'completed',
      mode: 'normal',
      modelControls: { reasoningEffort: 'auto', webSearch: false },
      modelSelection: { providerId: 'p', modelId: 'm' },
      agentConfiguration: { id: 'a', toolIds: ['compact_context', 'read_file'], skills: [] },
      skills: [
        { id: 'check', name: '检查角色', description: '检查人物关系', body: '', builtin: false, loading: 'on-demand' },
      ],
      workingFiles: [
        { path: '/files/note.md' },
        { path: '/character/definition/description.md' },
        { path: '/worldbooks/城市/entries/人物.md' },
      ],
    },
    providers: [
      {
        id: 'p',
        name: '渠道',
        enabled: true,
        interfaceType: 'openai-chat',
        models: [
          { id: 'm', name: '模型一', modelId: 'model-1', enabled: true, modelSettings },
          { id: 'disabled', name: '禁用模型', modelId: 'disabled', enabled: false, modelSettings },
        ],
      },
    ],
    busy: false,
    approvalMode: 'normal',
    sendWithCtrlEnter: false,
    agentConfigurations: [],
  } as unknown as DreamCardAgentRuntimeState);
  const submitInput = vi.fn(async (input: SessionInput) => input);
  const stopSession = vi.fn();
  const error = vi.fn();
  const sidebarCollapsed = ref(true);
  const sidebarFocus = ref();
  vi.stubGlobal('toastr', { error });
  mock.context = {
    state,
    sidebarCollapsed,
    sidebarFocus,
    runtime: { submitInput, stopSession },
    action: async (work: () => Promise<unknown>) => {
      await work();
      return true;
    },
  };
  const root = document.createElement('div');
  root.className = 'dca-app';
  const target = document.createElement('div');
  root.append(target);
  document.body.append(root);
  const app = createApp(SessionComposer);
  app.mount(target);
  mounted = { app, root };
  const input = root.querySelector<HTMLTextAreaElement>('textarea')!;
  await vi.waitFor(() => expect(input.disabled).toBe(false));
  const type = async (text: string, caret = text.length) => {
    input.value = text;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  };
  const options = () => [...root.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  const send = () => root.querySelector<HTMLButtonElement>('.dca-send-button')!.click();
  return { root, input, state, submitInput, stopSession, error, sidebarCollapsed, sidebarFocus, type, options, send };
}

describe('输入命令与分类引用交互', () => {
  it('模型和推理参数使用可用候选，选择不会立即提交', async () => {
    const f = await composer();
    await f.type('/model ');
    expect(f.options()).toHaveLength(1);
    expect(f.options()[0].textContent).toContain('模型一');
    f.options()[0].click();
    await nextTick();
    expect(f.input.value).toBe('/model 渠道/模型一 ');
    expect(f.submitInput).not.toHaveBeenCalled();
    f.send();
    await vi.waitFor(() => expect(f.submitInput).toHaveBeenCalledOnce());
    expect(f.submitInput.mock.calls[0][0]).toMatchObject({ kind: 'command', text: '/model 渠道/模型一 ' });
    await vi.waitFor(() => expect(f.input.value).toBe(''));
    await f.type('/effort ');
    expect(f.options().map(item => item.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('自动'),
        expect.stringContaining('关闭推理'),
        expect.stringContaining('高'),
      ]),
    );
  });

  it('分类切换、空结果与触摸操作不会抢发消息', async () => {
    const f = await composer();
    await f.type('@');
    const category = [...f.root.querySelectorAll<HTMLButtonElement>('.dca-shortcut-categories button')].find(
      item => item.textContent === '世界书',
    )!;
    const down = new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true });
    category.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    category.click();
    await nextTick();
    expect(f.options()).toHaveLength(1);
    expect(f.options()[0].textContent).toContain('人物.md');
    f.options()[0].click();
    await nextTick();
    expect(f.input.value).toContain('/worldbooks/');
    expect(f.submitInput).not.toHaveBeenCalled();
    await f.type('@');
    [...f.root.querySelectorAll<HTMLButtonElement>('.dca-shortcut-categories button')]
      .find(item => item.textContent === '聊天')!
      .click();
    await nextTick();
    expect(f.options()).toHaveLength(0);
    expect(f.root.textContent).toContain('没有匹配的引用');
    f.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(f.root.querySelector('.dca-shortcut-menu')).toBeNull();
  });

  it('引用替换光标所在词，并保留前后文', async () => {
    const f = await composer();
    await f.type('参考 @note 尾部', 6);
    f.options()
      .find(item => item.textContent?.includes('note.md'))!
      .click();
    await nextTick();
    expect(f.input.value).toBe('参考 [note.md](/files/note.md)  尾部');
  });

  it('会话切换关闭旧面板，重新打开只显示当前会话资源', async () => {
    const f = await composer();
    await f.type('@note');
    const stale = f.options()[0];
    f.state.value = {
      ...f.state.value,
      active: {
        ...f.state.value.active!,
        sessionId: 'b',
        workingFiles: [
          {
            path: '/files/current.md',
            content: '',
            mediaType: 'text/markdown',
            readonly: false,
            resourceId: 'current',
          },
        ],
        skills: [],
      },
    };
    await nextTick();
    await f.type('新会话草稿');
    stale.click();
    await nextTick();
    expect(f.input.value).toBe('新会话草稿');
    await f.type('@');
    expect(f.root.textContent).not.toContain('note.md');
    expect(f.options()[0].textContent).toContain('current.md');
  });

  it('未知指令和禁用指令保留草稿并说明原因', async () => {
    const f = await composer();
    await f.type('/missing');
    f.send();
    expect(f.error).toHaveBeenCalledWith(expect.stringContaining('未知指令'), '梦境创客');
    expect(f.input.value).toBe('/missing');
    f.state.value = { ...f.state.value, busy: true, active: { ...f.state.value.active!, status: 'running' } };
    await f.type('/model');
    f.send();
    expect(f.error).toHaveBeenCalledWith('请先停止当前任务', '梦境创客');
    expect(f.submitInput).not.toHaveBeenCalled();
  });

  it('帮助、上下文和停止指令执行本地操作，停止绑定当前会话', async () => {
    const f = await composer();
    await f.type('/help');
    f.send();
    await nextTick();
    expect(f.root.querySelector('[role="dialog"]')?.textContent).toContain('/compact [保留重点]');
    const buttons = [...f.root.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(buttons.at(-1));
    buttons.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[0]);
    f.root.querySelector<HTMLButtonElement>('[aria-label="关闭指令帮助"]')!.click();
    await nextTick();
    await f.type('/context');
    f.send();
    expect(f.sidebarCollapsed.value).toBe(false);
    expect(f.sidebarFocus.value).toEqual({ tab: 'context' });
    f.state.value = { ...f.state.value, busy: true, active: { ...f.state.value.active!, status: 'waiting-approval' } };
    await f.type('/stop');
    f.send();
    expect(f.stopSession).toHaveBeenCalledExactlyOnceWith('a');
    expect(f.submitInput).not.toHaveBeenCalled();
  });

  it('输入法期间不选中候选，Ctrl+Tab 不被截获', async () => {
    const f = await composer();
    await f.type('/comp');
    f.input.dispatchEvent(new Event('compositionstart'));
    f.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(f.input.value).toBe('/comp');
    f.input.dispatchEvent(new Event('compositionend'));
    const tab = new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true });
    f.input.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    f.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    expect(f.input.value).toBe('/compact ');
    expect(f.submitInput).not.toHaveBeenCalled();
  });

  it('命令失败保留草稿，迟到的成功回执不会清除后续编辑', async () => {
    const f = await composer();
    f.submitInput.mockRejectedValueOnce(new Error('模型已停用'));
    await f.type('/model 渠道/模型一');
    f.send();
    await vi.waitFor(() => expect(f.error).toHaveBeenCalledWith('模型已停用', '梦境创客'));
    expect(f.input.value).toBe('/model 渠道/模型一');
    let resolve!: (input: SessionInput) => void;
    f.submitInput.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    f.send();
    await vi.waitFor(() => expect(f.submitInput).toHaveBeenCalledTimes(2));
    await f.type('下一条要求');
    resolve(f.submitInput.mock.calls[1][0]);
    await nextTick();
    await nextTick();
    expect(f.input.value).toBe('下一条要求');
  });
});
