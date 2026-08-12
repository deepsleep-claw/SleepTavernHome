import { describe, expect, it } from 'vitest';
import type { RunnerEvent } from '../runner/agent-runner';
import type { SessionUiItem } from './types';
import { repairPersistedRunDurations } from './run-duration';

describe('repairPersistedRunDurations', () => {
  it('按重发分支的检查点和最终事件修复复用旧时间造成的错误耗时', () => {
    const events: RunnerEvent[] = [
      { at: 3_000, status: 'completed', type: 'status' },
      { at: 100_000, status: 'running', type: 'status' },
      { at: 102_500, status: 'completed', type: 'status' },
    ];
    const ui: SessionUiItem[] = [
      {
        at: 100_000,
        checkpointId: 'checkpoint:resend',
        content: '重新发送',
        durationMs: 101_500,
        id: 'user:shared',
        kind: 'user',
        runStatus: 'completed',
      },
    ];

    repairPersistedRunDurations(ui, events);

    expect(ui[0]).toMatchObject({ at: 100_000, durationMs: 2_500, runStatus: 'completed' });
  });
});
