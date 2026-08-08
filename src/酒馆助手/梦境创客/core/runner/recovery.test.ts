import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import type { RunnerEvent } from './agent-runner';
import { recoverPendingRunnerStep } from './recovery';

const messages: ModelMessage[] = [
  { content: '请求', role: 'user' },
  {
    content: [
      { input: { path: '/a' }, toolCallId: 'a', toolName: 'read_file', type: 'tool-call' },
      { input: { path: '/b' }, toolCallId: 'b', toolName: 'write_file', type: 'tool-call' },
    ],
    role: 'assistant',
  },
];

describe('runner recovery', () => {
  it('从最后一个成功工具之后恢复，保留原工具调用ID', () => {
    const events: RunnerEvent[] = [
      {
        at: 1,
        call: { input: { path: '/a' }, toolCallId: 'a', toolName: 'read_file' },
        output: { ok: true },
        type: 'tool-completed',
      },
      {
        at: 2,
        call: { input: { path: '/b' }, toolCallId: 'b', toolName: 'write_file' },
        error: 'closed',
        type: 'tool-failed',
      },
    ];
    expect(recoverPendingRunnerStep(messages, events)).toEqual({ calls: expect.any(Array), compacting: false, nextCall: 1 });
  });

  it('完整工具链或无工具消息不产生待恢复步骤', () => {
    const events: RunnerEvent[] = ['a', 'b'].map(toolCallId => ({
      at: 1,
      call: { input: {}, toolCallId, toolName: 'tool' },
      output: {},
      type: 'tool-completed' as const,
    }));
    expect(recoverPendingRunnerStep(messages, events)).toBeUndefined();
    expect(recoverPendingRunnerStep([{ content: 'done', role: 'assistant' }], [])).toBeUndefined();
  });

  it('识别被中断的上下文压缩工具链', () => {
    const compact: ModelMessage[] = [
      {
        content: [{ input: { summary: '摘要' }, toolCallId: 'c', toolName: 'compact_context', type: 'tool-call' }],
        role: 'assistant',
      },
    ];
    expect(recoverPendingRunnerStep(compact, [])).toMatchObject({ compacting: true, nextCall: 0 });
  });
});
