import type { Pinia } from 'pinia';
import type { PluginActivationContext } from '../../../公共模块/脚本更新器/contracts';
import { createScriptIdDiv } from '@util/script';
import { createApp, markRaw } from 'vue';
import Panel from './Panel.vue';

const PANEL_ROOT_CLASS = 'th-modern-panel-root';

export function initPanel(pinia: Pinia, context: PluginActivationContext) {
  $(`#extensions_settings2 > [script_id="${getScriptId()}"].${PANEL_ROOT_CLASS}`).remove();

  const app = createApp(Panel, {
    updater: context.updater,
    updaterUi: context.updaterUi ? markRaw(context.updaterUi) : undefined,
  }).use(pinia);
  const $app = createScriptIdDiv().addClass(PANEL_ROOT_CLASS).appendTo('#extensions_settings2');
  app.mount($app[0]);

  return {
    destroy: () => {
      app.unmount();
      $app.remove();
    },
  };
}
