import { describe, expect, it } from 'vitest';
import type { SessionUiItem } from '../../core/session/types';
import {
  buildTimelineBlocks,
  defaultRunCollapsed,
  itemKindLabel,
  toolGroupLabel,
  toolStatusLabel,
} from './timeline';

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

  it('中途引导作为用户消息留在原位置，并把前后过程切成两个运行块', () => {
    const ui: SessionUiItem[] = [
      { at: 1_000, checkpointId: 'checkpoint:guide', content: '开始', id: 'user:guide', kind: 'user' },
      {
        at: 1_400,
        checkpointId: 'checkpoint:guide',
        content: '读取前置文件',
        id: 'tool:before',
        kind: 'tool',
        status: 'completed',
      },
      {
        at: 2_000,
        checkpointId: 'checkpoint:guide',
        content: '<mid_turn_guidance>再补充两行</mid_turn_guidance>',
        id: 'guidance:1',
        kind: 'guidance',
      },
      {
        at: 2_400,
        checkpointId: 'checkpoint:guide',
        content: '写入文件',
        id: 'tool:after',
        kind: 'tool',
        status: 'completed',
      },
      {
        at: 3_000,
        checkpointId: 'checkpoint:guide',
        content: '完成',
        id: 'assistant:final',
        kind: 'assistant',
        status: 'completed',
      },
    ];

    const blocks = buildTimelineBlocks(ui, 'completed', 200, 20_000);
    expect(blocks.map(block => block.type === 'run' ? block.id : block.item.id)).toEqual([
      'user:guide',
      'run:checkpoint:guide:0',
      'guidance:1',
      'run:checkpoint:guide:1',
      'assistant:final',
    ]);
    const runs = blocks.filter(block => block.type === 'run');
    expect(runs.map(run => run.items.map(item => item.id))).toEqual([['tool:before'], ['tool:after']]);
    expect(runs.every(defaultRunCollapsed)).toBe(true);
    expect(itemKindLabel('guidance')).toBe('你 · 中途引导');
  });

  it('区分工具参数生成、就绪与执行状态', () => {
    const item = (toolPhase: SessionUiItem['toolPhase']): SessionUiItem => ({
      at: 1,
      content: '',
      id: `tool:${toolPhase}`,
      kind: 'tool',
      status: 'running',
      toolPhase,
    });

    expect(toolGroupLabel([item('generating')])).toBe('正在生成工具调用 · 1');
    expect(toolGroupLabel([item('ready')])).toBe('工具参数已就绪 · 1');
    expect(toolGroupLabel([item('executing')])).toBe('正在调用工具 · 1');
    expect(toolStatusLabel('running', 'generating')).toBe('生成中');
    expect(toolStatusLabel('running', 'ready')).toBe('待执行');
    expect(toolStatusLabel('running', 'executing')).toBe('运行中');
  });
});
