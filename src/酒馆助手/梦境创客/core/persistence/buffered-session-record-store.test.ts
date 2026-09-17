import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryBrowserRecordStore } from './browser-record-store';
import { BufferedSessionRecordStore } from './buffered-session-record-store';

afterEach(() => vi.useRealTimers());

describe('会话延迟落盘', () => {
  it('检测其他页面的同版本写入冲突并保留待保存内容', async () => {
    vi.useFakeTimers();
    const base = new MemoryBrowserRecordStore();
    const store = new BufferedSessionRecordStore(base);
    await store.put('session:one', { entry: { revision: 2 }, input: '本页' });
    await base.put('session:one', { entry: { revision: 2 }, input: '其他页' });
    await expect(store.flush()).rejects.toThrow('其他页面');
    expect(await base.get('session:one')).toMatchObject({ input: '其他页' });
    expect(await store.get('session:one')).toMatchObject({ input: '本页' });
    store.dispose();
  });
  it('连续更新重置三秒计时，正文与索引只写最新版本', async () => {
    vi.useFakeTimers();
    const base = new MemoryBrowserRecordStore();
    const writes = vi.spyOn(base, 'update');
    const store = new BufferedSessionRecordStore(base);
    const index = { key: 'session-index:one', project: (value: { count: number }) => value.count };
    await store.update('session:one', () => ({ count: 1 }), index);
    await vi.advanceTimersByTimeAsync(2500);
    await store.update<{ count: number }>('session:one', value => ({ count: value!.count + 1 }), index);
    await vi.advanceTimersByTimeAsync(2999);
    expect(writes).not.toHaveBeenCalled();
    expect(await store.get('session:one')).toEqual({ count: 2 });
    expect(await store.get('session-index:one')).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(await base.get('session:one')).toEqual({ count: 2 });
    expect(await base.get('session-index:one')).toBe(2);
    store.dispose();
  });

  it('提交期间到达的新版本不会被旧提交清掉', async () => {
    vi.useFakeTimers();
    const base = new MemoryBrowserRecordStore();
    const store = new BufferedSessionRecordStore(base);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const update = base.update.bind(base);
    vi.spyOn(base, 'update').mockImplementationOnce(async (...args) => {
      await gate;
      return update(...args);
    });
    await store.put('session:one', 1);
    const saving = store.flush();
    await Promise.resolve();
    await store.put('session:one', 2);
    release();
    await saving;
    expect(await store.get('session:one')).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await base.get('session:one')).toBe(2);
    store.dispose();
  });

  it('页面离开前同步保留待写批次，刷新后能读到正文与索引', async () => {
    vi.useFakeTimers();
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };
    const base = new MemoryBrowserRecordStore();
    vi.spyOn(base, 'update').mockImplementation(() => new Promise(() => {}));
    const recovery = { storage, key: async () => 'account-A' };
    const first = new BufferedSessionRecordStore(base, recovery);
    await first.update('session:one', () => ({ message: '最新内容' }), {
      key: 'session-index:one',
      project: () => ({ title: '会话' }),
    });
    first.dispose();
    const next = new BufferedSessionRecordStore(new MemoryBrowserRecordStore(), recovery);
    expect(await next.get('session:one')).toEqual({ message: '最新内容' });
    expect(await next.list('session-index:')).toEqual([{ key: 'session-index:one', value: { title: '会话' } }]);
    await next.flush();
    next.dispose();
  });
});
