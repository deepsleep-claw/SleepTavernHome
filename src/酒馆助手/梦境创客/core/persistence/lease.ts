import type { TavernFileClient } from './file-client';
import type { AgentSettingsStore } from './settings';

export type LeaseRecord = {
  expiresAt: number;
  holderId: string;
  sessionId: string;
  updatedAt: number;
};

export interface LeaseRecordStore {
  read(sessionId: string): Promise<LeaseRecord | undefined>;
  write(record: LeaseRecord): Promise<void>;
}

export class MemoryLeaseRecordStore implements LeaseRecordStore {
  private readonly values = new Map<string, LeaseRecord>();
  async read(sessionId: string): Promise<LeaseRecord | undefined> {
    const value = this.values.get(sessionId);
    return value ? structuredClone(value) : undefined;
  }
  async write(record: LeaseRecord): Promise<void> {
    this.values.set(record.sessionId, structuredClone(record));
  }
}

export class TavernLeaseRecordStore implements LeaseRecordStore {
  constructor(
    private readonly client: TavernFileClient,
    private readonly settingsStore: AgentSettingsStore,
    private readonly bindingId: string,
  ) {}

  async read(sessionId: string): Promise<LeaseRecord | undefined> {
    const entry = this.settingsStore.load().sessions[sessionId];
    if (!entry?.leaseUrl) return undefined;
    try {
      const bytes = await this.client.download(entry.leaseUrl);
      const record = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LeaseRecord>;
      if (
        record.sessionId !== sessionId ||
        typeof record.holderId !== 'string' ||
        typeof record.updatedAt !== 'number' ||
        typeof record.expiresAt !== 'number'
      ) {
        return undefined;
      }
      return record as LeaseRecord;
    } catch {
      return undefined;
    }
  }

  async write(record: LeaseRecord): Promise<void> {
    const settings = this.settingsStore.load();
    const entry = settings.sessions[record.sessionId];
    if (!entry) throw new Error(`无法为不存在的会话写入租约：${record.sessionId}`);
    const safeSessionId = record.sessionId.replace(/[^a-zA-Z\d_-]/gu, '_').slice(0, 80);
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    const name = `dream-card-agent--${safeSessionId}--lease.json`;
    const url = await this.client.upload(name, bytes);
    entry.leaseUrl = url;
    settings.files[`lease:${record.sessionId}`] = {
      bindingId: this.bindingId,
      createdAt: record.updatedAt,
      name,
      size: bytes.byteLength,
      url,
    };
    await this.settingsStore.save(settings);
  }
}

export type LeaseCoordinatorOptions = {
  holderId?: string;
  now?: () => number;
  sessionId: string;
  store: LeaseRecordStore;
};

export class LeaseCoordinator {
  readonly holderId: string;
  private readonly now: () => number;
  private readonly sessionId: string;
  private readonly store: LeaseRecordStore;
  private timer?: ReturnType<typeof setInterval>;
  private channel?: BroadcastChannel;
  private owner = false;

  constructor(options: LeaseCoordinatorOptions) {
    this.holderId = options.holderId ?? crypto.randomUUID();
    this.now = options.now ?? Date.now;
    this.sessionId = options.sessionId;
    this.store = options.store;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`dream-card-agent:${this.sessionId}`);
      this.channel.addEventListener('message', event => {
        const record = event.data as LeaseRecord;
        if (record.sessionId === this.sessionId && record.holderId !== this.holderId && record.expiresAt > this.now()) {
          this.owner = false;
        }
      });
    }
  }

  async acquire(force = false): Promise<boolean> {
    const current = await this.store.read(this.sessionId);
    if (!force && current && current.holderId !== this.holderId && current.expiresAt > this.now()) {
      this.owner = false;
      return false;
    }
    await this.writeLease();
    const verified = await this.store.read(this.sessionId);
    this.owner = verified?.holderId === this.holderId;
    if (this.owner) this.startRefresh();
    return this.owner;
  }

  async refresh(): Promise<boolean> {
    if (!this.owner) return false;
    const current = await this.store.read(this.sessionId);
    if (current && current.holderId !== this.holderId && current.expiresAt > this.now()) {
      this.owner = false;
      this.stopRefresh();
      return false;
    }
    await this.writeLease();
    return true;
  }

  async isStale(): Promise<boolean> {
    const current = await this.store.read(this.sessionId);
    return !current || current.expiresAt <= this.now();
  }

  isOwner(): boolean {
    return this.owner;
  }

  close(): void {
    this.owner = false;
    this.stopRefresh();
    this.channel?.close();
  }

  private async writeLease(): Promise<void> {
    const timestamp = this.now();
    const record = { expiresAt: timestamp + 30_000, holderId: this.holderId, sessionId: this.sessionId, updatedAt: timestamp };
    await this.store.write(record);
    this.channel?.postMessage(record);
  }

  private startRefresh(): void {
    this.stopRefresh();
    this.timer = setInterval(() => void this.refresh(), 10_000);
  }

  private stopRefresh(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
