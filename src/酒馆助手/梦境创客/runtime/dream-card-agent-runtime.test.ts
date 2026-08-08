import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { MemoryTavernFileClient } from '../core/persistence/file-client';
import { MemoryAgentSettingsStore } from '../core/persistence/settings';
import type { ModelStepExecutor, ModelStepRequest, ModelStepResult } from '../core/runner/step-executor';
import { MemoryCardStateAdapter } from '../core/transaction/adapter';
import { transactionState } from '../core/transaction/test-fixture';
import { DreamCardAgentRuntime } from './dream-card-agent-runtime';

class QueueExecutor implements ModelStepExecutor {
  constructor(private readonly results: ModelStepResult[]) {}
  async execute(_request: ModelStepRequest): Promise<ModelStepResult> {
    const result = this.results.shift();
    if (!result) throw new Error('missing runtime model step');
    return result;
  }
}

function modelStep(tool = false): ModelStepResult {
  const messages: ModelMessage[] = tool
    ? [
        {
          content: [
            {
              input: { content: '运行时描述', path: '/character/description.md' },
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
            input: { content: '运行时描述', path: '/character/description.md' },
            toolCallId: 'runtime-write',
            toolName: 'write_file',
          },
        ]
      : [],
  };
}

async function addProfile(runtime: DreamCardAgentRuntime): Promise<void> {
  await runtime.saveProfile({
    apiKey: 'secret',
    baseURL: 'https://example.invalid/v1',
    headers: {},
    model: 'model',
    name: '本地接口',
    protocol: 'openai-chat',
  });
}

describe('DreamCardAgentRuntime', () => {
  it('把角色绑定、API Profile、会话Revision和前台状态串成生产运行时', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const settings = new MemoryAgentSettingsStore();
    const files = new MemoryTavernFileClient();
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([modelStep(true), modelStep(false)]),
      fileClient: files,
      holderId: 'same-browser',
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
    expect(settings.load().sessions[sessionId]).toMatchObject({ avatarId: 'avatar.png', title: '塑造角色' });
    expect(files.urls().some(url => url.includes('manifest'))).toBe(true);
    runtime.destroy();

    const reopened = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([]),
      fileClient: files,
      holderId: 'same-browser',
      settingsStore: settings,
    });
    const view = await reopened.openSession(sessionId);
    expect(view.ui.some(item => item.content === '修改描述')).toBe(true);
    expect(view.readOnly).toBe(false);
    reopened.destroy();
  });

  it('非租约持有者只读打开，并可手动接管', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const settings = new MemoryAgentSettingsStore();
    const files = new MemoryTavernFileClient();
    const owner = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([]),
      fileClient: files,
      holderId: 'owner',
      settingsStore: settings,
    });
    await addProfile(owner);
    const session = await owner.createSession();

    const observer = new DreamCardAgentRuntime({
      adapterFactory: () => adapter,
      executorFactory: () => new QueueExecutor([]),
      fileClient: files,
      holderId: 'observer',
      settingsStore: settings,
    });
    expect((await observer.openSession(session.sessionId)).readOnly).toBe(true);
    await expect(observer.send('不能写')).rejects.toThrow('只能查看');
    expect((await observer.takeOverSession()).readOnly).toBe(false);
    owner.destroy();
    observer.destroy();
  });

  it('Profile与轻量设置保存到extension settings模型，不发测试请求', async () => {
    const settings = new MemoryAgentSettingsStore();
    const runtime = new DreamCardAgentRuntime({
      adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
      executorFactory: () => new QueueExecutor([]),
      fileClient: new MemoryTavernFileClient(),
      settingsStore: settings,
    });
    await addProfile(runtime);
    const profile = runtime.snapshot().profiles[0];
    await runtime.updateSettings({ developerMode: true, floatingButton: false });
    expect(runtime.snapshot()).toMatchObject({ developerMode: true, floatingButton: false });
    await runtime.selectProfile(profile.id);
    await runtime.removeProfile(profile.id);
    expect(runtime.snapshot().profiles).toEqual([]);
    await expect(runtime.createSession()).rejects.toThrow('API设置');
    runtime.destroy();
  });
});
