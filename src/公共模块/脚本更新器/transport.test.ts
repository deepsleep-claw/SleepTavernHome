import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCdnRuntime } from '../../../util/cdn_runtime.mjs';

const entry = 'https://cdn.jsdelivr.net/gh/example/repo@plugin-v1.2.3/dist/%E5%85%A5%E5%8F%A3/index.js';
const mirror = entry.replace('cdn.jsdelivr.net', 'cdn.jsdmirror.com');
const javascript = () =>
  new Response('export const version = "1.2.3"', { headers: { 'content-type': 'application/javascript' } });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CDN 加载', () => {
  it('保留精确 Tag、编码路径和查询参数，并支持线路优先级', () => {
    expect(createCdnRuntime().urls(`${entry}?t=123#module`)).toEqual([
      `${mirror}?t=123#module`,
      `${entry}?t=123#module`,
    ]);
    expect(createCdnRuntime('jsdelivr').urls(mirror)).toEqual([entry, mirror]);
    expect(createCdnRuntime('unknown').urls(entry)).toEqual([mirror, entry]);
    expect(createCdnRuntime().urls('http://localhost:5500/index.js')).toEqual(['http://localhost:5500/index.js']);
  });

  it('镜像不可达时从备用源加载，验证后返回实际来源', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(javascript());
    const module = { version: '1.2.3' };
    const importer = vi.fn(async () => module);
    const validate = vi.fn();
    vi.stubGlobal('fetch', request);
    expect(await createCdnRuntime('auto', importer).importModule(entry, validate)).toEqual({ module, url: entry });
    expect(request.mock.calls.map(call => call[0])).toEqual([mirror, entry]);
    expect(importer).toHaveBeenCalledExactlyOnceWith(entry);
    expect(validate).toHaveBeenCalledExactlyOnceWith(module);
  });

  it('HTTP 200 的 HTML 错误页不会作为模块执行', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } }))
        .mockResolvedValueOnce(javascript()),
    );
    const importer = vi.fn(async () => ({}));
    await createCdnRuntime('auto', importer).importModule(entry);
    expect(importer).toHaveBeenCalledExactlyOnceWith(entry);
  });

  it('版本验证失败或依赖加载失败后继续尝试同版本备用源', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => javascript()),
    );
    const importer = vi.fn().mockResolvedValueOnce({ version: '1.2.2' }).mockResolvedValueOnce({ version: '1.2.3' });
    const loaded = await createCdnRuntime('auto', importer).importModule(entry, module => {
      if (module.version !== '1.2.3') throw new Error('版本不匹配');
    });
    expect(loaded.url).toBe(entry);
    const failing = vi.fn().mockRejectedValueOnce(new Error('dependency offline')).mockResolvedValueOnce({});
    expect((await createCdnRuntime('auto', failing).importModule(entry)).url).toBe(entry);
  });

  it('预取超时中止请求，随后才加载备用源', async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener('abort', () => {
                aborted = true;
                reject(new Error('aborted'));
              });
            }),
        )
        .mockResolvedValueOnce(javascript()),
    );
    const importer = vi.fn(async () => ({}));
    const loading = createCdnRuntime('auto', importer).importModule(entry);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await loading).url).toBe(entry);
    expect(aborted).toBe(true);
    expect(importer).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('各源均失败时保留来源与原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    await expect(createCdnRuntime().importModule(entry)).rejects.toThrow(
      /cdn.jsdmirror.com: HTTP 503；cdn.jsdelivr.net: HTTP 503/u,
    );
  });

  it('二进制资源切换来源后保留完整内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(new Response(new Uint8Array([0, 128, 255]))),
    );
    const response = await createCdnRuntime().fetchResource(entry);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 128, 255]);
  });

  it('样式加载失败时只切换一次备用线路', () => {
    const link = document.createElement('link');
    createCdnRuntime().stylesheet(link, entry);
    expect(link.href).toBe(mirror);
    link.dispatchEvent(new Event('error'));
    expect(link.href).toBe(entry);
    link.dispatchEvent(new Event('error'));
    expect(link.href).toBe(entry);
  });
});
