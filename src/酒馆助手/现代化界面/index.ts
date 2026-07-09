import { checkMinimumVersion } from '@util/common';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { mountCharacterManagement } from './character-management-module';
import { initPanel } from './panel';
import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  DEFAULT_MAIN_CHAT_MAX_WIDTH,
  DEFAULT_OVERLAY_PANEL_WIDTH,
  SCRIPT_NAME,
  type ModernLayoutSettings,
  useModernLayoutStore,
} from './store';
import { mountWorldInfoEditor } from './world-info-module';
import './style.css';
import './world-info.css';
import './character-management.css';

const BODY_CLASS_ENABLED = 'th-modern-enabled';
const BODY_CLASS_TWO_COLUMN = 'th-modern-two-column';
const BODY_CLASS_LEGACY_THREE_COLUMN = 'th-modern-three-column';
const BODY_CLASS_REDUCE_MOTION = 'th-modern-reduce-motion';
const BODY_CLASS_REDUCE_ADVANCED_EFFECTS = 'th-modern-reduce-advanced-effects';
const BODY_CLASS_SIDEBAR_COLLAPSED = 'th-modern-sidebar-collapsed';
const BODY_CLASS_AUTO_COLLAPSE = 'th-modern-auto-collapse';
const BODY_CLASS_TEMP_EXPANDED = 'th-modern-sidebar-temp-expanded';
const BODY_CLASS_RESIZING = 'th-modern-resizing';
const BODY_CLASS_DRAWER_FULLSCREEN = 'th-modern-drawer-fullscreen';
const BODY_CLASS_DRAWER_OPEN = 'th-modern-drawer-open';
const ICON_STYLESHEET_ID = 'th-modern-bootstrap-icons';
const ICON_STYLESHEET_HREF = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css';
const SIDEBAR_ID = 'th-modern-sidebar';
const SIDEBAR_RESIZE_HANDLE_ID = 'th-modern-sidebar-resize-handle';
const OVERLAY_RESIZE_HANDLE_ID = 'th-modern-overlay-resize-handle';
const TOPBAR_LABEL_CLASS = 'th-modern-topbar-label';
const DRAWER_TITLEBAR_CLASS = 'th-modern-drawer-titlebar';
const DRAWER_TITLE_CLASS = 'th-modern-drawer-title';
const DRAWER_ACTIONS_CLASS = 'th-modern-drawer-actions';
const DRAWER_CLOSE_CLASS = 'th-modern-drawer-close';
const DRAWER_FULLSCREEN_CLASS = 'th-modern-drawer-fullscreen-toggle';
const DRAWER_FULLSCREEN_CONTENT_CLASS = 'th-modern-drawer-fullscreen-content';
const DRAWER_FULLSCREEN_PIN_DATA = 'thModernFullscreenPinned';
const DRAWER_FULLSCREEN_WAS_PINNED_DATA = 'thModernFullscreenWasPinned';
const API_SOURCE_GROUP_CLASS = 'th-modern-api-source-group';
const API_FOOTER_CLASS = 'th-modern-api-footer';
const FAILSAFE_KEY_SEQUENCE = 'th-reset';
const FAILSAFE_TOUCH_HOLD_MS = 5000;
const RUNTIME_DISPOSE_PATH = 'TavernHelper.modernLayout.dispose';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'TavernHelper.modernLayout.sidebarCollapsed';
const RECENT_COLLAPSED_STORAGE_KEY = 'TavernHelper.modernLayout.recentCollapsed';
const RECENT_CHAT_LIMIT = 15;
const COMPACT_TWO_COLUMN_QUERY = '(min-width: 900px) and (max-width: 1199.98px)';
const DESKTOP_TWO_COLUMN_QUERY = '(min-width: 900px)';
const LEFT_SIDEBAR_MIN_WIDTH = 320;
const LEFT_SIDEBAR_MAX_WIDTH = 460;
const OVERLAY_PANEL_MIN_WIDTH = 720;
const OVERLAY_PANEL_RESERVED_WIDTH = 24;
const LEFT_NAV_HEIGHT_VARIABLE = '--th-modern-left-nav-height';
const LEFT_NAV_TOP_FALLBACK = 66;
const LEFT_NAV_RECENT_MIN_HEIGHT_FALLBACK = 152;
const LEFT_NAV_BOTTOM_GAP = 24;

let is_drawer_fullscreen_mode = false;

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

function getHostStorage(): Storage | undefined {
  return (getHostDocument().defaultView ?? window).localStorage;
}

function readStoredBoolean(key: string): boolean {
  try {
    return getHostStorage()?.getItem(key) === 'true';
  } catch (error) {
    console.warn(`[${SCRIPT_NAME}] 读取浏览器状态失败。`, error);
    return false;
  }
}

function writeStoredBoolean(key: string, value: boolean) {
  try {
    getHostStorage()?.setItem(key, String(value));
  } catch (error) {
    console.warn(`[${SCRIPT_NAME}] 保存浏览器状态失败。`, error);
  }
}

function getHostDocuments(): Document[] {
  return _.uniq([document, getHostDocument()]);
}

function setHostCssVariable(name: string, value: string) {
  getHostStyleTargets().forEach(element => {
    if (element.style.getPropertyValue(name) !== value) {
      element.style.setProperty(name, value);
    }
  });
}

function removeHostCssVariable(name: string) {
  getHostStyleTargets().forEach(element => {
    if (element.style.getPropertyValue(name)) {
      element.style.removeProperty(name);
    }
  });
}

function parseCssPixelValue(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setCssVariableForTargets(targets: HTMLElement[], name: string, value: string) {
  targets.forEach(element => {
    if (element.style.getPropertyValue(name) !== value) {
      element.style.setProperty(name, value);
    }
  });
}

function mountIconStylesheet(): { destroy: () => void } {
  const mounted_links = getHostDocuments().flatMap(host_document => {
    if (host_document.getElementById(ICON_STYLESHEET_ID)) {
      return [];
    }

    const link = host_document.createElement('link');
    link.id = ICON_STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = ICON_STYLESHEET_HREF;
    link.dataset.thModernOwned = 'true';
    host_document.head.append(link);
    return [link];
  });

  return {
    destroy: () => {
      mounted_links.forEach(link => {
        link.remove();
      });
    },
  };
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
  const $sidebar = createScriptIdDiv().attr('id', SIDEBAR_ID).addClass('th-modern-sidebar recentChat');
  const $brand = $('<div>').addClass('th-modern-sidebar-brand');
  const $brand_main = $('<span>').addClass('th-modern-brand-main').appendTo($brand);
  $('<img>')
    .addClass('th-modern-brand-logo welcomeHeaderLogo')
    .attr({ src: 'img/logo.png', alt: 'SillyTavern Logo', 'data-i18n': '[alt]SillyTavern Logo' })
    .appendTo($brand_main);
  $('<span>').addClass('th-modern-brand-name').text('SillyTavern').appendTo($brand_main);
  const $sidebar_collapse_button = $('<button>')
    .attr({ type: 'button', title: '折叠侧边栏', 'aria-pressed': 'false' })
    .addClass('th-modern-icon-button th-modern-sidebar-toggle bi bi-chevron-left')
    .appendTo($brand);

  const $recent = $('<section>').addClass('th-modern-recent-section');
  const recent_list_id = `${SIDEBAR_ID}-recent-list`;
  const $recent_header = $('<div>')
    .attr({ role: 'button', tabindex: '0', title: '折叠最近聊天', 'aria-controls': recent_list_id, 'aria-expanded': 'true' })
    .addClass('th-modern-section-header');
  const $recent_title = $('<span>').addClass('th-modern-section-title');
  const $recent_actions = $('<span>').addClass('th-modern-section-actions');
  const $collapse_button = $('<button>')
    .attr({ type: 'button', title: '折叠最近聊天', 'aria-expanded': 'true' })
    .addClass('th-modern-icon-button th-modern-recent-collapse bi bi-chevron-up');
  $('<span>').addClass('th-modern-section-label').text('最近聊天').appendTo($recent_title);
  $recent_title.prepend($collapse_button);

  const setSidebarCollapsed = (collapsed: boolean, persist = true) => {
    $(getHostDocument().body).toggleClass(BODY_CLASS_SIDEBAR_COLLAPSED, collapsed);
    $(getHostDocument().body).removeClass(BODY_CLASS_TEMP_EXPANDED);
    $sidebar.toggleClass('is-collapsed', collapsed);
    syncSidebarToggleButton();
    if (persist) {
      writeStoredBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed);
    }
  };

  const syncSidebarToggleButton = () => {
    const body = getHostDocument().body;
    const manually_collapsed = body.classList.contains(BODY_CLASS_SIDEBAR_COLLAPSED);
    const auto_collapsed = body.classList.contains(BODY_CLASS_AUTO_COLLAPSE) && !body.classList.contains(BODY_CLASS_TEMP_EXPANDED);
    const collapsed = manually_collapsed || auto_collapsed;
    $sidebar_collapse_button
      .toggleClass('bi-chevron-left', !collapsed)
      .toggleClass('bi-chevron-right', collapsed)
      .attr({
        title: collapsed ? '展开侧边栏' : '折叠侧边栏',
        'aria-pressed': String(collapsed),
      });
  };

  const setRecentCollapsed = (collapsed: boolean, persist = true) => {
    const title = collapsed ? '展开最近聊天' : '折叠最近聊天';
    $recent.toggleClass('is-collapsed', collapsed);
    $recent_header.attr({ title, 'aria-expanded': String(!collapsed) });
    $collapse_button
      .toggleClass('bi-chevron-up', !collapsed)
      .toggleClass('bi-chevron-down', collapsed)
      .attr({
        title,
        'aria-expanded': String(!collapsed),
      });
    if (persist) {
      writeStoredBoolean(RECENT_COLLAPSED_STORAGE_KEY, collapsed);
    }
  };

  const toggleRecentCollapse = () => {
    setRecentCollapsed(!$recent.hasClass('is-collapsed'));
  };

  $sidebar_collapse_button.on('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const body = getHostDocument().body;
    if (body.classList.contains(BODY_CLASS_AUTO_COLLAPSE) && !body.classList.contains(BODY_CLASS_SIDEBAR_COLLAPSED)) {
      body.classList.toggle(BODY_CLASS_TEMP_EXPANDED);
      syncSidebarToggleButton();
      return;
    }
    setSidebarCollapsed(!body.classList.contains(BODY_CLASS_SIDEBAR_COLLAPSED));
  });
  $collapse_button.on('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleRecentCollapse();
  });
  $recent_header.on('click', () => {
    toggleRecentCollapse();
  });
  $recent_header.on('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    toggleRecentCollapse();
  });
  const $refresh_button = $('<button>')
    .attr({ type: 'button', title: '刷新最近聊天' })
    .addClass('th-modern-icon-button bi bi-arrow-clockwise')
    .on('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void refreshRecentChats($list);
    });
  $recent_actions.append($refresh_button);
  $recent_header.append($recent_title, $recent_actions);

  const $list = $('<div>').attr('id', recent_list_id).addClass('th-modern-recent-list');
  $recent.append($recent_header, $list);
  $sidebar.append($brand, $recent).appendTo('body');
  const body_observer = new MutationObserver(syncSidebarToggleButton);
  body_observer.observe(getHostDocument().body, { attributes: true, attributeFilter: ['class'] });
  setSidebarCollapsed(readStoredBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY), false);
  setRecentCollapsed(readStoredBoolean(RECENT_COLLAPSED_STORAGE_KEY), false);
  syncSidebarToggleButton();

  return {
    $list,
    destroy: () => {
      body_observer.disconnect();
      $(getHostDocument().body).removeClass(BODY_CLASS_SIDEBAR_COLLAPSED);
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

function getFullscreenDrawerContent(): HTMLElement | undefined {
  return (
    getHostDocument().querySelector<HTMLElement>(
      `#top-settings-holder > .drawer > .drawer-content.${DRAWER_FULLSCREEN_CONTENT_CLASS}`,
    ) ?? undefined
  );
}

function syncDrawerFullscreenButtons() {
  const active_content = getFullscreenDrawerContent();
  $(`.${DRAWER_FULLSCREEN_CLASS}`, getHostDocument()).each((_, button) => {
    const is_fullscreen = is_drawer_fullscreen_mode && Boolean(active_content && $(button).closest('.drawer-content')[0] === active_content);
    $(button)
      .toggleClass('is-fullscreen', is_fullscreen)
      .toggleClass('bi-arrows-fullscreen', !is_fullscreen)
      .toggleClass('bi-fullscreen-exit', is_fullscreen)
      .attr({
        title: is_fullscreen ? '恢复面板宽度' : '全屏显示面板',
        'aria-label': is_fullscreen ? '恢复面板宽度' : '全屏显示面板',
      });
  });
}

function syncDrawerOpenState(open_contents?: HTMLElement[]) {
  const host_document = getHostDocument();
  const has_open_drawer =
    open_contents !== undefined
      ? open_contents.length > 0
      : Boolean(host_document.querySelector('#top-settings-holder > .drawer > .drawer-content.openDrawer'));
  host_document.body.classList.toggle(BODY_CLASS_DRAWER_OPEN, has_open_drawer);
}

function removeDrawerFullscreenContent() {
  const content = getFullscreenDrawerContent();
  if (content) {
    const was_pinned = content.dataset[DRAWER_FULLSCREEN_WAS_PINNED_DATA] === 'true';
    const has_pin_record = content.dataset[DRAWER_FULLSCREEN_WAS_PINNED_DATA] !== undefined;
    const pinned_by_modern_fullscreen = has_pin_record ? !was_pinned : true;
    $(content).removeClass(DRAWER_FULLSCREEN_CONTENT_CLASS);
    if (pinned_by_modern_fullscreen) {
      $(content).removeClass('pinnedOpen');
    } else if (was_pinned) {
      $(content).addClass('pinnedOpen');
    }
    delete content.dataset[DRAWER_FULLSCREEN_PIN_DATA];
    delete content.dataset[DRAWER_FULLSCREEN_WAS_PINNED_DATA];
  }
  getHostDocument().body.classList.remove(BODY_CLASS_DRAWER_FULLSCREEN);
  syncDrawerOpenState();
}

function clearDrawerFullscreen() {
  is_drawer_fullscreen_mode = false;
  removeDrawerFullscreenContent();
  syncDrawerFullscreenButtons();
}

function applyDrawerFullscreenContent(content: Element) {
  const active_content = getFullscreenDrawerContent();
  if (active_content && active_content !== content) {
    removeDrawerFullscreenContent();
  }

  const host_window = getHostDocument().defaultView ?? window;
  if (!(content instanceof host_window.HTMLElement)) {
    return;
  }

  const body = getHostDocument().body;
  const $content = $(content);
  if (content.dataset[DRAWER_FULLSCREEN_WAS_PINNED_DATA] === undefined) {
    const was_pinned = $content.hasClass('pinnedOpen');
    content.dataset[DRAWER_FULLSCREEN_WAS_PINNED_DATA] = String(was_pinned);
    if (!was_pinned) {
      content.dataset[DRAWER_FULLSCREEN_PIN_DATA] = 'true';
    }
  }
  $content.addClass(`${DRAWER_FULLSCREEN_CONTENT_CLASS} pinnedOpen openDrawer`).removeClass('closedDrawer');
  const $icon = $content.closest('.drawer').find('.drawer-icon').first();
  if ($icon.hasClass('closedIcon')) {
    $icon.removeClass('closedIcon').addClass('openIcon');
  }
  body.classList.add(BODY_CLASS_DRAWER_FULLSCREEN);
  syncDrawerOpenState([content]);
  if (body.classList.contains(BODY_CLASS_AUTO_COLLAPSE) && !body.classList.contains(BODY_CLASS_SIDEBAR_COLLAPSED)) {
    body.classList.add(BODY_CLASS_TEMP_EXPANDED);
  }
  syncDrawerFullscreenButtons();
}

function setDrawerFullscreen(content: Element, fullscreen: boolean) {
  is_drawer_fullscreen_mode = fullscreen;
  if (!fullscreen) {
    clearDrawerFullscreen();
    return;
  }

  applyDrawerFullscreenContent(content);
}

function closeDrawerContent(content: Element) {
  if (getFullscreenDrawerContent() === content) {
    removeDrawerFullscreenContent();
  }

  const $content = $(content);
  if (!$content.hasClass('openDrawer')) {
    return;
  }
  $content.removeClass('openDrawer').addClass('closedDrawer');
  const $icon = $content.closest('.drawer').find('.drawer-icon').first();
  if ($icon.hasClass('openIcon')) {
    $icon.removeClass('openIcon').addClass('closedIcon');
  }
  syncDrawerOpenState();
}

function openDrawerContent(content: Element) {
  const active_fullscreen_content = getFullscreenDrawerContent();
  if (active_fullscreen_content && active_fullscreen_content !== content) {
    removeDrawerFullscreenContent();
  }

  const $content = $(content);
  if ($content.hasClass('openDrawer')) {
    if (is_drawer_fullscreen_mode) {
      applyDrawerFullscreenContent(content);
    }
    return;
  }

  const $open_drawers = $('.openDrawer:not(.pinnedOpen)').not(content);
  $open_drawers.removeClass('openDrawer').addClass('closedDrawer');
  $('.openIcon:not(.drawerPinnedOpen)').removeClass('openIcon').addClass('closedIcon');
  $content.removeClass('closedDrawer').addClass('openDrawer');
  const $icon = $content.closest('.drawer').find('.drawer-icon').first();
  if ($icon.hasClass('closedIcon')) {
    $icon.removeClass('closedIcon').addClass('openIcon');
  }
  if (is_drawer_fullscreen_mode) {
    applyDrawerFullscreenContent(content);
  }
  syncDrawerOpenState();
}

function mountDrawerEnhancements(): { destroy: () => void } {
  const host_document = getHostDocument();
  const host_window = host_document.defaultView ?? window;
  let scheduled_reconcile = 0;

  const scheduleReconcileDrawerFullscreen = () => {
    if (scheduled_reconcile !== 0) {
      return;
    }
    scheduled_reconcile = host_window.requestAnimationFrame(() => {
      scheduled_reconcile = 0;
      reconcileDrawerFullscreen();
    });
  };

  const reconcileDrawerFullscreen = () => {
    const fullscreen_content = getFullscreenDrawerContent();
    const open_contents = Array.from(
      host_document.querySelectorAll<HTMLElement>('#top-settings-holder > .drawer > .drawer-content.openDrawer'),
    );
    syncDrawerOpenState(open_contents);
    if (!fullscreen_content) {
      host_document.body.classList.remove(BODY_CLASS_DRAWER_FULLSCREEN);
      if (is_drawer_fullscreen_mode && open_contents[0]) {
        applyDrawerFullscreenContent(open_contents[0]);
        return;
      }
      syncDrawerFullscreenButtons();
      return;
    }

    if (!fullscreen_content.isConnected || !fullscreen_content.classList.contains('openDrawer')) {
      removeDrawerFullscreenContent();
      if (is_drawer_fullscreen_mode && open_contents[0]) {
        applyDrawerFullscreenContent(open_contents[0]);
      } else {
        syncDrawerFullscreenButtons();
      }
      return;
    }

    const other_open_content = open_contents.find(content => content !== fullscreen_content);
    if (!other_open_content) {
      return;
    }

    removeDrawerFullscreenContent();
    closeDrawerContent(fullscreen_content);
    if (is_drawer_fullscreen_mode) {
      applyDrawerFullscreenContent(other_open_content);
      return;
    }
    syncDrawerFullscreenButtons();
  };

  const enhanceDrawers = () => {
    $('#top-settings-holder > .drawer > .drawer-toggle').each((_, toggle) => {
      const $toggle = $(toggle);
      const label = getDrawerLabel($toggle);
      if (label) {
        $toggle.attr({ title: label, 'aria-label': label });
      }
      if ($toggle.children(`.${TOPBAR_LABEL_CLASS}`).length > 0) {
        return;
      }

      if (!label) {
        return;
      }
      $('<span>').addClass(TOPBAR_LABEL_CLASS).text(label).appendTo($toggle);
    });

    $('#top-settings-holder > .drawer > .drawer-content').each((_, content) => {
      const $content = $(content);
      const $existing_titlebars = $content.children(`.${DRAWER_TITLEBAR_CLASS}`);
      const $existing_titlebar = $existing_titlebars.first();
      $existing_titlebars.slice(1).remove();
      if ($existing_titlebar.length > 0) {
        return;
      }

      const label = getDrawerLabel($content.closest('.drawer').children('.drawer-toggle').first());
      const $titlebar = $('<div>').addClass(DRAWER_TITLEBAR_CLASS);
      $('<span>').addClass(DRAWER_TITLE_CLASS).text(label || '菜单').appendTo($titlebar);
      const $actions = $('<div>').addClass(DRAWER_ACTIONS_CLASS).appendTo($titlebar);
      $('<button>')
        .attr({ type: 'button', title: '全屏显示面板', 'aria-label': '全屏显示面板' })
        .addClass(`${DRAWER_FULLSCREEN_CLASS} bi bi-arrows-fullscreen`)
        .appendTo($actions);
      $('<button>')
        .attr({ type: 'button', title: '关闭面板' })
        .addClass(`${DRAWER_CLOSE_CLASS} bi bi-x-lg`)
        .appendTo($actions);
      $content.prepend($titlebar);
    });
    syncDrawerFullscreenButtons();
    reconcileDrawerFullscreen();
  };

  const handleDrawerActionClick = (event: MouseEvent) => {
    const target = event.target instanceof host_window.Element ? event.target : null;
    const action = target?.closest(`.${DRAWER_FULLSCREEN_CLASS}, .${DRAWER_CLOSE_CLASS}`);
    if (!action) {
      const toggle = target?.closest('#top-settings-holder > .drawer > .drawer-toggle');
      if (toggle) {
        scheduleReconcileDrawerFullscreen();
      }
      return;
    }

    const content = action.closest('#top-settings-holder > .drawer > .drawer-content');
    if (!content) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (action.classList.contains(DRAWER_FULLSCREEN_CLASS)) {
      const is_fullscreen = getFullscreenDrawerContent() === content;
      setDrawerFullscreen(content, !is_fullscreen);
      return;
    }

    closeDrawerContent(content);
  };

  enhanceDrawers();
  const holder = $('#top-settings-holder')[0];
  const observer =
    holder instanceof host_window.HTMLElement
      ? new MutationObserver(mutations => {
          if (mutations.some(mutation => mutation.type === 'childList')) {
            enhanceDrawers();
            return;
          }
          if (
            mutations.some(
              mutation =>
                mutation.type === 'attributes' &&
                mutation.target instanceof host_window.Element &&
                mutation.target.matches('#top-settings-holder > .drawer > .drawer-content'),
            )
          ) {
            scheduleReconcileDrawerFullscreen();
          }
        })
      : undefined;
  observer?.observe(holder, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  host_document.addEventListener('click', handleDrawerActionClick, true);

  return {
    destroy: () => {
      if (scheduled_reconcile !== 0) {
        host_window.cancelAnimationFrame(scheduled_reconcile);
      }
      observer?.disconnect();
      host_document.removeEventListener('click', handleDrawerActionClick, true);
      clearDrawerFullscreen();
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
  const max_width_value = `${max_width}px`;
  const max_height_value = `${max_height}px`;
  if (element.style.maxWidth !== max_width_value) {
    element.style.maxWidth = max_width_value;
  }
  if (element.style.maxHeight !== max_height_value) {
    element.style.maxHeight = max_height_value;
  }

  const style = getComputedStyle(element);
  if (style.position !== 'absolute' && style.position !== 'fixed') {
    return;
  }

  const next_left = Math.min(Math.max(rect.left, margin), host_window.innerWidth - Math.min(rect.width, max_width) - margin);
  const next_top = Math.min(Math.max(rect.top, margin), host_window.innerHeight - Math.min(rect.height, max_height) - margin);
  if (Math.abs(next_left - rect.left) > 1) {
    const left_value = `${style.position === 'fixed' ? next_left : next_left + host_window.scrollX}px`;
    if (element.style.left !== left_value) {
      element.style.left = left_value;
    }
  }
  if (Math.abs(next_top - rect.top) > 1) {
    const top_value = `${style.position === 'fixed' ? next_top : next_top + host_window.scrollY}px`;
    if (element.style.top !== top_value) {
      element.style.top = top_value;
    }
  }
}

function mountFloatingMenuPositioner(): { destroy: () => void } {
  const host_document = getHostDocument();
  const host_window = host_document.defaultView ?? window;
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
    if (host_document.body.classList.contains(BODY_CLASS_RESIZING)) {
      return;
    }
    if (frame !== 0) {
      return;
    }
    frame = host_window.requestAnimationFrame(() => {
      frame = host_window.requestAnimationFrame(clampAll);
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
        host_window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      host_document.removeEventListener('click', schedule, true);
      host_document.removeEventListener('focusin', schedule, true);
      host_document.removeEventListener('keydown', schedule, true);
    },
  };
}

function mountResponsiveMode(store: ReturnType<typeof useModernLayoutStore>): { destroy: () => void } {
  const host_document = getHostDocument();
  const host_window = host_document.defaultView ?? window;
  const compact_query = host_window.matchMedia(COMPACT_TWO_COLUMN_QUERY);

  const sync = () => {
    applyBodyState(store.settings, store.is_active, store.should_use_two_column);
  };

  const handlePointerDown = (event: PointerEvent) => {
    const body = host_document.body;
    if (!body.classList.contains(BODY_CLASS_AUTO_COLLAPSE) || body.classList.contains(BODY_CLASS_SIDEBAR_COLLAPSED)) {
      return;
    }

    const target = event.target instanceof host_window.Element ? event.target : null;
    const is_sidebar_area = Boolean(target?.closest(`#${SIDEBAR_ID}, #top-settings-holder`));
    if (body.classList.contains(BODY_CLASS_DRAWER_FULLSCREEN)) {
      body.classList.add(BODY_CLASS_TEMP_EXPANDED);
      return;
    }

    if (body.classList.contains(BODY_CLASS_TEMP_EXPANDED)) {
      if (!is_sidebar_area) {
        body.classList.remove(BODY_CLASS_TEMP_EXPANDED);
      }
      return;
    }

    if (is_sidebar_area) {
      body.classList.add(BODY_CLASS_TEMP_EXPANDED);
    }
  };

  const handleDrawerToggleClick = (event: MouseEvent) => {
    const $body = $(host_document.body);
    if (!$body.hasClass(BODY_CLASS_AUTO_COLLAPSE) || $body.hasClass(BODY_CLASS_SIDEBAR_COLLAPSED)) {
      return;
    }

    const target = event.target instanceof host_window.Element ? event.target : null;
    const toggle = target?.closest('#top-settings-holder > .drawer > .drawer-toggle');
    if (!toggle) {
      return;
    }

    const content = $(toggle).closest('.drawer').children('.drawer-content')[0];
    if (!content) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    $body.addClass(BODY_CLASS_TEMP_EXPANDED);
    if ($(content).hasClass('openDrawer')) {
      closeDrawerContent(content);
    } else {
      openDrawerContent(content);
    }
  };

  compact_query.addEventListener('change', sync);
  host_document.addEventListener('pointerdown', handlePointerDown, true);
  host_document.addEventListener('click', handleDrawerToggleClick, true);
  sync();

  return {
    destroy: () => {
      compact_query.removeEventListener('change', sync);
      host_document.removeEventListener('pointerdown', handlePointerDown, true);
      host_document.removeEventListener('click', handleDrawerToggleClick, true);
      host_document.body.classList.remove(BODY_CLASS_AUTO_COLLAPSE, BODY_CLASS_TEMP_EXPANDED);
    },
  };
}

function mountSidebarNavSizer(): { destroy: () => void } {
  const host_document = getHostDocument();
  const host_window = host_document.defaultView ?? window;
  const holder = host_document.getElementById('top-settings-holder');
  let frame = 0;

  const measureOuterHeight = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const style = host_window.getComputedStyle(element);
    return rect.height + parseCssPixelValue(style.marginTop, 0) + parseCssPixelValue(style.marginBottom, 0);
  };

  const update = () => {
    frame = 0;
    if (!(holder instanceof host_window.HTMLElement)) {
      removeHostCssVariable(LEFT_NAV_HEIGHT_VARIABLE);
      return;
    }

    const body = host_document.body;
    if (!body.classList.contains(BODY_CLASS_ENABLED) || !body.classList.contains(BODY_CLASS_TWO_COLUMN)) {
      removeHostCssVariable(LEFT_NAV_HEIGHT_VARIABLE);
      return;
    }

    const body_style = host_window.getComputedStyle(body);
    const nav_top = parseCssPixelValue(body_style.getPropertyValue('--th-modern-left-nav-top'), LEFT_NAV_TOP_FALLBACK);
    const recent_min_height = parseCssPixelValue(
      body_style.getPropertyValue('--th-modern-recent-min-height'),
      LEFT_NAV_RECENT_MIN_HEIGHT_FALLBACK,
    );
    const max_height = Math.max(48, host_window.innerHeight - nav_top - recent_min_height - LEFT_NAV_BOTTOM_GAP);
    const holder_style = host_window.getComputedStyle(holder);
    const padding_height = parseCssPixelValue(holder_style.paddingTop, 0) + parseCssPixelValue(holder_style.paddingBottom, 0);
    const content_height = Array.from(holder.querySelectorAll<HTMLElement>(':scope > .drawer > .drawer-toggle')).reduce(
      (height, toggle) => {
        const toggle_style = host_window.getComputedStyle(toggle);
        if (toggle_style.display === 'none' || toggle_style.visibility === 'hidden') {
          return height;
        }
        return height + measureOuterHeight(toggle);
      },
      padding_height,
    );
    const next_height = Math.ceil(Math.min(Math.max(content_height, 48), max_height));
    setHostCssVariable(LEFT_NAV_HEIGHT_VARIABLE, `${next_height}px`);
  };

  const schedule = () => {
    if (frame !== 0) {
      return;
    }
    frame = host_window.requestAnimationFrame(update);
  };

  const holder_observer =
    holder instanceof host_window.HTMLElement
      ? new MutationObserver(schedule)
      : undefined;
  holder_observer?.observe(holder!, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  const body_observer = new MutationObserver(schedule);
  body_observer.observe(host_document.body, { attributes: true, attributeFilter: ['class'] });
  host_window.addEventListener('resize', schedule);
  schedule();

  return {
    destroy: () => {
      if (frame !== 0) {
        host_window.cancelAnimationFrame(frame);
      }
      holder_observer?.disconnect();
      body_observer.disconnect();
      host_window.removeEventListener('resize', schedule);
      removeHostCssVariable(LEFT_NAV_HEIGHT_VARIABLE);
    },
  };
}

function mountResizeHandles(store: ReturnType<typeof useModernLayoutStore>): { destroy: () => void } {
  const host_document = getHostDocument();
  const host_window = host_document.defaultView ?? window;
  const $sidebar_handle = createScriptIdDiv().attr('id', SIDEBAR_RESIZE_HANDLE_ID).appendTo('body');
  const $overlay_handle = createScriptIdDiv().attr('id', OVERLAY_RESIZE_HANDLE_ID).appendTo('body');
  let active_drag_cleanup: (() => void) | undefined;

  const startDrag = (event: PointerEvent, kind: 'sidebar' | 'overlay') => {
    if (event.button !== 0) {
      return;
    }

    const body = host_document.body;
    const sidebar = host_document.getElementById(SIDEBAR_ID);
    const open_drawer = host_document.querySelector<HTMLElement>('#top-settings-holder > .drawer > .drawer-content.openDrawer');
    if (kind === 'sidebar' && (!sidebar || open_drawer || body.classList.contains(BODY_CLASS_SIDEBAR_COLLAPSED) || body.classList.contains(BODY_CLASS_AUTO_COLLAPSE))) {
      return;
    }
    if (kind === 'overlay' && !open_drawer) {
      return;
    }

    active_drag_cleanup?.();
    event.preventDefault();
    const start_x = event.clientX;
    const start_width = kind === 'sidebar' ? sidebar!.getBoundingClientRect().width : open_drawer!.getBoundingClientRect().width;
    const drawer_left = open_drawer?.getBoundingClientRect().left ?? 0;
    const css_variable = kind === 'sidebar' ? '--th-modern-left-width' : '--th-modern-overlay-width';
    const css_targets = getHostStyleTargets();
    let pending_width = Math.round(start_width);
    let animation_frame = 0;
    body.classList.add(BODY_CLASS_RESIZING);

    const applyPendingWidth = () => {
      animation_frame = 0;
      setCssVariableForTargets(css_targets, css_variable, `${pending_width}px`);
    };

    const scheduleWidthApply = (next_width: number) => {
      if (next_width === pending_width) {
        return;
      }
      pending_width = next_width;
      if (animation_frame === 0) {
        animation_frame = host_window.requestAnimationFrame(applyPendingWidth);
      }
    };

    const handlePointerMove = (move_event: PointerEvent) => {
      const delta = move_event.clientX - start_x;
      if (kind === 'sidebar') {
        scheduleWidthApply(Math.round(clamp(start_width + delta, LEFT_SIDEBAR_MIN_WIDTH, LEFT_SIDEBAR_MAX_WIDTH, DEFAULT_LEFT_SIDEBAR_WIDTH)));
        return;
      }

      const max_width = Math.max(OVERLAY_PANEL_MIN_WIDTH, host_window.innerWidth - drawer_left - OVERLAY_PANEL_RESERVED_WIDTH);
      scheduleWidthApply(Math.round(clamp(start_width + delta, OVERLAY_PANEL_MIN_WIDTH, max_width, DEFAULT_OVERLAY_PANEL_WIDTH)));
    };

    const stopDrag = () => {
      if (animation_frame !== 0) {
        host_window.cancelAnimationFrame(animation_frame);
        applyPendingWidth();
      }
      if (kind === 'sidebar' && store.settings.leftSidebarWidth !== pending_width) {
        store.settings.leftSidebarWidth = pending_width;
      }
      if (kind === 'overlay' && store.settings.overlayPanelWidth !== pending_width) {
        store.settings.overlayPanelWidth = pending_width;
      }
      body.classList.remove(BODY_CLASS_RESIZING);
      host_window.removeEventListener('pointermove', handlePointerMove);
      host_window.removeEventListener('pointerup', stopDrag);
      host_window.removeEventListener('pointercancel', stopDrag);
      active_drag_cleanup = undefined;
    };

    active_drag_cleanup = stopDrag;
    host_window.addEventListener('pointermove', handlePointerMove);
    host_window.addEventListener('pointerup', stopDrag);
    host_window.addEventListener('pointercancel', stopDrag);
  };

  const handleSidebarPointerDown = (event: JQuery.TriggeredEvent) => {
    startDrag(event.originalEvent as PointerEvent, 'sidebar');
  };
  const handleOverlayPointerDown = (event: JQuery.TriggeredEvent) => {
    startDrag(event.originalEvent as PointerEvent, 'overlay');
  };

  $sidebar_handle.on('pointerdown', handleSidebarPointerDown);
  $overlay_handle.on('pointerdown', handleOverlayPointerDown);

  return {
    destroy: () => {
      active_drag_cleanup?.();
      $sidebar_handle.remove();
      $overlay_handle.remove();
      host_document.body.classList.remove(BODY_CLASS_RESIZING);
    },
  };
}

function createMovedElementRestore(element: Element, target: Element, marker_label: string): () => void {
  if (element.parentElement === target) {
    return _.noop;
  }

  const marker = element.ownerDocument.createComment(marker_label);
  element.before(marker);
  target.append(element);

  return () => {
    if (marker.parentNode) {
      marker.replaceWith(element);
    }
  };
}

function mountApiPanelEnhancements(): { destroy: () => void } {
  const host_document = getHostDocument();
  const host_window = host_document.defaultView ?? window;
  const desktop_query = host_window.matchMedia(DESKTOP_TWO_COLUMN_QUERY);
  const moved_restores: Array<() => void> = [];
  const original_select_sizes = new Map<HTMLSelectElement, string | null>();
  let active_source_restore: (() => void) | undefined;
  let active_source_selector: string | undefined;
  let scheduled_enhance_frame = 0;
  let scheduled_enhance_timers: number[] = [];

  const shouldUseExpandedSelectors = () => {
    return desktop_query.matches && host_document.body.classList.contains(BODY_CLASS_TWO_COLUMN);
  };

  const restoreSelectSize = (select: HTMLSelectElement) => {
    if (!original_select_sizes.has(select)) {
      return;
    }
    const original_size = original_select_sizes.get(select);
    if (original_size === null) {
      select.removeAttribute('size');
    } else {
      select.setAttribute('size', original_size);
    }
  };

  const setSelectListMode = (selector: string, enabled: boolean) => {
    const select = host_document.querySelector<HTMLSelectElement>(selector);
    if (!select) {
      return;
    }

    if (!enabled) {
      restoreSelectSize(select);
      return;
    }

    if (!original_select_sizes.has(select)) {
      original_select_sizes.set(select, select.getAttribute('size'));
    }
    select.setAttribute('size', String(Math.max(2, select.options.length)));
  };

  const clearApiSourceGroup = () => {
    active_source_restore?.();
    active_source_restore = undefined;
    active_source_selector = undefined;
  };

  const getApiSourceSelector = () => {
    const main_api = host_document.querySelector<HTMLSelectElement>('#rm_api_block #main_api');
    switch (main_api?.value) {
      case 'openai':
        return {
          selector: '#rm_api_block #chat_completion_source',
          block_selector: '#rm_api_block #openai_api',
          title_marker: 'th-modern-api-chat-source-title',
          select_marker: 'th-modern-api-chat-source-select',
        };
      case 'textgenerationwebui':
        return {
          selector: '#rm_api_block #textgen_type',
          block_selector: '#rm_api_block #textgenerationwebui_api',
          title_marker: 'th-modern-api-textgen-source-title',
          select_marker: 'th-modern-api-textgen-source-select',
        };
      default:
        return undefined;
    }
  };

  const updateApiSourceGroup = (main_api_block: Element | null, use_expanded_selectors: boolean) => {
    setSelectListMode('#rm_api_block #chat_completion_source', false);
    setSelectListMode('#rm_api_block #textgen_type', false);

    if (!main_api_block) {
      clearApiSourceGroup();
      return;
    }

    let source_group = main_api_block.querySelector(`.${API_SOURCE_GROUP_CLASS}`);
    if (!source_group) {
      source_group = host_document.createElement('div');
      source_group.className = API_SOURCE_GROUP_CLASS;
      main_api_block.append(source_group);
    }

    const source_config = getApiSourceSelector();
    const source_select = source_config ? host_document.querySelector<HTMLSelectElement>(source_config.selector) : null;
    if (!source_config || !source_select) {
      clearApiSourceGroup();
      source_group.classList.add('is-empty');
      return;
    }

    source_group.classList.remove('is-empty');
    if (active_source_selector !== source_config.selector || source_select.parentElement !== source_group) {
      clearApiSourceGroup();

      const source_block = host_document.querySelector(source_config.block_selector);
      const source_title = (source_select.previousElementSibling?.matches('h4')
        ? source_select.previousElementSibling
        : source_block?.querySelector('h4')) ?? null;
      const restores: Array<() => void> = [];
      if (source_title && source_title.parentElement !== source_group) {
        restores.push(createMovedElementRestore(source_title, source_group, source_config.title_marker));
      }
      if (source_select.parentElement !== source_group) {
        restores.push(createMovedElementRestore(source_select, source_group, source_config.select_marker));
      }
      active_source_restore = () => {
        restores.reverse().forEach(restore => restore());
      };
      active_source_selector = source_config.selector;
    }

    setSelectListMode(source_config.selector, use_expanded_selectors);
  };

  const enhanceApiPanel = () => {
    const main_api_block = host_document.querySelector('#rm_api_block #main-API-selector-block');

    const api_holder = host_document.querySelector('#rm_api_block > .flex-container.flexFlowColumn');
    const api_footer = Array.from(host_document.querySelectorAll<HTMLElement>('#rm_api_block > .flex-container.alignitemscenter.spaceBetween.wide100p')).find(
      element => element.textContent?.includes('自动连接到上次的服务器') || element.querySelector('#viewSecrets'),
    );
    if (api_holder && api_footer && api_footer.parentElement !== api_holder) {
      api_footer.classList.add(API_FOOTER_CLASS);
      moved_restores.push(createMovedElementRestore(api_footer, api_holder, 'th-modern-api-footer'));
    }

    const use_expanded_selectors = shouldUseExpandedSelectors();
    setSelectListMode('#rm_api_block #main_api', use_expanded_selectors);
    updateApiSourceGroup(main_api_block, use_expanded_selectors);
  };

  const clearScheduledApiPanelEnhancement = () => {
    if (scheduled_enhance_frame !== 0) {
      host_window.cancelAnimationFrame(scheduled_enhance_frame);
      scheduled_enhance_frame = 0;
    }
    scheduled_enhance_timers.forEach(timer => host_window.clearTimeout(timer));
    scheduled_enhance_timers = [];
  };

  const scheduleApiPanelEnhancement = () => {
    clearScheduledApiPanelEnhancement();
    scheduled_enhance_frame = host_window.requestAnimationFrame(() => {
      scheduled_enhance_frame = 0;
      enhanceApiPanel();
    });
    scheduled_enhance_timers = [0, 80, 200].map(delay => host_window.setTimeout(enhanceApiPanel, delay));
  };

  enhanceApiPanel();
  const api_panel = host_document.querySelector('#rm_api_block');
  const observer =
    api_panel instanceof host_window.HTMLElement
      ? new MutationObserver(() => {
          scheduleApiPanelEnhancement();
        })
      : undefined;
  if (api_panel instanceof host_window.HTMLElement) {
    observer?.observe(api_panel, { childList: true, subtree: true });
  }
  const body_observer = new MutationObserver(() => {
    scheduleApiPanelEnhancement();
  });
  body_observer.observe(host_document.body, { attributes: true, attributeFilter: ['class'] });
  const handleApiSelectorChange = (event: Event) => {
    if (!(event.target instanceof host_window.HTMLSelectElement)) {
      return;
    }
    if (event.target.matches('#rm_api_block #main_api, #rm_api_block #chat_completion_source, #rm_api_block #textgen_type')) {
      scheduleApiPanelEnhancement();
    }
  };
  host_document.addEventListener('input', handleApiSelectorChange);
  host_document.addEventListener('change', handleApiSelectorChange);
  desktop_query.addEventListener('change', scheduleApiPanelEnhancement);

  return {
    destroy: () => {
      clearScheduledApiPanelEnhancement();
      observer?.disconnect();
      body_observer.disconnect();
      host_document.removeEventListener('input', handleApiSelectorChange);
      host_document.removeEventListener('change', handleApiSelectorChange);
      desktop_query.removeEventListener('change', scheduleApiPanelEnhancement);
      clearApiSourceGroup();
      moved_restores.reverse().forEach(restore => restore());
      host_document.querySelectorAll(`.${API_SOURCE_GROUP_CLASS}:empty`).forEach(element => element.remove());
      host_document.querySelectorAll(`.${API_FOOTER_CLASS}`).forEach(element => element.classList.remove(API_FOOTER_CLASS));
      original_select_sizes.forEach((size, select) => {
        if (size === null) {
          select.removeAttribute('size');
        } else {
          select.setAttribute('size', size);
        }
      });
    },
  };
}

function applyBodyState(settings: ModernLayoutSettings, is_active: boolean, should_use_two_column: boolean) {
  const host_window = getHostDocument().defaultView ?? window;
  const should_auto_collapse = is_active && should_use_two_column && host_window.matchMedia(COMPACT_TWO_COLUMN_QUERY).matches;
  $('body')
    .toggleClass(BODY_CLASS_ENABLED, is_active)
    .toggleClass(BODY_CLASS_TWO_COLUMN, should_use_two_column)
    .toggleClass(BODY_CLASS_REDUCE_MOTION, is_active && settings.reduceMotion)
    .toggleClass(BODY_CLASS_REDUCE_ADVANCED_EFFECTS, is_active && settings.reduceAdvancedEffects)
    .toggleClass(BODY_CLASS_AUTO_COLLAPSE, should_auto_collapse)
    .removeClass(BODY_CLASS_LEGACY_THREE_COLUMN);
  if (!should_auto_collapse || $('body').hasClass(BODY_CLASS_SIDEBAR_COLLAPSED)) {
    $('body').removeClass(BODY_CLASS_TEMP_EXPANDED);
  }
  if (!is_active || !should_use_two_column) {
    clearDrawerFullscreen();
  }
  setHostCssVariable(
    '--th-modern-left-width',
    `${clamp(settings.leftSidebarWidth, LEFT_SIDEBAR_MIN_WIDTH, LEFT_SIDEBAR_MAX_WIDTH, DEFAULT_LEFT_SIDEBAR_WIDTH)}px`,
  );
  setHostCssVariable(
    '--th-modern-overlay-width',
    `${clamp(settings.overlayPanelWidth, OVERLAY_PANEL_MIN_WIDTH, Number.MAX_SAFE_INTEGER, DEFAULT_OVERLAY_PANEL_WIDTH)}px`,
  );
  setHostCssVariable(
    '--th-modern-main-max-width',
    settings.mainChatMaxWidth > 0 ? `${settings.mainChatMaxWidth}px` : `${DEFAULT_MAIN_CHAT_MAX_WIDTH * 125}px`,
  );
}

function clearBodyState() {
  $('body').removeClass(
    `${BODY_CLASS_ENABLED} ${BODY_CLASS_TWO_COLUMN} ${BODY_CLASS_LEGACY_THREE_COLUMN} ${BODY_CLASS_REDUCE_MOTION} ${BODY_CLASS_REDUCE_ADVANCED_EFFECTS} ${BODY_CLASS_SIDEBAR_COLLAPSED} ${BODY_CLASS_AUTO_COLLAPSE} ${BODY_CLASS_TEMP_EXPANDED} ${BODY_CLASS_RESIZING} ${BODY_CLASS_DRAWER_FULLSCREEN} ${BODY_CLASS_DRAWER_OPEN}`,
  );
  removeHostCssVariable('--th-modern-left-width');
  removeHostCssVariable('--th-modern-overlay-width');
  removeHostCssVariable('--th-modern-main-max-width');
  removeHostCssVariable(LEFT_NAV_HEIGHT_VARIABLE);
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
  const { destroy: destroyIconStylesheet } = mountIconStylesheet();
  const { destroy: destroyTeleportedStyle } = teleportStyle();
  const { destroy: destroySidebar, $list } = mountSidebar();
  const { destroy: destroyDrawerEnhancements } = mountDrawerEnhancements();
  const { destroy: destroySidebarNavSizer } = mountSidebarNavSizer();
  const { destroy: destroyFailsafeRestore } = mountFailsafeRestore(store);
  const { destroy: destroyFloatingMenuPositioner } = mountFloatingMenuPositioner();
  const { destroy: destroyResponsiveMode } = mountResponsiveMode(store);
  const { destroy: destroyResizeHandles } = mountResizeHandles(store);
  const { destroy: destroyApiPanelEnhancements } = mountApiPanelEnhancements();
  const { destroy: destroyWorldInfoEditor } = mountWorldInfoEditor(store);
  const { destroy: destroyCharacterManagement } = mountCharacterManagement(store);

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
    destroyApiPanelEnhancements();
    destroyCharacterManagement();
    destroyWorldInfoEditor();
    destroyResizeHandles();
    destroyResponsiveMode();
    destroySidebarNavSizer();
    destroyFloatingMenuPositioner();
    destroyFailsafeRestore();
    destroyDrawerEnhancements();
    destroySidebar();
    destroyPanel();
    destroyTeleportedStyle();
    destroyIconStylesheet();
    if (_.get(window.parent, RUNTIME_DISPOSE_PATH) === destroyAll) {
      _.unset(window.parent, RUNTIME_DISPOSE_PATH);
    }
  });

  _.set(window.parent, RUNTIME_DISPOSE_PATH, destroyAll);
  $(window)
    .off('pagehide.th-modern-layout')
    .on('pagehide.th-modern-layout', () => destroyAll());
});
