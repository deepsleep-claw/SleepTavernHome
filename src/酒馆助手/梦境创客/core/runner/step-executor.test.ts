import { tool } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { AiSdkModelStepExecutor, requestProviderOptions } from './step-executor';
import type { RunnerTool } from './tools';

const usage = {
  inputTokens: { cacheRead: 2, cacheWrite: 1, noCache: 3, total: 6 },
  outputTokens: { reasoning: 0, text: 2, total: 2 },
};

function runnerTool(name: string): RunnerTool {
  return {
    definition: tool({ description: name, inputSchema: z.object({ value: z.string() }) }),
    execute: async () => ({}),
    name,
    readonly: true,
  };
}

describe('AiSdkModelStepExecutor', () => {
  it('用streamText只执行一个模型步骤，保留流式文本、工具调用、用量与稳定工具顺序', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { id: 'reasoning', type: 'reasoning-start' },
            { delta: '先读取文件', id: 'reasoning', type: 'reasoning-delta' },
            { id: 'reasoning', type: 'reasoning-end' },
            { id: 'text', type: 'text-start' },
            { delta: 'hello', id: 'text', type: 'text-delta' },
            { id: 'text', type: 'text-end' },
            { input: '{"value":"x"}', toolCallId: 'call-1', toolName: 'read_file', type: 'tool-call' },
            { finishReason: { raw: 'tool_calls', unified: 'tool-calls' }, type: 'finish', usage },
          ],
        }),
      },
    });
    const delta = vi.fn();
    const reasoningDelta = vi.fn();
    const toolInputReady = vi.fn();
    const toolInputStarted = vi.fn();
    const executor = new AiSdkModelStepExecutor(async () => model);
    const result = await executor.execute({
      abortSignal: new AbortController().signal,
      forceTool: 'read_file',
      messages: [{ content: 'go', role: 'user' }],
      modelSettings: {
        maxOutputTokens: 4096,
        reasoningEffort: 'high',
        temperature: 0.7,
        topP: 0.9,
        webSearch: false,
      },
      onReasoningDelta: reasoningDelta,
      onTextDelta: delta,
      onToolInputReady: toolInputReady,
      onToolInputStarted: toolInputStarted,
      tools: [runnerTool('read_file'), runnerTool('search_files')],
    });
    expect(result).toMatchObject({
      finishReason: 'tool-calls',
      inputTokens: 6,
      outputTokens: 2,
      text: 'hello',
      toolCalls: [{ input: { value: 'x' }, toolCallId: 'call-1', toolName: 'read_file' }],
    });
    expect(delta).toHaveBeenCalledWith('hello');
    expect(reasoningDelta).toHaveBeenCalledWith('先读取文件');
    expect(toolInputStarted).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'call-1', toolName: 'read_file' }),
    );
    expect(toolInputReady).toHaveBeenCalledWith(
      expect.objectContaining({ input: { value: 'x' }, toolCallId: 'call-1', toolName: 'read_file' }),
    );
    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0]).toMatchObject({
      maxOutputTokens: 4096,
      temperature: 0.7,
      toolChoice: { toolName: 'read_file', type: 'tool' },
      topP: 0.9,
    });
    expect(model.doStreamCalls[0].tools?.map(item => item.name)).toEqual(['read_file', 'search_files']);
  });

  it('把Schema校验失败的工具调用单独标记，且不再交给本地执行队列', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { input: '{"value":8}', toolCallId: 'invalid-1', toolName: 'read_file', type: 'tool-call' },
            { finishReason: { raw: 'tool_calls', unified: 'tool-calls' }, type: 'finish', usage },
          ],
        }),
      },
    });
    const result = await new AiSdkModelStepExecutor(async () => model).execute({
      abortSignal: new AbortController().signal,
      messages: [{ content: 'go', role: 'user' }],
      tools: [runnerTool('read_file')],
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.invalidToolCalls).toEqual([
      expect.objectContaining({ input: { value: 8 }, toolCallId: 'invalid-1', toolName: 'read_file' }),
    ]);
    expect(result.invalidToolCalls?.[0].error).toContain('Invalid input for tool read_file');
    expect(result.assistantMessages.some(message => message.role === 'tool')).toBe(true);
  });

  it('在模型仍生成参数时转发工具ID和输入增量', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { id: 'stream-1', toolName: 'read_file', type: 'tool-input-start' },
            { delta: '{"value":"', id: 'stream-1', type: 'tool-input-delta' },
            { delta: 'hello"}', id: 'stream-1', type: 'tool-input-delta' },
            { id: 'stream-1', type: 'tool-input-end' },
            { input: '{"value":"hello"}', toolCallId: 'stream-1', toolName: 'read_file', type: 'tool-call' },
            { finishReason: { raw: 'tool_calls', unified: 'tool-calls' }, type: 'finish', usage },
          ],
        }),
      },
    });
    const started = vi.fn();
    const delta = vi.fn();
    const ready = vi.fn();
    const result = await new AiSdkModelStepExecutor(async () => model).execute({
      abortSignal: new AbortController().signal,
      messages: [{ content: 'go', role: 'user' }],
      onToolInputDelta: delta,
      onToolInputReady: ready,
      onToolInputStarted: started,
      tools: [runnerTool('read_file')],
    });

    expect(started).toHaveBeenCalledOnce();
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'stream-1', toolName: 'read_file' }));
    expect(delta.mock.calls.map(call => call[0])).toEqual([
      { delta: '{"value":"', toolCallId: 'stream-1' },
      { delta: 'hello"}', toolCallId: 'stream-1' },
    ]);
    expect(ready).toHaveBeenCalledWith(
      expect.objectContaining({ input: { value: 'hello' }, toolCallId: 'stream-1', toolName: 'read_file' }),
    );
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ input: { value: 'hello' }, toolCallId: 'stream-1', toolName: 'read_file' }),
    ]);
  });

  it('按六种适配组合映射推理参数，自动档不额外指定强度', () => {
    expect(requestProviderOptions({ interfaceType: 'openai-responses', reasoningEffort: 'xhigh', webSearch: true }))
      .toMatchObject({ openai: { maxToolCalls: 10, reasoningEffort: 'xhigh' } });
    expect(requestProviderOptions({ interfaceType: 'openai-chat', reasoningEffort: 'off', webSearch: false }))
      .toEqual({ dreamCardAgentChat: { reasoningEffort: 'none' } });
    expect(requestProviderOptions({ interfaceType: 'anthropic', reasoningEffort: 'auto', webSearch: false }))
      .toMatchObject({ anthropic: { effort: undefined, thinking: undefined } });
    expect(requestProviderOptions({ interfaceType: 'anthropic', reasoningEffort: 'high', webSearch: true }))
      .toMatchObject({ anthropic: { effort: 'high', thinking: { type: 'adaptive' } } });

    expect(requestProviderOptions({
      compatibilityMode: 'deepseek',
      interfaceType: 'openai-chat',
      reasoningEffort: 'custom-id',
      webSearch: false,
    })).toEqual({ dreamCardAgentChat: { reasoningEffort: 'custom-id', thinking: { type: 'enabled' } } });
    expect(requestProviderOptions({
      compatibilityMode: 'deepseek',
      interfaceType: 'openai-responses',
      reasoningEffort: 'off',
      webSearch: true,
    })).toEqual({
      openai: {
        forceReasoning: false,
        include: ['web_search_call.results'],
        metadata: { dream_card_agent_reasoning_effort: 'none' },
        reasoningEffort: undefined,
        store: false,
      },
    });
    expect(requestProviderOptions({
      compatibilityMode: 'deepseek',
      interfaceType: 'anthropic',
      reasoningEffort: 'high',
      webSearch: true,
    })).toMatchObject({ anthropic: { effort: 'high', thinking: { type: 'enabled' } } });
  });

  it('把HTTP成功但没有文本、消息或工具调用的结果视为协议错误', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [{ finishReason: { raw: 'other', unified: 'other' }, type: 'finish', usage }],
        }),
      },
    });
    const executor = new AiSdkModelStepExecutor(async () => model);
    await expect(
      executor.execute({
        abortSignal: new AbortController().signal,
        messages: [{ content: 'probe', role: 'user' }],
        tools: [runnerTool('read_file')],
      }),
    ).rejects.toThrow(/空响应.*Base URL/u);
  });

  it('保留流式接口返回的真实错误，而不是只抛出无输出占位错误', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [{ error: new Error('provider rejected request'), type: 'error' }],
        }),
      },
    });
    const executor = new AiSdkModelStepExecutor(async () => model);
    await expect(
      executor.execute({
        abortSignal: new AbortController().signal,
        messages: [{ content: 'probe', role: 'user' }],
        tools: [runnerTool('read_file')],
      }),
    ).rejects.toThrow('provider rejected request');
  });
});
