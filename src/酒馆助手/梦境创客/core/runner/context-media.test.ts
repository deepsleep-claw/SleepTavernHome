import type { FilePart, ModelMessage, ToolResultPart } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { dreamCreatorFileReference, resolveModelMessageFiles } from '../session/attachments';
import { AgentRunner, MemoryRunnerJournal } from './agent-runner';
import { decideContext, measureContext } from './context';
import type { ModelStepRequest } from './step-executor';

const imageData = 'A'.repeat(4_200_000);
const image: FilePart = { type: 'file', mediaType: 'image/png', data: { type: 'data', data: imageData } };
type ToolOutput = ToolResultPart['output'];
type OutputPart = Extract<ToolOutput, { type: 'content' }>['value'][number];

function toolResult(output: ToolOutput): ModelMessage {
  return {
    role: 'tool',
    content: [{ type: 'tool-result', toolName: 'read_file', toolCallId: 'read-image', output }],
  };
}

describe('多模态上下文估算', () => {
  it('工具图片与用户图片使用同一口径，编码长度不会触发强制压缩', () => {
    const history: ModelMessage[] = [{ role: 'system', content: '文'.repeat(30_000) }];
    const usage = measureContext(
      [...history, toolResult({ type: 'content', value: [image as OutputPart] })],
      1_048_576,
    );
    expect(usage.totalTokens).toBeGreaterThan(20_000);
    expect(usage.totalTokens).toBeLessThan(25_000);
    expect(decideContext(usage, 32_000)).toBe('continue');
    const userUsage = measureContext([...history, { role: 'user', content: [image] }], 1_048_576);
    expect(Math.abs(usage.totalTokens - userUsage.totalTokens)).toBeLessThan(30);
  });

  it.each<OutputPart>([
    { type: 'image-data', mediaType: 'image/png', data: imageData },
    { type: 'image-url', url: `data:image/png;base64,${imageData}` },
    { type: 'file-data', mediaType: 'image/png', data: imageData },
    { type: 'file-url', mediaType: 'image/png', url: `data:image/png;base64,${imageData}` },
    { type: 'file', mediaType: 'image', data: { type: 'data', data: imageData } },
    { type: 'file', mediaType: 'image/png', data: dreamCreatorFileReference('image') },
  ])('工具媒体 $type 保留图片预算，忽略传输编码和私有元数据', part => {
    const output: ToolOutput = {
      type: 'content',
      value: [{ ...part, providerOptions: { google: { thoughtSignature: imageData } } }],
    };
    const usage = measureContext([toolResult(output)], 128_000);
    expect(usage.toolTokens).toBeGreaterThan(1000);
    expect(usage.toolTokens).toBeLessThan(2000);
  });

  it('二进制文档按媒体预算估算，普通 JSON 和文本正文仍完整计入', () => {
    const pdf: OutputPart = { type: 'file', mediaType: 'application/pdf', data: { type: 'data', data: imageData } };
    expect(measureContext([toolResult({ type: 'content', value: [pdf] })], 128_000).toolTokens).toBeLessThan(10_000);
    for (const output of [
      { type: 'json', value: { data: imageData, mediaType: 'image/png' } },
      { type: 'error-json', value: { detail: imageData } },
      { type: 'text', value: imageData },
      { type: 'content', value: [{ type: 'file', mediaType: 'text/plain', data: { type: 'text', text: imageData } }] },
    ] as ToolOutput[]) {
      expect(measureContext([toolResult(output)], 2_000_000).toolTokens).toBeGreaterThan(1_000_000);
    }
  });

  it('旧估算锚点不参与新口径校准，新请求继续使用 API 输入用量', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: '继续' },
      toolResult({ type: 'content', value: [image as OutputPart] }),
    ];
    const old = measureContext(messages, 1_048_576, { version: 2, inputTokens: 20_000, estimatedTokens: 1_400_000 });
    expect(old.measurement).toBe('estimated');
    expect(old.totalTokens).toBeGreaterThan(1000);
    expect(old.totalTokens).toBeLessThan(2000);
    const current = measureContext(messages, 1_048_576, {
      version: 3,
      inputTokens: 20_000,
      estimatedTokens: old.estimatedTokens!,
    });
    expect(current.totalTokens).toBe(20_000);
    expect(current.measurement).toBe('api');
  });

  it('摘要准备附件后仍能发出请求，不把解引用后的图片当成百万 Token', async () => {
    const execute = vi.fn(async (_request: ModelStepRequest) => ({
      text: '旧图片已经检查，继续完成任务。',
      finishReason: 'stop',
      toolCalls: [],
      assistantMessages: [{ role: 'assistant' as const, content: '旧图片已经检查，继续完成任务。' }],
    }));
    const messages: ModelMessage[] = [
      { role: 'user', content: '检查旧图片' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'read-image', toolName: 'read_file', input: { path: '/files/image.png' } },
        ],
      },
      toolResult({
        type: 'content',
        value: [{ type: 'file', mediaType: 'image/png', data: dreamCreatorFileReference('image') }],
      }),
      { role: 'assistant', content: '检查结果'.repeat(1000) },
      { role: 'user', content: '继续完成最新任务' },
    ];
    const runner = new AgentRunner({
      contextWindow: 128_000,
      executor: { execute },
      initialMessages: messages,
      journal: new MemoryRunnerJournal(),
      tools: [],
      prepareMessages: input =>
        resolveModelMessageFiles(input, async () => ({ data: imageData, mediaType: 'image/png' })),
    });
    const state = await runner.compact();
    expect(state.status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ purpose: 'summary', modelSettings: { maxOutputTokens: 8192 } });
    expect(state.messages).toContainEqual(messages.at(-1));
    expect(state.messages.some(message => message.role === 'tool')).toBe(false);
    expect(JSON.stringify(execute.mock.calls[0][0].messages)).toContain(imageData);
  });

  it('恢复因旧图片估算超限的会话后直接继续，不重复触发压缩', async () => {
    const execute = vi.fn(async (_request: ModelStepRequest) => ({
      text: '已恢复',
      finishReason: 'stop',
      toolCalls: [],
      inputTokens: 20_000,
      assistantMessages: [{ role: 'assistant' as const, content: '已恢复' }],
    }));
    const journal = new MemoryRunnerJournal();
    const runner = new AgentRunner({
      contextWindow: 1_048_576,
      executor: { execute },
      journal,
      tools: [],
      initialStatus: 'context-exhausted',
      initialApiUsageBaseline: { version: 2, estimatedTokens: 20_000, inputTokens: 20_000 },
      initialMessages: [
        { role: 'user', content: '检查图片' },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'read-image', toolName: 'read_file', input: {} }],
        },
        toolResult({ type: 'content', value: [image as OutputPart] }),
      ],
    });
    expect((await runner.resume()).status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].purpose).toBeUndefined();
    expect(journal.events.some(event => event.type === 'context-compaction-started')).toBe(false);
    expect(runner.usageBaseline()?.version).toBe(3);
  });
});
