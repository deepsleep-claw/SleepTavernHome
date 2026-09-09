export type BrowserRecordIndex<T> = { key: string; project: (value: T) => unknown };
export interface BrowserRecordStore {
  get<T>(key: string): Promise<T | undefined>;
  list<T>(prefix: string): Promise<Array<{ key: string; value: T }>>;
  put<T>(key: string, value: T): Promise<void>;
  update<T>(key: string, update: (value: T | undefined) => T | undefined, index?: BrowserRecordIndex<T>): Promise<void>;
}

let accountNamespace: Promise<string> | undefined;
export function browserAccountNamespace(): Promise<string> {
  accountNamespace ??= (async () => {
    const url = new URL('/scripts/user.js', window.parent.location.href).href;
    const HostFunction = (window.parent as Window & typeof globalThis).Function;
    const importModule = HostFunction('url', 'return import(url)') as (
      url: string,
    ) => Promise<{ getCurrentUserHandle: () => string }>;
    const module = await importModule(url);
    return module.getCurrentUserHandle();
  })();
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
            request.onupgradeneeded = () => request.result.createObjectStore('records');
            request.onsuccess = () => {
              request.result.onversionchange = () => {
                request.result.close();
                this.database = undefined;
              };
              resolve(request.result);
            };
            request.onerror = () => reject(request.error ?? new Error('无法打开浏览器数据库。'));
            request.onblocked = () => reject(new Error('浏览器数据库升级被其他页面占用，请关闭旧页面后重试。'));
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
    return new Promise((resolve, reject) => {
      const tx = database.transaction('records', 'readonly');
      const request = tx.objectStore('records').get(key);
      tx.oncomplete = () => resolve(request.result as T | undefined);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('读取本地数据失败。'));
    });
  }

  async list<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
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
      tx.oncomplete = () => resolve(rows);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('读取本地索引失败。'));
    });
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
    return new Promise((resolve, reject) => {
      const tx = database.transaction('records', 'readwrite');
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
          reject(error);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('本地保存失败，请检查浏览器存储空间。'));
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
