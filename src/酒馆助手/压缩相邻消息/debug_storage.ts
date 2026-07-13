export const SQUASH_DEBUG_DATABASE_NAME = 'dream-whale:squash-debug';

const DATABASE_VERSION = 1;
const RECORDS_STORE_NAME = 'records';
const CONTENTS_STORE_NAME = 'contents';
const CONTENT_RECORD_ID_INDEX = 'record_id';

export type PersistedDebugRecord = {
  created_at: string;
  id: string;
};

export type DebugContentStore = Record<string, Record<string, string>>;

type DebugContentRow = {
  content: string;
  content_id: string;
  record_id: string;
};

function createStorageError(message: string, cause?: unknown): Error {
  const error = new Error(message);
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? createStorageError('IndexedDB 请求失败。'));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? createStorageError('IndexedDB 事务已中止。'));
    transaction.onerror = () => reject(transaction.error ?? createStorageError('IndexedDB 事务失败。'));
  });
}

function getCreatedAtTimestamp(record: PersistedDebugRecord): number {
  const timestamp = Date.parse(record.created_at);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortNewestFirst<T extends PersistedDebugRecord>(records: T[]): T[] {
  return records.sort(
    (left, right) => getCreatedAtTimestamp(right) - getCreatedAtTimestamp(left) || right.id.localeCompare(left.id),
  );
}

function deleteContentsForRecord(contents_store: IDBObjectStore, record_id: string) {
  const cursor_request = contents_store.index(CONTENT_RECORD_ID_INDEX).openCursor(record_id);
  cursor_request.onsuccess = () => {
    const cursor = cursor_request.result;
    if (!cursor) {
      return;
    }
    cursor.delete();
    cursor.continue();
  };
}

function scheduleRecordPrune<T extends PersistedDebugRecord>(
  records_store: IDBObjectStore,
  contents_store: IDBObjectStore,
  max_records: number,
  clean_orphan_contents: boolean,
) {
  const records_request = records_store.getAll();
  records_request.onsuccess = () => {
    const all_records = sortNewestFirst(records_request.result as T[]);
    const retained_ids = new Set(all_records.slice(0, max_records).map(record => record.id));
    all_records.forEach(record => {
      if (!retained_ids.has(record.id)) {
        records_store.delete(record.id);
        if (!clean_orphan_contents) {
          deleteContentsForRecord(contents_store, record.id);
        }
      }
    });

    if (!clean_orphan_contents) {
      return;
    }
    const contents_request = contents_store.openCursor();
    contents_request.onsuccess = () => {
      const cursor = contents_request.result;
      if (!cursor) {
        return;
      }
      const row = cursor.value as DebugContentRow;
      if (!retained_ids.has(row.record_id)) {
        cursor.delete();
      }
      cursor.continue();
    };
  };
}

export class IndexedDbDebugStorage<T extends PersistedDebugRecord> {
  private readonly database: IDBDatabase;

  constructor(database: IDBDatabase) {
    this.database = database;
  }

  close() {
    this.database.close();
  }

  async loadRecords(max_records: number): Promise<T[]> {
    const transaction = this.database.transaction(RECORDS_STORE_NAME, 'readonly');
    const stored_records = (await requestResult(transaction.objectStore(RECORDS_STORE_NAME).getAll())) as T[];
    return sortNewestFirst(stored_records).slice(0, max_records);
  }

  async getContent(record_id: string, content_id: string): Promise<string | undefined> {
    const transaction = this.database.transaction(CONTENTS_STORE_NAME, 'readonly');
    const row = (await requestResult(transaction.objectStore(CONTENTS_STORE_NAME).get([record_id, content_id]))) as
      | DebugContentRow
      | undefined;
    return typeof row?.content === 'string' ? row.content : undefined;
  }

  async saveRecord(record: T, contents: Record<string, string>, max_records: number): Promise<void> {
    const transaction = this.database.transaction([RECORDS_STORE_NAME, CONTENTS_STORE_NAME], 'readwrite');
    const completion = transactionCompletion(transaction);
    const records_store = transaction.objectStore(RECORDS_STORE_NAME);
    const contents_store = transaction.objectStore(CONTENTS_STORE_NAME);
    records_store.put(record);
    Object.entries(contents).forEach(([content_id, content]) => {
      contents_store.put({ content, content_id, record_id: record.id } satisfies DebugContentRow);
    });
    scheduleRecordPrune<T>(records_store, contents_store, max_records, false);
    await completion;
  }

  async importLegacy(records: T[], contents: DebugContentStore, max_records: number): Promise<void> {
    const transaction = this.database.transaction([RECORDS_STORE_NAME, CONTENTS_STORE_NAME], 'readwrite');
    const completion = transactionCompletion(transaction);
    const records_store = transaction.objectStore(RECORDS_STORE_NAME);
    const contents_store = transaction.objectStore(CONTENTS_STORE_NAME);
    records.forEach(record => records_store.put(record));
    Object.entries(contents).forEach(([record_id, record_contents]) => {
      Object.entries(record_contents).forEach(([content_id, content]) => {
        if (typeof content === 'string') {
          contents_store.put({ content, content_id, record_id } satisfies DebugContentRow);
        }
      });
    });
    scheduleRecordPrune<T>(records_store, contents_store, max_records, true);
    await completion;
  }

  async cleanup(max_records: number): Promise<void> {
    const transaction = this.database.transaction([RECORDS_STORE_NAME, CONTENTS_STORE_NAME], 'readwrite');
    const completion = transactionCompletion(transaction);
    scheduleRecordPrune<T>(
      transaction.objectStore(RECORDS_STORE_NAME),
      transaction.objectStore(CONTENTS_STORE_NAME),
      max_records,
      true,
    );
    await completion;
  }

  async clear(): Promise<void> {
    const transaction = this.database.transaction([RECORDS_STORE_NAME, CONTENTS_STORE_NAME], 'readwrite');
    const completion = transactionCompletion(transaction);
    transaction.objectStore(RECORDS_STORE_NAME).clear();
    transaction.objectStore(CONTENTS_STORE_NAME).clear();
    await completion;
  }
}

export function openIndexedDbDebugStorage<T extends PersistedDebugRecord>(
  host_window: Window,
): Promise<IndexedDbDebugStorage<T>> {
  return new Promise((resolve, reject) => {
    if (!host_window.indexedDB) {
      reject(createStorageError('当前 WebView 不支持 IndexedDB。'));
      return;
    }

    const request = host_window.indexedDB.open(SQUASH_DEBUG_DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORDS_STORE_NAME)) {
        database.createObjectStore(RECORDS_STORE_NAME, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(CONTENTS_STORE_NAME)) {
        const contents_store = database.createObjectStore(CONTENTS_STORE_NAME, {
          keyPath: ['record_id', 'content_id'],
        });
        contents_store.createIndex(CONTENT_RECORD_ID_INDEX, 'record_id');
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(new IndexedDbDebugStorage<T>(request.result));
    };
    request.onerror = () => reject(request.error ?? createStorageError('打开 IndexedDB 失败。'));
    request.onblocked = () => {
      blocked = true;
      reject(createStorageError('打开 IndexedDB 被旧连接阻塞。'));
    };
  });
}
