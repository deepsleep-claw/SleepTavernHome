import UpdaterPanel from './UpdaterPanel.vue';
import { compareStableVersions, fetchManifest, selectUpdaterRelease } from './manifest';
import { createCdnRuntime, readSourcePreference } from './sources';
import { bootPluginWithUi, UPDATER_API_MAJOR, UPDATER_VERSION } from '../脚本更新器核心';
import type { PluginRuntime, PluginUpdaterConfig, PluginUpdaterModule, UpdaterBootstrapData } from './contracts';

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || '未知错误');
}

async function resolveBootstrap(
  config: PluginUpdaterConfig,
  bootstrap: UpdaterBootstrapData,
): Promise<UpdaterBootstrapData> {
  if (bootstrap.manifest !== undefined || bootstrap.manifestError !== undefined) {
    return { ...bootstrap };
  }
  try {
    return { ...bootstrap, manifest: await fetchManifest(config, readSourcePreference()) };
  } catch (error) {
    console.warn(`[${config.pluginName}] 获取 Manifest 失败，将使用锚定更新器和保底脚本。`, error);
    return { ...bootstrap, manifestError: describeError(error) };
  }
}

async function importUpdater(
  release: NonNullable<ReturnType<typeof selectUpdaterRelease>>,
): Promise<PluginUpdaterModule> {
  const loaded = await createCdnRuntime(readSourcePreference()).importModule(release.url, module => {
    if (module.UPDATER_API_MAJOR !== UPDATER_API_MAJOR) {
      throw new Error(`更新器 API 不兼容：需要 v${UPDATER_API_MAJOR}，实际为 v${module.UPDATER_API_MAJOR ?? '未知'}`);
    }
    if (module.UPDATER_VERSION !== release.version) {
      throw new Error(`更新器版本不匹配：需要 ${release.version}，实际为 ${module.UPDATER_VERSION ?? '未知'}`);
    }
    if (typeof module.bootPlugin !== 'function') throw new Error('更新器没有导出 bootPlugin()');
  });
  return loaded.module as PluginUpdaterModule;
}

async function waitForDocumentReady(): Promise<void> {
  await new Promise<void>(resolve => $(resolve));
}

export { bootPluginHeadless, createPluginUpdater, UPDATER_API_MAJOR, UPDATER_VERSION } from '../脚本更新器核心';
export { default as UpdaterPanel } from './UpdaterPanel.vue';
export type * from './contracts';

export async function bootPlugin(
  config: PluginUpdaterConfig,
  bootstrap: UpdaterBootstrapData = {},
): Promise<PluginRuntime | void> {
  const resolvedBootstrap = await resolveBootstrap(config, bootstrap);
  const latestUpdater =
    resolvedBootstrap.manifest === undefined ? undefined : selectUpdaterRelease(resolvedBootstrap.manifest, config);

  if (latestUpdater && compareStableVersions(latestUpdater.version, UPDATER_VERSION) > 0) {
    let updater: PluginUpdaterModule | undefined;
    try {
      updater = await importUpdater(latestUpdater);
    } catch (error) {
      console.warn(
        `[${config.pluginName}] 最新更新器 v${latestUpdater.version} 加载失败，将使用锚定版本 v${UPDATER_VERSION}。`,
        error,
      );
    }
    if (updater?.bootPlugin) {
      await waitForDocumentReady();
      return await updater.bootPlugin(config, resolvedBootstrap);
    }
  }

  await waitForDocumentReady();
  return await bootPluginWithUi(config, UpdaterPanel, resolvedBootstrap);
}
