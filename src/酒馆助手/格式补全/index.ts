import { checkMinimumVersion } from '@util/common';
import { initFormatCompletion } from './format_completion';
import { initPanel } from './panel';
import { FORMAT_COMPLETION_NAME } from './store';

$(() => {
  checkMinimumVersion('4.0.0', FORMAT_COMPLETION_NAME);
  appendInexistentScriptButtons([{ name: FORMAT_COMPLETION_NAME, visible: true }]);

  const { destroy: destroyPanel } = initPanel();
  const { destroy: destroyFormatCompletion } = initFormatCompletion();

  $(window).on('pagehide', () => {
    destroyFormatCompletion();
    destroyPanel();
  });
});
