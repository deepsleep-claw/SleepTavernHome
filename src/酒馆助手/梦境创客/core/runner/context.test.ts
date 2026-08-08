import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { compactModelMessages, decideContext, estimateTokens, measureContext } from './context';

describe('runner context', () => {
  it('按角色估算组成、阈值与剩余空间', () => {
    const messages: ModelMessage[] = [
      { content: 'system', role: 'system' },
      { content: 'user', role: 'user' },
      { content: 'assistant', role: 'assistant' },
      {
        content: [{ output: { type: 'json', value: { ok: true } }, toolCallId: '1', toolName: 'read_file', type: 'tool-result' }],
        role: 'tool',
      },
    ];
    const usage = measureContext(messages, 1000);
    expect(usage.totalTokens).toBe(usage.systemTokens + usage.userTokens + usage.assistantTokens + usage.toolTokens);
    expect(usage.thresholdTokens).toBe(700);
    expect(usage.remainingTokens).toBe(1000 - usage.totalTokens);
    expect(estimateTokens('x')).toBeGreaterThan(0);
  });

  it('优先识别用户消息耗尽，否则在70%或输出空间不足时压缩', () => {
    expect(
      decideContext({
        assistantTokens: 0,
        contextWindow: 100,
        ratio: 0.81,
        remainingTokens: 19,
        systemTokens: 0,
        thresholdTokens: 70,
        toolTokens: 0,
        totalTokens: 81,
        userTokens: 81,
      }),
    ).toBe('users-exhausted');
    expect(
      decideContext({
        assistantTokens: 71,
        contextWindow: 100,
        ratio: 0.71,
        remainingTokens: 29,
        systemTokens: 0,
        thresholdTokens: 70,
        toolTokens: 0,
        totalTokens: 71,
        userTokens: 0,
      }, 10),
    ).toBe('compact');
    expect(
      decideContext({
        assistantTokens: 1,
        contextWindow: 100,
        ratio: 0.01,
        remainingTokens: 99,
        systemTokens: 0,
        thresholdTokens: 70,
        toolTokens: 0,
        totalTokens: 1,
        userTokens: 0,
      }, 10),
    ).toBe('continue');
  });

  it('压缩后保留静态头、全部用户消息、摘要和最新完整助手链', () => {
    const messages: ModelMessage[] = [
      { content: 'head', role: 'system' },
      { content: 'old user', role: 'user' },
      { content: 'old assistant', role: 'assistant' },
      { content: 'new user', role: 'user' },
      { content: 'latest assistant', role: 'assistant' },
      {
        content: [{ input: { summary: 'summary' }, toolCallId: 'c', toolName: 'compact_context', type: 'tool-call' }],
        role: 'assistant',
      },
      {
        content: [{ output: { type: 'json', value: { compacted: true } }, toolCallId: 'c', toolName: 'compact_context', type: 'tool-result' }],
        role: 'tool',
      },
    ];
    const compacted = compactModelMessages(messages, 'summary');
    expect(compacted).toEqual([
      { content: 'head', role: 'system' },
      { content: '【上下文压缩摘要】\nsummary', role: 'system' },
      { content: 'old user', role: 'user' },
      { content: 'new user', role: 'user' },
      { content: 'latest assistant', role: 'assistant' },
    ]);
    expect(compactModelMessages(compacted, 'new summary').filter(message => message.role === 'system')).toHaveLength(2);
    expect(compactModelMessages([{ content: 'only user', role: 'user' }], 'summary')).toEqual([
      { content: '【上下文压缩摘要】\nsummary', role: 'system' },
      { content: 'only user', role: 'user' },
    ]);
  });
});
