import { klona } from 'klona';
import type { BrowserRecordStore } from './browser-record-store';
import { CharacterMetadataStore, type CharacterMetadata } from './character-store';
import { SessionRevisionStore, type CommitSessionRevision, type SessionRevision } from './session-store';
import type { SessionIndexEntry } from './settings';

type LocalSessionIndex = Omit<LocalSession, 'input'>;
type LocalSession = {
  input: CommitSessionRevision;
  entry: SessionIndexEntry;
  dirty: boolean;
  deleted?: boolean;
  remoteRevision: number;
};
export type SessionBackupStatus = { pending: number; syncing: boolean; error?: string; lastSavedAt?: number };
const keyFor = (bindingId: string, sessionId: string) =>
  `session:${encodeURIComponent(bindingId)}:${encodeURIComponent(sessionId)}`;

export class LocalSessionStore {
  private timer?: ReturnType<typeof setTimeout>;
  private syncing?: Promise<void>;
  private disposed = false;
  private lastSavedAt?: number;
  private error?: string;

  constructor(
    private readonly local: BrowserRecordStore,
    private readonly remote: SessionRevisionStore,
    private readonly characters: CharacterMetadataStore,
    private readonly onStatus: (status: SessionBackupStatus) => void = () => {},
  ) {}

  private async updateSession(
    key: string,
    update: (row: LocalSession | undefined) => LocalSession | undefined,
  ): Promise<void> {
    await this.local.update(key, update, {
      key: `session-index:${key.slice('session:'.length)}`,
      project: ({ input: _input, ...index }) => index,
    });
  }

  async commit(input: CommitSessionRevision): Promise<SessionIndexEntry> {
    let entry!: SessionIndexEntry;
    await this.updateSession(keyFor(input.bindingId, input.runtime.sessionId), previous => {
      entry = {
        ...previous?.entry,
        bindingId: input.bindingId,
        avatarId: input.avatarId,
        characterName: input.characterName,
        sessionId: input.runtime.sessionId,
        title: input.runtime.title,
        status: input.status,
        createdAt: input.runtime.createdAt,
        updatedAt: input.runtime.updatedAt,
        revision: (previous?.entry.revision ?? 0) + 1,
        sha256: previous?.entry.sha256 ?? '',
        size: new TextEncoder().encode(JSON.stringify(input.runtime)).byteLength,
        url: previous?.entry.url ?? '',
      };
      return { input: klona(input), entry, dirty: true, remoteRevision: previous?.remoteRevision ?? 0 };
    });
    this.schedule();
    await this.publish();
    return entry;
  }

  async load(bindingId: string, sessionId: string): Promise<SessionRevision> {
    const key = keyFor(bindingId, sessionId);
    const row = await this.local.get<LocalSession>(key);
    if (row?.deleted) throw new Error('会话已删除。');
    if (row) return { entry: klona(row.entry), runtime: klona(row.input.runtime) };
    const revision = await this.remote.load(bindingId, sessionId);
    await this.updateSession(
      key,
      current =>
        current ?? {
          entry: revision.entry,
          dirty: false,
          remoteRevision: revision.entry.revision,
          input: {
            bindingId,
            avatarId: revision.entry.avatarId,
            characterName: revision.entry.characterName,
            status: revision.entry.status,
            runtime: revision.runtime,
          },
        },
    );
    return this.load(bindingId, sessionId);
  }

  async metadata(
    bindingId: string,
    defaults: { avatarId?: string; characterName?: string } = {},
  ): Promise<CharacterMetadata> {
    const cacheKey = `metadata:${bindingId}`;
    let metadata = await this.local.get<CharacterMetadata>(cacheKey);
    if (!metadata) {
      metadata = await this.characters.load(bindingId, defaults).catch(() => ({
        bindingId,
        avatarId: defaults.avatarId,
        characterName: defaults.characterName ?? '',
        revision: 0,
        schemaVersion: 1 as const,
        sessions: {},
        updatedAt: 0,
      }));
      await this.local.put(cacheKey, metadata);
    }
    for (const { value } of await this.local.list<LocalSessionIndex>(
      `session-index:${encodeURIComponent(bindingId)}:`,
    )) {
      if (value.deleted) delete metadata.sessions[value.entry.sessionId];
      else {
        metadata.sessions[value.entry.sessionId] = value.entry;
        metadata.avatarId = defaults.avatarId ?? value.entry.avatarId ?? metadata.avatarId;
        metadata.characterName = defaults.characterName ?? value.entry.characterName;
      }
    }
    return metadata;
  }

  async bindings(): Promise<SessionIndexEntry[]> {
    return (await this.local.list<LocalSessionIndex>('session-index:'))
      .filter(row => !row.value.deleted)
      .map(row => row.value.entry);
  }

  async removeSession(bindingId: string, sessionId: string): Promise<SessionIndexEntry | undefined> {
    const revision = await this.load(bindingId, sessionId).catch(() => undefined);
    if (!revision) return undefined;
    await this.updateSession(keyFor(bindingId, sessionId), row => row && { ...row, dirty: true, deleted: true });
    this.schedule();
    await this.publish();
    return revision.entry;
  }

  async removeCharacter(bindingId: string): Promise<void> {
    const metadata = await this.metadata(bindingId);
    for (const sessionId of Object.keys(metadata.sessions)) await this.removeSession(bindingId, sessionId);
  }

  private schedule(delay = 1500) {
    if (this.disposed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.backup().catch(error => {
        this.onStatus({ pending: 1, syncing: false, error: String(error) });
      });
    }, delay);
  }

  requestBackup() {
    this.schedule();
  }

  async backup(): Promise<void> {
    if (this.disposed) return;
    if (this.syncing) return this.syncing;
    const flushing = (async () => {
      if (typeof navigator !== 'undefined' && navigator.locks)
        await navigator.locks.request('dream-creator-session-backup', () => this.flush());
      else await this.flush();
    })();
    this.syncing = flushing
      .catch(error => {
        this.error = error instanceof Error ? error.message : String(error);
      })
      .finally(async () => {
        this.syncing = undefined;
        await this.publish();
        if ((await this.local.list<LocalSessionIndex>('session-index:')).some(row => row.value.dirty))
          this.schedule(30_000);
      });
    return this.syncing;
  }

  private async flush(): Promise<void> {
    this.error = undefined;
    await this.publish(true);
    for (const { value: index } of await this.local.list<LocalSessionIndex>('session-index:')) {
      if (!index.dirty) continue;
      const key = keyFor(index.entry.bindingId, index.entry.sessionId);
      if (this.disposed) return;
      const row = await this.local.get<LocalSession>(key);
      if (!row?.dirty) continue;
      const metadata = await this.characters.load(row.entry.bindingId);
      const existing = metadata.sessions[row.entry.sessionId];
      if (existing && existing.revision !== row.remoteRevision) {
        this.error = `“${row.entry.title}”的后端备份已被其他页面更新，本机内容已保留。`;
        continue;
      }
      const entry = row.deleted
        ? (await this.characters.removeSession(row.entry.bindingId, row.entry.sessionId), undefined)
        : await this.remote.commit(row.input);
      await this.updateSession(key, current => {
        if (!current) return current;
        return {
          ...current,
          dirty: current.entry.revision !== row.entry.revision || Boolean(current.deleted) !== Boolean(row.deleted),
          remoteRevision: entry?.revision ?? 0,
          entry: entry ? { ...current.entry, url: entry.url, sha256: entry.sha256 } : current.entry,
        };
      });
      await this.local.put(`metadata:${row.entry.bindingId}`, await this.characters.load(row.entry.bindingId));
      this.lastSavedAt = Date.now();
    }
  }

  async refreshBackups(): Promise<void> {
    for (const { key } of await this.local.list<CharacterMetadata>('metadata:'))
      await this.local.update(key, () => undefined);
    this.schedule(0);
  }

  async exportSessions(): Promise<string> {
    const sessions = (await this.local.list<LocalSession>('session:'))
      .filter(row => !row.value.deleted)
      .map(row => row.value);
    const recovery = await this.local.list<LocalSession>('session-recovery:');
    return JSON.stringify(
      { format: 'dream-creator-local-sessions', version: 1, exportedAt: Date.now(), sessions, recovery },
      null,
      2,
    );
  }

  async restoreBackup(bindingId: string, sessionId: string): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.syncing;
    const revision = await this.remote.load(bindingId, sessionId);
    const key = keyFor(bindingId, sessionId);
    const current = await this.local.get<LocalSession>(key);
    if (current) await this.local.put(`session-recovery:${sessionId}:${crypto.randomUUID()}`, current);
    await this.updateSession(key, () => ({
      dirty: false,
      remoteRevision: revision.entry.revision,
      entry: revision.entry,
      input: {
        bindingId,
        avatarId: revision.entry.avatarId,
        characterName: revision.entry.characterName,
        status: revision.entry.status,
        runtime: revision.runtime,
      },
    }));
    this.error = undefined;
    await this.publish();
  }

  private async publish(syncing = Boolean(this.syncing)) {
    const pending = (await this.local.list<LocalSessionIndex>('session-index:')).filter(row => row.value.dirty).length;
    this.onStatus({ pending, syncing, error: this.error, lastSavedAt: this.lastSavedAt });
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
