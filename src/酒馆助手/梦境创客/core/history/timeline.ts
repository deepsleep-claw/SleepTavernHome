export type CheckpointStatus = 'abnormal' | 'committed' | 'running' | 'stopped';

export type HistoryCheckpoint = {
  abandonedAt?: number;
  active: boolean;
  afterAgentCursor?: number;
  afterSnapshot?: string;
  beforeAgentCursor: number;
  beforeSnapshot: string;
  createdAt: number;
  id: string;
  pinned: boolean;
  status: CheckpointStatus;
  userMessageId: string;
};

export type HistoryRestore = {
  agentCursor: number;
  checkpointId: string;
  snapshot: string;
  userMessageId: string;
};

export type HistoryTimelineOptions = {
  checkpoints?: HistoryCheckpoint[];
  maxCheckpoints?: number;
  now?: () => number;
  position?: number;
};

const ABANDONED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class HistoryTimeline {
  private checkpoints: HistoryCheckpoint[];
  private readonly maxCheckpoints: number;
  private readonly now: () => number;
  private position: number;

  constructor(options: HistoryTimelineOptions = {}) {
    this.checkpoints = structuredClone(options.checkpoints ?? []);
    this.maxCheckpoints = Math.max(1, options.maxCheckpoints ?? 100);
    this.now = options.now ?? Date.now;
    this.position = options.position ?? this.active().length - 1;
  }

  beginTurn(input: {
    beforeAgentCursor: number;
    beforeSnapshot: string;
    id?: string;
    userMessageId: string;
  }): HistoryCheckpoint {
    if (this.checkpoints.some(item => item.active && item.status === 'running')) {
      throw new Error('已有正在执行的历史检查点。');
    }
    this.abandonFuture();
    const checkpoint: HistoryCheckpoint = {
      active: true,
      beforeAgentCursor: input.beforeAgentCursor,
      beforeSnapshot: input.beforeSnapshot,
      createdAt: this.now(),
      id: input.id ?? crypto.randomUUID(),
      pinned: false,
      status: 'running',
      userMessageId: input.userMessageId,
    };
    this.checkpoints.push(checkpoint);
    this.position = this.active().length - 1;
    this.pruneActive();
    return structuredClone(checkpoint);
  }

  completeTurn(id: string, input: { afterAgentCursor: number; afterSnapshot: string; stopped?: boolean }): void {
    const checkpoint = this.requireCheckpoint(id);
    if (checkpoint.status !== 'running') {
      throw new Error(`检查点不在运行中：${id}`);
    }
    checkpoint.afterAgentCursor = input.afterAgentCursor;
    checkpoint.afterSnapshot = input.afterSnapshot;
    checkpoint.status = input.stopped ? 'stopped' : 'committed';
  }

  markAbnormal(id: string): void {
    const checkpoint = this.requireCheckpoint(id);
    checkpoint.afterAgentCursor = checkpoint.beforeAgentCursor;
    checkpoint.afterSnapshot = checkpoint.beforeSnapshot;
    checkpoint.status = 'abnormal';
  }

  undo(): HistoryRestore | undefined {
    const active = this.active();
    if (this.position < 0) {
      return undefined;
    }
    const checkpoint = active[this.position];
    this.position -= 1;
    return {
      agentCursor: checkpoint.beforeAgentCursor,
      checkpointId: checkpoint.id,
      snapshot: checkpoint.beforeSnapshot,
      userMessageId: checkpoint.userMessageId,
    };
  }

  redo(): HistoryRestore | undefined {
    const active = this.active();
    const checkpoint = active[this.position + 1];
    if (!checkpoint?.afterSnapshot || checkpoint.afterAgentCursor === undefined) {
      return undefined;
    }
    this.position += 1;
    return {
      agentCursor: checkpoint.afterAgentCursor,
      checkpointId: checkpoint.id,
      snapshot: checkpoint.afterSnapshot,
      userMessageId: checkpoint.userMessageId,
    };
  }

  pin(id: string, pinned = true): void {
    this.requireCheckpoint(id).pinned = pinned;
  }

  cleanupAbandoned(): string[] {
    const cutoff = this.now() - ABANDONED_RETENTION_MS;
    const removed = this.checkpoints.filter(item => !item.active && !item.pinned && (item.abandonedAt ?? 0) <= cutoff);
    const ids = new Set(removed.map(item => item.id));
    this.checkpoints = this.checkpoints.filter(item => !ids.has(item.id));
    return [...ids];
  }

  referencedSnapshots(): string[] {
    return [
      ...new Set(
        this.checkpoints.flatMap(item => [item.beforeSnapshot, item.afterSnapshot]).filter((item): item is string => Boolean(item)),
      ),
    ];
  }

  export(): { checkpoints: HistoryCheckpoint[]; position: number } {
    return { checkpoints: structuredClone(this.checkpoints), position: this.position };
  }

  private abandonFuture(): void {
    const active = this.active();
    for (const checkpoint of active.slice(this.position + 1)) {
      checkpoint.active = false;
      checkpoint.abandonedAt = this.now();
    }
  }

  private active(): HistoryCheckpoint[] {
    return this.checkpoints.filter(item => item.active);
  }

  private pruneActive(): void {
    const active = this.active();
    const removable = active.filter(item => !item.pinned);
    const excess = active.length - this.maxCheckpoints;
    if (excess <= 0) return;
    for (const checkpoint of removable.slice(0, excess)) {
      checkpoint.active = false;
      checkpoint.abandonedAt = this.now();
      this.position -= 1;
    }
    this.position = Math.max(-1, this.position);
  }

  private requireCheckpoint(id: string): HistoryCheckpoint {
    const checkpoint = this.checkpoints.find(item => item.id === id);
    if (!checkpoint) {
      throw new Error(`历史检查点不存在：${id}`);
    }
    return checkpoint;
  }
}
