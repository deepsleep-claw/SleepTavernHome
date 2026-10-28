import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbBrowserRecordStore } from './browser-record-store';
import type { PersistedSessionRuntime } from '../session/types';
import { joinSessionRuntime, splitSessionRuntime } from './session-parts';
import { IndexedDbSessionDraftCache } from './session-draft-cache';
import { IndexedDbOperationRecoveryStore } from '../operations/recovery-store';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function state() {
  return {
    version: 3,
    sessionId: 'one',
    title: '标题',
    updatedAt: 1,
    ui: Array.from({ length: 40 }, (_, index) => ({
      id: String(index),
      kind: 'user',
      at: index,
      content: `内容${index}`,
    })),
    events: [],
    modelMessages: [],
    operationLog: { version: 1, records: [], turns: [] },
  } as unknown as PersistedSessionRuntime;
}

describe('本机会话分段记录', () => {
  it('恢复日志与待备份缓存沿用已有版本 2 数据库', async () => {
    for (const [name, store, keyPath] of [
      ['dream-card-agent', 'operation-recovery', 'sessionId'],
      ['dream-card-agent-session-cache', 'pending-sessions', 'cacheId'],
    ])
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 2);
        request.onupgradeneeded = () => request.result.createObjectStore(store, { keyPath });
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    const recovery = new IndexedDbOperationRecoveryStore();
    await recovery.save('one', { version: 1, records: [], turns: [] });
    expect(await recovery.load('one')).toEqual({ version: 1, records: [], turns: [] });
    const cache = new IndexedDbSessionDraftCache();
    await cache.save({ bindingId: 'card', characterName: '测试', status: 'idle', runtime: state() });
    expect(await cache.list('card')).toHaveLength(1);
    expect((await indexedDB.databases()).map(database => database.version)).toEqual([2, 2]);
  });
  it('分段往返保留旧会话中的 URL、日期和正则类型', () => {
    const runtime = {
      ...state(),
      custom: { url: new URL('https://example.test/file'), date: new Date(123), pattern: /test/giu },
    };
    const split = splitSessionRuntime(runtime);
    expect(joinSessionRuntime(split.fields, split.parts)).toEqual(runtime);
  });
  it('长文本、表情跨分段和空数组完整往返', () => {
    const runtime = state();
    runtime.ui[0].content = 'x'.repeat(65_500) + '😀'.repeat(100_000);
    const parts = splitSessionRuntime(runtime);
    expect(Math.max(...[...parts.parts.values()].map(value => value.length))).toBeLessThanOrEqual(65_536);
    expect(joinSessionRuntime(parts.fields, parts.parts)).toEqual(runtime);
    const missing = new Map(parts.parts);
    missing.delete(missing.keys().next().value!);
    expect(() => joinSessionRuntime(parts.fields, missing)).toThrow('缺失');
  });
  it('只写变化的历史段，记录与列表索引在同一事务提交，冷读取可恢复', async () => {
    const store = new IndexedDbBrowserRecordStore(async () => 'parts');
    const runtime = state();
    const index = {
      key: 'session-index:one',
      project: (value: { input: { runtime: PersistedSessionRuntime } }) => value.input.runtime.title,
    };
    await store.update('session:one', () => ({ input: { runtime } }), index);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const changed = structuredClone(runtime);
    changed.ui.at(-1)!.content = '最新内容';
    await store.update('session:one', () => ({ input: { runtime: changed } }), index);
    const partWrites = put.mock.calls.filter(([, key]) => String(key).startsWith('session-part:'));
    expect(partWrites).toHaveLength(1);
    const cold = new IndexedDbBrowserRecordStore(async () => 'parts');
    expect(await cold.get('session:one')).toEqual({ input: { runtime: changed } });
    expect(await cold.get('session-index:one')).toBe('标题');
    expect(await cold.list('session:')).toHaveLength(1);
    expect((await cold.list('session-part:')).length).toBeGreaterThan(1);
  });
  it('索引写入异常回滚正文和分段，删除会话同时移除分段', async () => {
    const store = new IndexedDbBrowserRecordStore(async () => 'atomic');
    await store.put('session:one', { input: { runtime: state() } });
    const changed = state();
    changed.title = '未提交';
    await expect(
      store.update('session:one', () => ({ input: { runtime: changed } }), {
        key: 'session-index:one',
        project: () => {
          throw new Error('index failed');
        },
      }),
    ).rejects.toThrow('index failed');
    expect(await store.get('session:one')).toMatchObject({ input: { runtime: { title: '标题' } } });
    await store.update('session:one', () => undefined);
    expect(await store.list('session-part:')).toEqual([]);
  });
  it.each([1, 2, 5])('沿用已有数据库结构版本 %i，保留旧会话并支持创建新会话', async version => {
    const runtime = state();
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('dream-creator-local:legacy', version);
      open.onupgradeneeded = () => open.result.createObjectStore('records');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('records', 'readwrite');
        transaction.objectStore('records').put({ input: { runtime } }, 'session:one');
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    const store = new IndexedDbBrowserRecordStore(async () => 'legacy');
    expect(await store.get('session:one')).toEqual({ input: { runtime } });
    await store.put('session:one', { input: { runtime } });
    expect((await store.list('session-part:')).length).toBeGreaterThan(1);
    expect(await store.get('session:one')).toEqual({ input: { runtime } });
    await store.put('session:two', { input: { runtime: { ...runtime, sessionId: 'two' } } });
    expect(await store.list('session:')).toHaveLength(2);
    const info = await indexedDB.databases();
    expect(info.find(database => database.name === 'dream-creator-local:legacy')?.version).toBe(version);
  });
});
