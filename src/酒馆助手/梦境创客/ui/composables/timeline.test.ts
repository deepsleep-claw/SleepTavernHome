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
});
