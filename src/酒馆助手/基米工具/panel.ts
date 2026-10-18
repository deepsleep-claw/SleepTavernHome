import { createScriptIdDiv, teleportStyle } from '@util/script';
import type { Pinia } from 'pinia';
import { createApp } from 'vue';
import Panel from './Panel.vue';

export function initPanel(pinia: Pinia): { open: () => void; destroy: () => void } {
  const app = createApp(Panel).use(pinia);
  const mount = createScriptIdDiv().attr('id', 'jimi-tools-settings').appendTo('#extensions_settings2');
  app.mount(mount[0]);
  const styles = teleportStyle();
  return {
    open() {
      const extensions = $('#rm_extensions_block');
      if (!extensions.hasClass('openDrawer'))
        extensions.closest('.drawer').children('.drawer-toggle').first().trigger('click');
      extensions
        .find('[data-extension-key]')
        .filter((_, button) => $(button).text().trim() === '基米工具')
        .first()
        .trigger('click');
      const content = mount.find('.inline-drawer-content').first();
      if (content.css('display') === 'none') mount.find('.inline-drawer-header').first().trigger('click');
      mount[0].scrollIntoView?.({ block: 'nearest' });
    },
    destroy() {
      app.unmount();
      mount.remove();
      styles.destroy();
    },
  };
}
