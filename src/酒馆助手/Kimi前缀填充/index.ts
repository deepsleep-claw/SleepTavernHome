import { checkMinimumVersion } from '@util/common';
import { initializeKimiPartialModeApi } from './api';
import { initPanel } from './panel';
import { initializeKimiPartialMode } from './partial_mode';
import { SCRIPT_NAME } from './store';

$(() => {
  checkMinimumVersion('4.0.0', SCRIPT_NAME);

  const { store, destroy: destroyPanel } = initPanel();
  const { destroy: destroyApi } = initializeKimiPartialModeApi(store);
  const { destroy: destroyPartialMode } = initializeKimiPartialMode(store);

  $(window).on('pagehide', () => {
    destroyPartialMode();
    destroyApi();
    store.destroy();
    destroyPanel();
  });
});
