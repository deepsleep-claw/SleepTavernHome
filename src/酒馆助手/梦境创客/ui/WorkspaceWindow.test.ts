// @vitest-environment happy-dom

import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionBackupStatus } from '../core/persistence/local-session-store';

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
    sessionBackup: undefined as SessionBackupStatus | undefined,
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
    backupSessions: vi.fn(async () => undefined),
    resolveSessionBackupConflict: vi.fn(async () => undefined),
    closeSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    submitInput: vi.fn(async (input: { id: string; sessionId: string; kind: string; text: string }) => input),
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
  return { runtime, state, publish: (next: unknown = state) => subscriber?.(structuredClone(next)) };
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
  mock.state.sessionBackup = undefined;
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
  it('手机选择层逐级返回，侧栏隔离正文，设置返回会话再返回列表', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const root = await mountWorkspace();
    const back = () => root.querySelector<HTMLButtonElement>('[aria-label="返回"]')!.click();
    root.querySelector<HTMLButtonElement>('.dca-session-model-trigger')!.click();
    await nextTick();
    await nextTick();
    expect(root.querySelector('.dca-mobile-sheet')).not.toBeNull();
    [...root.querySelectorAll<HTMLButtonElement>('.dca-model-menu-root button')]
      .find(item => item.textContent?.includes('模型'))!
      .click();
    await vi.waitFor(() => expect(root.querySelector('[aria-label="返回上一级"]')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[aria-label="返回上一级"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('.dca-model-menu-root')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[aria-label="关闭模型与推理"]')!.click();
    await nextTick();
    root.querySelector<HTMLButtonElement>('[title="打开侧栏"]')!.click();
    await nextTick();
    expect(root.querySelector('.dca-session-panel')?.hasAttribute('inert')).toBe(true);
    back();
    await nextTick();
    expect(root.querySelector('.dca-session-sidebar')).toBeNull();
    root.querySelector<HTMLButtonElement>('[title="设置"]')!.click();
    await nextTick();
    expect(root.querySelector('.dca-settings-workspace')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[aria-label="返回当前会话"]')!.click();
    await nextTick();
    expect(root.querySelector('.dca-composer')).not.toBeNull();
    back();
    await nextTick();
    expect(root.querySelector('.dca-composer')).toBeNull();
  });

  it('手机从列表进入设置后可直接返回运行中的会话并保留输入草稿', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    mock.state.active.status = 'running';
    mock.state.sessionStatuses['session-1'] = 'running';
    const root = await mountWorkspace();
    const input = root.querySelector<HTMLTextAreaElement>('[aria-label="消息输入"]')!;
    input.value = '先补充角色关系';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[aria-label="返回"]')!.click();
    await nextTick();
    expect(root.querySelector('.dca-composer')).toBeNull();

    root.querySelector<HTMLButtonElement>('[title="设置"]')!.click();
    await nextTick();
    const returnButton = root.querySelector<HTMLButtonElement>('[aria-label="返回当前会话"]')!;
    expect(returnButton.textContent).toContain('返回会话');
    expect(returnButton.title).toBe('session-1');
    returnButton.click();
    await nextTick();
    expect(root.querySelector<HTMLTextAreaElement>('[aria-label="消息输入"]')?.value).toBe('先补充角色关系');
    expect(root.querySelector('[aria-label="停止当前任务"]')).not.toBeNull();
    expect(mock.runtime.stop).not.toHaveBeenCalled();
    expect(mock.runtime.submitInput).not.toHaveBeenCalled();
  });

  it('没有当前会话时设置返回列表，手机窗口操作通过菜单进入更新页', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    const root = await mountWorkspace();
    root.querySelector<HTMLButtonElement>('[title="设置"]')!.click();
    await nextTick();
    mock.publish({ ...mock.state, active: undefined, interfaceModes: { detached: true } });
    await nextTick();
    root.querySelector<HTMLButtonElement>('[title="窗口操作"]')!.click();
    await nextTick();
    expect(root.querySelector('[aria-label="窗口操作"]')?.textContent).toContain('在新窗口打开');
    [...root.querySelectorAll<HTMLButtonElement>('.dca-window-menu button')]
      .find(button => button.textContent?.includes('版本与更新'))!
      .click();
    await nextTick();
    expect(root.querySelector('[aria-label="窗口操作"]')).toBeNull();
    expect(root.querySelector('.dca-settings-nav button.active')?.textContent).toContain('更新');
    root.querySelector<HTMLButtonElement>('[aria-label="返回会话列表"]')!.click();
    await nextTick();
    expect(root.querySelector('.dca-settings-workspace')).toBeNull();
    expect(root.querySelector('.dca-home')).not.toBeNull();
  });
  it('后台备份失败在通知中心显示，重试期间禁用按钮，恢复后允许清除', async () => {
    const root = await mountWorkspace();
    const snapshot = structuredClone(mock.state);
    Object.assign(snapshot, {
      sessionBackup: { pending: 1, syncing: false, error: '后端暂时不可用' },
      warnings: ['一般提示'],
    });
    mock.publish(snapshot);
    await nextTick();
    const trigger = root.querySelector<HTMLButtonElement>('.dca-workspace-status [data-notification-trigger]')!;
    expect(trigger.getAttribute('aria-label')).not.toContain('待处理');
    expect(root.querySelector('[data-notification-id="session-backup"]')).toBeNull();
    trigger.click();
    await nextTick();
    expect(root.querySelector('.dca-notification-required')).toBeNull();
    root.querySelector<HTMLButtonElement>('.dca-notification-actions button')!.click();
    expect(mock.runtime.backupSessions).toHaveBeenCalledOnce();
    snapshot.sessionBackup = { pending: 1, syncing: true };
    mock.publish(snapshot);
    await nextTick();
    expect(trigger.getAttribute('aria-label')).not.toContain('待处理');
    expect(root.querySelector<HTMLButtonElement>('.dca-notification-actions button')!.disabled).toBe(true);
    snapshot.sessionBackup = { pending: 0, syncing: false };
    mock.publish(snapshot);
    await nextTick();
    expect(root.querySelector('.dca-notification-required')).toBeNull();
    expect(root.querySelector('.dca-notification-list')?.textContent).toContain('已同步');
    root.querySelector<HTMLButtonElement>('[title="清除可关闭消息"]')!.click();
    await nextTick();
    expect(root.querySelector('.dca-notification-list')?.textContent).toContain('暂无通知');
  });

  it('手机顶部通知入口保留冲突，稍后处理后仍能返回版本选择', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const root = await mountWorkspace();
    mock.state.sessionBackup = {
      pending: 1,
      syncing: false,
      conflicts: [
        {
          bindingId: 'binding-test',
          sessionId: 'session-1',
          title: '创作记录',
          characterName: '测试角色',
          localRevision: 2,
          remoteRevision: 2,
          localUpdatedAt: 1000,
          remoteUpdatedAt: 2000,
          deleted: false,
        },
      ],
    };
    mock.publish();
    await nextTick();
    const trigger = root.querySelector<HTMLButtonElement>('.dca-tabs [data-notification-trigger]')!;
    expect(trigger).not.toBeNull();
    expect(root.querySelector('.dca-workspace-status')).toBeNull();
    trigger.click();
    await nextTick();
    expect(root.querySelector<HTMLButtonElement>('[title="清除可关闭消息"]')!.disabled).toBe(true);
    root.querySelector<HTMLButtonElement>('.dca-notification-actions button')!.click();
    await nextTick();
    expect(root.querySelector('[aria-label="处理备份冲突"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.dca-backup-dialog footer button')!.click();
    await nextTick();
    trigger.click();
    await nextTick();
    expect(root.querySelector('.dca-notification-required')?.textContent).toBe('待处理');
    root.querySelector<HTMLButtonElement>('.dca-notification-actions button')!.click();
    await nextTick();
    expect(root.querySelector('[aria-label="处理备份冲突"]')).not.toBeNull();
  });

  it('上下文面板分开显示占用估算、工具定义和 API 回执，缺失用量不显示为零', async () => {
    const root = await mountWorkspace();
    const snapshot = structuredClone(mock.state);
    Object.assign(snapshot.active.contextUsage, {
      totalTokens: 2100,
      ratio: 0.21,
      contextWindow: 10000,
      remainingTokens: 7900,
      systemTokens: 300,
      userTokens: 400,
      assistantTokens: 500,
      toolTokens: 600,
      toolSchemaTokens: 300,
      measurement: 'api',
      apiInputTokens: 2000,
      apiReasoningTokens: 7000,
      apiCacheReadTokens: 1500,
      estimatedDeltaTokens: 100,
    });
    mock.publish(snapshot);
    await nextTick();
    root.querySelector<HTMLButtonElement>('button[title="打开侧栏"]')?.click();
    await nextTick();
    const button = [...root.querySelectorAll<HTMLButtonElement>('.dca-session-sidebar nav button')].find(item =>
      item.textContent?.includes('上下文'),
    );
    expect(button).toBeTruthy();
    button!.click();
    await nextTick();
    const text = root.querySelector('.dca-session-sidebar')!.textContent!;
    expect(text).toContain('当前占用（估算）');
    expect(text).toContain('工具定义（估算）');
    expect(text).toContain('输出 —');
    expect(text).toContain('7000');
    expect(text).not.toContain('用户消息 80%');
  });

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
    expect(mock.runtime.submitInput).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'guidance',
        text: '请先检查世界书',
      }),
    );

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
