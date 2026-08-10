export interface BinaryBlobStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  keys(): Promise<string[]>;
  put(key: string, value: Uint8Array): Promise<void>;
}

export class MemoryBinaryBlobStore implements BinaryBlobStore {
  private readonly values = new Map<string, Uint8Array>();

  constructor(initial: Record<string, Uint8Array> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, Uint8Array.from(value)));
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const value = this.values.get(key);
    return value ? Uint8Array.from(value) : undefined;
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()].sort();
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    this.values.set(key, Uint8Array.from(value));
  }

  dump(): Record<string, Uint8Array> {
    return Object.fromEntries([...this.values].map(([key, value]) => [key, Uint8Array.from(value)]));
  }
}

/**
 * 把新Blob暂存在当前页面内存中，直到一次会话持久化事务结束前再统一落盘。
 * 读取会先命中暂存区，因此Agent运行期间仍可正常创建和使用快照。
 */
export class StagedBinaryBlobStore implements BinaryBlobStore {
  private readonly staged = new Map<string, Uint8Array>();

  constructor(private readonly backing: BinaryBlobStore) {}

  async delete(key: string): Promise<void> {
    if (this.staged.delete(key)) return;
    await this.backing.delete(key);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const staged = this.staged.get(key);
    return staged ? Uint8Array.from(staged) : this.backing.get(key);
  }

  async keys(): Promise<string[]> {
    return [...new Set([...(await this.backing.keys()), ...this.staged.keys()])].sort();
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    this.staged.set(key, Uint8Array.from(value));
  }

  pendingCount(): number {
    return this.staged.size;
  }

  async flush(): Promise<void> {
    for (const [key, value] of [...this.staged]) {
      await this.backing.put(key, value);
      this.staged.delete(key);
    }
  }
}
