// @vitest-environment happy-dom

import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  let subscriber: ((state: unknown) => void) | undefined;
  const state = {
    active: {
      agentConfiguration: { id: 'agent:default', name: '梦境创客默认 Agent', presetId: 'preset', skillIds: [] },
      bindingId: 'binding-test',
      characterName: '测试角色',
      contextUsage: {
        assistantTokens: 1,
        contextWindow: 128_000,
        ratio: 0.01,
        remainingTokens: 127_990,
        systemTokens: 1,
        thresholdTokens: 89_600,
        toolTokens: 1,
        totalTokens: 10,
        userTokens: 7,
      },
      events: [],
      mode: 'normal',
      preset: {
        id: 'preset',
        name: '默认',
        nodes: [
          { content: '{{agent_identity}}', enabled: true, id: 'identity', order: 10, role: 'system', title: '身份' },
        ],
        version: 1,
      },
      sessionId: 'session-1',
      skills: [],
      status: 'completed',
      title: '最近的创作',
      ui: [
        {
          at: 1,
          checkpointId: 'checkpoint-1',
          content: '**检查设定**\n\nhttps://example.com/preview.png',
          durationMs: 12_000,
          id: 'user-1',
          kind: 'user',
          attachments: [{ filename: '参考图.png', id: 'attachment-1', mediaType: 'image/png', size: 1024 }],
          runStatus: 'completed',
        },
        {
          at: 2,
          checkpointId: 'checkpoint-1',
          content: '{}',
          id: 'tool-1',
          kind: 'tool',
          status: 'completed',
          toolName: 'list_directory',
        },
        {
          at: 3,
          checkpointId: 'checkpoint-1',
          content: '{}',
          id: 'tool-2',
          kind: 'tool',
          status: 'completed',
          toolName: 'read_file',
        },
        {
          at: 4,
          checkpointId: 'checkpoint-1',
          content: '{}',
          id: 'tool-3',
          kind: 'tool',
          status: 'completed',
          toolName: 'read_file',
        },
        {
          at: 5,
          checkpointId: 'checkpoint-1',
          content: '先读文件\n再梳理关系',
          durationMs: 3_200,
          id: 'reason-1',
          kind: 'reasoning',
          status: 'completed',
        },
        {
          at: 6,
          checkpointId: 'checkpoint-1',
          content: '### 完成',
          id: 'assistant-1',
          kind: 'assistant',
          status: 'completed',
        },
      ],
      warnings: [],
      workingChanges: [],
      workingFiles: [
        {
          content: '描述',
          mediaType: 'text/markdown',
          path: '/character/description.md',
          readonly: false,
          resourceId: 'character:description',
        },
      ],
    },
    activeAgentConfigurationId: 'agent:default',
    activeSessionAccess: 'live',
    activeProfileId: 'profile',
    activePresetId: 'preset',
    agentConfigurations: [{ id: 'agent:default', name: '梦境创客默认 Agent', presetId: 'preset', skillIds: [] }],
    busy: false,
    characterGroups: [] as any[],
    currentCharacter: { avatarId: 'avatar', bindingId: 'binding-test', name: '测试角色' },
    debugLogs: [],
    developerMode: false,
    floatingButton: true,
    floatingButtonAnchor: 'middle-right',
    floatingButtonOffset: { x: 18, y: 0 },
    loadedSessionIds: ['session-1'],
    onboardingDone: true,
    profiles: [
      {
        baseURL: 'http://localhost/v1',
        compatibilityMode: 'standard',
        id: 'profile',
        interfaceType: 'openai-chat',
        model: 'model',
        name: '本地',
      },
    ],
    presetProfiles: [
      {
        id: 'preset',
        name: '默认',
        nodes: [
          { content: '{{agent_identity}}', enabled: true, id: 'identity', order: 10, role: 'system', title: '身份' },
        ],
        version: 1,
      },
    ],
    sessions: [
      {
        bindingId: 'binding-test',
        characterName: '测试角色',
        createdAt: 1,
        revision: 12,
        sessionId: 'session-1',
        sha256: 'hash',
        size: 100,
        status: 'completed',
        title: '最近的创作',
        updatedAt: Date.now(),
        url: '/session-1.json',
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        bindingId: 'binding-test',
        characterName: '测试角色',
        createdAt: index + 2,
        revision: 1,
        sessionId: `session-${index + 2}`,
        sha256: `hash-${index + 2}`,
        size: 100,
        status: 'completed',
        title: `历史会话${index + 2}`,
        updatedAt: Date.now() - index - 1,
        url: `/session-${index + 2}.json`,
      })),
    ],
    sessionStatuses: { 'session-1': 'completed' },
    skills: [
      {
        assets: {},
        body: '# 测试流程',
        builtin: false,
        description: '用于验证编辑和删除',
        id: 'skill:test',
        loading: 'on-demand',
        name: '测试 Skill',
        references: {},
      },
    ],
    storage: { currentCharacterBytes: 2048, globalSkillBytes: 0 },
    warnings: [],
  };
  state.characterGroups = [
    {
      available: true,
      avatarId: 'avatar',
      bindingId: 'binding-test',
      characterName: '测试角色',
      current: true,
      sessions: state.sessions,
      updatedAt: Date.now(),
    },
    {
      available: true,
      avatarId: 'second.png',
      bindingId: 'binding-second',
      characterName: '第二角色',
      current: false,
      sessions: [
        {
          bindingId: 'binding-second',
          characterName: '第二角色',
          createdAt: 1,
          revision: 1,
          sessionId: 'second-session-1',
          sha256: 'second-hash',
          size: 100,
          status: 'completed',
          title: '第二角色的会话',
          updatedAt: Date.now() - 10,
          url: '/second-session-1.json',
        },
      ],
      updatedAt: Date.now() - 10,
    },
  ];
  const runtime = {
    closeSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    enqueueGuidance: vi.fn(),
    refreshCharacter: vi.fn(async () => undefined),
    removeGlobalSkill: vi.fn(async () => undefined),
    saveAgentConfiguration: vi.fn(async (configuration: unknown) => configuration),
    saveGlobalSkill: vi.fn(async (skill: unknown) => skill),
    snapshot: () => structuredClone(state),
    stop: vi.fn(),
    subscribe: (next: (value: unknown) => void) => {
      subscriber = next;
      next(structuredClone(state));
      return () => {
        subscriber = undefined;
      };
    },
  };
  return { runtime, state, subscriber: () => subscriber };
});

vi.mock('../runtime/dream-card-agent-runtime', () => ({ getDreamCardAgentRuntime: () => mock.runtime }));

describe('WorkspaceWindow', () => {
  beforeEach(() => {
    vi.stubGlobal('toastr', { error: vi.fn(), success: vi.fn() });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('默认隐藏Revision和侧栏，并折叠连续工具与思考过程', async () => {
    const { default: WorkspaceWindow } = await import('./WorkspaceWindow.vue');
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(WorkspaceWindow);
    app.mount(root);
    await nextTick();

    expect(root.textContent).not.toContain('r12');
    expect(root.querySelector('.dca-workbench')?.classList).toContain('sidebar-collapsed');
    expect(root.querySelectorAll('.dca-tool-group')).toHaveLength(1);
    expect(root.textContent).toContain('已调用 3 个工具');
    expect(root.textContent).toContain('read_file ×2');
    expect(root.textContent).toContain('已思考 3 秒');
    expect(root.querySelector('.dca-message-user strong')?.textContent).toBe('检查设定');
    expect(root.querySelector('.dca-message-attachments')?.textContent).toContain('参考图.png');
    expect(root.querySelector<HTMLImageElement>('.dca-message-user img')?.src).toBe('https://example.com/preview.png');
    expect(root.querySelector('.dca-message-assistant h3')?.textContent).toBe('完成');
    expect(root.querySelector('.dca-header')).toBeNull();
    expect(root.querySelector('.dca-sidebar-brand strong')).toBeNull();
    expect(root.querySelector<HTMLImageElement>('.dca-character-avatar img')?.getAttribute('src')).toBe(
      '/thumbnail?type=avatar&file=avatar',
    );

    (root.querySelector('button[title="打开侧栏"]') as HTMLButtonElement).click();
    await nextTick();
    expect(root.querySelector('.dca-workbench')?.classList).not.toContain('sidebar-collapsed');
    expect(root.querySelector('.dca-side-files')).not.toBeNull();
    expect(root.textContent).toContain('character');
    expect(root.textContent).toContain('description.md');
    (root.querySelector('.dca-file-tree-row.directory') as HTMLButtonElement).click();
    await nextTick();
    expect(root.textContent).not.toContain('description.md');

    (root.querySelector('button[title="会话列表"]') as HTMLButtonElement).click();
    await nextTick();
    expect(root.textContent).toContain('最近会话');
    expect(root.querySelector('select')).toBeNull();
    expect(root.textContent).toContain('最近的创作');
    expect(root.querySelectorAll('.dca-recent-item')).toHaveLength(5);
    expect(root.querySelectorAll('.dca-character-sessions > button:not(.dca-all-sessions-button)')).toHaveLength(10);
    (root.querySelector('.dca-all-sessions-button') as HTMLButtonElement).click();
    await nextTick();
    expect(root.querySelectorAll('.dca-all-list article')).toHaveLength(11);
    (root.querySelector('.dca-all-dialog button[title="关闭"]') as HTMLButtonElement).click();
    await nextTick();

    const characterToggles = root.querySelectorAll<HTMLButtonElement>('.dca-character-toggle');
    characterToggles[1].click();
    await nextTick();
    expect(root.querySelectorAll('.dca-character-sessions')).toHaveLength(2);
    characterToggles[0].click();
    await nextTick();
    expect(root.querySelectorAll('.dca-character-sessions')).toHaveLength(1);
    characterToggles[0].click();
    await nextTick();

    const secondRecentDelete = root.querySelector<HTMLButtonElement>(
      '.dca-recent-item:nth-child(2) .dca-welcome-delete',
    )!;
    secondRecentDelete.click();
    await nextTick();
    expect(root.querySelector('.dca-welcome-delete-confirm')?.textContent).toContain('历史会话2');
    (root.querySelector('.dca-welcome-delete-confirm button.danger') as HTMLButtonElement).click();
    expect(mock.runtime.deleteSession).toHaveBeenCalledWith('session-2');
    await nextTick();

    (root.querySelector('.dca-settings-tab') as HTMLButtonElement).click();
    await nextTick();
    const skillSection = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-nav button')].find(button =>
      button.textContent?.includes('Skill'),
    )!;
    skillSection.click();
    await nextTick();
    const newSkill = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-content button')].find(button =>
      button.textContent?.includes('新建'),
    )!;
    newSkill.click();
    await nextTick();
    expect(root.querySelector('.dca-skill-editor')).not.toBeNull();
    (root.querySelector('.dca-skill-editor button[title="关闭"]') as HTMLButtonElement).click();
    await nextTick();

    const userSkillCard = root.querySelector('.dca-skill-card:not(.builtin)')!;
    const editSkill = [...userSkillCard.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.trim() === '编辑',
    )!;
    editSkill.click();
    await nextTick();
    expect(root.querySelector('#dca-skill-title')?.textContent).toContain('编辑 Skill');
    const saveSkill = [...root.querySelectorAll<HTMLButtonElement>('.dca-skill-editor-footer button')].find(button =>
      button.textContent?.includes('保存 Skill'),
    )!;
    saveSkill.click();
    await nextTick();
    const confirmSave = [...root.querySelectorAll<HTMLButtonElement>('.dca-alert button')].find(button =>
      button.textContent?.includes('确认保存'),
    )!;
    confirmSave.click();
    expect(mock.runtime.saveGlobalSkill).toHaveBeenCalledWith(expect.objectContaining({ id: 'skill:test' }));
    await vi.waitFor(() => expect(root.querySelector('.dca-skill-editor')).toBeNull());

    const visibleUserSkillCard = root.querySelector('.dca-skill-card:not(.builtin)')!;
    const deleteSkill = [...visibleUserSkillCard.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.trim() === '删除',
    )!;
    deleteSkill.click();
    await nextTick();
    expect(root.querySelector('#dca-skill-title')?.textContent).toContain('删除 Skill');
    expect(root.querySelector('.dca-skill-editor textarea')).toBeNull();
    const confirmDelete = [...root.querySelectorAll<HTMLButtonElement>('.dca-skill-editor-footer button')].find(
      button => button.textContent?.includes('确认删除'),
    )!;
    confirmDelete.click();
    expect(mock.runtime.removeGlobalSkill).toHaveBeenCalledWith('skill:test');
    await vi.waitFor(() => expect(root.querySelector('.dca-skill-editor')).toBeNull());

    const agentSection = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-nav button')].find(
      button => button.textContent?.trim() === 'Agent配置',
    )!;
    agentSection.click();
    await nextTick();
    expect(root.querySelector<HTMLInputElement>('input[maxlength="80"]')?.value).toBe('梦境创客默认 Agent');
    expect(root.querySelector<HTMLInputElement>('input[maxlength="80"]')?.disabled).toBe(true);
    expect(root.querySelector('.dca-agent-skill-panel')).not.toBeNull();
    const skillSaveCalls = mock.runtime.saveGlobalSkill.mock.calls.length;
    const saveAsBuiltin = [...root.querySelectorAll<HTMLButtonElement>('.dca-resource-savebar button')].find(button =>
      button.textContent?.includes('另存为自定义Agent'),
    )!;
    saveAsBuiltin.click();
    await nextTick();
    const saveConfiguration = [...root.querySelectorAll<HTMLButtonElement>('.dca-resource-savebar button')].find(
      button => button.textContent?.trim() === '保存配置',
    )!;
    saveConfiguration.click();
    expect(mock.runtime.saveAgentConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringMatching(/^agent:/u), name: '梦境创客默认 Agent 副本', skillIds: [] }),
    );
    expect(mock.runtime.saveGlobalSkill).toHaveBeenCalledTimes(skillSaveCalls);

    const presetSection = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-nav button')].find(button =>
      button.textContent?.includes('预设'),
    )!;
    presetSection.click();
    await nextTick();
    expect(root.querySelector('.dca-resource-toolbar')).not.toBeNull();
    expect(root.querySelector('.dca-preset-node')?.getAttribute('draggable')).toBe('true');

    mock.state.active.status = 'running';
    mock.state.sessionStatuses['session-1'] = 'running';
    mock.subscriber()?.(structuredClone(mock.state));
    await nextTick();
    (root.querySelector('button[title="会话列表"]') as HTMLButtonElement).click();
    await nextTick();
    (root.querySelector('.dca-recent-open') as HTMLButtonElement).click();
    await nextTick();
    expect(root.querySelector('.dca-guidance-box')).toBeNull();
    const composer = root.querySelector<HTMLTextAreaElement>('.dca-composer textarea')!;
    expect(composer.disabled).toBe(false);
    const stopButton = root.querySelector<HTMLButtonElement>('.dca-composer button[aria-label="停止当前任务"]')!;
    expect(stopButton.classList).toContain('dca-send-button');
    expect(root.querySelector('.dca-composer-icon.dca-stop-button')).toBeNull();
    stopButton.click();
    expect(mock.runtime.stop).toHaveBeenCalledOnce();
    composer.value = '请优先检查世界书';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    const guideButton = root.querySelector<HTMLButtonElement>('.dca-composer button[aria-label="发送中途引导"]')!;
    expect(guideButton.classList).toContain('dca-guidance-button');
    expect(root.querySelector('.dca-composer button[aria-label="停止当前任务"]')).toBeNull();
    guideButton.click();
    expect(mock.runtime.enqueueGuidance).toHaveBeenCalledWith('请优先检查世界书');
    await nextTick();
    expect(root.querySelector('.dca-composer button[aria-label="停止当前任务"]')).not.toBeNull();
    const tabButtons = root.querySelectorAll<HTMLButtonElement>('.dca-session-tab button');
    expect(tabButtons[0].disabled).toBe(false);
    expect(tabButtons[1].disabled).toBe(true);

    mock.state.active.status = 'completed';
    mock.state.sessionStatuses['session-1'] = 'completed';
    mock.state.characterGroups[0].sessions[0].status = 'running';
    mock.subscriber()?.(structuredClone(mock.state));
    await nextTick();
    const closeButton = root.querySelector<HTMLButtonElement>('.dca-session-tab-close')!;
    expect(closeButton.disabled).toBe(false);
    closeButton.click();
    expect(mock.runtime.closeSession).toHaveBeenCalledWith('session-1');
    app.unmount();
  });
});
