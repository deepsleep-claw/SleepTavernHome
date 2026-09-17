import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTavern } from './test-helpers';

const database = vi.hoisted(() => ({
  records: new Map<string, any>(),
  contents: new Map<string, Record<string, string>>(),
}));
vi.mock('./debug_storage', () => ({
  SQUASH_DEBUG_DATABASE_NAME: 'debug-test',
  openIndexedDbDebugStorage: async () => ({
    loadRecords: async () => [...database.records.values()],
    getContent: async (id: string, key: string) => database.contents.get(id)?.[key],
    cleanup: async () => {},
    close: () => {},
    saveRecord: async (record: { id: string }, contents: Record<string, string>) => {
      database.records.set(record.id, structuredClone(record));
      database.contents.set(record.id, { ...database.contents.get(record.id), ...contents });
    },
    clear: async () => {
      database.records.clear();
      database.contents.clear();
    },
  }),
}));

describe('Debug usage 回填', () => {
  let destroy: (() => void) | undefined;
  let original: typeof fetch;
  beforeEach(() => {
    vi.resetModules();
    database.records.clear();
    database.contents.clear();
    original = window.parent.fetch;
  });
  afterEach(() => {
    destroy?.();
    destroy = undefined;
    window.parent.fetch = original;
  });

  it('回填原记录并持久化，同时保留正文缓存', async () => {
    const tavern = setupTavern();
    let resolve!: (response: Response) => void;
    window.parent.fetch = vi.fn(
      () =>
        new Promise<Response>(done => {
          resolve = done;
        }),
    );
    const module = await import('./debug');
    destroy = module.initializeSquashDebugGlobal().destroy;
    const api = (window.parent as any)[module.SQUASH_DEBUG_GLOBAL_KEY];
    await api.ready;
    const messages = [{ role: 'user' as const, content: '正文' }];
    module.publishSquashDebugRecord('请求甲', { total_rows: [{ 详细内容: '完整正文😀' }] }, undefined, messages);
    const first = api.getRecords()[0];
    const bodyKey = first.state.total_rows[0].详细内容缓存键;
    const payload = { messages, model: 'model', proxy_password: 'sensitive-placeholder' };
    tavern.emit('CHAT_COMPLETION_SETTINGS_READY', payload);
    const request = window.parent.fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    module.publishSquashDebugRecord('请求乙', { total_rows: [{ 详细内容: '其他正文' }] });
    resolve(new Response(JSON.stringify({ id: 'response-a', usage: { prompt_tokens: 100, cached_tokens: 70 } })));
    await request;
    await vi.waitFor(() =>
      expect(api.getRecords().find((record: any) => record.id === first.id)?.token_usage?.cached_input_tokens).toBe(70),
    );
    expect(api.getRecords().find((record: any) => record.title === '请求乙').token_usage).toBeUndefined();
    await vi.waitFor(() => expect(database.records.get(first.id)?.token_usage?.cached_input_tokens).toBe(70));
    expect(await api.getContent(first.id, bodyKey)).toBe('完整正文😀');
    expect(first.state.total_rows[0].详细内容字数).toBe(5);
    expect(JSON.stringify([...database.records.values()])).not.toContain('sensitive-placeholder');
  });

  it('记录清空后迟到统计不会使其重新出现', async () => {
    const tavern = setupTavern();
    let resolve!: (response: Response) => void;
    window.parent.fetch = vi.fn(
      () =>
        new Promise<Response>(done => {
          resolve = done;
        }),
    );
    const module = await import('./debug');
    destroy = module.initializeSquashDebugGlobal().destroy;
    const api = (window.parent as any)[module.SQUASH_DEBUG_GLOBAL_KEY];
    await api.ready;
    const messages = [{ role: 'user' as const, content: '正文' }];
    module.publishSquashDebugRecord('请求', { total_rows: [{ 详细内容: '正文' }] }, undefined, messages);
    const payload = { messages };
    tavern.emit('CHAT_COMPLETION_SETTINGS_READY', payload);
    const request = window.parent.fetch('/api/backends/chat-completions/generate', { body: JSON.stringify(payload) });
    await api.clearRecords();
    resolve(new Response(JSON.stringify({ usage: { prompt_tokens: 100, cached_tokens: 70 } })));
    await request;
    await vi.waitFor(() => expect(database.records.size).toBe(0));
    expect(api.getRecords()).toEqual([]);
  });

  it('在设置就绪阶段发布的最终记录可直接关联本次请求统计', async () => {
    const tavern = setupTavern();
    window.parent.fetch = vi.fn(
      async () => new Response(JSON.stringify({ usage: { prompt_tokens: 80, cached_tokens: 60 } })),
    );
    const module = await import('./debug');
    destroy = module.initializeSquashDebugGlobal().destroy;
    const api = (window.parent as any)[module.SQUASH_DEBUG_GLOBAL_KEY];
    await api.ready;
    const payload = { messages: [{ role: 'user' as const, content: '最终正文' }], model: 'model' };
    tavern.emit('CHAT_COMPLETION_SETTINGS_READY', payload);
    module.publishSquashDebugRecord(
      '最终请求',
      { total_rows: [{ 详细内容: '最终正文' }] },
      undefined,
      payload.messages,
      payload,
    );
    await window.parent.fetch('/api/backends/chat-completions/generate', { body: JSON.stringify(payload) });
    await vi.waitFor(() => expect(api.getRecords()[0].token_usage?.cached_input_tokens).toBe(60));
  });
});
