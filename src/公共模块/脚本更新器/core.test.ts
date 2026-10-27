import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../../manifest.json';
import { createCdnRuntime } from '../../../util/cdn_runtime.mjs';
import { bootPluginHeadless, createPluginUpdater } from '../脚本更新器核心';
import type { PluginUpdaterConfig, StoredUpdaterState } from './contracts';

const { importer } = vi.hoisted(() => ({ importer: vi.fn() }));
vi.mock('./sources', async importOriginal => {
  const actual = await importOriginal<typeof import('./sources')>();
  return { ...actual, createCdnRuntime: (source: string) => createCdnRuntime(source, importer) };
});

const release = manifest.plugins['modern-ui'].channels.stable;
const config: PluginUpdaterConfig = {
  pluginId: 'modern-ui',
  pluginName: '现代化界面',
  repository: manifest.repository,
  cdnBaseUrl: 'https://cdn.jsdelivr.net/gh',
  manifestUrl: `https://raw.githubusercontent.com/${manifest.repository}/main/manifest.json`,
  channel: 'stable',
  tagPrefix: 'modern-ui-v',
  updaterApiMajor: 1,
  fallback: { ...release, url: `https://cdn.jsdelivr.net/gh/${manifest.repository}@${release.tag}/${release.entry}` },
};
let variables: Record<string, any>;
let reload: ReturnType<typeof vi.spyOn>;
const state = () => variables.__updater as StoredUpdaterState;
const moduleFor = (version = release.version, activate = vi.fn()) => ({
  PLUGIN_ID: 'modern-ui',
  PLUGIN_VERSION: version,
  activate,
});

beforeEach(() => {
  importer.mockReset();
  variables = { unrelated: { enabled: true } };
  vi.stubGlobal('getScriptId', () => 'updater-test');
  vi.stubGlobal('getVariables', () => variables);
  vi.stubGlobal('updateVariablesWith', (update: (value: typeof variables) => typeof variables) => {
    variables = update(variables);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('export {}', { headers: { 'content-type': 'application/javascript' } })),
  );
  vi.stubGlobal('toastr', { error: vi.fn() });
  reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any).__thCdnSource;
  delete (globalThis as any).__thManagedPluginLoad;
});

function pendingState() {
  variables.__updater = {
    schemaVersion: 1,
    pluginId: config.pluginId,
    channel: 'stable',
    active: config.fallback,
    pending: { ...config.fallback, version: '0.2.1', tag: 'modern-ui-v0.2.1' },
  };
}

describe('更新启动与线路状态', () => {
  it('新版本主源失败后换源启动，只激活一次并提交 pending', async () => {
    pendingState();
    const module = moduleFor('0.2.1');
    importer.mockRejectedValueOnce(new Error('mirror offline')).mockResolvedValueOnce(module);
    await bootPluginHeadless(config);
    expect(importer).toHaveBeenCalledTimes(2);
    expect(module.activate).toHaveBeenCalledOnce();
    expect(module.activate.mock.calls[0][0].release.url).toContain('cdn.jsdelivr.net');
    expect(state().active.version).toBe('0.2.1');
    expect(state().pending).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
    expect(variables.unrelated).toEqual({ enabled: true });
  });

  it('新版本全源失败后保留当前版本并清理 pending', async () => {
    pendingState();
    importer.mockRejectedValue(new Error('offline'));
    await bootPluginHeadless(config);
    expect(importer).toHaveBeenCalledTimes(2);
    expect(state().active.version).toBe(release.version);
    expect(state().pending).toBeUndefined();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('激活失败不重复换源执行同一版本', async () => {
    pendingState();
    const activate = vi.fn(() => {
      throw new Error('activation failed');
    });
    importer.mockResolvedValue(moduleFor('0.2.1', activate));
    await bootPluginHeadless(config);
    expect(importer).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(state().active.version).toBe(release.version);
  });

  it('同版 fallback 不因 CDN 地址变化而再次启动', async () => {
    const fallback = { ...config.fallback, url: config.fallback.url.replace('cdn.jsdelivr.net', 'cdn.jsdmirror.com') };
    variables.__updater = { schemaVersion: 1, pluginId: config.pluginId, channel: 'stable', active: config.fallback };
    importer.mockRejectedValue(new Error('offline'));
    await expect(bootPluginHeadless({ ...config, fallback })).rejects.toThrow('模块加载失败');
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('线路偏好持久化并能被下一次启动读取', () => {
    const updater = createPluginUpdater(config);
    updater.setSource?.('jsdelivr');
    expect(state().source).toBe('jsdelivr');
    expect(createPluginUpdater(config).getSnapshot().source).toBe('jsdelivr');
    expect(state().active.version).toBe(release.version);
  });

  it('较旧的缓存清单不会导致已安装版本降级', async () => {
    variables.__updater = {
      schemaVersion: 1,
      pluginId: config.pluginId,
      channel: 'stable',
      active: { ...config.fallback, version: '0.2.1', tag: 'modern-ui-v0.2.1' },
    };
    const updater = createPluginUpdater(config, { manifest });
    expect(updater.getSnapshot().updateAvailable).toBe(false);
    await updater.install();
    expect(reload).not.toHaveBeenCalled();
    expect(state().active.version).toBe('0.2.1');
  });
});
