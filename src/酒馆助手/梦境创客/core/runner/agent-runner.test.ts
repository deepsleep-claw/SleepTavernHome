import { tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { AgentRunner, MemoryRunnerJournal } from './agent-runner';
import type { ModelStepExecutor, ModelStepRequest, ModelStepResult, RunnerToolCall } from './step-executor';
import type { RunnerTool } from './tools';

function modelStep(toolCalls: RunnerToolCall[] = [], text = 'done'): ModelStepResult {
  const assistantMessages: ModelMessage[] = [
    toolCalls.length === 0
      ? { content: text, role: 'assistant' }
      : {
          content: toolCalls.map(call => ({
            input: call.input,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            type: 'tool-call' as const,
          })),
          role: 'assistant',
        },
  ];
  return { assistantMessages, finishReason: toolCalls.length ? 'tool-calls' : 'stop', text, toolCalls };
}

class QueueExecutor implements ModelStepExecutor {
  readonly requests: ModelStepRequest[] = [];
  constructor(
    private readonly queue: Array<ModelStepResult | Error | ((request: ModelStepRequest) => Promise<ModelStepResult>)>,
  ) {}
  async execute(request: ModelStepRequest): Promise<ModelStepResult> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error('missing fake step');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(request) : next;
  }
}

function runnerTool(
  name: string,
  readonly: boolean,
  execute: RunnerTool['execute'],
  confirmation?: RunnerTool['confirmation'],
): RunnerTool {
  return {
    confirmation,
    definition: tool({ description: name, inputSchema: z.object({ value: z.string().optional() }) }),
    execute,
    name,
    readonly,
  };
}

describe('AgentRunner', () => {
  it('无工具回复直接完成并保存规范化ModelMessage', async () => {
    const executor = new QueueExecutor([modelStep([], 'answer')]);
    const journal = new MemoryRunnerJournal();
    const runner = new AgentRunner({ executor, journal, tools: [] });
    const state = await runner.start('request');
    expect(state.status).toBe('completed');
    expect(state.messages).toEqual([
      { content: 'request', role: 'user' },
      { content: 'answer', role: 'assistant' },
    ]);
    expect(journal.events.some(event => event.type === 'model-completed')).toBe(true);
  });

  it('批次含写入时，读取与写入全部严格按调用顺序执行', async () => {
    const calls: RunnerToolCall[] = [
      { input: {}, toolCallId: '1', toolName: 'read' },
      { input: {}, toolCallId: '2', toolName: 'write' },
      { input: {}, toolCallId: '3', toolName: 'read' },
    ];
    const order: string[] = [];
    const executor = new QueueExecutor([modelStep(calls), modelStep()]);
    const runner = new AgentRunner({
      executor,
      journal: new MemoryRunnerJournal(),
      tools: [
        runnerTool('read', true, async (_input, id) => {
          order.push(`read:${id}`);
          return { id };
        }),
        runnerTool('write', false, async (_input, id) => {
          order.push(`write:${id}`);
          return { id };
        }),
      ],
    });
    expect((await runner.start('go')).status).toBe('completed');
    expect(order).toEqual(['read:1', 'write:2', 'read:3']);
  });

  it('纯读取批次并行启动，但按调用顺序记录结果', async () => {
    const resolvers: Array<() => void> = [];
    const started: string[] = [];
    const tools = ['a', 'b'].map(name =>
      runnerTool(name, true, async () => {
        started.push(name);
        await new Promise<void>(resolve => resolvers.push(resolve));
        return { name };
      }),
    );
    const executor = new QueueExecutor([
      modelStep([
        { input: {}, toolCallId: 'a', toolName: 'a' },
        { input: {}, toolCallId: 'b', toolName: 'b' },
      ]),
      modelStep(),
    ]);
    const journal = new MemoryRunnerJournal();
    const runner = new AgentRunner({ executor, journal, tools });
    const running = runner.start('parallel');
    await vi.waitFor(() => expect(started).toEqual(['a', 'b']));
    resolvers.reverse().forEach(resolve => resolve());
    await running;
    expect(journal.events.filter(event => event.type === 'tool-completed').map(event => event.call.toolName)).toEqual([
      'a',
      'b',
    ]);
  });

  it('工具失败作为结果返回给模型，由模型决定是否修正重试', async () => {
    let fail = true;
    const invoked: string[] = [];
    const calls = ['one', 'two', 'three'].map(name => ({ input: {}, toolCallId: name, toolName: name }));
    const executor = new QueueExecutor([modelStep(calls), modelStep(calls.slice(1)), modelStep()]);
    const journal = new MemoryRunnerJournal();
    const tools = calls.map(call =>
      runnerTool(call.toolName, false, async () => {
        invoked.push(call.toolName);
        if (call.toolName === 'two' && fail) {
          fail = false;
          throw new Error('temporary failure');
        }
        return { ok: true };
      }),
    );
    const runner = new AgentRunner({ executor, journal, tools });
    const state = await runner.start('retry');
    expect(state.status).toBe('completed');
    expect(state.failure).toBeUndefined();
    expect(invoked).toEqual(['one', 'two', 'two', 'three']);

    const firstResults = executor.requests[1].messages.filter(message => message.role === 'tool');
    expect(firstResults).toHaveLength(3);
    expect(JSON.stringify(firstResults[1])).toContain('temporary failure');
    expect(JSON.stringify(firstResults[2])).toContain('"skipped":true');
    expect(journal.events.filter(event => event.type === 'tool-failed')).toEqual([
      expect.objectContaining({ call: expect.objectContaining({ toolCallId: 'two' }) }),
      expect.objectContaining({ call: expect.objectContaining({ toolCallId: 'three' }) }),
    ]);
  });

  it('中途引导在工具结果后注入；已完成时作为下一条用户消息', async () => {
    const call = { input: {}, toolCallId: 'read', toolName: 'read' };
    const executor = new QueueExecutor([modelStep([call]), modelStep()]);
    const runner = new AgentRunner({
      executor,
      journal: new MemoryRunnerJournal(),
      tools: [runnerTool('read', true, async () => ({ ok: true }))],
    });
    runner.enqueueGuidance('补充一');
    runner.enqueueGuidance('补充二');
    await runner.start('goal');
    const secondRequest = executor.requests[1].messages;
    expect(secondRequest.at(-2)?.role).toBe('tool');
    expect(secondRequest.at(-1)).toMatchObject({ role: 'user' });
    expect(String(secondRequest.at(-1)?.content)).toContain('<mid_turn_guidance>');
    expect(String(secondRequest.at(-1)?.content)).toContain('补充一\n补充二');

    const directExecutor = new QueueExecutor([modelStep([], 'first'), modelStep([], 'second')]);
    const direct = new AgentRunner({ executor: directExecutor, journal: new MemoryRunnerJournal(), tools: [] });
    direct.enqueueGuidance('完成后的引导');
    expect((await direct.start('goal')).status).toBe('completed');
    expect(directExecutor.requests).toHaveLength(2);
  });

  it('主动停止丢弃失败模型流，并保留此前消息', async () => {
    const executor = new QueueExecutor([
      request =>
        new Promise<ModelStepResult>((_resolve, reject) => {
          request.abortSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    ]);
    const runner = new AgentRunner({ executor, journal: new MemoryRunnerJournal(), tools: [] });
    const running = runner.start('stop me');
    await vi.waitFor(() => expect(executor.requests).toHaveLength(1));
    runner.stop();
    const state = await running;
    expect(state.status).toBe('stopped');
    expect(state.messages).toEqual([{ content: 'stop me', role: 'user' }]);
  });

  it('高危工具等待批准；拒绝后把结果告诉模型但不执行工具', async () => {
    const execute = vi.fn(async () => ({ changed: true }));
    const executor = new QueueExecutor([
      modelStep([{ input: {}, toolCallId: 'danger', toolName: 'danger' }]),
      modelStep(),
    ]);
    const journal = new MemoryRunnerJournal();
    const runner = new AgentRunner({
      executor,
      journal,
      requestApproval: async () => false,
      tools: [
        runnerTool('danger', false, execute, (_input, toolCallId) => ({
          description: 'danger',
          toolCallId,
          toolName: 'danger',
        })),
      ],
    });
    await runner.start('danger');
    expect(execute).not.toHaveBeenCalled();
    expect(journal.events).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'waiting-approval' })]));
    expect(executor.requests[1].messages.at(-1)).toMatchObject({ role: 'tool' });
  });

  it('达到阈值时强制compact_context并保留摘要后继续', async () => {
    const compactCall = { input: { summary: '保留目标与完成项' }, toolCallId: 'compact', toolName: 'compact_context' };
    const executor = new QueueExecutor([modelStep([compactCall]), modelStep([], 'after compact')]);
    const runner = new AgentRunner({
      contextWindow: 500,
      executor,
      initialMessages: [
        { content: 'head', role: 'system' },
        { content: 'x'.repeat(2500), role: 'assistant' },
        { content: 'latest', role: 'assistant' },
      ],
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    const state = await runner.start('small user');
    expect(executor.requests[0].forceTool).toBe('compact_context');
    expect(executor.requests[1].forceTool).toBeUndefined();
    expect(
      state.messages.some(message => message.role === 'system' && String(message.content).includes('保留目标与完成项')),
    ).toBe(true);
    expect(state.messages.some(message => String(message.content).includes('x'.repeat(100)))).toBe(false);
    expect(state.status).toBe('completed');
  });

  it('用户消息超过80%时暂停；强制压缩未调用工具时失败', async () => {
    const exhaustedExecutor = new QueueExecutor([]);
    const exhausted = new AgentRunner({
      contextWindow: 100,
      executor: exhaustedExecutor,
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    expect((await exhausted.start('u'.repeat(500))).status).toBe('context-exhausted');
    expect(exhaustedExecutor.requests).toHaveLength(0);

    const missing = new AgentRunner({
      contextWindow: 100,
      executor: new QueueExecutor([modelStep([], 'refused')]),
      initialMessages: [{ content: 'a'.repeat(500), role: 'assistant' }],
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    const failed = await missing.start('small');
    expect(failed.status).toBe('failed');
    expect(failed.failure).toContain('没有按要求');
  });

  it('拒绝并发启动和没有中断点的恢复', async () => {
    const executor = new QueueExecutor([modelStep()]);
    const runner = new AgentRunner({ executor, journal: new MemoryRunnerJournal(), tools: [] });
    await expect(runner.resume()).rejects.toThrow('没有可恢复');
    await runner.start('one');
    await expect(runner.resume()).rejects.toThrow('没有可恢复');
  });

  it('覆盖空引导、并发启动、未知工具和批准执行分支', async () => {
    let release!: (value: ModelStepResult) => void;
    const waitingExecutor = new QueueExecutor([() => new Promise<ModelStepResult>(resolve => (release = resolve))]);
    const waiting = new AgentRunner({ executor: waitingExecutor, journal: new MemoryRunnerJournal(), tools: [] });
    waiting.enqueueGuidance('   ');
    const first = waiting.start('one');
    await vi.waitFor(() => expect(waitingExecutor.requests).toHaveLength(1));
    await expect(waiting.start('two')).rejects.toThrow('已经在运行');
    release(modelStep());
    await first;

    const unknownExecutor = new QueueExecutor([
      modelStep([{ input: {}, toolCallId: 'x', toolName: 'unknown' }]),
      modelStep([], '已根据错误改用其他方案'),
    ]);
    const unknown = new AgentRunner({
      executor: unknownExecutor,
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    expect((await unknown.start('unknown')).status).toBe('completed');
    expect(JSON.stringify(unknownExecutor.requests[1].messages.at(-1))).toContain('未知工具');

    const execute = vi.fn(async () => ({ changed: true }));
    const approved = new AgentRunner({
      executor: new QueueExecutor([modelStep([{ input: {}, toolCallId: 'ok', toolName: 'danger' }]), modelStep()]),
      journal: new MemoryRunnerJournal(),
      requestApproval: async () => true,
      tools: [
        runnerTool('danger', false, execute, (_input, toolCallId) => ({
          description: 'danger',
          toolCallId,
          toolName: 'danger',
        })),
      ],
    });
    expect((await approved.start('approve')).status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
  });
});
