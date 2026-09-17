import { describe, expect, it, vi } from 'vitest';
import { createTokenUsageMonitor } from './usage_monitor';

const endpoint = '/api/backends/chat-completions/generate';
const payload = (text: string) => ({ messages: [{ role: 'user', content: text }], model: 'model', stream: true });
const response = (cached: number) =>
  new Response(JSON.stringify({ usage: { prompt_tokens: 100, cached_tokens: cached } }));

describe('请求级 usage 采集', () => {
  it('响应逆序完成也回填各自记录，原始请求和响应保持可用', async () => {
    const resolvers: ((response: Response) => void)[] = [];
    const delegate = vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve)));
    const host = { fetch: delegate as typeof fetch, location: { href: 'http://localhost:8000/' } };
    const received = vi.fn();
    const monitor = createTokenUsageMonitor(host, received);
    const a = payload('甲');
    const b = payload('乙');
    monitor.register('a', a.messages);
    monitor.prepare(a);
    const initA = { method: 'POST', body: JSON.stringify(a) };
    const fetchA = host.fetch(endpoint, initA);
    monitor.register('b', b.messages);
    monitor.prepare(b);
    const fetchB = host.fetch(endpoint, { method: 'POST', body: JSON.stringify(b) });
    const responseB = response(20);
    const responseA = response(60);
    resolvers[1](responseB);
    expect(await fetchB).toBe(responseB);
    resolvers[0](responseA);
    expect(await fetchA).toBe(responseA);
    expect(await responseA.json()).toMatchObject({ usage: { cached_tokens: 60 } });
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2));
    expect(received).toHaveBeenCalledWith('a', expect.objectContaining({ cached_input_tokens: 60 }));
    expect(received).toHaveBeenCalledWith('b', expect.objectContaining({ cached_input_tokens: 20 }));
    expect(delegate.mock.calls[0]).toEqual([endpoint, initA]);
    expect(JSON.parse(initA.body)).toEqual(a);
    monitor.destroy();
    expect(host.fetch).toBe(delegate);
  });

  it('相同请求存在多条候选时不猜测归属', async () => {
    const host = { fetch: vi.fn(async () => response(50)) as typeof fetch, location: { href: 'http://localhost/' } };
    const received = vi.fn();
    const monitor = createTokenUsageMonitor(host, received);
    const a = payload('同文');
    const b = payload('同文');
    monitor.register('a', a.messages);
    monitor.prepare(a);
    monitor.register('b', b.messages);
    monitor.prepare(b);
    await host.fetch(endpoint, { body: JSON.stringify(a) });
    await host.fetch(endpoint, { body: JSON.stringify(b) });
    expect(received).not.toHaveBeenCalled();
    monitor.destroy();
  });

  it('正文克隆可唯一关联，过期记录不再关联', async () => {
    let now = 0;
    const host = { fetch: vi.fn(async () => response(40)) as typeof fetch, location: { href: 'http://localhost/' } };
    const received = vi.fn();
    const monitor = createTokenUsageMonitor(host, received, () => now);
    const a = payload('甲');
    monitor.register('a', a.messages);
    monitor.prepare(JSON.parse(JSON.stringify(a)));
    await host.fetch(endpoint, { body: JSON.stringify(a) });
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
    const b = payload('乙');
    monitor.register('b', b.messages);
    now = 121_000;
    monitor.prepare(b);
    await host.fetch(endpoint, { body: JSON.stringify(b) });
    expect(received).toHaveBeenCalledOnce();
    monitor.destroy();
  });

  it('没有统计和请求异常不会改变原请求行为', async () => {
    const error = Error('网络断开');
    const delegate = vi.fn().mockResolvedValueOnce(new Response('{"choices":[]}')).mockRejectedValueOnce(error);
    const host = { fetch: delegate as typeof fetch, location: { href: 'http://localhost/' } };
    const received = vi.fn();
    const monitor = createTokenUsageMonitor(host, received);
    const a = payload('甲');
    monitor.register('a', a.messages);
    monitor.prepare(a);
    expect(await (await host.fetch(endpoint, { body: JSON.stringify(a) })).json()).toEqual({ choices: [] });
    const b = payload('乙');
    monitor.register('b', b.messages);
    monitor.prepare(b);
    await expect(host.fetch(endpoint, { body: JSON.stringify(b) })).rejects.toBe(error);
    expect(received).not.toHaveBeenCalled();
    monitor.destroy();
  });

  it('卸载时保留后来加入的 fetch 链', async () => {
    const delegate = vi.fn(async () => response(5));
    const host = { fetch: delegate as typeof fetch, location: { href: 'http://localhost/' } };
    const received = vi.fn();
    const monitor = createTokenUsageMonitor(host, received);
    const wrapped = host.fetch;
    const other: typeof fetch = (...args) => wrapped(...args);
    host.fetch = other;
    monitor.destroy();
    expect(host.fetch).toBe(other);
    await host.fetch(endpoint, { body: JSON.stringify(payload('甲')) });
    expect(delegate).toHaveBeenCalledOnce();
    expect(received).not.toHaveBeenCalled();
  });

  it('宿主固定 fetch 时仍能安全初始化和卸载', () => {
    const host = Object.freeze({ fetch: vi.fn() as unknown as typeof fetch, location: { href: 'http://localhost/' } });
    expect(() => createTokenUsageMonitor(host, vi.fn()).destroy()).not.toThrow();
  });

  it('可与带访问器的 fetch 代理链共同工作', async () => {
    const native = vi.fn<typeof fetch>(async () => response(7));
    let delegate: typeof fetch = native;
    let depth = 0;
    const guarded: typeof fetch = (...args) => {
      if (depth > 0) return native(...args);
      depth++;
      try {
        return delegate(...args);
      } finally {
        depth--;
      }
    };
    const host = { fetch: guarded, location: { href: 'http://localhost/' } };
    Object.defineProperty(host, 'fetch', {
      get: () => guarded,
      set: value => {
        delegate = value;
      },
    });
    const received = vi.fn();
    const monitor = createTokenUsageMonitor(host, received);
    const a = payload('甲');
    monitor.register('a', a.messages);
    monitor.prepare(a);
    await host.fetch(endpoint, { body: JSON.stringify(a) });
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
    expect(native).toHaveBeenCalledOnce();
    monitor.destroy();
  });
});
