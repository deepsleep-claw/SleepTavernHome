import { checkMinimumVersion } from '@util/common';
import { createScriptIdDiv, registerAsUniqueScript, teleportStyle } from '@util/script';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { createApp, watch } from 'vue';
import Panel from './Panel.vue';
import { createRepairController } from './runtime';
import { BUTTON_NAME, SCRIPT_NAME, useRepairStore } from './settings';

$(() => {
  checkMinimumVersion('4.8.4', SCRIPT_NAME);
  const pinia = getActivePinia() ?? createPinia();
  setActivePinia(pinia);
  const store = useRepairStore();
  const unique = registerAsUniqueScript(SCRIPT_NAME);
  store.enabled = unique.getPreferredScriptId() === getScriptId();
  const preference = unique.listenPreferenceState(id => {
    store.enabled = id === getScriptId();
  });
  const controller = createRepairController(store);
  const api = {
    get enabled() {
      return store.enabled;
    },
    open: () => {
      store.open = true;
    },
  };
  const owner = window.parent as unknown as { DreamRepairV2?: typeof api };
  const stop_watch = watch(
    () => store.enabled,
    enabled => {
      if (enabled) owner.DreamRepairV2 = api;
      else {
        controller.stop();
        if (owner.DreamRepairV2 === api) delete owner.DreamRepairV2;
      }
    },
    { immediate: true },
  );
  appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
  const button = eventOn(getButtonEvent(BUTTON_NAME), () => {
    if (store.enabled) store.open = true;
  });
  const app = createApp(Panel, { controller }).use(pinia);
  const mount = createScriptIdDiv().appendTo('body');
  app.mount(mount[0]);
  const styles = teleportStyle();
  $(window).on('pagehide', () => {
    controller.destroy();
    button.stop();
    preference.stop();
    stop_watch();
    unique.unregister();
    if (owner.DreamRepairV2 === api) delete owner.DreamRepairV2;
    app.unmount();
    mount.remove();
    styles.destroy();
  });
});
