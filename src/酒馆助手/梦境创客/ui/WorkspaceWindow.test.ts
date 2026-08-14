// @vitest-environment happy-dom

import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  let subscriber: ((state: unknown) => void) | undefined;
  const state = {
    active: {
      agentConfiguration: {
        id: 'agent:default',
        name: '梦境创客默认 Agent',
        presetId: 'preset',
        skills: [],
        toolIds: [],
      },
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
      modelControls: { reasoningEffort: 'auto', webSearch: false },
      modelSelection: { providerId: 'provider', modelId: 'model-config' },
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
      workingFiles: [
        {
          content: '描述',
          mediaType: 'text/markdown',
          path: '/character/definition/description.md',
          readonly: false,
          resourceId: 'character:description',
        },
      ],
    },
    activeAgentConfigurationId: 'agent:default',
    activeSessionAccess: 'live',
    approvalMode: 'normal',
    activePresetId: 'preset',
    agentConfigurations: [
      { id: 'agent:default', name: '梦境创客默认 Agent', presetId: 'preset', skills: [], toolIds: [] },
    ],
    builtinSkillResources: [
      {
        cached: true,
        description: '拆分源码、检查与编译。',
        file: 'html-project.zip',
        id: 'html-project',
        loading: 'on-demand',
        name: 'HTML工程',
        sha256: 'hash-html',
        size: 2048,
        sourceUrl: 'http://127.0.0.1:5500/resources/html-project.zip',
        state: 'available',
        version: 1,
      },
      {
        cached: false,
        description: '查询当前酒馆助手接口。',
        file: 'tavern-helper-api.zip',
        id: 'tavern-helper-api',
        loading: 'on-demand',
        name: '酒馆助手API参考',
        sha256: 'hash-api',
        size: 4096,
        sourceUrl: 'http://127.0.0.1:5500/resources/tavern-helper-api.zip',
        state: 'missing',
        version: 1,
      },
    ],
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
    providers: [
      {
        baseURL: 'http://localhost/v1',
        enabled: true,
        id: 'provider',
        interfaceType: 'openai-chat',
        name: '本地',
        models: [
          {
            compatibilityMode: 'standard',
            enabled: true,
            id: 'model-config',
            modelId: 'model',
            name: '模型',
            modelSettings: {
              capabilities: { reasoning: 'enabled', toolCalling: 'enabled', vision: 'enabled', webSearch: 'disabled' },
              contextWindow: 128_000,
              maxOutputTokens: 8_000,
              reasoningEfforts: [],
            },
          },
        ],
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
        resources: {
          'notes.md': { content: '测试资源', mediaType: 'text/markdown', size: 12 },
        },
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
    deleteCharacterSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    enqueueGuidance: vi.fn(),
    downloadBuiltinSkillResource: vi.fn(async () => undefined),
    loadGlobalSkill: vi.fn(async (id: string) => {
      if (id === 'html-project') {
        return {
          body: '# HTML工程',
          builtin: true,
          description: '拆分源码、检查与编译。',
          id,
          loading: 'on-demand',
          locked: true,
          name: 'HTML工程',
          resources: { 'guide.md': { content: '说明', mediaType: 'text/markdown', size: 6 } },
        };
      }
      return structuredClone(state.skills.find(skill => skill.id === id));
    }),
    refreshCharacter: vi.fn(async () => undefined),
    refreshBuiltinSkillResources: vi.fn(async () => undefined),
    removeGlobalSkill: vi.fn(async () => undefined),
    saveAgentConfiguration: vi.fn(async (configuration: unknown) => configuration),
    saveGlobalSkill: vi.fn(async (skill: unknown) => skill),
    snapshot: () => structuredClone(state),
    stop: vi.fn(),
    stopSession: vi.fn(),
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
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    localStorage.clear();
    vi.stubGlobal('toastr', { error: vi.fn(), success: vi.fn() });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('手机端顶部只显示当前角色，并在侧栏管理已打开会话与隐藏角色', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 430 });
    const { default: WorkspaceWindow } = await import('./WorkspaceWindow.vue');
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(WorkspaceWindow);
    app.mount(root);
    await nextTick();

    expect(root.querySelector('.dca-app')?.classList).toContain('mobile');
    expect(root.querySelector('.dca-mobile-brand strong')?.textContent).toBe('测试角色');
    expect(root.querySelectorAll('.dca-session-tab')).toHaveLength(0);

    root.querySelector<HTMLButtonElement>('.dca-mobile-navigation-tab')?.click();
    await nextTick();
    expect(root.querySelector('.dca-mobile-open-sessions')?.textContent).toContain('最近的创作');

    const secondGroup = [...root.querySelectorAll<HTMLElement>('.dca-character-group')].find(group =>
      group.textContent?.includes('第二角色'),
    )!;
    secondGroup.querySelector<HTMLButtonElement>('.dca-character-more')?.click();
    await nextTick();
    expect(secondGroup.querySelector('.dca-character-menu')?.textContent).toContain('删除全部会话');
    const hideButton = [...secondGroup.querySelectorAll<HTMLButtonElement>('.dca-character-menu button')].find(button =>
      button.textContent?.includes('隐藏角色卡'),
    )!;
    hideButton.click();
    await nextTick();
    expect(root.querySelector('.dca-character-action-dialog')?.textContent).toContain('隐藏这张角色卡');
    const confirmHide = [...root.querySelectorAll<HTMLButtonElement>('.dca-character-action-dialog button')].find(
      button => button.textContent?.includes('确认隐藏'),
    )!;
    confirmHide.click();
    await nextTick();
    expect(root.querySelector('.dca-character-groups')?.textContent).not.toContain('第二角色');
    expect(localStorage.getItem('dream-card-agent:hidden-character-groups')).toContain('binding-second');

    const reopenedState = structuredClone(mock.state);
    reopenedState.currentCharacter = { avatarId: 'second.png', bindingId: 'binding-second', name: '第二角色' };
    reopenedState.characterGroups = reopenedState.characterGroups.map(group => ({
      ...group,
      current: group.bindingId === 'binding-second',
    }));
    mock.subscriber()?.(reopenedState);
    await nextTick();
    expect(root.querySelector('.dca-character-groups')?.textContent).toContain('第二角色');
    expect(localStorage.getItem('dream-card-agent:hidden-character-groups')).toBe('[]');

    (root.querySelector('.dca-settings-tab') as HTMLButtonElement).click();
    await nextTick();
    const mobileSkillSection = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-nav button')].find(button =>
      button.textContent?.trim() === 'Skill',
    )!;
    mobileSkillSection.click();
    await nextTick();
    const mobileUserSkill = root.querySelector('.dca-skill-card:not(.builtin)')!;
    [...mobileUserSkill.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '编辑')!
      .click();
    await vi.waitFor(() => expect(root.querySelector('.dca-skill-file-list')?.textContent).toContain('notes.md'));
    const notesButton = [...root.querySelectorAll<HTMLButtonElement>('.dca-skill-file-row')]
      .find(button => button.textContent?.includes('notes.md'))!;
    notesButton.click();
    await nextTick();
    expect(root.querySelector('.dca-skill-file-preview-layer')?.classList).toContain('open');
    (root.querySelector('.dca-skill-mobile-preview-close') as HTMLButtonElement).click();
    await nextTick();
    expect(root.querySelector('.dca-skill-file-preview-layer')?.classList).not.toContain('open');

    app.unmount();
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
    expect(root.querySelector('.dca-sidebar-brand strong')?.textContent).toBe('梦境创客');
    expect(root.querySelector('.dca-character-group.current .dca-character-copy strong')?.textContent).toBe('测试角色');
    expect(root.querySelector('.dca-version-tab')?.textContent).toContain('v0.1.0');
    expect(root.querySelector<HTMLImageElement>('.dca-character-avatar img')?.getAttribute('src')).toBe(
      '/thumbnail?type=avatar&file=avatar',
    );

    (root.querySelector('button[title="打开侧栏"]') as HTMLButtonElement).click();
    await nextTick();
    expect(root.querySelector('.dca-workbench')?.classList).not.toContain('sidebar-collapsed');
    expect(root.querySelector('.dca-side-files')).not.toBeNull();
    expect(root.textContent).toContain('character');
    const definitionRow = [...root.querySelectorAll<HTMLButtonElement>('.dca-file-tree-row.directory')]
      .find(button => button.textContent?.includes('definition'))!;
    definitionRow.click();
    await nextTick();
    expect(root.textContent).toContain('description.md');
    const characterRow = [...root.querySelectorAll<HTMLButtonElement>('.dca-file-tree-row.directory')]
      .find(button => button.textContent?.includes('character'))!;
    characterRow.click();
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
    const settingsLabels = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-nav button')].map(button =>
      button.textContent?.trim(),
    );
    expect(settingsLabels.indexOf('API')).toBeLessThan(settingsLabels.indexOf('Agent配置'));
    const updateSection = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-nav button')].find(button =>
      button.textContent?.includes('更新'),
    )!;
    updateSection.click();
    await nextTick();
    expect(root.querySelector('.dca-update-settings')?.textContent).toContain('当前版本 v0.1.0');
    expect(root.querySelector('.dca-update-settings')?.textContent).toContain('首次加载后静默检查更新');
    const skillSection = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-nav button')].find(button =>
      button.textContent?.includes('Skill'),
    )!;
    skillSection.click();
    await nextTick();
    const remoteSkillCards = root.querySelectorAll('.dca-skill-card.remote');
    expect(remoteSkillCards).toHaveLength(2);
    const downloadedRemoteButtons = [...remoteSkillCards[0].querySelectorAll('button')].map(button => button.textContent?.trim());
    expect(downloadedRemoteButtons).toEqual(['查看', '另存为', '导出']);
    expect([...remoteSkillCards[1].querySelectorAll('button')].map(button => button.textContent?.trim())).toEqual(['下载']);
    (remoteSkillCards[0].querySelector('button[aria-expanded="false"]') as HTMLButtonElement).click();
    await nextTick();
    expect(root.querySelector('.dca-skill-export-options')?.textContent).toContain('仅导出 MD');
    expect(root.querySelector('.dca-skill-export-options')?.textContent).toContain('导出 ZIP');
    expect(root.querySelector('select[aria-label*="导出格式"]')).toBeNull();
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
    await vi.waitFor(() => expect(saveSkill.disabled).toBe(false));
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

    const resourcesSection = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-nav button')].find(
      button => button.textContent?.trim() === '资源下载',
    )!;
    resourcesSection.click();
    await nextTick();
    expect(root.querySelector('.dca-download-summary')?.textContent).toContain('2 项资源');
    expect(root.querySelector('.dca-download-summary')?.textContent).toContain('已下载 1');
    expect(root.querySelector('.dca-download-summary')?.textContent).toContain('待下载 1');
    expect(root.querySelectorAll('.dca-resource-download-card')).toHaveLength(2);
    expect(root.querySelector('.dca-download-settings')?.textContent).not.toContain('127.0.0.1');
    expect(root.querySelector('.dca-download-settings')?.textContent).not.toContain('另存为用户Skill');
    expect(root.querySelector('.dca-download-settings')?.textContent).not.toContain('重新下载');

    const agentSection = [...root.querySelectorAll<HTMLButtonElement>('.dca-settings-nav button')].find(
      button => button.textContent?.trim() === 'Agent配置',
    )!;
    agentSection.click();
    await nextTick();
    expect(root.querySelector<HTMLInputElement>('input[maxlength="80"]')?.value).toBe('梦境创客默认 Agent');
    expect(root.querySelector<HTMLInputElement>('input[maxlength="80"]')?.disabled).toBe(true);
    const agentSkillTab = [...root.querySelectorAll<HTMLButtonElement>('.dca-agent-tabs button')]
      .find(button => button.textContent?.includes('Skill'))!;
    agentSkillTab.click();
    await nextTick();
    expect(root.querySelector('.dca-agent-skill-row')).not.toBeNull();
    const skillSaveCalls = mock.runtime.saveGlobalSkill.mock.calls.length;
    const saveAsBuiltin = [...root.querySelectorAll<HTMLButtonElement>('.dca-resource-savebar button')].find(button =>
      button.textContent?.includes('另存为自定义 Agent'),
    )!;
    saveAsBuiltin.click();
    await nextTick();
    const saveConfiguration = [...root.querySelectorAll<HTMLButtonElement>('.dca-resource-savebar button')].find(
      button => button.textContent?.trim() === '保存 Agent',
    )!;
    saveConfiguration.click();
    expect(mock.runtime.saveAgentConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^agent:/u),
        name: '梦境创客默认 Agent 副本',
        skills: [],
        toolIds: expect.any(Array),
      }),
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
    expect(tabButtons[1].disabled).toBe(false);
    expect(tabButtons[1].title).toBe('停止任务并关闭页签');

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
