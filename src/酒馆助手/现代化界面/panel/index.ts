import type { Pinia } from 'pinia';
import { createScriptIdDiv } from '@util/script';
import { createApp } from 'vue';
import Panel from './Panel.vue';

const PANEL_ROOT_CLASS = 'th-modern-panel-root';

export function initPanel(pinia: Pinia) {
  $(`#extensions_settings2 > [script_id="${getScriptId()}"].${PANEL_ROOT_CLASS}`).remove();

  const app = createApp(Panel).use(pinia);
  const $app = createScriptIdDiv().addClass(PANEL_ROOT_CLASS).appendTo('#extensions_settings2');
  app.mount($app[0]);

  return {
    destroy: () => {
      app.unmount();
      $app.remove();
    },
  };
}
