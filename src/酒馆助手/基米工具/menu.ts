import { SCRIPT_NAME, SETTINGS_BUTTON } from './config';

export function mountToolsMenu(open: () => void): { destroy: () => void } {
  let container: JQuery<HTMLElement> | undefined;
  let timer: ReturnType<typeof window.setInterval> | undefined;
  const append = () => {
    const menu = $('#extensionsMenu');
    if (!menu.length) return false;
    const button = $('<div>')
      .attr({ id: 'jimi-tools-menu-button', title: SETTINGS_BUTTON, role: 'button', tabindex: 0 })
      .addClass('list-group-item flex-container flexGap5')
      .append($('<i>').addClass('fa-solid fa-sliders').attr('aria-hidden', 'true'))
      .append($('<span>').text(SCRIPT_NAME))
      .on('click', open)
      .on('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          button.trigger('click');
        }
      });
    container = $('<div>')
      .attr({ id: 'jimi-tools-menu-container', script_id: getScriptId() })
      .addClass('extension_container')
      .append(button)
      .appendTo(menu);
    $('#extensionsMenuButton').css('display', 'flex');
    return true;
  };
  if (!append()) {
    timer = window.setInterval(() => {
      if (append()) {
        window.clearInterval(timer);
        timer = undefined;
      }
    }, 1000);
  }
  return {
    destroy() {
      if (timer !== undefined) window.clearInterval(timer);
      container?.find('[role="button"]').off();
      container?.remove();
      const visible =
        $('#extensionsMenu')
          .children()
          .filter((_, child) => $(child).css('display') !== 'none').length > 0;
      $('#extensionsMenuButton').toggle(visible);
    },
  };
}
