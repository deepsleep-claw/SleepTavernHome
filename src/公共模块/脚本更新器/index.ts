import UpdaterPanel from './UpdaterPanel.vue';
import { bootPluginWithUi } from '../脚本更新器核心';
import type { PluginRuntime, PluginUpdaterConfig, UpdaterBootstrapData } from './contracts';

export { bootPluginHeadless, createPluginUpdater, UPDATER_API_MAJOR, UPDATER_VERSION } from '../脚本更新器核心';
export { default as UpdaterPanel } from './UpdaterPanel.vue';
export type * from './contracts';

export async function bootPlugin(
  config: PluginUpdaterConfig,
  bootstrap: UpdaterBootstrapData = {},
): Promise<PluginRuntime | void> {
  return await bootPluginWithUi(config, UpdaterPanel, bootstrap);
}
