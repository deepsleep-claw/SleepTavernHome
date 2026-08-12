import { klona } from 'klona';
import type { PersistedSessionRuntime } from '../session/types';
import type { SessionIndexEntry } from './settings';

export type PendingSessionDraft = {
  avatarId?: string;
  bindingId: string;
  characterName: string;
  runtime: PersistedSessionRuntime;
  status: SessionIndexEntry['status'];
};

export interface SessionDraftCache {
  list(bindingId: string): Promise<PendingSessionDraft[]>;
  remove(bindingId: string, sessionId: string): Promise<void>;
  save(value: PendingSessionDraft): Promise<void>;
}

type DraftRow = PendingSessionDraft & { cacheId: string; updatedAt: number };

const DATABASE_NAME = 'dream-card-agent-session-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'pending-sessions';

function cacheId(bindingId: string, sessionId: string): string {
  return `${bindingId}:${sessionId}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB操作失败。')), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB事务已中止。')), {
      once: true,
    });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB事务失败。')), {
      once: true,
    });
  });
}

/** 上传失败时暂存在当前浏览器；连接恢复后由会话索引刷新自动重传。 */
export class IndexedDbSessionDraftCache implements SessionDraftCache {
  private database?: Promise<IDBDatabase>;

  async list(bindingId: string): Promise<PendingSessionDraft[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const rows = await requestResult(transaction.objectStore(STORE_NAME).getAll() as IDBRequest<DraftRow[]>);
    await transactionDone(transaction);
    return rows
      .filter(row => row.bindingId === bindingId)
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .map(({ cacheId: _cacheId, updatedAt: _updatedAt, ...row }) => klona(row));
  }

  async remove(bindingId: string, sessionId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(cacheId(bindingId, sessionId));
    await transactionDone(transaction);
  }

  async save(value: PendingSessionDraft): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      ...klona(value),
      cacheId: cacheId(value.bindingId, value.runtime.sessionId),
      updatedAt: Date.now(),
    } satisfies DraftRow);
    await transactionDone(transaction);
  }

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('当前环境不支持IndexedDB。'));
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener('upgradeneeded', () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'cacheId' });
        }
      });
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error ?? new Error('无法打开会话恢复缓存。')), { once: true });
    });
    return this.database;
  }
}

export class MemorySessionDraftCache implements SessionDraftCache {
  private readonly values = new Map<string, PendingSessionDraft>();

  async list(bindingId: string): Promise<PendingSessionDraft[]> {
    return [...this.values.values()].filter(value => value.bindingId === bindingId).map(value => klona(value));
  }

  async remove(bindingId: string, sessionId: string): Promise<void> {
    this.values.delete(cacheId(bindingId, sessionId));
  }

  async save(value: PendingSessionDraft): Promise<void> {
    this.values.set(cacheId(value.bindingId, value.runtime.sessionId), klona(value));
  }
}
