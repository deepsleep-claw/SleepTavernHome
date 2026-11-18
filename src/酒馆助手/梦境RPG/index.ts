import { createPinia } from 'pinia';
import { watch } from 'vue';
import { createRpgDisplay } from './display';
import { initPanel } from './panel';
import { GLOBAL_KEY, type DreamRpgApi } from './protocol';
import { createRpgRuntime } from './runtime';
import { useRpgStore } from './settings';
import { themeVariables } from './theme';

$(() => {
  const owner = window.parent as Window & { DreamRpg?: DreamRpgApi; __dreamRpgScript?: { destroy: () => void } };
  owner.__dreamRpgScript?.destroy();
  const pinia = createPinia();
  const store = useRpgStore(pinia);
  const panel = initPanel(pinia);
  const runtime = createRpgRuntime(store, panel.open);
  const display = createRpgDisplay(() => ({
    enabled: runtime.api.active,
    allowSecretReveal: store.settings.allow_secret_reveal,
    showAnswerResults: store.settings.preview_results,
  }));
  const themeNode = window.parent.document.createElement('style');
  themeNode.dataset.dreamRpgTheme = getScriptId();
  window.parent.document.head.append(themeNode);
  const updateTheme = () => {
    themeNode.textContent = `:root{${Object.entries(themeVariables[runtime.theme()])
      .map(([key, value]) => `${key}:${value};`)
      .join('')}}`;
  };
  const stop = watch(
    () => [store.settings.enabled, store.settings.theme, store.settings.allow_secret_reveal],
    () => {
      owner[GLOBAL_KEY] = runtime.api;
      runtime.refresh();
      display.refresh();
      updateTheme();
    },
    { immediate: true },
  );
  const stopAnswerResults = watch(() => store.settings.preview_results, display.refresh);
  const themeTimer = setInterval(updateTheme, 1200);
  let destroyed = false;
  const instance = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      display.destroy();
      runtime.destroy();
      stop();
      stopAnswerResults();
      clearInterval(themeTimer);
      themeNode.remove();
      if (owner[GLOBAL_KEY] === runtime.api) delete owner[GLOBAL_KEY];
      panel.destroy();
      if (owner.__dreamRpgScript === instance) delete owner.__dreamRpgScript;
    },
  };
  owner.__dreamRpgScript = instance;
  $(window).on('pagehide', instance.destroy);
});
