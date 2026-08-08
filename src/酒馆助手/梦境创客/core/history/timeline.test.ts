import { describe, expect, it } from 'vitest';
import { HistoryTimeline } from './timeline';

describe('history timeline', () => {
  it('每条消息建立前后快照并连续Undo/Redo', () => {
    let now = 1_000;
    const timeline = new HistoryTimeline({ now: () => now });
    const first = timeline.beginTurn({ beforeAgentCursor: 0, beforeSnapshot: 's0', id: 'c1', userMessageId: 'u1' });
    timeline.completeTurn(first.id, { afterAgentCursor: 2, afterSnapshot: 's1' });
    now += 1;
    const second = timeline.beginTurn({ beforeAgentCursor: 2, beforeSnapshot: 's1', id: 'c2', userMessageId: 'u2' });
    timeline.completeTurn(second.id, { afterAgentCursor: 5, afterSnapshot: 's2', stopped: true });

    expect(timeline.undo()).toEqual({ agentCursor: 2, checkpointId: 'c2', snapshot: 's1', userMessageId: 'u2' });
    expect(timeline.undo()).toEqual({ agentCursor: 0, checkpointId: 'c1', snapshot: 's0', userMessageId: 'u1' });
    expect(timeline.undo()).toBeUndefined();
    expect(timeline.redo()).toEqual({ agentCursor: 2, checkpointId: 'c1', snapshot: 's1', userMessageId: 'u1' });
    expect(timeline.redo()).toEqual({ agentCursor: 5, checkpointId: 'c2', snapshot: 's2', userMessageId: 'u2' });
    expect(timeline.redo()).toBeUndefined();
  });

  it('可以从任意仍可见的用户消息直接回退', () => {
    const timeline = new HistoryTimeline({ now: () => 1 });
    const first = timeline.beginTurn({ beforeAgentCursor: 0, beforeSnapshot: 'before-1', userMessageId: 'u1' });
    timeline.completeTurn(first.id, { afterAgentCursor: 1, afterSnapshot: 'after-1' });
    const second = timeline.beginTurn({ beforeAgentCursor: 1, beforeSnapshot: 'before-2', userMessageId: 'u2' });
    timeline.completeTurn(second.id, { afterAgentCursor: 2, afterSnapshot: 'after-2' });
    expect(timeline.undoToUserMessage('u1')).toMatchObject({ snapshot: 'before-1', userMessageId: 'u1' });
    expect(timeline.redo()).toMatchObject({ snapshot: 'after-1' });
    expect(timeline.undoToUserMessage('missing')).toBeUndefined();
  });

  it('从旧点重发会废弃未来分支但保留7天', () => {
    let now = 10_000;
    const timeline = new HistoryTimeline({ now: () => now });
    const one = timeline.beginTurn({ beforeAgentCursor: 0, beforeSnapshot: 's0', id: 'c1', userMessageId: 'u1' });
    timeline.completeTurn(one.id, { afterAgentCursor: 1, afterSnapshot: 's1' });
    const two = timeline.beginTurn({ beforeAgentCursor: 1, beforeSnapshot: 's1', id: 'c2', userMessageId: 'u2' });
    timeline.completeTurn(two.id, { afterAgentCursor: 2, afterSnapshot: 's2' });
    timeline.undo();
    const branch = timeline.beginTurn({ beforeAgentCursor: 1, beforeSnapshot: 's1', id: 'c3', userMessageId: 'u2-edited' });
    timeline.completeTurn(branch.id, { afterAgentCursor: 3, afterSnapshot: 's3' });
    expect(timeline.export().checkpoints.find(item => item.id === 'c2')).toMatchObject({ active: false, abandonedAt: now });
    expect(timeline.redo()).toBeUndefined();
    now += 7 * 24 * 60 * 60 * 1000 - 1;
    expect(timeline.cleanupAbandoned()).toEqual([]);
    now += 2;
    expect(timeline.cleanupAbandoned()).toEqual(['c2']);
  });

  it('异常中断回到执行前状态，且不允许同时创建两个运行点', () => {
    const timeline = new HistoryTimeline();
    const running = timeline.beginTurn({ beforeAgentCursor: 4, beforeSnapshot: 'base', id: 'running', userMessageId: 'u' });
    expect(() => timeline.beginTurn({ beforeAgentCursor: 4, beforeSnapshot: 'base', userMessageId: 'u2' })).toThrow(
      '已有正在执行',
    );
    timeline.markAbnormal(running.id);
    expect(timeline.undo()).toMatchObject({ agentCursor: 4, snapshot: 'base' });
    expect(timeline.redo()).toMatchObject({ agentCursor: 4, snapshot: 'base' });
  });

  it('固定检查点不受数量和废弃清理影响', () => {
    let now = 1_000;
    const timeline = new HistoryTimeline({ maxCheckpoints: 2, now: () => now });
    for (let index = 0; index < 3; index += 1) {
      const item = timeline.beginTurn({
        beforeAgentCursor: index,
        beforeSnapshot: `s${index}`,
        id: `c${index}`,
        userMessageId: `u${index}`,
      });
      timeline.completeTurn(item.id, { afterAgentCursor: index + 1, afterSnapshot: `s${index + 1}` });
      if (index === 0) timeline.pin(item.id);
    }
    expect(timeline.export().checkpoints.filter(item => item.active).map(item => item.id)).toEqual(['c0', 'c2']);
    expect(timeline.referencedSnapshots()).toEqual(['s0', 's1', 's2', 's3']);
    timeline.pin('c0', false);
    now += 8 * 24 * 60 * 60 * 1000;
    expect(timeline.cleanupAbandoned()).toContain('c1');
  });

  it('拒绝完成未知或非运行中的检查点', () => {
    const timeline = new HistoryTimeline();
    expect(() => timeline.completeTurn('missing', { afterAgentCursor: 1, afterSnapshot: 's' })).toThrow('不存在');
    const item = timeline.beginTurn({ beforeAgentCursor: 0, beforeSnapshot: 's0', id: 'known', userMessageId: 'u' });
    timeline.completeTurn(item.id, { afterAgentCursor: 1, afterSnapshot: 's1' });
    expect(() => timeline.completeTurn(item.id, { afterAgentCursor: 2, afterSnapshot: 's2' })).toThrow('不在运行中');
  });
});
