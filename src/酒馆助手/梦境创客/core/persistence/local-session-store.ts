import { klona } from 'klona';
import type { BrowserRecordStore } from './browser-record-store';
import { CharacterMetadataStore, type CharacterMetadata } from './character-store';
import { SessionRevisionStore, type CommitSessionRevision, type SessionRevision } from './session-store';
import type { SessionIndexEntry } from './settings';
import { canonicalStringify } from '../transaction/canonical';

type LocalSessionIndex = Omit<LocalSession, 'input'>;
type LocalSession = {
  input: CommitSessionRevision;
  entry: SessionIndexEntry;
  dirty: boolean;
  deleted?: boolean;
  remoteRevision: number;
  recordVersion?: number;
  conflict?: SessionBackupConflict;
};
export type SessionBackupConflict = {
  bindingId: string;
  sessionId: string;
  title: string;
  characterName: string;
  localRevision: number;
  remoteRevision: number;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  deleted: boolean;
};
export type SessionBackupResolution = 'local' | 'remote';
export type SessionBackupStatus = {
  pending: number;
  syncing: boolean;
  localPending?: number;
  error?: string;
  lastSavedAt?: number;
  conflicts?: SessionBackupConflict[];
};
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
    await this.local.update<LocalSession>(
      key,
      current => {
        const next = update(current);
        if (!next || next === current) return next;
        // 备份确认与删除也会改变记录；正文版本不变时仍须恢复这些尚未落盘的状态。
        return {
          ...next,
          recordVersion: Math.max(current?.recordVersion ?? current?.entry.revision ?? 0, next.entry.revision) + 1,
        };
      },
      {
        key: `session-index:${key.slice('session:'.length)}`,
        project: ({ input: _input, ...index }) => index,
      },
    );
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
          remoteRevision: revision.referencedRevision ?? revision.entry.revision,
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
    if (!metadata || (metadata.revision === 0 && metadata.updatedAt === 0)) {
      try {
        metadata = await this.characters.load(bindingId, defaults);
        await this.local.put(cacheKey, metadata);
      } catch (error) {
        this.error = `会话索引暂不可用：${String(error)}`;
        metadata = {
          bindingId,
          avatarId: defaults.avatarId,
          characterName: defaults.characterName ?? '',
          revision: 0,
          schemaVersion: 1 as const,
          sessions: {},
          updatedAt: 0,
        };
      }
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

  private schedule(delay = 3000) {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.backup().catch(error => {
        this.onStatus({ pending: 1, syncing: false, error: String(error) });
      });
    }, delay);
  }

  requestBackup() {
    if (!this.timer) this.schedule();
  }

  async backup(): Promise<void> {
    if (this.disposed) return;
    if (this.syncing) return this.syncing;
    return this.synchronize(() => this.flush());
  }

  private synchronize(work: () => Promise<void>, rejectErrors = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const flushing = (async () => {
      if (typeof navigator !== 'undefined' && navigator.locks)
        await navigator.locks.request('dream-creator-session-backup', work);
      else await work();
    })();
    this.syncing = flushing
      .catch(error => {
        this.error = error instanceof Error ? error.message : String(error);
        if (rejectErrors) throw error;
      })
      .finally(async () => {
        this.syncing = undefined;
        await this.publish();
        if (
          (await this.local.list<LocalSessionIndex>('session-index:')).some(
            row => row.value.dirty && !row.value.conflict,
          )
        )
          this.schedule(30_000);
      });
    return this.syncing;
  }

  private async flush(targetKey?: string): Promise<void> {
    this.error = undefined;
    await this.publish(true);
    for (const { value: index } of await this.local.list<LocalSessionIndex>('session-index:')) {
      if (!index.dirty) continue;
      const key = keyFor(index.entry.bindingId, index.entry.sessionId);
      if (targetKey && key !== targetKey) continue;
      if (this.disposed) return;
      const row = await this.local.get<LocalSession>(key);
      if (!row?.dirty) continue;
      const metadata = await this.characters.load(row.entry.bindingId);
      const existing = metadata.sessions[row.entry.sessionId];
      let entry: SessionIndexEntry | undefined;
      let remoteRevision: number | undefined;
      if (existing && existing.revision !== row.remoteRevision) {
        const backup = await this.remote.load(row.entry.bindingId, row.entry.sessionId);
        if (!row.deleted && canonicalStringify(backup.runtime) === canonicalStringify(row.input.runtime)) {
          // 上传成功但本机确认丢失时，只补齐确认，不再上传相同的会话正文。
          entry = backup.entry;
          remoteRevision = backup.referencedRevision ?? backup.entry.revision;
        } else {
          await this.recordConflict(key, row, {
            ...backup.entry,
            revision: backup.referencedRevision ?? backup.entry.revision,
          });
          continue;
        }
      } else {
        entry = row.deleted
          ? (await this.characters.removeSession(row.entry.bindingId, row.entry.sessionId), undefined)
          : await this.remote.commit(row.input);
      }
      await this.updateSession(key, current => {
        if (!current) return current;
        return {
          ...current,
          dirty: current.entry.revision !== row.entry.revision || Boolean(current.deleted) !== Boolean(row.deleted),
          remoteRevision: remoteRevision ?? entry?.revision ?? 0,
          conflict: undefined,
          entry: entry ? { ...current.entry, url: entry.url, sha256: entry.sha256 } : current.entry,
        };
      });
      await this.local.put(`metadata:${row.entry.bindingId}`, await this.characters.load(row.entry.bindingId));
      this.lastSavedAt = Date.now();
    }
  }

  private async recordConflict(key: string, row: LocalSession, remote: SessionIndexEntry): Promise<void> {
    await this.updateSession(key, current => {
      if (
        !current ||
        current.entry.revision !== row.entry.revision ||
        Boolean(current.deleted) !== Boolean(row.deleted)
      )
        return current;
      return {
        ...current,
        conflict: {
          bindingId: row.entry.bindingId,
          sessionId: row.entry.sessionId,
          title: row.entry.title,
          characterName: row.entry.characterName,
          localRevision: row.entry.revision,
          remoteRevision: remote.revision,
          localUpdatedAt: row.entry.updatedAt,
          remoteUpdatedAt: remote.updatedAt,
          deleted: Boolean(row.deleted),
        },
      };
    });
  }

  async resolveConflict(conflict: SessionBackupConflict, resolution: SessionBackupResolution): Promise<void> {
    if (this.disposed) throw new Error('会话存储已关闭。');
    while (this.syncing) await this.syncing;
    await this.synchronize(async () => {
      this.error = undefined;
      await this.publish(true);
      const { bindingId, sessionId } = conflict;
      const key = keyFor(bindingId, sessionId);
      const row = await this.local.get<LocalSession>(key);
      if (!row?.dirty) return;
      const remote = await this.remote.load(bindingId, sessionId);
      const remoteRevision = remote.referencedRevision ?? remote.entry.revision;
      if (
        row.entry.revision !== conflict.localRevision ||
        Boolean(row.deleted) !== conflict.deleted ||
        remoteRevision !== conflict.remoteRevision
      ) {
        await this.recordConflict(key, row, { ...remote.entry, revision: remoteRevision });
        throw new Error('会话记录又有更新，请查看最新状态后重新选择。');
      }
      const remoteRow: LocalSession = {
        dirty: false,
        remoteRevision,
        entry: remote.entry,
        input: {
          bindingId,
          avatarId: remote.entry.avatarId,
          characterName: remote.entry.characterName,
          status: remote.entry.status,
          runtime: remote.runtime,
        },
      };
      await this.local.put(`session-recovery:${sessionId}:${crypto.randomUUID()}`, row);
      await this.local.put(`session-recovery:${sessionId}:${crypto.randomUUID()}`, remoteRow);
      await this.updateSession(key, current => {
        if (
          !current ||
          current.entry.revision !== row.entry.revision ||
          Boolean(current.deleted) !== Boolean(row.deleted)
        ) {
          throw new Error('本机会话又有更新，请重新选择。');
        }
        return resolution === 'remote' ? remoteRow : { ...current, conflict: undefined, remoteRevision };
      });
      await this.local.put(`metadata:${bindingId}`, await this.characters.load(bindingId));
      await this.flush(key);
    }, true);
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
      remoteRevision: revision.referencedRevision ?? revision.entry.revision,
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
    const pending = (await this.local.list<LocalSessionIndex>('session-index:')).filter(row => row.value.dirty);
    const conflicts = pending.flatMap(row => (row.value.conflict ? [row.value.conflict] : []));
    this.onStatus({ pending: pending.length, conflicts, syncing, error: this.error, lastSavedAt: this.lastSavedAt });
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
