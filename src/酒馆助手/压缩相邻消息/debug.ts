import {
  type DebugContentStore,
  IndexedDbDebugStorage,
  openIndexedDbDebugStorage,
  SQUASH_DEBUG_DATABASE_NAME,
} from './debug_storage';

export const SQUASH_DEBUG_GLOBAL_KEY = '__dream_whale_squash_debug_api__';

const LEGACY_STORAGE_KEY = 'dream-whale:squash-debug-records';
const LEGACY_CONTENT_STORAGE_KEY = 'dream-whale:squash-debug-contents';
const MAX_RECORDS = 50;
const CONTENT_PREVIEW_LENGTH = 120;

type DebugState = Record<string, any>;

export type SquashDebugRecord = {
  id: string;
  created_at: string;
  title: string;
  summary: {
    error_count: number;
    failed: number;
    green_cache_insertions: number;
    loaded_total: number;
    total_rows: number;
    triggered_rows: number;
    wrapper_orphan: number;
    wrapper_paired: number;
  };
  state: DebugState;
};

export type SquashDebugApi = {
  clearRecords: () => Promise<void>;
  database_name: string;
  getContent: (record_id: string, content_id: string) => Promise<string | undefined>;
  getRecords: () => SquashDebugRecord[];
  max_records: number;
  ready: Promise<void>;
  subscribe: (callback: (records: SquashDebugRecord[]) => void) => { stop: () => void };
  version: 2;
};

type LegacyDebugData = {
  contents: DebugContentStore;
  has_data: boolean;
  records: SquashDebugRecord[];
};

const listeners = new Set<(records: SquashDebugRecord[]) => void>();
const session_content_store = new Map<string, Record<string, string>>();
let records: SquashDebugRecord[] = [];
let storage: IndexedDbDebugStorage<SquashDebugRecord> | undefined;
let storage_initialization_started = false;
let storage_ready: Promise<void> = Promise.resolve();
let storage_queue: Promise<void> = Promise.resolve();
let storage_warning_emitted = false;

function getHostWindow(): Window {
  return window.parent ?? window;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getRecordTimestamp(record: SquashDebugRecord): number {
  const timestamp = Date.parse(record.created_at);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortAndLimitRecords(values: SquashDebugRecord[]): SquashDebugRecord[] {
  return values
    .sort((left, right) => getRecordTimestamp(right) - getRecordTimestamp(left) || right.id.localeCompare(left.id))
    .slice(0, MAX_RECORDS);
}

function isSquashDebugRecord(value: unknown): value is SquashDebugRecord {
  return (
    _.isPlainObject(value) &&
    typeof (value as SquashDebugRecord).id === 'string' &&
    typeof (value as SquashDebugRecord).created_at === 'string' &&
    typeof (value as SquashDebugRecord).title === 'string' &&
    _.isPlainObject((value as SquashDebugRecord).summary) &&
    _.isPlainObject((value as SquashDebugRecord).state)
  );
}

function readLegacyDebugData(): LegacyDebugData {
  let records_raw: string | null;
  let contents_raw: string | null;
  try {
    const local_storage = getHostWindow().localStorage;
    records_raw = local_storage.getItem(LEGACY_STORAGE_KEY);
    contents_raw = local_storage.getItem(LEGACY_CONTENT_STORAGE_KEY);
  } catch (error) {
    console.warn('[压缩相邻消息] 无法读取旧版 Debug 数据，将跳过迁移。', error);
    return { contents: {}, has_data: false, records: [] };
  }

  let legacy_records: SquashDebugRecord[] = [];
  if (records_raw) {
    try {
      const parsed = JSON.parse(records_raw) as unknown;
      legacy_records = Array.isArray(parsed) ? parsed.filter(isSquashDebugRecord) : [];
    } catch (error) {
      console.warn('[压缩相邻消息] 旧版 Debug 记录格式无效，将忽略记录列表。', error);
    }
  }

  const legacy_contents: DebugContentStore = {};
  if (contents_raw) {
    try {
      const parsed = JSON.parse(contents_raw) as unknown;
      if (_.isPlainObject(parsed)) {
        Object.entries(parsed as Record<string, unknown>).forEach(([record_id, value]) => {
          if (!_.isPlainObject(value)) {
            return;
          }
          const record_contents = Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          );
          if (Object.keys(record_contents).length > 0) {
            legacy_contents[record_id] = record_contents;
          }
        });
      }
    } catch (error) {
      console.warn('[压缩相邻消息] 旧版 Debug 正文格式无效，将忽略正文缓存。', error);
    }
  }

  return {
    contents: legacy_contents,
    has_data: records_raw !== null || contents_raw !== null,
    records: legacy_records,
  };
}

function removeLegacyDebugData() {
  try {
    const local_storage = getHostWindow().localStorage;
    local_storage.removeItem(LEGACY_STORAGE_KEY);
    local_storage.removeItem(LEGACY_CONTENT_STORAGE_KEY);
  } catch (error) {
    console.warn('[压缩相邻消息] 清理旧版 Debug 数据失败。', error);
  }
}

function fallBackToMemory(error: unknown) {
  storage?.close();
  storage = undefined;
  if (!storage_warning_emitted) {
    storage_warning_emitted = true;
    console.warn('[压缩相邻消息] IndexedDB 不可用，Debug 将仅保留在当前会话内存中。', error);
  }
}

function emitRecords() {
  const snapshot = getRecords();
  listeners.forEach(listener => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[压缩相邻消息] 推送 Debug 记录给订阅者失败。', error);
    }
  });
}

function getRecords(): SquashDebugRecord[] {
  return cloneJson(records);
}

function pruneSessionContents() {
  const retained_ids = new Set(records.map(record => record.id));
  session_content_store.forEach((_contents, record_id) => {
    if (!retained_ids.has(record_id)) {
      session_content_store.delete(record_id);
    }
  });
}

async function initializeStorage(): Promise<void> {
  try {
    const backend = await openIndexedDbDebugStorage<SquashDebugRecord>(getHostWindow());
    storage = backend;
    const legacy = readLegacyDebugData();
    if (legacy.has_data) {
      await backend.importLegacy(legacy.records, legacy.contents, MAX_RECORDS);
      removeLegacyDebugData();
    } else {
      await backend.cleanup(MAX_RECORDS);
    }

    const stored_records = await backend.loadRecords(MAX_RECORDS);
    const merged_records = new Map(stored_records.map(record => [record.id, record]));
    records.forEach(record => merged_records.set(record.id, record));
    records = sortAndLimitRecords([...merged_records.values()]);
    pruneSessionContents();
    emitRecords();
  } catch (error) {
    fallBackToMemory(error);
  }
}

function ensureStorageInitialized(): Promise<void> {
  if (!storage_initialization_started) {
    storage_initialization_started = true;
    storage_ready = initializeStorage();
  }
  return storage_ready;
}

function enqueueStorage(
  operation: (backend: IndexedDbDebugStorage<SquashDebugRecord>) => Promise<void>,
): Promise<void> {
  storage_queue = storage_queue.then(async () => {
    await ensureStorageInitialized();
    const backend = storage;
    if (!backend) {
      return;
    }
    try {
      await operation(backend);
    } catch (error) {
      fallBackToMemory(error);
    }
  });
  return storage_queue;
}

function getRecordId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getContentPreview(content: string): string {
  if (content.length <= CONTENT_PREVIEW_LENGTH * 2) {
    return content;
  }
  return `${content.slice(0, CONTENT_PREVIEW_LENGTH)}\n...省略 ${content.length - CONTENT_PREVIEW_LENGTH * 2} 字...\n${content.slice(-CONTENT_PREVIEW_LENGTH)}`;
}

function getContentHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeDebugValue(value: any, contents: Record<string, string>, nextContentId: () => string): any {
  if (_.isArray(value)) {
    return value.map(item => sanitizeDebugValue(item, contents, nextContentId));
  }
  if (!_.isPlainObject(value)) {
    return value;
  }

  const result: Record<string, any> = {};
  Object.entries(value).forEach(([key, item]) => {
    if (key === '详细内容' && typeof item === 'string') {
      const content_id = nextContentId();
      const preview = getContentPreview(item);
      contents[content_id] = item;
      result[key] = preview;
      result['详细内容摘要'] = preview;
      result['详细内容长度'] = item.length;
      result['详细内容hash'] = getContentHash(item);
      result['详细内容缓存键'] = content_id;
      return;
    }
    result[key] = sanitizeDebugValue(item, contents, nextContentId);
  });
  return result;
}

function createSanitizedDebugState(state: DebugState): { state: DebugState; contents: Record<string, string> } {
  const contents: Record<string, string> = {};
  let content_index = 0;
  const nextContentId = () => `c${content_index++}`;
  return {
    state: sanitizeDebugValue(state, contents, nextContentId),
    contents,
  };
}

function getSummary(state: DebugState): SquashDebugRecord['summary'] {
  return {
    error_count: state.error_logs?.length ?? 0,
    failed: Math.max(0, (state.total_extraction ?? 0) - (state.total_consumed ?? 0)),
    green_cache_insertions: state.green_cache?.insertions?.length ?? 0,
    loaded_total: state.loaded?.total ?? 0,
    total_rows: state.total_rows?.length ?? 0,
    triggered_rows: state.triggered_rows?.length ?? 0,
    wrapper_orphan: state.wrapper_before_unwrap?.orphan ?? 0,
    wrapper_paired: state.wrapper_before_unwrap?.paired ?? 0,
  };
}

export function publishSquashDebugRecord(title: string, state: DebugState) {
  void ensureStorageInitialized();
  const id = getRecordId();
  const { state: state_snapshot, contents } = createSanitizedDebugState(state);
  const record: SquashDebugRecord = {
    id,
    created_at: new Date().toISOString(),
    title,
    summary: getSummary(state_snapshot),
    state: state_snapshot,
  };
  records = sortAndLimitRecords([record, ...records]);
  if (Object.keys(contents).length > 0) {
    session_content_store.set(id, contents);
  }
  pruneSessionContents();
  emitRecords();

  void enqueueStorage(async backend => {
    await backend.saveRecord(record, contents, MAX_RECORDS);
    if (session_content_store.get(id) === contents) {
      session_content_store.delete(id);
    }
  });
}

async function getContent(record_id: string, content_id: string): Promise<string | undefined> {
  const session_contents = session_content_store.get(record_id);
  if (session_contents && Object.hasOwn(session_contents, content_id)) {
    return session_contents[content_id];
  }

  await ensureStorageInitialized();
  const backend = storage;
  if (!backend) {
    return undefined;
  }
  try {
    return await backend.getContent(record_id, content_id);
  } catch (error) {
    fallBackToMemory(error);
    return undefined;
  }
}

async function clearRecords(): Promise<void> {
  records = [];
  session_content_store.clear();
  emitRecords();
  await enqueueStorage(backend => backend.clear());
  removeLegacyDebugData();
}

export function initializeSquashDebugGlobal(): { destroy: () => void } {
  const host_window = getHostWindow() as Window & { [SQUASH_DEBUG_GLOBAL_KEY]?: SquashDebugApi };
  const api: SquashDebugApi = {
    clearRecords,
    database_name: SQUASH_DEBUG_DATABASE_NAME,
    getContent,
    getRecords,
    max_records: MAX_RECORDS,
    ready: ensureStorageInitialized(),
    subscribe: callback => {
      listeners.add(callback);
      callback(getRecords());
      return {
        stop: () => {
          listeners.delete(callback);
        },
      };
    },
    version: 2,
  };

  host_window[SQUASH_DEBUG_GLOBAL_KEY] = api;
  return {
    destroy: () => {
      listeners.clear();
      if (host_window[SQUASH_DEBUG_GLOBAL_KEY] === api) {
        delete host_window[SQUASH_DEBUG_GLOBAL_KEY];
      }
    },
  };
}
