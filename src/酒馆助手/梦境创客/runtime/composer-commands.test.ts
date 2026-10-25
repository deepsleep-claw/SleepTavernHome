import { afterEach, describe, expect, it, vi } from 'vitest';
import { DreamCardAgentRuntime } from './dream-card-agent-runtime';
import { MemoryTavernFileClient } from '../core/persistence/file-client';
import { MemoryBrowserRecordStore } from '../core/persistence/browser-record-store';
import { MemoryAgentSettingsStore } from '../core/persistence/settings';
import { MemoryCardStateAdapter } from '../core/transaction/adapter';
import { transactionState } from '../core/transaction/test-fixture';
import { FakeTavernBridge } from '../core/tavern/test-bridge';
import { defaultBuiltinAgentConfiguration } from '../core/persistence/builtin-agent';
import type { ModelStepRequest, ModelStepResult } from '../core/runner/step-executor';

const runtimes: DreamCardAgentRuntime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach(runtime => runtime.destroy());
});
function response(text = '完成'): ModelStepResult {
  return { assistantMessages: [{ role: 'assistant', content: text }], text, toolCalls: [], finishReason: 'stop' };
}

async function fixture(execute = vi.fn(async (_request: ModelStepRequest) => response())) {
  const settings = new MemoryAgentSettingsStore();
  const runtime = new DreamCardAgentRuntime({
    bridge: new FakeTavernBridge(),
    adapterFactory: () => new MemoryCardStateAdapter(transactionState()),
    settingsStore: settings,
    fileClient: new MemoryTavernFileClient(),
    browserRecords: new MemoryBrowserRecordStore(),
    executorFactory: () => ({ execute }),
  });
  runtimes.push(runtime);
  const provider = await runtime.saveProvider({
    name: '测试渠道',
    interfaceType: 'openai-chat',
    apiKey: 'test-key',
    enabled: true,
    baseURL: 'https://example.invalid/v1',
  });
  const model = await runtime.saveModel(provider.id, {
    name: '模型一',
    modelId: 'model-1',
    enabled: true,
    compatibilityMode: 'standard',
    modelSettings: {
      reasoningEfforts: [
        { id: 'high', name: '高' },
        { id: 'low', name: '低' },
      ],
    },
  });
  await runtime.selectDefaultModel({ providerId: provider.id, modelId: model.id });
  await runtime.saveGlobalSkill({
    id: 'local-check',
    name: '角色检查',
    description: '检查角色设定',
    body: '检查设定一致性。',
    builtin: false,
    loading: 'on-demand',
  });
  await runtime.saveAgentConfiguration({
    id: 'agent:commands',
    name: '指令助手',
    presetId: runtime.snapshot().activePresetId,
    skills: [{ id: 'local-check', enabled: true, loading: 'on-demand' }],
    toolIds: defaultBuiltinAgentConfiguration().toolIds,
  });
  await runtime.refreshCharacter();
  const session = await runtime.createSession();
  const command = (text: string, id = crypto.randomUUID()) => ({
    id,
    sessionId: session.sessionId,
    kind: 'command' as const,
    text,
  });
  return { runtime, session, provider, model, settings, execute, command };
}

describe('运行时输入指令', () => {
  it('配置命令只修改当前会话，同一输入 ID 不重复执行', async () => {
    const f = await fixture();
    const second = await f.runtime.saveModel(f.provider.id, {
      name: '模型二',
      modelId: 'model-2',
      enabled: true,
      compatibilityMode: 'standard',
      modelSettings: { reasoningEfforts: [{ id: 'high', name: '高' }] },
    });
    const select = vi.spyOn(f.runtime, 'selectSessionModel');
    const input = f.command('/model 测试渠道/模型二');
    const first = f.runtime.submitInput(input);
    expect(f.runtime.submitInput(input)).toBe(first);
    await first;
    expect(select).toHaveBeenCalledTimes(1);
    expect(f.runtime.snapshot().active?.modelSelection?.modelId).toBe(second.id);
    await f.runtime.submitInput(f.command('/推理 high'));
    expect(f.runtime.snapshot().active?.modelControls.reasoningEffort).toBe('high');
    expect(f.execute).not.toHaveBeenCalled();
    await expect(f.runtime.submitInput(f.command('/effort unavailable'))).rejects.toThrow('不适用');
  });

  it('未知命令、非法参数、附件与过期会话不进入模型请求', async () => {
    const f = await fixture();
    await expect(f.runtime.submitInput(f.command('/不存在'))).rejects.toThrow('未知指令');
    await expect(f.runtime.submitInput(f.command('/stop 另一会话'))).rejects.toThrow('不接受参数');
    await expect(
      f.runtime.submitInput({
        ...f.command('/compact'),
        attachments: [{ filename: 'a.txt', mediaType: 'text/plain', data: 'QQ==', size: 1 }],
      }),
    ).rejects.toThrow('附件');
    await f.runtime.createSession();
    await expect(f.runtime.submitInput(f.command('/model 模型一'))).rejects.toThrow('目标会话');
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('Skill 指令使用当前挂载路径并把任务送入正常提交流程', async () => {
    const f = await fixture();
    const input = f.command('/skill local-check 检查世界观\n保留人物关系');
    await f.runtime.submitInput(input);
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
    const sent = JSON.stringify(f.execute.mock.calls[0][0].messages);
    expect(sent).toContain('/skills/user/local-check/SKILL.md');
    expect(sent).toContain('检查世界观');
    expect(sent).not.toContain('/skill local-check');
    await vi.waitFor(() => expect(f.runtime.snapshot().active?.status).toBe('completed'));
    await expect(f.runtime.submitInput(f.command('/skill local-check'))).rejects.toThrow('填写任务');
    await expect(f.runtime.submitInput(f.command('/skill missing 检查'))).rejects.toThrow('未在当前会话挂载');
  });

  it('手动压缩重点进入摘要请求，正文和工具续轮不混入指令文本', async () => {
    const execute = vi.fn(async (request: ModelStepRequest) =>
      response(request.purpose === 'summary' ? '已保留人物关系与待办' : '此前完成的步骤'.repeat(400)),
    );
    const f = await fixture(execute);
    await f.runtime.send('第一轮');
    await f.runtime.send('第二轮');
    await f.runtime.submitInput(f.command('/压缩 保留人物关系和未完成事项'));
    const summary = execute.mock.calls.find(([request]) => request.purpose === 'summary')?.[0];
    expect(summary).toBeDefined();
    expect(JSON.stringify(summary!.messages.at(-1))).toContain('保留人物关系和未完成事项');
    expect(summary!.tools).toEqual([]);
    expect(f.runtime.snapshot().active?.ui.some(item => item.kind === 'user' && item.content.startsWith('/压缩'))).toBe(
      false,
    );
  });

  it('运行中拒绝切换配置，停止指令只停止目标会话', async () => {
    const execute = vi.fn(
      (request: ModelStepRequest) =>
        new Promise<ModelStepResult>((_resolve, reject) =>
          request.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        ),
    );
    const f = await fixture(execute);
    await f.runtime.submitInput({ ...f.command('开始'), kind: 'message' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await expect(f.runtime.submitInput(f.command('/model 模型一'))).rejects.toThrow('先停止');
    await f.runtime.submitInput(f.command('/stop'));
    await vi.waitFor(() => expect(f.runtime.snapshot().active?.status).toBe('stopped'));
  });

  it('继续命令接收后即可发送中途引导，不等待整轮生成结束', async () => {
    const execute = vi.fn(
      (request: ModelStepRequest) =>
        new Promise<ModelStepResult>((_resolve, reject) =>
          request.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        ),
    );
    const f = await fixture(execute);
    await f.runtime.submitInput({ ...f.command('开始'), kind: 'message' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await f.runtime.submitInput(f.command('/stop'));
    await vi.waitFor(() => expect(f.runtime.snapshot().active?.status).toBe('stopped'));
    const resume = f.command('/resume');
    await vi.waitFor(() => expect(f.runtime.snapshot().busy).toBe(false));
    await expect(f.runtime.submitInput(resume)).resolves.toMatchObject({ id: resume.id, kind: 'command' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    await expect(f.runtime.submitInput({ ...f.command('保留角色关系'), kind: 'guidance' })).resolves.toMatchObject({
      kind: 'guidance',
    });
    expect(f.runtime.snapshot().active?.status).toBe('running');
    f.runtime.stopSession(f.session.sessionId);
    await vi.waitFor(() => expect(f.runtime.snapshot().active?.status).toBe('stopped'));
  });

  it('最新配置停用 Skill 或读取工具时拒绝命令并保留中断任务', async () => {
    const execute = vi.fn(
      (request: ModelStepRequest) =>
        new Promise<ModelStepResult>((_resolve, reject) =>
          request.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        ),
    );
    const f = await fixture(execute);
    await f.runtime.submitInput({ ...f.command('开始'), kind: 'message' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    f.runtime.stopSession(f.session.sessionId);
    await vi.waitFor(() => expect(f.runtime.snapshot().active?.status).toBe('stopped'));
    const settings = f.settings.load();
    const configuration = settings.agentConfigurations.find(item => item.id === 'agent:commands')!;
    configuration.toolIds = configuration.toolIds.filter(id => id !== 'read_file');
    f.settings.save(settings);
    await expect(f.runtime.submitInput(f.command('/skill local-check 检查'))).rejects.toThrow('读取文件');
    expect(f.runtime.snapshot().active?.status).toBe('stopped');
    configuration.skills[0].enabled = false;
    f.settings.save(settings);
    await expect(f.runtime.submitInput(f.command('/skill local-check 检查'))).rejects.toThrow('已被停用');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
