import { describe, expect, it } from 'vitest';
import type { SessionUiItem } from '../../core/session/types';
import { buildTimelineBlocks } from './timeline';

describe('timeline', () => {
  it('使用调用方提供的当前时间持续计算运行耗时', () => {
    const ui: SessionUiItem[] = [
      {
        at: 1_000,
        checkpointId: 'checkpoint:1',
        content: '开始任务',
        id: 'user:1',
        kind: 'user',
      },
      {
        at: 1_100,
        checkpointId: 'checkpoint:1',
        content: '正在思考',
        id: 'reasoning:1',
        kind: 'reasoning',
        status: 'running',
      },
    ];

    const first = buildTimelineBlocks(ui, 'running', 200, 4_500).find(block => block.type === 'run');
    const second = buildTimelineBlocks(ui, 'running', 200, 6_500).find(block => block.type === 'run');

    expect(first?.durationMs).toBe(3_500);
    expect(second?.durationMs).toBe(5_500);
  });

  it('已完成的旧历史缺少整轮耗时时使用末条记录估算且不随当前时间增长', () => {
    const ui: SessionUiItem[] = [
      {
        at: 1_000,
        checkpointId: 'checkpoint:legacy',
        content: '旧任务',
        id: 'user:legacy',
        kind: 'user',
      },
      {
        at: 2_500,
        checkpointId: 'checkpoint:legacy',
        content: '旧思考',
        durationMs: 500,
        id: 'reasoning:legacy',
        kind: 'reasoning',
        status: 'completed',
      },
      {
        at: 3_200,
        checkpointId: 'checkpoint:legacy',
        content: '最终回复',
        id: 'assistant:legacy',
        kind: 'assistant',
        status: 'completed',
      },
    ];

    const first = buildTimelineBlocks(ui, 'completed', 200, 100_000).find(block => block.type === 'run');
    const second = buildTimelineBlocks(ui, 'completed', 200, 200_000).find(block => block.type === 'run');

    expect(first?.durationMs).toBe(2_200);
    expect(second?.durationMs).toBe(2_200);
  });
});
