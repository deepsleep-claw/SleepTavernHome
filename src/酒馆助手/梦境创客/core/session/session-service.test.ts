import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import type { StructuredPreset } from '../preset/compiler';
import type { ModelStepExecutor, ModelStepRequest, ModelStepResult, RunnerToolCall } from '../runner/step-executor';
import type { AgentSkill } from '../skills/types';
import { MemoryCardStateAdapter } from '../transaction/adapter';
import { transactionState } from '../transaction/test-fixture';
import { CardAgentSessionService } from './session-service';
import { GlobalAgentTaskLock } from './task-lock';
import type { PersistedSessionRuntime } from './types';
import { defaultBuiltinAgentConfiguration } from '../persistence/builtin-agent';

function step(toolCalls: RunnerToolCall[] = [], text = '完成啦'): ModelStepResult {
  const assistantMessages: ModelMessage[] = [
    toolCalls.length
      ? {
          content: toolCalls.map(call => ({
            input: call.input,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            type: 'tool-call' as const,
          })),
          role: 'assistant',
        }
      : { content: text, role: 'assistant' },
  ];
  return { assistantMessages, finishReason: toolCalls.length ? 'tool-calls' : 'stop', text, toolCalls };
}

class QueueExecutor implements ModelStepExecutor {
  readonly requests: ModelStepRequest[] = [];
  constructor(private readonly queue: ModelStepResult[]) {}
  async execute(request: ModelStepRequest): Promise<ModelStepResult> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error('missing step');
    return next;
  }
}

function writeDescription(content: string, id = 'write-description'): RunnerToolCall {
  return {
    input: { content, overwrite: true, path: '/character/definition/description.md' },
    toolCallId: id,
    toolName: 'write_file',
  };
}

function createService(input: {
  adapter?: MemoryCardStateAdapter;
  executor: ModelStepExecutor;
  mode?: 'full' | 'normal' | 'yolo';
  onPersist?: (runtime: PersistedSessionRuntime) => Promise<void>;
  requestToolApproval?: (request: { toolName: string }) => Promise<boolean>;
}) {
  return CardAgentSessionService.create({
    adapter: input.adapter ?? new MemoryCardStateAdapter(transactionState()),
    agentConfiguration: defaultBuiltinAgentConfiguration(),
    executor: input.executor,
    lock: new GlobalAgentTaskLock(),
    mode: input.mode,
    onPersist: input.onPersist,
    requestToolApproval: input.requestToolApproval,
  });
}

describe('card agent realtime session service', () => {
  it('按toolCallId流式建立工具卡并在正式执行时原地更新', async () => {
    const call = writeDescription('第一行\n第二行', 'stream-write');
    let stepIndex = 0;
    const executor: ModelStepExecutor = {
      execute: async request => {
        stepIndex += 1;
        if (stepIndex > 1) return step();
        request.onTextDelta?.('先说明再写入。');
        request.onToolInputStarted?.({ toolCallId: call.toolCallId, toolName: call.toolName });
        request.onToolInputDelta?.({
          delta: '{"path":"/character/definition/description.md","content":"第一行\\n第二',
          toolCallId: call.toolCallId,
        });
        await new Promise(resolve => setTimeout(resolve, 5));
        request.onToolInputReady?.(call);
        return {
          assistantMessages: [
            {
              content: [
                { text: '先说明再写入。', type: 'text' },
                { ...call, type: 'tool-call' as const },
              ],
              role: 'assistant',
            },
          ],
          finishReason: 'tool-calls',
          text: '先说明再写入。',
          toolCalls: [call],
        };
      },
    };
    const updates: PersistedSessionRuntime['ui'][] = [];
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      agentConfiguration: defaultBuiltinAgentConfiguration(),
      executor,
      lock: new GlobalAgentTaskLock(),
      mode: 'full',
      onUpdate: view => updates.push(structuredClone(view.ui)),
      scheduleStreamingUpdate: callback => {
        const timer = setTimeout(callback, 0);
        return () => clearTimeout(timer);
      },
    });

    const completed = await service.send('写两行');
    expect(updates.some(ui => ui.some(item => item.toolCallId === call.toolCallId && item.toolPhase === 'generating')))
      .toBe(true);
    const cards = completed.ui.filter(item => item.toolCallId === call.toolCallId);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ status: 'completed', toolPhase: undefined, toolName: 'write_file' });
    expect(JSON.parse(cards[0].toolInput ?? '{}')).toEqual(call.input);
    expect(
      completed.ui
        .filter(item => item.kind === 'assistant' || item.kind === 'tool')
        .map(item => item.kind === 'tool' ? 'tool' : item.content),
    ).toEqual(['先说明再写入。', 'tool', '完成啦']);
  });

  it('普通发送固定Skill头部，压缩时使用当前Skill重新编译', async () => {
    const oldSkill: AgentSkill = {
      body: 'OLD_SKILL_BODY', builtin: false, description: '测试', directories: [], id: 'dynamic-skill',
      loading: 'full', name: '动态Skill', resources: {},
    };
    const preset: StructuredPreset = {
      id: 'preset:dynamic-skill', name: '动态Skill预设', version: 1,
      nodes: [{ content: '{{skill_instructions}}', enabled: true, id: 'skills', order: 10, role: 'system', title: 'Skill' }],
    };
    const compactCall = { input: { summary: '保留目标' }, toolCallId: 'compact', toolName: 'compact_context' };
    const executor = new QueueExecutor([step([], 'x'.repeat(150_000)), step([compactCall]), step([], '压缩后完成')]);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      agentConfiguration: {
        id: 'agent:test',
        name: '测试',
        presetId: preset.id,
        skills: [{ enabled: true, id: oldSkill.id, loading: 'full' }],
        toolIds: defaultBuiltinAgentConfiguration().toolIds,
      },
      contextWindow: 50_000,
      executor,
      lock: new GlobalAgentTaskLock(),
      preset,
      skills: [oldSkill],
    });
    await service.send('第一轮');
    await service.setSkills([{ ...oldSkill, body: 'NEW_SKILL_BODY' }]);
    await service.send('第二轮');
    expect(executor.requests[1].forceTool).toBe('compact_context');
    expect(String(executor.requests[1].messages[0].content)).toContain('NEW_SKILL_BODY');
    expect(String(executor.requests[2].messages[0].content)).toContain('NEW_SKILL_BODY');
  });

  it('附件进入规范模型消息，界面和持久化仅暴露所需层级', async () => {
    const executor = new QueueExecutor([step([], '看到了')]);
    const persisted = vi.fn(async (_runtime: PersistedSessionRuntime) => undefined);
    const service = await createService({ executor, onPersist: persisted });
    const completed = await service.send('', 'attachment-user', [
      { data: 'AQID', filename: 'reference.png', mediaType: 'image/png', size: 3 },
    ]);
    expect(executor.requests[0].messages.at(-1)).toMatchObject({
      content: [expect.objectContaining({ filename: 'reference.png', mediaType: 'image/png', type: 'file' })],
      role: 'user',
    });
    expect(completed.ui.find(item => item.id === 'attachment-user')?.attachments?.[0]).not.toHaveProperty('data');
    expect(persisted.mock.calls.at(-1)?.[0].version).toBe(3);
  });

  it('手动模式逐工具批准后立即写入真实角色资源并记录操作', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const approval = vi.fn(async () => true);
    const service = await createService({
      adapter,
      executor: new QueueExecutor([step([writeDescription('实时新描述')]), step([], '完成')]),
      requestToolApproval: approval,
    });
    const completed = await service.send('修改描述');
    expect(approval).toHaveBeenCalledOnce();
    expect((await adapter.read()).character.fields.description).toBe('实时新描述');
    expect(completed.status).toBe('completed');
    expect(completed.operationLog.records).toMatchObject([
      { actor: 'agent', approvalMode: 'manual', state: 'applied', toolCallId: 'write-description' },
    ]);
  });

  it('拒绝工具后把结果交还模型继续决策，不中断整轮', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const executor = new QueueExecutor([step([writeDescription('不会写入')]), step([], '已按用户拒绝停止修改')]);
    const service = await createService({ adapter, executor, requestToolApproval: async () => false });
    const completed = await service.send('修改描述');
    expect(completed.status).toBe('completed');
    expect((await adapter.read()).character.fields.description).not.toBe('不会写入');
    expect(executor.requests[1].messages.at(-1)).toMatchObject({ role: 'tool' });
  });

  it('完全权限自动放行写入，YOLO仍保留高危工具确认', async () => {
    const fullApproval = vi.fn(async () => true);
    const full = await createService({
      executor: new QueueExecutor([step([writeDescription('完全权限')]), step()]),
      mode: 'full', requestToolApproval: fullApproval,
    });
    await full.send('修改');
    expect(fullApproval).not.toHaveBeenCalled();

    const yoloApproval = vi.fn(async () => false);
    const yolo = await createService({
      executor: new QueueExecutor([
        step([{ input: { path: '/character/greetings' }, toolCallId: 'delete-greetings', toolName: 'delete_path' }]),
        step([], '已拒绝删除'),
      ]),
      mode: 'yolo', requestToolApproval: yoloApproval,
    });
    await yolo.send('删除全部开场白');
    expect(yoloApproval).toHaveBeenCalledOnce();
  });

  it('最新一轮修改可独立Undo和Redo，不回退Agent消息', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const service = await createService({
      adapter,
      executor: new QueueExecutor([step([writeDescription('第二版')]), step([], '修改完成')]),
      mode: 'full',
    });
    const completed = await service.send('修改描述', 'turn-user');
    const original = transactionState().character.fields.description;
    expect(completed.ui.some(item => item.kind === 'assistant')).toBe(true);
    await service.undo();
    expect((await adapter.read()).character.fields.description).toBe(original);
    expect(service.view().ui.some(item => item.kind === 'assistant')).toBe(true);
    await service.redo();
    expect((await adapter.read()).character.fields.description).toBe('第二版');
  });

  it('Undo先模拟真实文件，外部编辑冲突时等待应用内确认并可跳过', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const service = await createService({
      adapter,
      executor: new QueueExecutor([step([writeDescription('Agent版本')]), step()]),
      mode: 'full',
    });
    await service.send('修改');
    const external = await adapter.read();
    external.character.fields.description = '玩家外部编辑';
    adapter.replaceExternal(external);
    const waiting = await service.undo();
    expect(waiting.operationReplay?.conflicts).toMatchObject([
      { path: '/character/definition/description.md', reason: '文件在原操作之后又发生了变化。' },
    ]);
    await service.confirmOperationReplay(true);
    expect((await adapter.read()).character.fields.description).toBe('玩家外部编辑');
  });

  it('回退最新用户消息时同时撤销文件操作、保留可编辑用户消息并允许重发', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const executor = new QueueExecutor([
      step([writeDescription('第一版')]), step([], '第一轮完成'),
      step([writeDescription('第二版', 'write-again')]), step([], '第二轮完成'),
    ]);
    const service = await createService({ adapter, executor, mode: 'full' });
    const original = transactionState().character.fields.description;
    await service.send('先修改', 'editable-user');
    const undone = await service.undoToUserMessage('editable-user');
    expect((await adapter.read()).character.fields.description).toBe(original);
    expect(undone.ui.at(-1)).toMatchObject({ id: 'editable-user', kind: 'user' });
    await expect(service.redo()).rejects.toThrow('没有可重做');
    service.editUserMessage('editable-user', '重新修改');
    await service.resend('editable-user');
    expect((await adapter.read()).character.fields.description).toBe('第二版');
  });

  it('玩家保存实时写入、归入独特工具记录并向下一轮模型说明', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const executor = new QueueExecutor([step([], '已知晓玩家修改')]);
    const service = await createService({ adapter, executor, mode: 'full' });
    const before = (await service.view().workingFiles.find(file => file.path === '/character/definition/description.md'))?.content;
    const changed = await service.writeWorkingFile('/character/definition/description.md', '玩家版本', false, before);
    expect((await adapter.read()).character.fields.description).toBe('玩家版本');
    expect(changed.operationLog.records.at(-1)).toMatchObject({ actor: 'user' });
    expect(changed.ui.at(-1)).toMatchObject({ kind: 'manual', toolName: '玩家修改工作区' });
    await service.finalizeManualEdits();
    await service.send('继续');
    expect(executor.requests[0].messages.some(message => String(message.content).includes('manual_workspace_changes'))).toBe(true);
  });

  it('玩家基于过期编辑内容保存时报告三方冲突而不覆盖实时文件', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const service = await createService({ adapter, executor: new QueueExecutor([]), mode: 'full' });
    const before = service.view().workingFiles.find(file => file.path === '/character/definition/description.md')!.content;
    const external = await adapter.read();
    external.character.fields.description = '外部版本';
    adapter.replaceExternal(external);
    await expect(service.writeWorkingFile('/character/definition/description.md', '玩家版本', false, before)).rejects.toThrow(
      'MANUAL_EDIT_CONFLICT',
    );
    expect((await adapter.read()).character.fields.description).toBe('外部版本');
  });

  it('会话级推理与联网设置保持绑定并进入模型请求', async () => {
    const executor = new QueueExecutor([step()]);
    const service = await createService({ executor });
    await service.setModelControls({ reasoningEffort: 'high', webSearch: true });
    await service.send('检查');
    expect(executor.requests[0].modelSettings).toMatchObject({ reasoningEffort: 'high', webSearch: true });
    expect(service.view().modelControls).toEqual({ reasoningEffort: 'high', webSearch: true });
  });

  it('主动停止后保留同一操作边界，恢复产生的过程项仍归入原轮次', async () => {
    const persisted: PersistedSessionRuntime[] = [];
    let stepIndex = 0;
    const executor: ModelStepExecutor = {
      execute: request => {
        stepIndex += 1;
        if (stepIndex === 1) {
          return new Promise((_resolve, reject) => {
            request.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        }
        if (stepIndex === 2) {
          request.onReasoningDelta?.('恢复后的思考');
          return Promise.resolve(step([writeDescription('恢复后写入', 'resumed-write')]));
        }
        return Promise.resolve(step([], '恢复完成'));
      },
    };
    const service = await createService({
      executor,
      mode: 'full',
      onPersist: async runtime => {
        persisted.push(structuredClone(runtime));
      },
    });

    const sending = service.send('先停止再继续', 'stopped-user');
    await vi.waitFor(() => expect(stepIndex).toBe(1));
    service.stop();
    const stopped = await sending;
    const checkpointId = stopped.ui.find(item => item.id === 'stopped-user')?.checkpointId;
    expect(checkpointId).toBeTruthy();
    expect(stopped.status).toBe('stopped');
    expect(persisted.at(-1)?.activeCheckpointId).toBe(checkpointId);

    const completed = await service.resume();
    expect(completed.status).toBe('completed');
    expect(
      completed.ui
        .filter(item => ['assistant', 'reasoning', 'tool'].includes(item.kind))
        .every(item => item.checkpointId === checkpointId),
    ).toBe(true);
    expect(completed.ui.find(item => item.toolCallId === 'resumed-write')).toMatchObject({
      checkpointId,
      status: 'completed',
    });
    expect(persisted.at(-1)?.activeCheckpointId).toBeUndefined();
  });

  it('载入会话时把停止恢复后遗失归属的过程项补回最近用户轮次', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    let runtime: PersistedSessionRuntime | undefined;
    const service = await createService({
      adapter,
      executor: new QueueExecutor([step([], '第一轮完成')]),
      onPersist: async value => {
        runtime = structuredClone(value);
      },
    });
    await service.send('第一轮', 'first-user');
    if (!runtime) throw new Error('测试会话没有持久化。');
    const firstCheckpointId = runtime.ui.find(item => item.id === 'first-user')?.checkpointId;
    runtime.ui
      .filter(item => item.kind === 'assistant' || item.kind === 'reasoning' || item.kind === 'tool')
      .forEach(item => delete item.checkpointId);
    runtime.ui.push(
      { at: 20, checkpointId: 'turn:second', content: '第二轮', id: 'second-user', kind: 'user' },
      { at: 21, content: '第二轮回复', id: 'second-assistant', kind: 'assistant' },
      { at: 22, content: '独立状态', id: 'standalone-status', kind: 'status', status: 'completed' },
    );

    const restored = await CardAgentSessionService.restore(
      {
        adapter,
        agentConfiguration: defaultBuiltinAgentConfiguration(),
        executor: new QueueExecutor([]),
        lock: new GlobalAgentTaskLock(),
      },
      runtime,
    );
    const restoredUi = restored.view().ui;
    expect(restoredUi.find(item => item.kind === 'assistant' && item.id !== 'second-assistant')?.checkpointId).toBe(
      firstCheckpointId,
    );
    expect(restoredUi.find(item => item.id === 'second-assistant')?.checkpointId).toBe('turn:second');
    expect(restoredUi.find(item => item.id === 'standalone-status')?.checkpointId).toBeUndefined();
  });
});
