import { checkMinimumVersion } from '@util/common';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { initPanel } from './panel';
import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  DEFAULT_OVERLAY_PANEL_WIDTH,
  SCRIPT_NAME,
  type ModernLayoutSettings,
  useModernLayoutStore,
} from './store';
import './style.css';

const BODY_CLASS_ENABLED = 'th-modern-enabled';
const BODY_CLASS_TWO_COLUMN = 'th-modern-two-column';
const BODY_CLASS_LEGACY_THREE_COLUMN = 'th-modern-three-column';
const SIDEBAR_ID = 'th-modern-sidebar';
const TOPBAR_LABEL_CLASS = 'th-modern-topbar-label';
const DRAWER_TITLEBAR_CLASS = 'th-modern-drawer-titlebar';
const DRAWER_TITLE_CLASS = 'th-modern-drawer-title';
const DRAWER_CLOSE_CLASS = 'th-modern-drawer-close';
const FAILSAFE_KEY_SEQUENCE = 'th-reset';
const FAILSAFE_TOUCH_HOLD_MS = 5000;
const RUNTIME_DISPOSE_PATH = 'TavernHelper.modernLayout.dispose';
const RECENT_CHAT_LIMIT = 15;

type RecentChat = {
  file_name: string;
  chat_name?: string;
  file_size?: string;
  chat_items?: number;
  mes?: string;
  last_mes?: string;
  avatar?: string;
  char_thumbnail?: string;
  char_name?: string;
  date_short?: string;
  date_long?: string;
  group?: string;
  is_group?: boolean;
  pinned?: boolean;
};

type RuntimeContext = typeof SillyTavern & {
  openGroupById?: (group_id: string) => Promise<boolean>;
  setActiveCharacter?: (entity_or_key?: string | number | object | null) => void;
  setActiveGroup?: (entity_or_key?: string | number | object | null) => void;
};

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function getHostStyleTargets(): HTMLElement[] {
  const candidates: Array<Element | undefined | null> = [
    $('html')[0],
    $('body')[0],
    window.parent.document.documentElement,
    window.parent.document.body,
  ];
  return _.uniq(candidates).filter((element): element is HTMLElement => Boolean(element && 'style' in element));
}

function getHostDocument(): Document {
  return window.parent?.document ?? document;
}

function setHostCssVariable(name: string, value: string) {
  getHostStyleTargets().forEach(element => {
    element.style.setProperty(name, value);
  });
}

function removeHostCssVariable(name: string) {
  getHostStyleTargets().forEach(element => {
    element.style.removeProperty(name);
  });
}

function getContext(): RuntimeContext {
  return SillyTavern as RuntimeContext;
}

function getPinnedChats(): Array<Pick<RecentChat, 'group' | 'avatar' | 'file_name'>> {
  const raw_value = SillyTavern.accountStorage?.getItem?.('pinnedChats');
  if (typeof raw_value !== 'string') {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw_value);
    if (!parsed || typeof parsed !== 'object') {
      return [];
    }
    return Object.values(parsed).filter((value): value is Pick<RecentChat, 'group' | 'avatar' | 'file_name'> => {
      if (!value || typeof value !== 'object') {
        return false;
      }
      const item = value as Record<string, unknown>;
      return typeof item.file_name === 'string';
    });
  } catch (error) {
    console.warn(`[${SCRIPT_NAME}] 读取最近聊天置顶状态失败。`, error);
    return [];
  }
}

function findCharacterByAvatar(avatar: string | undefined): SillyTavern.v1CharData | undefined {
  if (!avatar) {
    return undefined;
  }
  return SillyTavern.characters.find(character => character.avatar === avatar);
}

function findGroupById(group_id: string | undefined): Record<string, any> | undefined {
  if (!group_id || !Array.isArray(SillyTavern.groups)) {
    return undefined;
  }
  return SillyTavern.groups.find((group: Record<string, any>) => group.id === group_id);
}

function formatRecentChat(raw_chat: RecentChat): RecentChat | undefined {
  const character = findCharacterByAvatar(raw_chat.avatar);
  const group = findGroupById(raw_chat.group);
  if (!character && !group) {
    return undefined;
  }

  const chat_name = raw_chat.chat_name ?? raw_chat.file_name.replace(/\.jsonl$/i, '');
  const moment = raw_chat.last_mes ? SillyTavern.timestampToMoment(raw_chat.last_mes) : undefined;
  return {
    ...raw_chat,
    chat_name,
    char_name: character?.name ?? String(group?.name ?? ''),
    char_thumbnail: character ? SillyTavern.getThumbnailUrl('avatar', character.avatar) : 'img/groupchat.png',
    date_short: moment?.format?.('l') ?? '',
    date_long: moment?.format?.('LL LT') ?? '',
    is_group: !!group,
    avatar: raw_chat.avatar ?? '',
    group: raw_chat.group ?? '',
    pinned: Boolean(raw_chat.pinned),
    mes: raw_chat.mes ?? '',
    chat_items: raw_chat.chat_items ?? 0,
    file_size: raw_chat.file_size ?? '',
    last_mes: raw_chat.last_mes ?? '',
  };
}

async function fetchRecentChats(): Promise<RecentChat[]> {
  const response = await fetch('/api/chats/recent', {
    method: 'POST',
    headers: SillyTavern.getRequestHeaders(),
    body: JSON.stringify({ max: RECENT_CHAT_LIMIT, pinned: getPinnedChats() }),
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map(chat => formatRecentChat(chat as RecentChat))
    .filter((chat): chat is RecentChat => chat !== undefined)
    .slice(0, RECENT_CHAT_LIMIT);
}

function isCurrentChat(chat: RecentChat): boolean {
  const current_chat_id = SillyTavern.getCurrentChatId?.();
  if (!current_chat_id) {
    return false;
  }
  return chat.chat_name === current_chat_id || chat.file_name === current_chat_id;
}

function createRecentChatElement(chat: RecentChat): JQuery<HTMLElement> {
  const $item = $('<button>')
    .attr({
      type: 'button',
      title: chat.date_long ? `${chat.char_name} - ${chat.chat_name}\n${chat.date_long}` : `${chat.char_name} - ${chat.chat_name}`,
    })
    .addClass('th-modern-recent-chat')
    .toggleClass('is-current', isCurrentChat(chat))
    .on('click', () => {
      openRecentChat(chat).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        toastr.error(`打开最近聊天失败：${message}`, SCRIPT_NAME);
        console.error(`[${SCRIPT_NAME}] 打开最近聊天失败。`, error);
      });
    });

  const $avatar = $('<span>').addClass('th-modern-recent-avatar');
  $('<img>')
    .attr({
      src: chat.char_thumbnail || 'img/ai4.png',
      alt: chat.char_name || '聊天头像',
    })
    .appendTo($avatar);

  const $main = $('<span>').addClass('th-modern-recent-main');
  $('<span>')
    .addClass('th-modern-recent-title')
    .text(chat.char_name ? `${chat.char_name} - ${chat.chat_name}` : (chat.chat_name ?? chat.file_name))
    .appendTo($main);
  $('<span>').addClass('th-modern-recent-message').text(chat.mes || '无最近消息').appendTo($main);

  const $meta = $('<span>').addClass('th-modern-recent-meta');
  $('<span>').text(chat.date_short ?? '').appendTo($meta);
  $('<span>').text(`${chat.chat_items ?? 0} 条`).appendTo($meta);

  return $item.append($avatar, $main, $meta);
}

async function openRecentChat(chat: RecentChat): Promise<void> {
  const context = getContext();
  const file_name = chat.chat_name ?? chat.file_name;

  if (chat.is_group && chat.group) {
    await context.openGroupById?.(chat.group);
    context.setActiveGroup?.(chat.group);
    await SillyTavern.openGroupChat(chat.group, file_name);
    void SillyTavern.saveSettingsDebounced?.();
    return;
  }

  if (chat.avatar) {
    const character_id = SillyTavern.characters.findIndex(character => character.avatar === chat.avatar);
    if (character_id === -1) {
      throw new Error('未找到对应角色。');
    }
    await SillyTavern.selectCharacterById(character_id);
    context.setActiveCharacter?.(chat.avatar);
    await SillyTavern.openCharacterChat(file_name);
    void SillyTavern.saveSettingsDebounced?.();
  }
}

function mountSidebar(): { $list: JQuery<HTMLElement>; destroy: () => void } {
  const $sidebar = createScriptIdDiv().attr('id', SIDEBAR_ID).addClass('th-modern-sidebar');
  const $brand = $('<div>').addClass('th-modern-sidebar-brand');
  $('<span>').addClass('th-modern-brand-icon fa-solid fa-mug-hot').appendTo($brand);
  $('<span>').addClass('th-modern-brand-name').text('SillyTavern').appendTo($brand);

  const $recent = $('<section>').addClass('th-modern-recent-section');
  const $recent_header = $('<div>').addClass('th-modern-section-header');
  $('<span>').text('最近聊天').appendTo($recent_header);
  const $refresh_button = $('<button>')
    .attr({ type: 'button', title: '刷新最近聊天' })
    .addClass('th-modern-icon-button fa-solid fa-rotate')
    .on('click', () => {
      void refreshRecentChats($list);
    });
  $recent_header.append($refresh_button);

  const $list = $('<div>').addClass('th-modern-recent-list');
  $recent.append($recent_header, $list);
  $sidebar.append($brand, $recent).appendTo('body');

  return {
    $list,
    destroy: () => {
      $sidebar.remove();
    },
  };
}

function renderRecentLoading($list: JQuery<HTMLElement>) {
  $list.empty().append($('<div>').addClass('th-modern-recent-state').text('正在读取最近聊天...'));
}

function renderRecentError($list: JQuery<HTMLElement>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  $list.empty().append($('<div>').addClass('th-modern-recent-state').text(`读取失败：${message}`));
}

async function refreshRecentChats($list: JQuery<HTMLElement>) {
  renderRecentLoading($list);
  try {
    const chats = await fetchRecentChats();
    $list.empty();
    if (chats.length === 0) {
      $list.append($('<div>').addClass('th-modern-recent-state').text('暂无最近聊天'));
      return;
    }
    chats.forEach(chat => {
      $list.append(createRecentChatElement(chat));
    });
  } catch (error) {
    renderRecentError($list, error);
  }
}

function getDrawerLabel($toggle: JQuery<HTMLElement>): string {
  const $icon = $toggle.children('.drawer-icon').first();
  return String($icon.attr('title') || $toggle.attr('title') || $toggle.text()).trim();
}

function closeDrawerContent(content: Element) {
  const $content = $(content);
  if (!$content.hasClass('openDrawer')) {
    return;
  }
  $content.removeClass('openDrawer').addClass('closedDrawer');
  const $icon = $content.closest('.drawer').find('.drawer-icon').first();
  if ($icon.hasClass('openIcon')) {
    $icon.removeClass('openIcon').addClass('closedIcon');
  }
}

function mountDrawerEnhancements(): { destroy: () => void } {
  const enhanceDrawers = () => {
    $('#top-settings-holder > .drawer > .drawer-toggle').each((_, toggle) => {
      const $toggle = $(toggle);
      if ($toggle.children(`.${TOPBAR_LABEL_CLASS}`).length > 0) {
        return;
      }

      const label = getDrawerLabel($toggle);
      if (!label) {
        return;
      }
      $('<span>').addClass(TOPBAR_LABEL_CLASS).text(label).appendTo($toggle);
    });

    $('#top-settings-holder > .drawer > .drawer-content').each((_, content) => {
      const $content = $(content);
      if ($content.children(`.${DRAWER_TITLEBAR_CLASS}`).length > 0) {
        return;
      }

      const label = getDrawerLabel($content.closest('.drawer').children('.drawer-toggle').first());
      const $titlebar = $('<div>').addClass(DRAWER_TITLEBAR_CLASS);
      $('<span>').addClass(DRAWER_TITLE_CLASS).text(label || '菜单').appendTo($titlebar);
      $('<button>')
        .attr({ type: 'button', title: '关闭面板' })
        .addClass(`${DRAWER_CLOSE_CLASS} fa-solid fa-xmark`)
        .on('click', event => {
          event.preventDefault();
          event.stopPropagation();
          closeDrawerContent(content);
        })
        .appendTo($titlebar);
      $content.prepend($titlebar);
    });
  };

  enhanceDrawers();
  const holder = $('#top-settings-holder')[0];
  const observer =
    holder instanceof HTMLElement
      ? new MutationObserver(() => {
          enhanceDrawers();
        })
      : undefined;
  observer?.observe(holder, { childList: true, subtree: true });

  return {
    destroy: () => {
      observer?.disconnect();
      $(`.${TOPBAR_LABEL_CLASS}`).remove();
      $(`.${DRAWER_TITLEBAR_CLASS}`).remove();
    },
  };
}

function showFailsafeRestoreConfirm(store: ReturnType<typeof useModernLayoutStore>, onClose: () => void) {
  const host_document = getHostDocument();
  $('.th-modern-failsafe-overlay', host_document).remove();

  const $overlay = $('<div>').addClass('th-modern-failsafe-overlay');
  const $dialog = $('<div>').addClass('th-modern-failsafe-dialog').appendTo($overlay);
  $('<strong>').text('关闭现代化界面？').appendTo($dialog);
  $('<p>').text('将立即还原 SillyTavern 原始布局，并保持关闭状态。之后可以在酒馆助手设置里重新启用。').appendTo($dialog);
  const $actions = $('<div>').addClass('th-modern-failsafe-actions').appendTo($dialog);

  const close = () => {
    $overlay.remove();
    onClose();
  };

  $('<button>')
    .attr('type', 'button')
    .addClass('menu_button')
    .text('取消')
    .on('click', close)
    .appendTo($actions);
  $('<button>')
    .attr('type', 'button')
    .addClass('menu_button th-modern-failsafe-confirm')
    .text('关闭并还原')
    .on('click', () => {
      store.disableModernLayout();
      toastr.warning('已关闭现代化界面。', SCRIPT_NAME);
      close();
    })
    .appendTo($actions);

  $overlay.on('click', event => {
    if (event.target === $overlay[0]) {
      close();
    }
  });
  $(host_document.body).append($overlay);
}

function mountFailsafeRestore(store: ReturnType<typeof useModernLayoutStore>): { destroy: () => void } {
  const host_document = getHostDocument();
  let typed_buffer = '';
  let is_prompt_open = false;
  let touch_timer: number | undefined;

  const openConfirm = () => {
    if (is_prompt_open || !store.is_active) {
      return;
    }
    is_prompt_open = true;
    showFailsafeRestoreConfirm(store, () => {
      is_prompt_open = false;
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) {
      return;
    }
    typed_buffer = `${typed_buffer}${event.key.toLowerCase()}`.slice(-FAILSAFE_KEY_SEQUENCE.length);
    if (typed_buffer === FAILSAFE_KEY_SEQUENCE) {
      typed_buffer = '';
      openConfirm();
    }
  };

  const cancelTouchTimer = () => {
    if (touch_timer !== undefined) {
      window.clearTimeout(touch_timer);
      touch_timer = undefined;
    }
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length < 3 || touch_timer !== undefined) {
      return;
    }
    touch_timer = window.setTimeout(() => {
      touch_timer = undefined;
      openConfirm();
    }, FAILSAFE_TOUCH_HOLD_MS);
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length < 3) {
      cancelTouchTimer();
    }
  };

  host_document.addEventListener('keydown', onKeyDown, true);
  host_document.addEventListener('touchstart', onTouchStart, { passive: true });
  host_document.addEventListener('touchend', onTouchEnd, { passive: true });
  host_document.addEventListener('touchcancel', cancelTouchTimer, { passive: true });

  return {
    destroy: () => {
      cancelTouchTimer();
      $('.th-modern-failsafe-overlay', host_document).remove();
      host_document.removeEventListener('keydown', onKeyDown, true);
      host_document.removeEventListener('touchstart', onTouchStart);
      host_document.removeEventListener('touchend', onTouchEnd);
      host_document.removeEventListener('touchcancel', cancelTouchTimer);
    },
  };
}

function clampFloatingElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) {
    return;
  }

  const host_window = element.ownerDocument.defaultView ?? window.parent ?? window;
  const margin = 8;
  const max_width = Math.max(160, host_window.innerWidth - margin * 2);
  const max_height = Math.max(120, host_window.innerHeight - margin * 2);
  element.style.maxWidth = `${max_width}px`;
  element.style.maxHeight = `${max_height}px`;

  const style = getComputedStyle(element);
  if (style.position !== 'absolute' && style.position !== 'fixed') {
    return;
  }

  const next_left = Math.min(Math.max(rect.left, margin), host_window.innerWidth - Math.min(rect.width, max_width) - margin);
  const next_top = Math.min(Math.max(rect.top, margin), host_window.innerHeight - Math.min(rect.height, max_height) - margin);
  if (Math.abs(next_left - rect.left) > 1) {
    element.style.left = `${style.position === 'fixed' ? next_left : next_left + host_window.scrollX}px`;
  }
  if (Math.abs(next_top - rect.top) > 1) {
    element.style.top = `${style.position === 'fixed' ? next_top : next_top + host_window.scrollY}px`;
  }
}

function mountFloatingMenuPositioner(): { destroy: () => void } {
  const host_document = getHostDocument();
  const selectors = [
    '.select2-container--open',
    '.select2-dropdown',
    '.ui-autocomplete',
    '.list-group',
    '#export_format_popup',
    '#rawPromptPopup',
  ];
  let frame = 0;

  const clampAll = () => {
    frame = 0;
    selectors.forEach(selector => {
      host_document.querySelectorAll<HTMLElement>(selector).forEach(element => {
        const style = getComputedStyle(element);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          clampFloatingElement(element);
        }
      });
    });
  };

  const schedule = () => {
    if (frame !== 0) {
      return;
    }
    frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(clampAll);
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(host_document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  host_document.addEventListener('click', schedule, true);
  host_document.addEventListener('focusin', schedule, true);
  host_document.addEventListener('keydown', schedule, true);

  return {
    destroy: () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      host_document.removeEventListener('click', schedule, true);
      host_document.removeEventListener('focusin', schedule, true);
      host_document.removeEventListener('keydown', schedule, true);
    },
  };
}

function applyBodyState(settings: ModernLayoutSettings, is_active: boolean, should_use_two_column: boolean) {
  $('body')
    .toggleClass(BODY_CLASS_ENABLED, is_active)
    .toggleClass(BODY_CLASS_TWO_COLUMN, should_use_two_column)
    .removeClass(BODY_CLASS_LEGACY_THREE_COLUMN);
  setHostCssVariable('--th-modern-left-width', `${clamp(settings.leftSidebarWidth, 320, 460, DEFAULT_LEFT_SIDEBAR_WIDTH)}px`);
  setHostCssVariable('--th-modern-overlay-width', `${clamp(settings.overlayPanelWidth, 720, 1080, DEFAULT_OVERLAY_PANEL_WIDTH)}px`);
}

function clearBodyState() {
  $('body').removeClass(`${BODY_CLASS_ENABLED} ${BODY_CLASS_TWO_COLUMN} ${BODY_CLASS_LEGACY_THREE_COLUMN}`);
  removeHostCssVariable('--th-modern-left-width');
  removeHostCssVariable('--th-modern-overlay-width');
}

$(() => {
  const previous_dispose = _.get(window.parent, RUNTIME_DISPOSE_PATH) as unknown;
  if (typeof previous_dispose === 'function') {
    previous_dispose({ unregisterUnique: false });
  }

  void checkMinimumVersion('4.0.0', SCRIPT_NAME);

  const pinia = getActivePinia() ?? createPinia();
  setActivePinia(pinia);

  const store = useModernLayoutStore();
  const { destroy: destroyPanel } = initPanel(pinia);
  const { destroy: destroyTeleportedStyle } = teleportStyle();
  const { destroy: destroySidebar, $list } = mountSidebar();
  const { destroy: destroyDrawerEnhancements } = mountDrawerEnhancements();
  const { destroy: destroyFailsafeRestore } = mountFailsafeRestore(store);
  const { destroy: destroyFloatingMenuPositioner } = mountFloatingMenuPositioner();

  const stop_state_watch = watch(
    () => [klona(store.settings), store.is_active, store.should_use_two_column] as const,
    ([settings, is_active, should_use_two_column]) => {
      applyBodyState(settings, is_active, should_use_two_column);
    },
    { immediate: true, deep: true },
  );

  const refresh_recent_chats = _.debounce(() => {
    if (store.is_active) {
      void refreshRecentChats($list);
    }
  }, 500);

  const events = [
    eventOn(tavern_events.APP_READY, refresh_recent_chats),
    eventOn(tavern_events.CHAT_CHANGED, refresh_recent_chats),
    eventOn(tavern_events.CHAT_CREATED, refresh_recent_chats),
    eventOn(tavern_events.CHAT_DELETED, refresh_recent_chats),
    eventOn(tavern_events.MESSAGE_SENT, refresh_recent_chats),
    eventOn(tavern_events.MESSAGE_RECEIVED, refresh_recent_chats),
    eventOn(tavern_events.CHARACTER_PAGE_LOADED, refresh_recent_chats),
  ];

  refresh_recent_chats();

  const destroyAll = _.once((options: { unregisterUnique?: boolean } = {}) => {
    refresh_recent_chats.cancel();
    events.forEach(event => event.stop());
    stop_state_watch();
    store.destroy({ unregisterUnique: options.unregisterUnique });
    clearBodyState();
    destroyFloatingMenuPositioner();
    destroyFailsafeRestore();
    destroyDrawerEnhancements();
    destroySidebar();
    destroyPanel();
    destroyTeleportedStyle();
    if (_.get(window.parent, RUNTIME_DISPOSE_PATH) === destroyAll) {
      _.unset(window.parent, RUNTIME_DISPOSE_PATH);
    }
  });

  _.set(window.parent, RUNTIME_DISPOSE_PATH, destroyAll);
  $(window)
    .off('pagehide.th-modern-layout')
    .on('pagehide.th-modern-layout', () => destroyAll());
});
