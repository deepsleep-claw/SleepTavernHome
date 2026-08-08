import type { RunnerEvent, RunnerJournal } from '../runner/agent-runner';

export type JournalFlush = (events: RunnerEvent[]) => Promise<void>;

export class PersistentRunnerJournal implements RunnerJournal {
  readonly events: RunnerEvent[];

  constructor(initial: RunnerEvent[] = [], private readonly flush?: JournalFlush) {
    this.events = structuredClone(initial);
  }

  async append(event: RunnerEvent): Promise<void> {
    this.events.push(structuredClone(event));
    await this.flush?.(structuredClone(this.events));
  }

  list(): RunnerEvent[] {
    return structuredClone(this.events);
  }
}
