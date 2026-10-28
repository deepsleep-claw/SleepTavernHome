import { tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { AgentRunner, MemoryRunnerJournal } from './agent-runner';
import { measureContext, normalizeTokenUsage, outputTokenBudget, estimateTokens } from './context';
import { isContextExceeded } from './context-errors';
import type { ModelStepRequest, ModelStepResult } from './step-executor';

function history(): ModelMessage[] {
  return [
    { role: 'system', content: '系统约束' },
    { role: 'user', content: '旧目标一'.repeat(200) },
    { role: 'assistant', content: '旧步骤一'.repeat(500) },
    { role: 'user', content: '旧目标二'.repeat(200) },
    { role: 'assistant', content: '旧步骤二'.repeat(500) },
    { role: 'user', content: '最新要求' },
  ];
}

function result(text = '保留目标与关键进展', finishReason = 'stop'): ModelStepResult {
  return { text, finishReason, assistantMessages: [{ role: 'assistant', content: text }], toolCalls: [] };
}

describe('上下文恢复', () => {
  it.each(['exception', 'finish-reason'])('普通请求 %s 超限后压缩并重试同一步', async source => {
    const execute = vi.fn(async (request: ModelStepRequest) => {
      if (execute.mock.calls.length === 1) {
        if (source === 'exception') throw new Error('maximum context length exceeded');
        return { ...result('', 'other'), rawFinishReason: 'model_context_window_exceeded' };
      }
      return result(request.purpose === 'summary' ? '旧目标已整理' : '继续完成');
    });
    const journal = new MemoryRunnerJournal();
    const runner = new AgentRunner({
      contextWindow: 20_000,
      executor: { execute },
      initialMessages: history(),
      headerMessageCount: 1,
      journal,
      tools: [],
    });
    const state = await runner.start('继续');
    expect(state.status).toBe('completed');
    expect(execute.mock.calls.map(([request]) => request.purpose)).toEqual([undefined, 'summary', undefined]);
    expect(JSON.stringify(execute.mock.calls[2][0].messages)).toContain('旧目标已整理');
    expect(state.messages).toContainEqual({ role: 'user', content: '继续' });
    expect(journal.events.find(event => event.type === 'context-compaction-started')).toMatchObject({
      trigger: 'overflow',
    });
  });

  it('同一步恢复后仍超限会停止，不反复压缩', async () => {
    const execute = vi.fn(async (request: ModelStepRequest) => {
      if (request.purpose === 'summary') return result();
      throw new Error('context_length_exceeded');
    });
    const runner = new AgentRunner({
      contextWindow: 20_000,
      executor: { execute },
      initialMessages: history(),
      headerMessageCount: 1,
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    expect((await runner.start('继续')).status).toBe('context-exhausted');
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('鉴权失败不触发摘要请求', async () => {
    const execute = vi.fn(async (_request: ModelStepRequest) => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    });
    const runner = new AgentRunner({
      executor: { execute },
      initialMessages: history(),
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    expect((await runner.start('继续')).status).toBe('failed');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('历史用户消息超过八成时仍可压缩，最新要求完整保留', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'a'.repeat(24_000) },
      { role: 'assistant', content: '已完成' },
      { role: 'user', content: '继续完成剩下的任务' },
    ];
    const execute = vi.fn(async (_request: ModelStepRequest) => result());
    const runner = new AgentRunner({
      contextWindow: 10_000,
      executor: { execute },
      initialMessages: messages,
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    const state = await runner.compact();
    expect(state.status).toBe('completed');
    expect(state.messages).toContainEqual(messages[2]);
    expect(JSON.stringify(state.messages)).not.toContain('a'.repeat(100));
  });

  it('摘要超限后移出完整轮次，移出的内容仍原样保留', async () => {
    const execute = vi.fn(async (_request: ModelStepRequest) => {
      if (execute.mock.calls.length === 1) throw new Error('prompt is too long');
      return result();
    });
    const original = history();
    const runner = new AgentRunner({
      contextWindow: 20_000,
      executor: { execute },
      initialMessages: original,
      headerMessageCount: 1,
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    const state = await runner.compact();
    expect(state.status).toBe('completed');
    expect(JSON.stringify(execute.mock.calls[1][0].messages).length).toBeLessThan(
      JSON.stringify(execute.mock.calls[0][0].messages).length,
    );
    expect(state.messages).toContainEqual(original[3]);
    expect(state.messages).toContainEqual(original[4]);
    expect(state.messages).toContainEqual(original[5]);
  });

  it('截断摘要重试，完整摘要才替换原上下文', async () => {
    const journal = new MemoryRunnerJournal();
    const execute = vi.fn(async (_request: ModelStepRequest) =>
      execute.mock.calls.length === 1 ? result('未完成的摘要', 'length') : result('完整摘要'),
    );
    const runner = new AgentRunner({
      executor: { execute },
      initialMessages: history(),
      headerMessageCount: 1,
      journal,
      tools: [],
    });
    const state = await runner.compact();
    expect(state.status).toBe('completed');
    expect(JSON.stringify(state.messages)).not.toContain('未完成的摘要');
    expect(execute.mock.calls[1][0].modelSettings?.maxOutputTokens).toBeGreaterThan(
      execute.mock.calls[0][0].modelSettings!.maxOutputTokens!,
    );
    expect(journal.events.filter(event => event.type === 'context-compaction-retrying')).toHaveLength(1);
  });

  it.each(['empty', 'length', 'larger'])('无效摘要 %s 最多尝试三次并保留历史', async mode => {
    const original = history();
    const execute = vi.fn(async (_request: ModelStepRequest) =>
      mode === 'empty' ? result('') : mode === 'length' ? result('不完整', 'length') : result('x'.repeat(30_000)),
    );
    const runner = new AgentRunner({
      executor: { execute },
      initialMessages: original,
      headerMessageCount: 1,
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    const state = await runner.compact();
    expect(state.status).toBe('failed');
    expect(state.messages).toEqual(original);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(state.failure).toContain('原上下文已保留');
  });

  it('停止摘要时不再重试且保留原上下文', async () => {
    const original = history();
    const execute = vi.fn(async (_request: ModelStepRequest) => {
      runner.stop();
      return result('', 'length');
    });
    const runner = new AgentRunner({
      executor: { execute },
      initialMessages: original,
      journal: new MemoryRunnerJournal(),
      tools: [],
    });
    expect((await runner.compact()).status).toBe('stopped');
    expect(runner.state.messages).toEqual(original);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('压缩前后比较采用相同估算口径，不把 API 校准值当压缩收益', async () => {
    const messages = history();
    const estimated = measureContext(messages, 20_000).totalTokens;
    const journal = new MemoryRunnerJournal();
    const runner = new AgentRunner({
      contextWindow: 20_000,
      executor: { execute: async () => result() },
      initialMessages: messages,
      headerMessageCount: 1,
      initialApiUsageBaseline: { version: 3, estimatedTokens: estimated, inputTokens: 18_000, outputTokens: 100 },
      journal,
      tools: [],
    });
    await runner.compact();
    const event = journal.events.find(event => event.type === 'context-compacted');
    expect(event?.beforeTokens).toBeLessThan(18_000);
    expect(event?.afterTokens).toBeLessThan(event!.beforeTokens!);
  });

  it('普通请求纳入工具定义并按剩余窗口限制输出', async () => {
    const execute = vi.fn(async (_request: ModelStepRequest) => ({
      ...result('回答'),
      inputTokens: 2000,
      outputTokens: 9000,
      reasoningTokens: 8998,
      cacheReadTokens: 1500,
    }));
    const runner = new AgentRunner({
      contextWindow: 10_000,
      executor: { execute, maxOutputTokens: 32_000 },
      journal: new MemoryRunnerJournal(),
      tools: [
        {
          name: 'read',
          readonly: true,
          definition: tool({ description: '读文件'.repeat(200), inputSchema: z.object({ path: z.string() }) }),
          execute: async () => ({}),
        },
      ],
    });
    const state = await runner.start('读取');
    expect(state.contextUsage.toolSchemaTokens).toBeGreaterThan(400);
    expect(execute.mock.calls[0][0].modelSettings!.maxOutputTokens).toBeLessThan(9500);
    expect(state.contextUsage.totalTokens).toBeLessThan(2100);
    expect(state.contextUsage).toMatchObject({ apiReasoningTokens: 8998, apiCacheReadTokens: 1500 });
  });
});

describe('Token 统计口径', () => {
  it('中文具有独立权重，元数据密文不按字符长度计入', () => {
    expect(estimateTokens('中'.repeat(300))).toBe(200);
    expect(estimateTokens('a'.repeat(300))).toBe(100);
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: '思考',
            providerOptions: { openai: { reasoningEncryptedContent: 'A'.repeat(500_000) } },
          },
        ],
      },
    ];
    expect(measureContext(messages, 128_000).totalTokens).toBeLessThan(100);
  });

  it('缺失输出仍可使用输入校准，缓存不再次叠加', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }];
    const estimated = measureContext(messages, 1000, undefined, 80).totalTokens;
    const usage = measureContext(
      messages,
      1000,
      { version: 3, inputTokens: 300, estimatedTokens: estimated, cacheReadTokens: 200, cacheWriteTokens: 50 },
      80,
    );
    expect(usage.totalTokens).toBe(300);
    expect(usage.apiOutputTokens).toBeUndefined();
  });

  it('无效回执与旧估算版本不污染当前占用', () => {
    expect(normalizeTokenUsage({ inputTokens: NaN, outputTokens: -1, totalTokens: Infinity })).toEqual({});
    expect(normalizeTokenUsage({ totalTokens: 100, outputTokens: 20 })).toMatchObject({ inputTokens: 80 });
    expect(normalizeTokenUsage({ totalTokens: 10, outputTokens: 20 }).inputTokens).toBeUndefined();
    expect(
      measureContext([{ role: 'user', content: 'hello' }], 1000, {
        estimatedTokens: 8,
        inputTokens: 200,
        outputTokens: 50,
      }).measurement,
    ).toBe('estimated');
    expect(outputTokenBudget(10_000, 9501, 4096)).toBe(0);
  });

  it('识别包裹的上下文错误，排除余额和单独输出上限错误', () => {
    expect(isContextExceeded({ cause: { code: 'context_length_exceeded' } })).toBe(true);
    expect(isContextExceeded({ responseBody: '{"error":{"code":"prompt_too_long"}}' })).toBe(true);
    expect(isContextExceeded(new Error('insufficient balance'))).toBe(false);
    expect(isContextExceeded(new Error('max_tokens must be less than 8192'))).toBe(false);
  });
});
