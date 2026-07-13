import { checkMinimumVersion } from '@util/common';
import { destroyPresetAdapterPopup, openPresetAdapterPopup, refreshPresetAdapterPopup } from './popup';
import { SCRIPT_NAME, markGeneratedMessageAsSummaryIfMatched, readScriptButtonName } from './store';

const WAND_CONTAINER_ID = 'sleep-preset-adapter-wand-container';
const WAND_BUTTON_ID = 'sleep-preset-adapter-wand-button';

function refreshExtensionsMenuButtonVisibility() {
  const has_menu_items =
    $('#extensionsMenu')
      .children()
      .filter((_, child) => $(child).css('display') !== 'none').length > 0;
  $('#extensionsMenuButton').toggle(has_menu_items);
}

function mountWandMenuButton(): { destroy: () => void } {
  let $container: JQuery<HTMLElement> | undefined;
  let interval: ReturnType<typeof window.setInterval> | undefined;

  const append = () => {
    if ($container?.parent().length) {
      return true;
    }

    const $menu = $('#extensionsMenu');
    if ($menu.length === 0) {
      return false;
    }

    const $button = $('<div>')
      .attr({
        id: WAND_BUTTON_ID,
        title: SCRIPT_NAME,
      })
      .addClass('list-group-item flex-container flexGap5')
      .append($('<i>').addClass('fa-solid fa-sliders').attr('aria-hidden', 'true'))
      .append($('<span>').text(SCRIPT_NAME))
      .on('click', () => {
        void openPresetAdapterPopup();
      });

    $container = $('<div>')
      .attr({
        id: WAND_CONTAINER_ID,
        script_id: getScriptId(),
      })
      .addClass('extension_container')
      .append($button)
      .appendTo($menu);

    $('#extensionsMenuButton').css('display', 'flex');
    return true;
  };

  if (!append()) {
    interval = window.setInterval(() => {
      if (append() && interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    }, 1000);
  }

  return {
    destroy: () => {
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
      $container?.remove();
      refreshExtensionsMenuButtonVisibility();
    },
  };
}

function ensureScriptButton(button_name: string) {
  updateScriptButtonsWith(buttons => {
    if (buttons.some(button => button.name === button_name)) {
      return buttons.map(button => (button.name === button_name ? { ...button, visible: true } : button));
    }
    return [...buttons, { name: button_name, visible: true }];
  });
}

function openPopupWithErrorToast() {
  openPresetAdapterPopup().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(`打开界面失败：${message}`, SCRIPT_NAME);
    console.error(`[${SCRIPT_NAME}] 打开界面失败。`, error);
  });
}

$(() => {
  checkMinimumVersion('4.0.0', SCRIPT_NAME);
  const script_button_name = readScriptButtonName();
  ensureScriptButton(script_button_name);

  const script_button_event = eventOn(getButtonEvent(script_button_name), () => {
    openPopupWithErrorToast();
  });
  const preset_changed_event = eventOn(tavern_events.PRESET_CHANGED, () => {
    refreshPresetAdapterPopup();
  });
  const summary_detect_event = eventOn(tavern_events.GENERATION_ENDED, message_id => {
    markGeneratedMessageAsSummaryIfMatched(message_id);
    refreshPresetAdapterPopup();
  });
  const { destroy: destroyWandMenuButton } = mountWandMenuButton();

  $(window).on('pagehide', () => {
    script_button_event.stop();
    preset_changed_event.stop();
    summary_detect_event.stop();
    destroyWandMenuButton();
    destroyPresetAdapterPopup();
  });
});
