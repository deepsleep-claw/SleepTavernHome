import { createPinia } from 'pinia';
import { initializeGeminiToolOutputModeApi } from './api';
import { describeError, SCRIPT_NAME, SCRIPT_VERSION, SETTINGS_BUTTON } from './config';
import { mountToolsMenu } from './menu';
import { initPanel } from './panel';
import { createJimiRuntime } from './runtime';
import { initializeSettings, readSettings, useJimiStore } from './settings';

$(() => {
  const owner = window.parent as unknown as Window & {
    __jimiToolsHelper?: { destroy: () => void };
    __toolOutputBridge?: { destroy: () => void };
  };
  owner.__jimiToolsHelper?.destroy();
  try {
    initializeSettings();
  } catch (error) {
    toastr.error(describeError(error), SCRIPT_NAME);
    console.error(`[${SCRIPT_NAME}]`, error);
    return;
  }
  const pinia = createPinia();
  const store = useJimiStore(pinia);
  const modeApi = initializeGeminiToolOutputModeApi(store);
  const panel = initPanel(pinia);
  owner.__toolOutputBridge?.destroy();
  const runtime = createJimiRuntime({
    host: owner,
    settings: readSettings,
    model: () => ({
      model: SillyTavern.getChatCompletionModel(),
      chat_completion_source: SillyTavern.chatCompletionSettings.chat_completion_source,
    }),
    warning: message => {
      store.warning = message;
      if (message) toastr.warning(message, SCRIPT_NAME);
    },
  });
  appendInexistentScriptButtons([{ name: SETTINGS_BUTTON, visible: true }]);
  const openSettings = () => {
    try {
      store.refresh();
      store.error = '';
    } catch (error) {
      store.error = describeError(error);
    }
    panel.open();
  };
  const button = eventOn(getButtonEvent(SETTINGS_BUTTON), openSettings);
  const menu = mountToolsMenu(openSettings);
  let destroyed = false;
  const api = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      modeApi.destroy();
      runtime.destroy();
      button.stop();
      menu.destroy();
      panel.destroy();
      if (owner.__jimiToolsHelper === api) delete owner.__jimiToolsHelper;
    },
  };
  owner.__jimiToolsHelper = api;
  $(window).on('pagehide', api.destroy);
  console.info(`[${SCRIPT_NAME}] 酒馆助手脚本 ${SCRIPT_VERSION} 已加载。`);
});
