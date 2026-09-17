import type { BrowserRecordIndex, BrowserRecordStore } from './browser-record-store';

type PendingRecord = { value: unknown; index?: { key: string; value: unknown } };
type Recovery = { storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; key: () => Promise<string> };

/** 会话正文与索引一起延迟落盘；内存读取始终能看到最新版本。 */
export class BufferedSessionRecordStore implements BrowserRecordStore {
  private readonly pending = new Map<string, PendingRecord>();
  private timer?: ReturnType<typeof setTimeout>;
  private flushing?: Promise<void>;
  private recoveryKey?: string;
  private initialized?: Promise<void>;
  private disposed = false;
  private savedRecovery?: string;
  private readonly pagehide = () => {
    this.preserve();
    void this.flush().catch(this.onError);
  };

  constructor(
    private readonly base: BrowserRecordStore,
    private readonly recovery?: Recovery,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly onPending: (count: number) => void = () => {},
  ) {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.pagehide);
  }

  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      if (!this.recovery) return;
      this.recoveryKey = await this.recovery.key();
      let text: string | null;
      try {
        text = this.recovery.storage.getItem(this.recoveryKey);
      } catch (error) {
        this.onError(error);
        return;
      }
      if (!text) return;
      this.savedRecovery = text;
      let rows: unknown;
      try {
        rows = JSON.parse(text);
      } catch (error) {
        this.onError(error);
        return;
      }
      if (!Array.isArray(rows)) {
        this.onError(new Error('会话恢复记录格式无效。'));
        return;
      }
      for (const row of rows) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0].startsWith('session:')) continue;
        if (row[1] && typeof row[1] === 'object' && 'value' in row[1]) {
          const durable = await this.base.get<{ entry?: { revision?: number } }>(row[0]);
          const revision = row[1].value?.entry?.revision;
          if (
            typeof revision === 'number' &&
            typeof durable?.entry?.revision === 'number' &&
            durable.entry.revision >= revision
          )
            continue;
          this.pending.set(row[0], row[1]);
        }
      }
      if (this.pending.size) this.schedule();
    })().catch(error => {
      this.initialized = undefined;
      throw error;
    });
    return this.initialized;
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.initialize();
    if (this.pending.has(key)) return structuredClone(this.pending.get(key)!.value) as T | undefined;
    for (const row of this.pending.values())
      if (row.index?.key === key) return structuredClone(row.index.value) as T | undefined;
    return this.base.get<T>(key);
  }

  async list<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    await this.initialize();
    const rows = new Map((await this.base.list<T>(prefix)).map(row => [row.key, row.value]));
    const put = (key: string, value: unknown) => {
      if (!key.startsWith(prefix)) return;
      if (value === undefined) rows.delete(key);
      else rows.set(key, structuredClone(value) as T);
    };
    for (const [key, row] of this.pending) {
      put(key, row.value);
      if (row.index) put(row.index.key, row.index.value);
    }
    return [...rows].map(([key, value]) => ({ key, value }));
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.update(key, () => value);
  }

  async update<T>(
    key: string,
    update: (value: T | undefined) => T | undefined,
    index?: BrowserRecordIndex<T>,
  ): Promise<void> {
    await this.initialize();
    if (!key.startsWith('session:')) return this.base.update(key, update, index);
    // 等待初次读取后再次检查内存，避免并发更新覆盖已排队的新版本。
    const stored = await this.get<T>(key);
    const current = this.pending.has(key) ? (this.pending.get(key)!.value as T | undefined) : stored;
    const value = update(structuredClone(current));
    this.pending.set(key, {
      value: structuredClone(value),
      index: index ? { key: index.key, value: value === undefined ? undefined : index.project(value) } : undefined,
    });
    this.onPending(this.pending.size);
    this.schedule();
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(this.onError);
    }, 3000);
  }

  /** 页面离开时同步保留尚未落盘的批次，下一次初始化优先恢复。 */
  private preserve(): void {
    if (!this.recovery || !this.recoveryKey) return;
    try {
      if (this.pending.size) {
        this.savedRecovery = JSON.stringify([...this.pending]);
        this.recovery.storage.setItem(this.recoveryKey, this.savedRecovery);
      } else if (this.recovery.storage.getItem(this.recoveryKey) === this.savedRecovery) {
        this.recovery.storage.removeItem(this.recoveryKey);
      }
    } catch (error) {
      this.onError(error);
    }
  }

  async flush(): Promise<void> {
    await this.initialize();
    if (this.flushing) return this.flushing;
    const batch = [...this.pending];
    this.flushing = (async () => {
      for (const [key, row] of batch) {
        await this.base.update(
          key,
          current => {
            const previous = current as { entry?: { revision?: number }; input?: unknown } | undefined;
            const next = row.value as { entry?: { revision?: number }; input?: unknown } | undefined;
            if (
              typeof previous?.entry?.revision === 'number' &&
              typeof next?.entry?.revision === 'number' &&
              (previous.entry.revision > next.entry.revision ||
                (previous.entry.revision === next.entry.revision &&
                  JSON.stringify(previous.input) !== JSON.stringify(next.input)))
            ) {
              throw new Error('会话已在其他页面更新，当前内容已保留，请导出后核对。');
            }
            return row.value;
          },
          row.index ? { key: row.index.key, project: () => row.index!.value } : undefined,
        );
        if (this.pending.get(key) === row) this.pending.delete(key);
      }
    })().finally(() => {
      this.flushing = undefined;
      this.preserve();
      this.onPending(this.pending.size);
      if (this.pending.size && !this.timer) this.schedule();
    });
    return this.flushing;
  }

  dispose(): void {
    this.disposed = true;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.pagehide);
    if (this.timer) clearTimeout(this.timer);
    this.preserve();
    void this.flush().catch(this.onError);
  }
}
