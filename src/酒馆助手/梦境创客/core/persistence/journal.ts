import type { RunnerEvent, RunnerJournal } from '../runner/agent-runner';

export type JournalFlush = (events: RunnerEvent[]) => Promise<void>;

export class PersistentRunnerJournal implements RunnerJournal {
  readonly events: RunnerEvent[];

  constructor(
    initial: RunnerEvent[] = [],
    private readonly flush?: JournalFlush,
  ) {
    this.events = structuredClone(initial);
  }

  async append(event: RunnerEvent): Promise<void> {
    const stored = structuredClone(event);
    this.events.push(stored);
    try {
      await this.flush?.(structuredClone(this.events));
    } catch (error) {
      // 摘要提交失败时，历史与完成事件必须一起回退。
      if (event.type === 'context-compacted') this.events.splice(this.events.indexOf(stored), 1);
      throw error;
    }
  }

  list(): RunnerEvent[] {
    return structuredClone(this.events);
  }
}
