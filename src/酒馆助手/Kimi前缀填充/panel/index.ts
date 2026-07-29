import { createScriptIdDiv, teleportStyle } from '@util/script';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { useKimiPartialModeStore } from '../store';
import Panel from './Panel.vue';

export function initPanel() {
  const pinia = getActivePinia() ?? createPinia();
  const app = createApp(Panel).use(pinia);
  const $app = createScriptIdDiv().appendTo('#extensions_settings2');
  app.mount($app[0]);
  const store = useKimiPartialModeStore(pinia);
  const { destroy: destroyStyle } = teleportStyle();

  return {
    store,
    destroy: () => {
      app.unmount();
      $app.remove();
      destroyStyle();
    },
  };
}
