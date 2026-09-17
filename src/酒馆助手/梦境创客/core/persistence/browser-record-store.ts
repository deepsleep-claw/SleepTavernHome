import { boundedWait } from '../async';

export type BrowserRecordIndex<T> = { key: string; project: (value: T) => unknown };
export interface BrowserRecordStore {
  get<T>(key: string): Promise<T | undefined>;
  list<T>(prefix: string): Promise<Array<{ key: string; value: T }>>;
  put<T>(key: string, value: T): Promise<void>;
  update<T>(key: string, update: (value: T | undefined) => T | undefined, index?: BrowserRecordIndex<T>): Promise<void>;
}

function transactionResult<T>(tx: IDBTransaction, result: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        tx.abort();
      } catch {
        /* 已结束的事务无需再次中止。 */
      }
      reject(new Error('本地会话存储响应超时，请重试。'));
    }, 15_000);
    tx.oncomplete = () => {
      clearTimeout(timer);
      resolve(result());
    };
    tx.onabort = tx.onerror = () => {
      clearTimeout(timer);
      reject(tx.error ?? new Error('本地会话存储操作失败。'));
    };
  });
}

let accountNamespace: Promise<string> | undefined;
export function browserAccountNamespace(): Promise<string> {
  accountNamespace ??= (async () => {
    const url = new URL('/scripts/user.js', window.parent.location.href).href;
    const HostFunction = (window.parent as Window & typeof globalThis).Function;
    const importModule = HostFunction('url', 'return import(url)') as (
      url: string,
    ) => Promise<{ getCurrentUserHandle: () => string }>;
    const module = await boundedWait(importModule(url), '加载当前账户');
    return module.getCurrentUserHandle();
  })().catch(error => {
    accountNamespace = undefined;
    throw error;
  });
  return accountNamespace;
}

export class IndexedDbBrowserRecordStore implements BrowserRecordStore {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly namespace: () => Promise<string> = browserAccountNamespace) {}

  private open(): Promise<IDBDatabase> {
    this.database ??= this.namespace()
      .then(
        account =>
          new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(`dream-creator-local:${account}`, 1);
            let expired = false;
            const timer = setTimeout(() => {
              expired = true;
              reject(new Error('打开本地会话数据库超时，请重试。'));
            }, 15_000);
            request.onupgradeneeded = () => request.result.createObjectStore('records');
            request.onsuccess = () => {
              clearTimeout(timer);
              if (expired) {
                request.result.close();
                return;
              }
              request.result.onversionchange = () => {
                request.result.close();
                this.database = undefined;
              };
              resolve(request.result);
            };
            request.onerror = () => {
              clearTimeout(timer);
              reject(request.error ?? new Error('无法打开浏览器数据库。'));
            };
            request.onblocked = () => {
              clearTimeout(timer);
              expired = true;
              reject(new Error('浏览器数据库升级被其他页面占用，请关闭旧页面后重试。'));
            };
          }),
      )
      .catch(error => {
        this.database = undefined;
        throw error;
      });
    return this.database;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const database = await this.open();
    const tx = database.transaction('records', 'readonly');
    const request = tx.objectStore('records').get(key);
    return transactionResult(tx, () => request.result as T | undefined);
  }

  async list<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    const database = await this.open();
    const rows: Array<{ key: string; value: T }> = [];
    const tx = database.transaction('records', 'readonly');
    const cursor = tx.objectStore('records').openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (item) {
        rows.push({ key: String(item.key), value: item.value as T });
        item.continue();
      }
    };
    return transactionResult(tx, () => rows);
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.update<T>(key, () => value);
  }

  async update<T>(
    key: string,
    update: (value: T | undefined) => T | undefined,
    index?: BrowserRecordIndex<T>,
  ): Promise<void> {
    const database = await this.open();
    const tx = database.transaction('records', 'readwrite');
    let updateError: unknown;
    const store = tx.objectStore('records');
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const next = update(request.result as T | undefined);
        if (next === undefined) store.delete(key);
        else store.put(next, key);
        if (index) {
          if (next === undefined) store.delete(index.key);
          else store.put(index.project(next), index.key);
        }
      } catch (error) {
        tx.abort();
        updateError = error;
      }
    };
    return transactionResult(tx, () => undefined).catch(error => {
      throw updateError ?? error;
    });
  }
}

export class MemoryBrowserRecordStore implements BrowserRecordStore {
  private readonly records = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.records.get(key)) as T | undefined;
  }
  async list<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    return [...this.records]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: structuredClone(value) as T }));
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.records.set(key, structuredClone(value));
  }
  async update<T>(
    key: string,
    update: (value: T | undefined) => T | undefined,
    index?: BrowserRecordIndex<T>,
  ): Promise<void> {
    const next = update(structuredClone(this.records.get(key)) as T | undefined);
    if (next === undefined) this.records.delete(key);
    else this.records.set(key, structuredClone(next));
    if (index) {
      if (next === undefined) this.records.delete(index.key);
      else this.records.set(index.key, structuredClone(index.project(next)));
    }
  }
}
