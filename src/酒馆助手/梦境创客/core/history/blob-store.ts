export interface BinaryBlobStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  keys(): Promise<string[]>;
  put(key: string, value: Uint8Array): Promise<void>;
}

export class MemoryBinaryBlobStore implements BinaryBlobStore {
  private readonly values = new Map<string, Uint8Array>();

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
}
