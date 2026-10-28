import { klona } from 'klona';
import type { BrowserRecordStore } from './browser-record-store';
import { CharacterMetadataStore, type CharacterMetadata } from './character-store';
import { SessionRevisionStore, type CommitSessionRevision, type SessionRevision } from './session-store';
import type { SessionIndexEntry } from './settings';
import { canonicalStringify } from '../transaction/canonical';
import { SessionBackupScheduler } from './session-backup-scheduler';

type LocalSessionIndex = Omit<LocalSession, 'input' | 'pendingBackup'>;
type LocalSession = {
  input: CommitSessionRevision;
  entry: SessionIndexEntry;
  dirty: boolean;
  deleted?: boolean;
  remoteRevision: number;
  recordVersion?: number;
  conflict?: SessionBackupConflict;
  pendingBackup?: { commitId: string; snapshotKey: string; localRevision: number };
  backupError?: string;
  retryAt?: number;
  failures?: number;
  lastBackedUpAt?: number;
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
  updates?: Array<SessionIndexEntry & { localDirty: boolean }>;
  pending: number;
  syncing: boolean;
  localPending?: number;
  error?: string;
  localError?: string;
  lastSavedAt?: number;
  conflicts?: SessionBackupConflict[];
};
const keyFor = (bindingId: string, sessionId: string) =>
  `session:${encodeURIComponent(bindingId)}:${encodeURIComponent(sessionId)}`;

export class LocalSessionStore {
  private readonly scheduler: SessionBackupScheduler;
  private syncing?: Promise<void>;
  private disposed = false;
  private lastSavedAt?: number;
  private updates: NonNullable<SessionBackupStatus['updates']> = [];
  private error?: string;

  constructor(
    private readonly local: BrowserRecordStore,
    private readonly remote: SessionRevisionStore,
    private readonly characters: CharacterMetadataStore,
    private readonly onStatus: (status: SessionBackupStatus) => void = () => {},
  ) {
    this.scheduler = new SessionBackupScheduler(() => this.checkBackups());
  }

  setBackupFrequency(seconds: number): void {
    this.scheduler.setFrequency(seconds);
  }

  private async checkBackups(): Promise<void> {
    if (this.disposed || this.syncing) return;
    const pending = await this.local.list<LocalSessionIndex>('session-index:');
    if (pending.some(({ value }) => value.dirty && !value.conflict && (value.retryAt ?? 0) <= Date.now()))
      await this.synchronize(() => this.flush(undefined, true));
  }

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
        project: ({ input: _input, pendingBackup: _pendingBackup, ...index }) => index,
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
        size: previous?.entry.size ?? 0,
        url: previous?.entry.url ?? '',
      };
      return { ...previous, input, entry, dirty: true, deleted: false, remoteRevision: previous?.remoteRevision ?? 0 };
    });
    await this.local.flush?.();
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
    await this.local.flush?.();
    await this.publish();
    return revision.entry;
  }

  async removeCharacter(bindingId: string): Promise<void> {
    const metadata = await this.metadata(bindingId);
    for (const sessionId of Object.keys(metadata.sessions)) await this.removeSession(bindingId, sessionId);
  }

  requestBackup() {
    void this.publish().catch(error => {
      if (this.disposed) return;
      this.onStatus({
        pending: 0,
        syncing: Boolean(this.syncing),
        localError: `读取本机会话失败：${error instanceof Error ? error.message : String(error)}`,
      });
    });
  }

  async backup(): Promise<void> {
    if (this.disposed) return;
    if (this.syncing) return this.syncing;
    return this.synchronize(() => this.flush());
  }

  private synchronize(work: () => Promise<void>, rejectErrors = false): Promise<void> {
    const flushing = (async () => {
      if (typeof navigator !== 'undefined' && navigator.locks)
        await navigator.locks.request('dream-creator-session-backup', { ifAvailable: true }, lock => {
          if (lock) return work();
          if (rejectErrors) throw new Error('另一页面正在备份，请稍后重试。');
          return undefined;
        });
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
      });
    return this.syncing;
  }

  private async flush(targetKey?: string, automatic = false): Promise<void> {
    this.error = undefined;
    await this.publish(true);
    for (const { value: index } of await this.local.list<LocalSessionIndex>('session-index:')) {
      if (!index.dirty || (!targetKey && index.conflict)) continue;
      if (automatic && (index.retryAt ?? 0) > Date.now()) continue;
      const key = keyFor(index.entry.bindingId, index.entry.sessionId);
      if (targetKey && key !== targetKey) continue;
      if (this.disposed) return;
      try {
        await this.backupSession(key);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.updateSession(key, current => {
          if (!current) return current;
          const failures = (current.failures ?? 0) + 1;
          return {
            ...current,
            failures,
            backupError: message,
            retryAt: Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5)),
          };
        }).catch(() => {
          this.error = message;
        });
        if (targetKey) throw error;
      }
    }
  }

  private async acknowledge(
    key: string,
    entry: SessionIndexEntry | undefined,
    localRevision: number,
    deleted = false,
  ): Promise<void> {
    let snapshotKey: string | undefined;
    await this.updateSession(key, current => {
      snapshotKey = current?.pendingBackup?.snapshotKey;
      return (
        current && {
          ...current,
          dirty: current.entry.revision !== localRevision || Boolean(current.deleted) !== deleted,
          remoteRevision: entry?.revision ?? 0,
          pendingBackup: undefined,
          backupError: undefined,
          retryAt: undefined,
          failures: 0,
          lastBackedUpAt: Date.now(),
          conflict: undefined,
          entry: entry
            ? { ...current.entry, url: entry.url, size: entry.size, sha256: entry.sha256, commitId: entry.commitId }
            : current.entry,
        }
      );
    });
    await this.local.flush?.();
    if (snapshotKey) await this.local.update(snapshotKey, () => undefined).catch(() => undefined);
    this.lastSavedAt = Date.now();
  }

  private async backupSession(key: string): Promise<void> {
    // 先确认或重试已提交的快照，再处理期间产生的新内容。
    for (let pass = 0; pass < 2; pass += 1) {
      const row = await this.local.get<LocalSession>(key);
      if (!row?.dirty || this.disposed) return;
      const metadata = await this.characters.load(row.entry.bindingId);
      const existing = metadata.sessions[row.entry.sessionId];
      if (row.pendingBackup && existing?.commitId === row.pendingBackup.commitId) {
        await this.acknowledge(key, existing, row.pendingBackup.localRevision);
        continue;
      }
      if (existing && existing.revision !== row.remoteRevision) {
        const backup = await this.remote.load(row.entry.bindingId, row.entry.sessionId);
        if (!row.deleted && canonicalStringify(backup.runtime) === canonicalStringify(row.input.runtime)) {
          await this.acknowledge(
            key,
            { ...backup.entry, revision: backup.referencedRevision ?? backup.entry.revision },
            row.entry.revision,
          );
        } else {
          await this.recordConflict(key, row, {
            ...backup.entry,
            revision: backup.referencedRevision ?? backup.entry.revision,
          });
        }
        return;
      }
      if (!existing && row.remoteRevision > 0 && !row.deleted) {
        throw new Error('后端会话备份已被删除，请检查后端版本后再恢复备份。');
      }
      if (row.deleted) {
        await this.characters.removeSession(row.entry.bindingId, row.entry.sessionId);
        await this.acknowledge(key, undefined, row.entry.revision, true);
        return;
      }
      const commitId = row.pendingBackup?.commitId ?? crypto.randomUUID();
      const pending = row.pendingBackup ?? {
        commitId,
        snapshotKey: `backup-snapshot:${commitId}`,
        localRevision: row.entry.revision,
      };
      if (!row.pendingBackup) await this.local.put(pending.snapshotKey, { input: { ...row.input, commitId } });
      let admitted = false;
      await this.updateSession(key, current => {
        if (
          !current?.dirty ||
          current.remoteRevision !== row.remoteRevision ||
          Boolean(current.deleted) !== Boolean(row.deleted)
        )
          return current;
        admitted = true;
        return { ...current, pendingBackup: pending };
      });
      if (!admitted) {
        if (!row.pendingBackup) await this.local.update(pending.snapshotKey, () => undefined);
        return;
      }
      await this.local.flush?.();
      const snapshot = await this.local.get<{ input: CommitSessionRevision }>(pending.snapshotKey);
      if (!snapshot) throw new Error('待备份快照缺失，本机会话仍保留，请导出后检查。');
      const entry = await this.remote.commit(snapshot.input);
      await this.acknowledge(key, entry, pending.localRevision);
      await this.local.put(`metadata:${row.entry.bindingId}`, await this.characters.load(row.entry.bindingId));
      if (pending.localRevision === row.entry.revision) return;
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
        return resolution === 'remote'
          ? remoteRow
          : {
              ...current,
              conflict: undefined,
              remoteRevision,
              pendingBackup: undefined,
              backupError: undefined,
            };
      });
      await this.local.put(`metadata:${bindingId}`, await this.characters.load(bindingId));
      await this.flush(key);
    }, true);
  }

  async refreshBackups(bindingIds: string[] = []): Promise<void> {
    await this.syncing;
    const local = await this.local.list<LocalSessionIndex>('session-index:');
    const bySession = new Map(
      local.map(row => [keyFor(row.value.entry.bindingId, row.value.entry.sessionId), row.value]),
    );
    const bindings = new Set([...bindingIds, ...local.map(row => row.value.entry.bindingId)]);
    const updates: NonNullable<SessionBackupStatus['updates']> = [];
    const errors: string[] = [];
    for (const bindingId of bindings) {
      try {
        const metadata = await this.characters.load(bindingId);
        await this.local.put(`metadata:${bindingId}`, metadata);
        for (const entry of Object.values(metadata.sessions)) {
          const row = bySession.get(keyFor(bindingId, entry.sessionId));
          if (!row || entry.revision !== row.remoteRevision)
            updates.push({ ...entry, localDirty: Boolean(row?.dirty) });
        }
      } catch (error) {
        errors.push(String(error));
      }
    }
    this.updates = updates;
    this.error = errors.length ? `后端版本检查未完成：${errors.join('；')}` : undefined;
    await this.publish();
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
    await this.syncing;
    const key = keyFor(bindingId, sessionId);
    const before = await this.local.get<LocalSession>(key);
    const revision = await this.remote.load(bindingId, sessionId);
    const current = await this.local.get<LocalSession>(key);
    if (current?.recordVersion !== before?.recordVersion) throw new Error('本机会话已有新内容，请重新检查后端版本。');
    if (current) await this.local.put(`session-recovery:${sessionId}:${crypto.randomUUID()}`, current);
    await this.updateSession(key, latest => {
      if (latest?.recordVersion !== before?.recordVersion) throw new Error('本机会话已有新内容，请重新检查后端版本。');
      return {
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
      };
    });
    await this.local.flush?.();
    this.updates = this.updates.filter(entry => entry.bindingId !== bindingId || entry.sessionId !== sessionId);
    this.error = undefined;
    await this.publish();
  }

  private async publish(syncing = Boolean(this.syncing)) {
    const rows = await this.local.list<LocalSessionIndex>('session-index:');
    const pending = rows.filter(row => row.value.dirty);
    const conflicts = pending.flatMap(row => (row.value.conflict ? [row.value.conflict] : []));
    const error =
      this.error ??
      [...new Set(pending.flatMap(row => (row.value.backupError ? [row.value.backupError] : [])))].join('；');
    this.onStatus({
      pending: pending.length,
      conflicts,
      updates: this.updates,
      syncing,
      error: error || undefined,
      lastSavedAt: this.lastSavedAt ?? (Math.max(0, ...rows.map(row => row.value.lastBackedUpAt ?? 0)) || undefined),
    });
  }

  dispose() {
    this.disposed = true;
    this.scheduler.dispose();
  }
}
