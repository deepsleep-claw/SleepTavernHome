import { checkMinimumVersion } from '@util/common';
import { teleportStyle } from '@util/script';
import { createProbeModel, createProbeStream } from './core/provider-probe';
import { getDreamCardAgentRuntime } from './runtime/dream-card-agent-runtime';
import { destroyDreamCardAgentWindow, openDreamCardAgentWindow } from './ui/popup';

export const DREAM_CARD_AGENT_ID = 'dream-card-agent';
export const DREAM_CARD_AGENT_NAME = '梦境创客';
export const dreamCardAgentProbe = createProbeStream;

const WAND_CONTAINER_ID = 'dream-card-agent-wand-container';
const FLOATING_BUTTON_ID = 'dream-card-agent-floating-button';

function refreshExtensionsMenuButton(): void {
  const visible = $('#extensionsMenu').children().filter((_, item) => $(item).css('display') !== 'none').length > 0;
  $('#extensionsMenuButton').toggle(visible);
}

function mountWandEntry(): { destroy: () => void } {
  let $container: JQuery<HTMLElement> | undefined;
  let timer: ReturnType<typeof window.setInterval> | undefined;
  const append = () => {
    if ($container?.parent().length) return true;
    const $menu = $('#extensionsMenu');
    if (!$menu.length) return false;
    $container = $('<div>')
      .attr({ id: WAND_CONTAINER_ID, script_id: getScriptId() })
      .addClass('extension_container')
      .append(
        $('<div>')
          .addClass('list-group-item flex-container flexGap5')
          .attr({ title: DREAM_CARD_AGENT_NAME })
          .append($('<i>').addClass('fa-solid fa-wand-magic-sparkles'))
          .append($('<span>').text(DREAM_CARD_AGENT_NAME))
          .on('click', openDreamCardAgentWindow),
      )
      .appendTo($menu);
    $('#extensionsMenuButton').css('display', 'flex');
    return true;
  };
  if (!append()) timer = window.setInterval(() => { if (append() && timer !== undefined) { window.clearInterval(timer); timer = undefined; } }, 1000);
  return { destroy: () => { if (timer !== undefined) window.clearInterval(timer); $container?.remove(); refreshExtensionsMenuButton(); } };
}

function mountFloatingButton(): { destroy: () => void } {
  const runtime = getDreamCardAgentRuntime();
  const $button = $('<button>')
    .attr({ 'aria-label': '打开梦境创客', id: FLOATING_BUTTON_ID, script_id: getScriptId(), title: '打开梦境创客' })
    .addClass('dca-floating-trigger')
    .append($('<i>').addClass('fa-solid fa-wand-magic-sparkles'))
    .on('click', openDreamCardAgentWindow)
    .appendTo('body');
  const unsubscribe = runtime.subscribe(state => $button.toggle(state.floatingButton));
  return { destroy: () => { unsubscribe(); $button.remove(); } };
}

$(() => {
  checkMinimumVersion('4.0.0', DREAM_CARD_AGENT_NAME);
  createProbeModel({ apiKey: '', baseURL: 'https://example.invalid/v1', model: 'probe', protocol: 'openai-responses' });
  const runtime = getDreamCardAgentRuntime();
  const style = teleportStyle();
  const floating = mountFloatingButton();
  const wand = mountWandEntry();
  const refresh = () => { void runtime.refreshCharacter().catch(() => undefined); };
  const events = [
    eventOn(tavern_events.CHAT_CHANGED, refresh),
    eventOn(tavern_events.CHARACTER_EDITED, refresh),
    eventOn(tavern_events.CHARACTER_RENAMED, refresh),
    eventOn(tavern_events.CHARACTER_DUPLICATED, refresh),
  ];
  refresh();
  $(window).on('pagehide', () => {
    events.forEach(event => event.stop());
    destroyDreamCardAgentWindow();
    floating.destroy();
    wand.destroy();
    runtime.destroy();
    style.destroy();
  });
  console.info(`[${DREAM_CARD_AGENT_NAME}] 已启动。`);
});
