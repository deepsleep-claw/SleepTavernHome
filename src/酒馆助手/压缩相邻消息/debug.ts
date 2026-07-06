export const SQUASH_DEBUG_GLOBAL_KEY = '__dream_whale_squash_debug_api__';

const STORAGE_KEY = 'dream-whale:squash-debug-records';
const MAX_RECORDS = 50;

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
  clearRecords: () => void;
  getRecords: () => SquashDebugRecord[];
  max_records: number;
  storage_key: string;
  subscribe: (callback: (records: SquashDebugRecord[]) => void) => { stop: () => void };
  version: 1;
};

const listeners = new Set<(records: SquashDebugRecord[]) => void>();
let records = readRecords();

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

function writeRecords() {
  try {
    getHostWindow().localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch (error) {
    console.warn('[压缩相邻消息] 保存 Debug 本地记录失败。', error);
  }
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
  const state_snapshot = cloneJson(state);
  records = [
    {
      id: getRecordId(),
      created_at: new Date().toISOString(),
      title,
      summary: getSummary(state_snapshot),
      state: state_snapshot,
    },
    ...records,
  ].slice(0, MAX_RECORDS);
  writeRecords();
  emitRecords();
}

export function initializeSquashDebugGlobal(): { destroy: () => void } {
  const host_window = getHostWindow() as Window & { [SQUASH_DEBUG_GLOBAL_KEY]?: SquashDebugApi };
  const api: SquashDebugApi = {
    clearRecords: () => {
      records = [];
      writeRecords();
      emitRecords();
    },
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
