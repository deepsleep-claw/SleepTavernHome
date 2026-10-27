import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../../manifest.json';
import { fetchManifest, selectUpdaterRelease } from './manifest';
import type { PluginUpdaterConfig } from './contracts';

const config: PluginUpdaterConfig = {
  pluginId: 'modern-ui',
  pluginName: '现代化界面',
  repository: manifest.repository,
  cdnBaseUrl: 'https://cdn.jsdelivr.net/gh',
  manifestUrl: `https://raw.githubusercontent.com/${manifest.repository}/main/manifest.json`,
  channel: 'stable',
  tagPrefix: 'modern-ui-v',
  updaterApiMajor: 1,
  fallback: {
    ...manifest.plugins['modern-ui'].channels.stable,
    url: 'https://cdn.jsdelivr.net/gh/example/repo@modern-ui-v0.2.0/index.js',
  },
};

function newer(plugin: string, updater: string) {
  const value = structuredClone(manifest);
  value.plugins['modern-ui'].channels.stable.version = plugin;
  value.plugins['modern-ui'].channels.stable.tag = `modern-ui-v${plugin}`;
  value.updater.apiMajors['1'].stable.version = updater;
  value.updater.apiMajors['1'].stable.tag = `script-updater-v${updater}`;
  return value;
}

afterEach(() => vi.unstubAllGlobals());

describe('多源清单', () => {
  it('从不同缓存中分别选择插件与更新器的较新版本', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(newer('0.2.1', '1.0.0')))
      .mockResolvedValueOnce(Response.json(newer('0.2.0', '1.1.0')))
      .mockRejectedValueOnce(new Error('raw offline'));
    vi.stubGlobal('fetch', request);
    const result = await fetchManifest(config, 'auto');
    expect(result.plugins['modern-ui'].channels.stable.version).toBe('0.2.1');
    expect(selectUpdaterRelease(result, config)?.version).toBe('1.1.0');
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every(call => String(call[0]).includes('_th_cache_bust='))).toBe(true);
  });

  it('忽略仓库不匹配、插件 API 不匹配及错误格式的来源', async () => {
    const invalid = newer('9.0.0', '9.0.0');
    invalid.plugins['modern-ui'].channels.stable.updaterApiMajor = 2;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(invalid))
        .mockResolvedValueOnce(Response.json({ ...manifest, repository: 'other/repo' }))
        .mockResolvedValueOnce(Response.json(manifest)),
    );
    expect((await fetchManifest(config, 'auto')).plugins['modern-ui'].channels.stable.version).toBe(config.fallback.version);
    expect(selectUpdaterRelease({}, config)).toBeUndefined();
  });

  it('全源失败时抛出聚合错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('offline', { status: 502 })),
    );
    await expect(fetchManifest(config, 'auto')).rejects.toThrow('获取更新清单失败');
  });
});
