import { klona } from 'klona';
import type { PersistedOperationLog } from './types';

export interface OperationRecoveryStore {
  load(sessionId: string): Promise<PersistedOperationLog | undefined>;
  remove(sessionId: string): Promise<void>;
  save(sessionId: string, value: PersistedOperationLog): Promise<void>;
}

type RecoveryRow = {
  log: PersistedOperationLog;
  sessionId: string;
  updatedAt: number;
};

const DATABASE_NAME = 'dream-card-agent';
const DATABASE_VERSION = 1;
const STORE_NAME = 'operation-recovery';

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

/** 浏览器本地的逐操作恢复日志。它不是写入真实资源的前置条件。 */
export class IndexedDbOperationRecoveryStore implements OperationRecoveryStore {
  private database?: Promise<IDBDatabase>;

  async load(sessionId: string): Promise<PersistedOperationLog | undefined> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const row = await requestResult(transaction.objectStore(STORE_NAME).get(sessionId) as IDBRequest<RecoveryRow | undefined>);
    await transactionDone(transaction);
    return row ? klona(row.log) : undefined;
  }

  async remove(sessionId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(sessionId);
    await transactionDone(transaction);
  }

  async save(sessionId: string, value: PersistedOperationLog): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ log: klona(value), sessionId, updatedAt: Date.now() } satisfies RecoveryRow);
    await transactionDone(transaction);
  }

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('当前环境不支持IndexedDB。'));
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener(
        'upgradeneeded',
        () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
        },
        { once: true },
      );
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error ?? new Error('无法打开IndexedDB。')), { once: true });
    });
    return this.database;
  }
}

/** 某一轮首次写入失败后停止重试，真实文件操作继续执行，但该轮标记为不可恢复。 */
export class OperationRecoveryCoordinator {
  private readonly disabledTurns = new Set<string>();

  constructor(private readonly store?: OperationRecoveryStore) {}

  async persist(sessionId: string, turnId: string, log: PersistedOperationLog): Promise<boolean> {
    if (!this.store) return true;
    if (this.disabledTurns.has(turnId)) return false;
    try {
      await this.store.save(sessionId, log);
      return true;
    } catch {
      this.disabledTurns.add(turnId);
      return false;
    }
  }

  isAvailable(turnId: string): boolean {
    return !this.store || !this.disabledTurns.has(turnId);
  }
}

export class MemoryOperationRecoveryStore implements OperationRecoveryStore {
  private readonly values = new Map<string, PersistedOperationLog>();
  async load(sessionId: string) { const value = this.values.get(sessionId); return value ? klona(value) : undefined; }
  async remove(sessionId: string) { this.values.delete(sessionId); }
  async save(sessionId: string, value: PersistedOperationLog) { this.values.set(sessionId, klona(value)); }
}
