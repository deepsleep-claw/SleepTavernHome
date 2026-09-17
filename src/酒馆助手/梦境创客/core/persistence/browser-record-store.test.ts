import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('当前账户命名空间', () => {
  it('一次加载失败后可以重试，不缓存失败的Promise', async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ getCurrentUserHandle: () => 'test' });
    vi.stubGlobal('window', { parent: { location: { href: 'http://localhost/' }, Function: () => importer } });
    const { browserAccountNamespace } = await import('./browser-record-store');
    await expect(browserAccountNamespace()).rejects.toThrow('offline');
    await expect(browserAccountNamespace()).resolves.toBe('test');
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
