export const SQUASH_DEBUG_GLOBAL_KEY = '__dream_whale_squash_debug_api__';

const STORAGE_KEY = 'dream-whale:squash-debug-records';
const CONTENT_STORAGE_KEY = 'dream-whale:squash-debug-contents';
const MAX_RECORDS = 50;
const CONTENT_PREVIEW_LENGTH = 120;

type DebugState = Record<string, any>;
type DebugContentStore = Record<string, Record<string, string>>;

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
  clearRecords: () => void;
  getContent: (record_id: string, content_id: string) => string | undefined;
  getRecords: () => SquashDebugRecord[];
  max_records: number;
  storage_key: string;
  subscribe: (callback: (records: SquashDebugRecord[]) => void) => { stop: () => void };
  version: 1;
};

const listeners = new Set<(records: SquashDebugRecord[]) => void>();
let records = readRecords();
let content_store = readContentStore();

function getHostWindow(): Window {
  return window.parent ?? window;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readRecords(): SquashDebugRecord[] {
  try {
    const raw = getHostWindow().localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECORDS) : [];
  } catch (error) {
    console.warn('[压缩相邻消息] 读取 Debug 本地记录失败。', error);
    return [];
  }
}

function readContentStore(): DebugContentStore {
  try {
    const raw = getHostWindow().localStorage.getItem(CONTENT_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return _.isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    console.warn('[压缩相邻消息] 读取 Debug 正文缓存失败。', error);
    return {};
  }
}

function writeRecords() {
  try {
    getHostWindow().localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch (error) {
    console.warn('[压缩相邻消息] 保存 Debug 本地记录失败。', error);
  }
}

function writeContentStore() {
  try {
    getHostWindow().localStorage.setItem(CONTENT_STORAGE_KEY, JSON.stringify(content_store));
  } catch (error) {
    console.warn('[压缩相邻消息] 保存 Debug 正文缓存失败。', error);
  }
}

function pruneContentStore() {
  const record_ids = new Set(records.map(record => record.id));
  Object.keys(content_store).forEach(record_id => {
    if (!record_ids.has(record_id)) {
      delete content_store[record_id];
    }
  });
}

function emitRecords() {
  const snapshot = getRecords();
  listeners.forEach(listener => listener(snapshot));
}

function getRecords(): SquashDebugRecord[] {
  return cloneJson(records);
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
  const id = getRecordId();
  const { state: state_snapshot, contents } = createSanitizedDebugState(state);
  records = [
    {
      id,
      created_at: new Date().toISOString(),
      title,
      summary: getSummary(state_snapshot),
      state: state_snapshot,
    },
    ...records,
  ].slice(0, MAX_RECORDS);
  if (Object.keys(contents).length > 0) {
    content_store[id] = contents;
  }
  pruneContentStore();
  writeRecords();
  writeContentStore();
  emitRecords();
}

export function initializeSquashDebugGlobal(): { destroy: () => void } {
  const host_window = getHostWindow() as Window & { [SQUASH_DEBUG_GLOBAL_KEY]?: SquashDebugApi };
  const api: SquashDebugApi = {
    clearRecords: () => {
      records = [];
      content_store = {};
      writeRecords();
      writeContentStore();
      emitRecords();
    },
    getContent: (record_id, content_id) => content_store[record_id]?.[content_id],
    getRecords,
    max_records: MAX_RECORDS,
    storage_key: STORAGE_KEY,
    subscribe: callback => {
      listeners.add(callback);
      callback(getRecords());
      return {
        stop: () => {
          listeners.delete(callback);
        },
      };
    },
    version: 1,
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
