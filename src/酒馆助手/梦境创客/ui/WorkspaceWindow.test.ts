// @vitest-environment happy-dom

import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  let subscriber: ((state: unknown) => void) | undefined;
  const session = (id: string, bindingId = 'binding-test') => ({
    bindingId,
    characterName: '测试角色',
    createdAt: 1,
    revision: 1,
    sessionId: id,
    sha256: 'hash',
    size: 100,
    status: 'completed',
    title: id,
    updatedAt: 1,
    url: '/' + id,
  });
  const sessions = [session('session-1'), session('session-2')];
  const state = {
    active: {
      agentConfiguration: { id: 'agent:default', name: '默认助手', presetId: 'preset', skills: [], toolIds: [] },
      bindingId: 'binding-test',
      characterName: '测试角色',
      sessionId: 'session-1',
      title: 'session-1',
      status: 'completed',
      mode: 'normal',
      scope: 'character',
      events: [],
      skills: [],
      warnings: [],
      ui: [],
      workingFiles: [],
      operationLog: { records: [], turns: [], version: 1 },
      modelSelection: { providerId: 'provider', modelId: 'model-config' },
      modelControls: { reasoningEffort: 'auto', webSearch: false },
      contextUsage: { totalTokens: 0, ratio: 0, contextWindow: 128000 },
    },
    activeSessionAccess: 'live',
    busy: false,
    currentCharacter: { avatarId: 'avatar', bindingId: 'binding-test', name: '测试角色' },
    loadedSessionIds: ['session-1'],
    sessionStatuses: { 'session-1': 'completed' },
    sessions,
    globalSessions: [],
    characterGroups: [
      {
        available: true,
        avatarId: 'avatar',
        bindingId: 'binding-test',
        characterName: '测试角色',
        current: true,
        sessions,
        updatedAt: 1,
      },
      {
        available: true,
        avatarId: 'second.png',
        bindingId: 'binding-second',
        characterName: '第二角色',
        current: false,
        sessions: [session('second-session', 'binding-second')],
        updatedAt: 1,
      },
    ],
    onboardingDone: true,
    approvalMode: 'normal',
    activeAgentConfigurationId: 'agent:default',
    agentConfigurations: [{ id: 'agent:default', name: '默认助手', presetId: 'preset', skills: [], toolIds: [] }],
    activePresetId: 'preset',
    presetProfiles: [],
    skills: [],
    builtinSkillResources: [],
    warnings: [],
    debugLogs: [],
    developerMode: false,
    storage: { currentCharacterBytes: 0 },
    providers: [
      {
        enabled: true,
        id: 'provider',
        name: '本地',
        interfaceType: 'openai-chat',
        models: [
          {
            enabled: true,
            id: 'model-config',
            modelId: 'model',
            name: '模型',
            compatibilityMode: 'standard',
            modelSettings: {
              contextWindow: 128000,
              maxOutputTokens: 8000,
              reasoningEfforts: [],
              capabilities: { reasoning: 'enabled', toolCalling: 'enabled', vision: 'disabled', webSearch: 'disabled' },
            },
          },
        ],
      },
    ],
  };
  const runtime = {
    closeSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    enqueueGuidance: vi.fn(),
    refreshCharacter: vi.fn(async () => undefined),
    stop: vi.fn(),
    stopSession: vi.fn(),
    snapshot: () => structuredClone(state),
    subscribe: (next: (value: unknown) => void) => {
      subscriber = next;
      next(structuredClone(state));
      return () => {
        subscriber = undefined;
      };
    },
  };
  return { runtime, state, publish: (next = state) => subscriber?.(structuredClone(next)) };
});

vi.mock('../runtime/dream-card-agent-runtime', () => ({ getDreamCardAgentRuntime: () => mock.runtime }));

let mounted: { app: ReturnType<typeof createApp>; root: HTMLElement } | undefined;
async function mountWorkspace() {
  const { default: WorkspaceWindow } = await import('./WorkspaceWindow.vue');
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(WorkspaceWindow);
  app.mount(root);
  mounted = { app, root };
  await nextTick();
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  localStorage.clear();
  mock.state.active.status = 'completed';
  mock.state.sessionStatuses['session-1'] = 'completed';
  mock.state.characterGroups[0].sessions[0].status = 'completed';
  vi.stubGlobal('toastr', { error: vi.fn(), success: vi.fn() });
});
afterEach(() => {
  mounted?.app.unmount();
  mounted?.root.remove();
  mounted = undefined;
  vi.unstubAllGlobals();
});

describe('WorkspaceWindow', () => {
  it('隐藏角色不删除会话，切换回该角色后恢复显示', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 430 });
    const root = await mountWorkspace();
    root.querySelector<HTMLButtonElement>('.dca-mobile-navigation-tab')!.click();
    await nextTick();
    const group = [...root.querySelectorAll<HTMLElement>('.dca-character-group')].find(item =>
      item.textContent?.includes('第二角色'),
    )!;
    group.querySelector<HTMLButtonElement>('.dca-character-more')!.click();
    await nextTick();
    [...group.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('隐藏角色卡'))!
      .click();
    await nextTick();
    root
      .querySelector<HTMLButtonElement>(
        '.dca-character-action-dialog button.danger, .dca-character-action-dialog button:last-child',
      )!
      .click();
    await nextTick();
    expect(root.querySelector('.dca-character-groups')?.textContent).not.toContain('第二角色');
    expect(mock.runtime.deleteSession).not.toHaveBeenCalled();
    expect(localStorage.getItem('dream-card-agent:hidden-character-groups')).toContain('binding-second');

    const next = structuredClone(mock.state);
    next.currentCharacter = { avatarId: 'second.png', bindingId: 'binding-second', name: '第二角色' };
    next.characterGroups.forEach(group => {
      group.current = group.bindingId === 'binding-second';
    });
    mock.publish(next);
    await nextTick();
    expect(root.querySelector('.dca-character-groups')?.textContent).toContain('第二角色');
    expect(localStorage.getItem('dream-card-agent:hidden-character-groups')).toBe('[]');
  });

  it('运行中可发送引导或停止，结束后过期索引不会阻止关闭', async () => {
    mock.state.active.status = 'running';
    mock.state.sessionStatuses['session-1'] = 'running';
    const root = await mountWorkspace();
    root.querySelector<HTMLButtonElement>('[aria-label="停止当前任务"]')!.click();
    expect(mock.runtime.stop).toHaveBeenCalledOnce();
    const composer = root.querySelector<HTMLTextAreaElement>('.dca-composer textarea')!;
    expect(composer.disabled).toBe(false);
    composer.value = '请先检查世界书';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    root.querySelector<HTMLButtonElement>('[aria-label="发送中途引导"]')!.click();
    expect(mock.runtime.enqueueGuidance).toHaveBeenCalledWith('请先检查世界书');

    mock.state.active.status = 'completed';
    mock.state.sessionStatuses['session-1'] = 'completed';
    mock.state.characterGroups[0].sessions[0].status = 'running';
    mock.publish();
    await nextTick();
    root.querySelector<HTMLButtonElement>('.dca-session-tab-close')!.click();
    expect(mock.runtime.closeSession).toHaveBeenCalledWith('session-1');
  });

  it('删除历史会话必须经过确认且指向所选会话', async () => {
    const root = await mountWorkspace();
    root.querySelector<HTMLButtonElement>('button[title="会话列表"]')!.click();
    await nextTick();
    root.querySelector<HTMLButtonElement>('.dca-recent-item:nth-child(2) .dca-welcome-delete')!.click();
    await nextTick();
    expect(mock.runtime.deleteSession).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('.dca-welcome-delete-confirm button.danger')!.click();
    expect(mock.runtime.deleteSession).toHaveBeenCalledWith('session-2');
  });
});
