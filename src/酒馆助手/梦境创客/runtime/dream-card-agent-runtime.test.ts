import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { MemoryTavernFileClient } from '../core/persistence/file-client';
import { MemoryAgentSettingsStore } from '../core/persistence/settings';
import type { ModelStepExecutor, ModelStepRequest, ModelStepResult } from '../core/runner/step-executor';
import { MemoryCardStateAdapter } from '../core/transaction/adapter';
import { transactionState } from '../core/transaction/test-fixture';
import { DreamCardAgentRuntime } from './dream-card-agent-runtime';
import type { AgentSkill } from '../core/skills/types';
import { FakeTavernBridge } from '../core/tavern/test-bridge';

class QueueExecutor implements ModelStepExecutor {
  constructor(private readonly results: ModelStepResult[]) {}
  async execute(_request: ModelStepRequest): Promise<ModelStepResult> {
    const result = this.results.shift();
    if (!result) throw new Error('missing runtime model step');
    return result;
  }
}

class DeferredExecutor implements ModelStepExecutor {
  started!: () => void;
  readonly startedPromise = new Promise<void>(resolve => {
    this.started = resolve;
  });
  finish!: (result: ModelStepResult) => void;
  private readonly result = new Promise<ModelStepResult>(resolve => {
    this.finish = resolve;
  });
  async execute(_request: ModelStepRequest): Promise<ModelStepResult> {
    this.started();
    return this.result;
  }
}

function modelStep(tool = false): ModelStepResult {
  const messages: ModelMessage[] = tool
    ? [
        {
          content: [
            {
              input: { content: '运行时描述', overwrite: true, path: '/character/description.md' },
              toolCallId: 'runtime-write',
              toolName: 'write_file',
              type: 'tool-call',
            },
          ],
          role: 'assistant',
        },
      ]
    : [{ content: '已完成', role: 'assistant' }];
  return {
    assistantMessages: messages,
    finishReason: tool ? 'tool-calls' : 'stop',
    text: tool ? '' : '已完成',
    toolCalls: tool
      ? [
          {
            input: { content: '运行时描述', overwrite: true, path: '/character/description.md' },
            toolCallId: 'runtime-write',
            toolName: 'write_file',
          },
        ]
      : [],
  };
}

async function addProfile(runtime: DreamCardAgentRuntime, modelSettings?: Parameters<DreamCardAgentRuntime['saveModel']>[1]['modelSettings']) {
  const provider = await runtime.saveProvider({
    apiKey: 'secret',
    baseURL: 'https://example.invalid/v1',
    headers: {},
    enabled: true,
    interfaceType: 'openai-chat',
    name: '本地接口',
  });
  const model = await runtime.saveModel(provider.id, {
    compatibilityMode: 'standard', enabled: true, modelId: 'model', modelSettings, name: 'model',
  });
  await runtime.selectDefaultModel({ providerId: provider.id, modelId: model.id });
  return { model, provider };
}

describe('DreamCardAgentRuntime', () => {
  it('按稳定绑定切换角色，并可把已失效角色的会话作为只读历史打开', async () => {
    const files = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const bridge = new FakeTavernBridge();
    const first = transactionState();
    const second = structuredClone(first);
    second.character.avatarId = 'second.png';
    second.character.bindingId = 'binding-2';
    second.character.name = '第二角色';
    second.character.extensions.card_agent = { binding_id: 'binding-2' };
    const firstRaw = structuredClone(bridge.raw!);
    const secondRaw = structuredClone(firstRaw);
    secondRaw.avatar = second.character.avatarId;
    secondRaw.name = second.character.name;
    secondRaw.data.name = second.character.name;
    secondRaw.data.extensions!.card_agent = { binding_id: second.character.bindingId };
    bridge.characters = [firstRaw, secondRaw];
    let current = first;
    bridge.selectCharacterById = async index => {
      bridge.calls.push(`select-character:${index}`);
      current = index === 0 ? first : second;
      bridge.raw = structuredClone(index === 0 ? firstRaw : secondRaw);
    };
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(current),
      bridge,
      executorFactory: () => new QueueExecutor([]),
      fileClient: files,
      settingsStore: settings,
    });
    await addProfile(runtime);
    await runtime.refreshCharacter();
    await runtime.createSession({ title: '第一角色会话' });
    current = second;
    bridge.raw = structuredClone(secondRaw);
    await runtime.refreshCharacter();
    const secondSession = await runtime.createSession({ title: '第二角色会话' });
    current = first;
    bridge.raw = structuredClone(firstRaw);
    await runtime.refreshCharacter();

    expect(runtime.snapshot().characterGroups.map(group => group.bindingId)).toEqual(['binding-1', 'binding-2']);
    await runtime.switchCharacterAndOpenSession('binding-2', secondSession.sessionId);
    expect(bridge.calls).toContain('select-character:1');
    expect(runtime.snapshot()).toMatchObject({
      active: { bindingId: 'binding-2', sessionId: secondSession.sessionId },
      activeSessionAccess: 'live',
      currentCharacter: { bindingId: 'binding-2' },
    });

    current = first;
    bridge.raw = structuredClone(firstRaw);
    bridge.characters = [firstRaw];
    await runtime.refreshCharacter();
    const unavailable = runtime.snapshot().characterGroups.find(group => group.bindingId === 'binding-2');
    expect(unavailable).toMatchObject({ available: false, characterName: '第二角色' });
    const history = await runtime.openHistorySession('binding-2', secondSession.sessionId);
    expect(runtime.snapshot().activeSessionAccess).toBe('readonly-history');
    expect(history.workingFiles.every(file => file.readonly)).toBe(true);
    runtime.destroy();
  });

  it('每套Agent配置独立组合预设与Skill开关，并可明确应用到已有会话', async () => {
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => new QueueExecutor([]),
      fileClient: new MemoryTavernFileClient(),
      settingsStore: new MemoryAgentSettingsStore(),
    });
    await addProfile(runtime);
    const writer: AgentSkill = {
      assets: {},
      body: '写作流程',
      builtin: false,
      description: '写作',
      id: 'writer',
      loading: 'full',
      name: '写作',
      references: {},
    };
    const reviewer: AgentSkill = { ...writer, body: '审阅流程', description: '审阅', id: 'reviewer', name: '审阅' };
    await runtime.saveGlobalSkill(writer);
    await runtime.saveGlobalSkill(reviewer);
    const presetId = runtime.snapshot().activePresetId;
    await runtime.saveAgentConfiguration({ id: 'agent:writer', name: '写作Agent', presetId, skillIds: ['writer'] });
    const first = await runtime.createSession();
    expect(first.agentConfiguration).toMatchObject({ id: 'agent:writer', skillIds: ['writer'] });
    expect(first.skills.map(skill => skill.id)).toEqual(['writer']);

    await runtime.saveAgentConfiguration({ id: 'agent:reviewer', name: '审阅Agent', presetId, skillIds: ['reviewer'] });
    expect(runtime.snapshot().active?.skills.map(skill => skill.id)).toEqual(['writer']);
    await runtime.applyAgentConfiguration('agent:reviewer');
    expect(runtime.snapshot().active).toMatchObject({
      agentConfiguration: { id: 'agent:reviewer', skillIds: ['reviewer'] },
    });
    expect(runtime.snapshot().active?.skills.map(skill => skill.id)).toEqual(['reviewer']);
    runtime.destroy();
  });

  it('内置Agent随脚本提供且不可编辑或删除', async () => {
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => new QueueExecutor([]),
      fileClient: new MemoryTavernFileClient(),
      settingsStore: new MemoryAgentSettingsStore(),
    });
    const builtin = runtime.snapshot().agentConfigurations[0];
    expect(builtin).toMatchObject({ id: 'agent:default', name: '梦境创客默认 Agent' });
    await expect(runtime.saveAgentConfiguration({ ...builtin, name: '被修改' })).rejects.toThrow('内置Agent不可编辑');
    await expect(runtime.removeAgentConfiguration(builtin.id)).rejects.toThrow('内置Agent不可删除');
    runtime.destroy();
  });

  it('全局Skill跨运行时复用，已打开会话从下一条消息开始挂载新版', async () => {
    const settings = new MemoryAgentSettingsStore();
    const files = new MemoryTavernFileClient();
    const adapter = new MemoryCardStateAdapter(transactionState());
    const original: AgentSkill = {
      assets: {},
      body: '旧版流程',
      builtin: false,
      description: '全局流程',
      id: 'global-writer',
      loading: 'full',
      name: '全局写作',
      references: {},
    };
    const first = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([modelStep(false)]),
      fileClient: files,
      settingsStore: settings,
    });
    await addProfile(first);
    await first.saveGlobalSkill(original);
    await first.saveAgentConfiguration({
      id: 'agent:writer',
      name: '写作Agent',
      presetId: first.snapshot().activePresetId,
      skillIds: [original.id],
    });
    await first.createSession();
    await first.saveGlobalSkill({ ...original, body: '新版流程' });
    expect(first.snapshot().active?.skills[0].body).toBe('旧版流程');
    await first.send('采用最新Skill');
    expect(first.snapshot().active?.skills[0].body).toBe('新版流程');

    const second = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([]),
      fileClient: files,
      settingsStore: settings,
    });
    await second.refreshCharacter();
    expect(second.snapshot().skills).toMatchObject([{ body: '新版流程', id: 'global-writer' }]);
    first.destroy();
    second.destroy();
  });

  it('预设Profile保存在全局设置，新会话采用当前Profile', async () => {
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => new QueueExecutor([]),
      fileClient: new MemoryTavernFileClient(),
      settingsStore: new MemoryAgentSettingsStore(),
    });
    await addProfile(runtime);
    const preset = await runtime.savePresetProfile({
      id: 'custom-preset',
      name: '世界书专家',
      nodes: [
        {
          content: '{{agent_identity}}\n{{skill_instructions}}',
          enabled: true,
          id: 'header',
          order: 10,
          role: 'system',
          title: '头部',
        },
      ],
      version: 1,
    });
    await runtime.saveAgentConfiguration({
      id: 'agent:worldbook',
      name: '世界书Agent',
      presetId: preset.id,
      skillIds: [],
    });
    expect(runtime.snapshot()).toMatchObject({ activePresetId: preset.id, presetProfiles: expect.any(Array) });
    expect((await runtime.createSession()).preset).toMatchObject({ id: 'custom-preset', name: '世界书专家' });
    runtime.destroy();
  });

  it('把角色绑定、API Profile、会话Revision和前台状态串成生产运行时', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const settings = new MemoryAgentSettingsStore();
    const files = new MemoryTavernFileClient();
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([modelStep(true), modelStep(false)]),
      fileClient: files,
      settingsStore: settings,
    });
    await addProfile(runtime);
    await runtime.refreshCharacter();
    expect(runtime.snapshot().currentCharacter?.name).toBe('角色');
    const created = await runtime.createSession({ mode: 'yolo', title: '塑造角色' });
    expect(created.title).toBe('塑造角色');
    expect((await runtime.send('修改描述')).status).toBe('completed');
    expect((await adapter.read()).character.fields.description).toBe('运行时描述');
    const sessionId = runtime.snapshot().active!.sessionId;
    expect(settings.load().characterStores['binding-1']).toMatchObject({ avatarId: 'avatar.png' });
    expect(runtime.snapshot().sessions.find(item => item.sessionId === sessionId)).toMatchObject({ title: '塑造角色' });
    expect(files.urls().some(url => url.includes('--Session--'))).toBe(true);
    expect(files.urls().some(url => url.includes('manifest') || url.includes('--blob--'))).toBe(false);
    runtime.destroy();

    const reopened = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([]),
      fileClient: files,
      settingsStore: settings,
    });
    const view = await reopened.openSession(sessionId);
    expect(view.ui.some(item => item.content === '修改描述')).toBe(true);
    reopened.destroy();
  });

  it('不同前端运行时都可直接打开会话，不创建后端租约', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const settings = new MemoryAgentSettingsStore();
    const files = new MemoryTavernFileClient();
    const owner = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([]),
      fileClient: files,
      settingsStore: settings,
    });
    await addProfile(owner);
    const session = await owner.createSession();

    const observer = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([]),
      fileClient: files,
      settingsStore: settings,
    });
    expect((await observer.openSession(session.sessionId)).sessionId).toBe(session.sessionId);
    expect(files.uploadedNames.some(name => name.includes('lease'))).toBe(false);
    expect((await observer.renameSession('重新命名的会话')).title).toBe('重新命名的会话');
    owner.destroy();
    observer.destroy();
  });

  it('首条用户输入前10个字成为默认会话名，并允许随后重命名', async () => {
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => new QueueExecutor([modelStep(false)]),
      fileClient: new MemoryTavernFileClient(),
      settingsStore: new MemoryAgentSettingsStore(),
    });
    await addProfile(runtime);
    await runtime.createSession();
    expect((await runtime.send('请补全角色的背景故事与动机')).title).toBe('请补全角色的背景故事');
    expect((await runtime.renameSession('  我的角色创作  ')).title).toBe('我的角色创作');
    expect(runtime.snapshot().sessions[0]?.title).toBe('我的角色创作');
    expect(runtime.snapshot().characterGroups[0]?.sessions[0]?.title).toBe('我的角色创作');
    runtime.destroy();
  });

  it('会话模型选项即时生效且不进入全局忙碌，关闭前合并保存', async () => {
    const files = new MemoryTavernFileClient();
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => new QueueExecutor([]),
      fileClient: files,
      settingsStore: new MemoryAgentSettingsStore(),
    });
    await addProfile(runtime);
    const session = await runtime.createSession();
    const busyStates: boolean[] = [];
    const unsubscribe = runtime.subscribe(state => busyStates.push(state.busy));
    busyStates.length = 0;
    const uploadsBefore = files.uploadedNames.length;
    const sessionUploadsBefore = files.uploadedNames.filter(name => name.includes('--Session--')).length;

    await runtime.setModelControls({ reasoningEffort: 'high' });
    await runtime.setModelControls({ webSearch: true });

    expect(runtime.snapshot().active?.modelControls).toEqual({ reasoningEffort: 'high', webSearch: true });
    expect(busyStates).toEqual([false, false]);
    expect(files.uploadedNames).toHaveLength(uploadsBefore);
    unsubscribe();

    await runtime.closeSession(session.sessionId);
    expect(files.uploadedNames.filter(name => name.includes('--Session--'))).toHaveLength(sessionUploadsBefore + 1);
    expect((await runtime.openSession(session.sessionId)).modelControls).toEqual({ reasoningEffort: 'high', webSearch: true });
    runtime.destroy();
  });

  it('Provider、模型与轻量设置保存到extension settings模型，不发测试请求', async () => {
    const settings = new MemoryAgentSettingsStore();
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => new QueueExecutor([]),
      fileClient: new MemoryTavernFileClient(),
      settingsStore: settings,
    });
    const { model, provider } = await addProfile(runtime);
    await runtime.updateSettings({ developerMode: true, floatingButton: false, sendWithCtrlEnter: true });
    expect(runtime.snapshot()).toMatchObject({ developerMode: true, floatingButton: false, sendWithCtrlEnter: true });
    await runtime.selectDefaultModel({ providerId: provider.id, modelId: model.id });
    await runtime.removeProvider(provider.id);
    expect(runtime.snapshot().providers).toEqual([]);
    expect((await runtime.createSession()).modelSelection).toBeUndefined();
    await expect(runtime.send('测试')).rejects.toThrow('尚未选择可用模型');
    runtime.destroy();
  });

  it('Provider与模型编辑保留ID，复制Provider时创建整套新ID', async () => {
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => new QueueExecutor([]),
      fileClient: new MemoryTavernFileClient(),
      settingsStore: new MemoryAgentSettingsStore(),
    });
    const { model, provider } = await addProfile(runtime);
    const updatedProvider = await runtime.saveProvider({
      apiKey: '', baseURL: provider.baseURL, enabled: true, id: provider.id,
      interfaceType: provider.interfaceType, name: '本地接口新版',
    });
    const updatedModel = await runtime.saveModel(provider.id, {
      compatibilityMode: 'deepseek', enabled: true, id: model.id, modelId: 'model-v2', name: '模型新版',
    });
    expect(updatedProvider.id).toBe(provider.id);
    expect(updatedModel.id).toBe(model.id);
    const copied = await runtime.copyProvider(provider.id);
    expect(copied.id).not.toBe(provider.id);
    expect(copied.models[0].id).not.toBe(model.id);
    expect(runtime.snapshot().providers.map(item => item.name)).toEqual(['本地接口新版', '本地接口新版 2']);
    runtime.destroy();
  });

  it('会话绑定模型明确关闭视觉时拒绝图片附件', async () => {
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => new QueueExecutor([]),
      fileClient: new MemoryTavernFileClient(),
      settingsStore: new MemoryAgentSettingsStore(),
    });
    await addProfile(runtime, {
        capabilities: { reasoning: 'auto', toolCalling: 'auto', vision: 'disabled', webSearch: 'auto' },
    });
    await runtime.createSession();
    await expect(
      runtime.send('', [{ data: 'AQID', filename: 'image.png', mediaType: 'image/png', size: 3 }]),
    ).rejects.toThrow('不支持视觉');
    runtime.destroy();
  });

  it('一个会话运行时仍可切换到其它已打开会话，后台完成不会抢回当前页签', async () => {
    const deferred = new DeferredExecutor();
    let executorIndex = 0;
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => (executorIndex++ === 0 ? deferred : new QueueExecutor([])),
      fileClient: new MemoryTavernFileClient(),
      settingsStore: new MemoryAgentSettingsStore(),
    });
    await addProfile(runtime);
    const first = await runtime.createSession({ title: '后台会话' });
    const running = runtime.send('运行一个任务');
    await deferred.startedPromise;

    const second = await runtime.createSession({ title: '前台会话' });
    expect(runtime.snapshot().active?.sessionId).toBe(second.sessionId);
    expect(runtime.snapshot().sessionStatuses[first.sessionId]).toBe('running');

    deferred.finish(modelStep(false));
    await running;
    expect(runtime.snapshot().active?.sessionId).toBe(second.sessionId);
    expect(runtime.snapshot().sessionStatuses[first.sessionId]).toBe('completed');
    expect(runtime.snapshot().loadedSessionIds).toEqual([first.sessionId, second.sessionId]);
    runtime.destroy();
  });
});
