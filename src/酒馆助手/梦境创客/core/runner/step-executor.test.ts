import { tool } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { AiSdkModelStepExecutor } from './step-executor';
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
    const executor = new AiSdkModelStepExecutor(async () => model);
    const result = await executor.execute({
      abortSignal: new AbortController().signal,
      forceTool: 'read_file',
      messages: [{ content: 'go', role: 'user' }],
      onTextDelta: delta,
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
    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0]).toMatchObject({
      toolChoice: { toolName: 'read_file', type: 'tool' },
    });
    expect(model.doStreamCalls[0].tools?.map(item => item.name)).toEqual(['read_file', 'search_files']);
  });
});
