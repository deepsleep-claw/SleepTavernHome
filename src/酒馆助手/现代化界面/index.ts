import { checkMinimumVersion } from '@util/common';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import { klona } from 'klona';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { watch } from 'vue';
import releaseVersions from '../../../release/versions.json';
import type { PluginActivationContext, PluginRuntime } from '../../公共模块/脚本更新器/contracts';
import { mountCharacterManagement } from './character-management-module';
import { mountExtensionSettings } from './extension-settings-module';
import { getHostDocument, getHostWindow } from './host-context';
import { initPanel } from './panel';
import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  DEFAULT_MAIN_CHAT_MIN_WIDTH,
  DEFAULT_OVERLAY_PANEL_WIDTH,
  SCRIPT_NAME,
  type ModernLayoutSettings,
  useModernLayoutStore,
} from './store';
import { mountWorldInfoEditor } from './world-info-module';
import './style.css';
import './world-info.css';
import './mobile-world-select.css';
import './character-management.css';
import './extension-settings.css';

const BODY_CLASS_ENABLED = 'th-modern-enabled';
const BODY_CLASS_TWO_COLUMN = 'th-modern-two-column';
const BODY_CLASS_LEGACY_THREE_COLUMN = 'th-modern-three-column';
const BODY_CLASS_DOCKED_DRAWER = 'th-modern-docked-drawer';
const BODY_CLASS_MAIN_FILL = 'th-modern-main-fill';
const BODY_CLASS_REDUCE_MOTION = 'th-modern-reduce-motion';
const BODY_CLASS_REDUCE_ADVANCED_EFFECTS = 'th-modern-reduce-advanced-effects';
const BODY_CLASS_SIDEBAR_COLLAPSED = 'th-modern-sidebar-collapsed';
const BODY_CLASS_AUTO_COLLAPSE = 'th-modern-auto-collapse';
const BODY_CLASS_TEMP_EXPANDED = 'th-modern-sidebar-temp-expanded';
const BODY_CLASS_RESIZING = 'th-modern-resizing';
const BODY_CLASS_DRAWER_FULLSCREEN = 'th-modern-drawer-fullscreen';
const BODY_CLASS_DRAWER_OPEN = 'th-modern-drawer-open';
const BODY_CLASS_DRAWER_SWITCHING = 'th-modern-drawer-switching';
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
const DRAWER_DOCKED_PIN_DATA = 'thModernDockedPinned';
const DRAWER_DOCKED_WAS_PINNED_DATA = 'thModernDockedWasPinned';
const API_SOURCE_GROUP_CLASS = 'th-modern-api-source-group';
const API_FOOTER_CLASS = 'th-modern-api-footer';
const FAILSAFE_KEY_SEQUENCE = 'th-reset';
const FAILSAFE_SHORTCUT_CLASS = 'th-modern-failsafe-shortcut';
const DEFAULT_PRODUCT_NAME = 'SillyTavern';
const LEGACY_RUNTIME_DISPOSE_PATH = 'TavernHelper.modernLayout.dispose';
const RUNTIME_REGISTRY_PATH = 'TavernHelper.modernLayout.runtimes';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'TavernHelper.modernLayout.sidebarCollapsed';
const RECENT_COLLAPSED_STORAGE_KEY = 'TavernHelper.modernLayout.recentCollapsed';
const RECENT_CHAT_LIMIT = 15;
const COMPACT_TWO_COLUMN_QUERY = '(min-width: 900px) and (max-width: 1199.98px)';
const DESKTOP_TWO_COLUMN_QUERY = '(min-width: 900px)';
const LEFT_SIDEBAR_MIN_WIDTH = 320;
const LEFT_SIDEBAR_MAX_WIDTH = 460;
const OVERLAY_PANEL_MIN_WIDTH = 720;
const OVERLAY_PANEL_RESERVED_WIDTH = 24;
const DOCKED_DRAWER_MIN_CHAT_WIDTH = 480;
const MAIN_LAYOUT_GAP = 14;
const DRAWER_SWITCH_FALLBACK_MS = 1000;
const LEFT_NAV_HEIGHT_VARIABLE = '--th-modern-left-nav-height';
const LEFT_NAV_TOP_FALLBACK = 66;
const LEFT_NAV_MIN_HEIGHT_FALLBACK = 240;
const LEFT_NAV_RECENT_MIN_HEIGHT_FALLBACK = 288;
const LEFT_NAV_BOTTOM_GAP = 12;

export const PLUGIN_ID = 'modern-ui';
export const PLUGIN_VERSION = releaseVersions.plugins[PLUGIN_ID].version;

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

type ActiveEntityKey = string | number | object | null | undefined;

type HostNavigationBridge = {
  openGroupById: (group_id: string) => Promise<boolean>;
  setActiveCharacter: (entity_or_key?: ActiveEntityKey) => void;
  setActiveGroup: (entity_or_key?: ActiveEntityKey) => void;
};

type RuntimeDisposer = (options?: { unregisterUnique?: boolean }) => void;

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function getHostStyleTargets(): HTMLElement[] {
  const host_document = getHostDocument();
  return [host_document.documentElement, host_document.body];
}

function getHostStorage(): Storage | undefined {
  return getHostWindow().localStorage;
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
  const host_document = getHostDocument();
  if (host_document.getElementById(ICON_STYLESHEET_ID)) {
    return { destroy: () => {} };
  }

  const link = host_document.createElement('link');
  link.id = ICON_STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = ICON_STYLESHEET_HREF;
  link.dataset.thModernOwned = 'true';
  host_document.head.append(link);

  return {
    destroy: () => link.remove(),
  };
}

function getContext(): typeof SillyTavern {
  return SillyTavern;
}

type HostMainModule = {
  selectCharacterById: typeof SillyTavern.selectCharacterById;
  isGenerating: () => boolean;
  isChatSaving: boolean;
  setActiveCharacter: HostNavigationBridge['setActiveCharacter'];
  setActiveGroup: HostNavigationBridge['setActiveGroup'];
};

type HostGroupModule = {
  openGroupChat: typeof SillyTavern.openGroupChat;
  openGroupById: HostNavigationBridge['openGroupById'];
};

function createHostNavigationBridge(): { get: () => Promise<HostNavigationBridge>; destroy: () => void } {
  let bridge_promise: Promise<HostNavigationBridge> | undefined;
  let destroyed = false;

  const loadBridge = async (): Promise<HostNavigationBridge> => {
    const host_window = getHostWindow() as Window & { Function: FunctionConstructor };
    const host_base_url = getHostDocument().baseURI || host_window.location.href;
    const main_module_url = new URL('script.js', host_base_url).href;
    const group_module_url = new URL('scripts/group-chats.js', host_base_url).href;
    const HostFunction = host_window.Function;
    const importModules = HostFunction(
      'mainModuleUrl',
      'groupModuleUrl',
      'return Promise.all([import(mainModuleUrl), import(groupModuleUrl)]);',
    ) as (mainModuleUrl: string, groupModuleUrl: string) => Promise<[unknown, unknown]>;
    const [main_unknown, group_unknown] = await importModules(main_module_url, group_module_url);
    const main = main_unknown as Partial<HostMainModule>;
    const group = group_unknown as Partial<HostGroupModule>;

    if (
      typeof main.selectCharacterById !== 'function' ||
      typeof main.isGenerating !== 'function' ||
      typeof main.isChatSaving !== 'boolean' ||
      typeof main.setActiveCharacter !== 'function' ||
      typeof main.setActiveGroup !== 'function' ||
      typeof group.openGroupChat !== 'function' ||
      typeof group.openGroupById !== 'function'
    ) {
      throw new Error('当前 SillyTavern 缺少最近聊天所需的导航能力。');
    }

    const context = getContext();
    if (main.selectCharacterById !== context.selectCharacterById || group.openGroupChat !== context.openGroupChat) {
      throw new Error('SillyTavern 导航模块未从宿主页加载。');
    }
    if (destroyed) {
      throw new DOMException('导航桥已销毁。', 'AbortError');
    }

    const isGenerating = main.isGenerating;
    const setActiveCharacter = main.setActiveCharacter;
    const setActiveGroup = main.setActiveGroup;
    const openGroupById = group.openGroupById;
    const assertCanNavigate = () => {
      if (main.isChatSaving) {
        throw new Error('聊天仍在保存，请稍后再切换。');
      }
      if (isGenerating()) {
        throw new Error('正在生成回复，当前不能切换聊天。');
      }
    };

    return {
      openGroupById: async group_id => {
        assertCanNavigate();
        return openGroupById(group_id);
      },
      setActiveCharacter: entity_or_key => {
        assertCanNavigate();
        setActiveCharacter(entity_or_key);
      },
      setActiveGroup: entity_or_key => {
        assertCanNavigate();
        setActiveGroup(entity_or_key);
      },
    };
  };

  return {
    get: () => {
      if (destroyed) {
        return Promise.reject(new DOMException('导航桥已销毁。', 'AbortError'));
      }
      bridge_promise ??= loadBridge().catch(error => {
        bridge_promise = undefined;
        throw error;
      });
      return bridge_promise;
    },
    destroy: () => {
      destroyed = true;
      bridge_promise = undefined;
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
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

async function fetchRecentChats(signal: AbortSignal): Promise<RecentChat[]> {
  const response = await fetch('/api/chats/recent', {
    method: 'POST',
    headers: SillyTavern.getRequestHeaders(),
    body: JSON.stringify({ max: RECENT_CHAT_LIMIT, pinned: getPinnedChats() }),
    cache: 'no-cache',
    signal,
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

function normalizeChatId(value: string | undefined): string {
  return (value ?? '').replace(/\.jsonl$/i, '');
}

async function characterChatExists(avatar: string, target_chat_id: string): Promise<boolean> {
  const response = await fetch('/api/characters/chats', {
    method: 'POST',
    headers: SillyTavern.getRequestHeaders(),
    body: JSON.stringify({ avatar_url: avatar, simple: true }),
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new Error(`读取角色聊天列表失败（HTTP ${response.status}）`);
  }

  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') {
    return false;
  }
  const items = Array.isArray(data) ? data : Object.values(data);
  return items.some(item => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const record = item as Record<string, unknown>;
    const file_id = typeof record.file_id === 'string' ? record.file_id : undefined;
    const file_name = typeof record.file_name === 'string' ? record.file_name : undefined;
    return normalizeChatId(file_id ?? file_name) === target_chat_id;
  });
}

function isCurrentChat(chat: RecentChat): boolean {
  const context = getContext();
  const target_chat_id = normalizeChatId(chat.chat_name ?? chat.file_name);
  if (!target_chat_id || normalizeChatId(context.getCurrentChatId?.()) !== target_chat_id) {
    return false;
  }

  if (chat.is_group && chat.group) {
    return String(context.groupId ?? '') === chat.group;
  }
  if (!chat.avatar || context.groupId) {
    return false;
  }
  const character_id = context.characters.findIndex(character => character.avatar === chat.avatar);
  return character_id !== -1 && String(context.characterId) === String(character_id);
}

function createRecentChatElement(chat: RecentChat, on_open: (chat: RecentChat) => void): JQuery<HTMLElement> {
  const $item = $('<button>')
    .attr({
      type: 'button',
      title: chat.date_long ? `${chat.char_name} - ${chat.chat_name}\n${chat.date_long}` : `${chat.char_name} - ${chat.chat_name}`,
    })
    .addClass('th-modern-recent-chat')
    .toggleClass('is-current', isCurrentChat(chat))
    .on('click', () => on_open(chat));

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

async function openRecentChat(
  chat: RecentChat,
  bridge: HostNavigationBridge,
  assert_operation_live: () => void,
): Promise<void> {
  const target_chat_id = normalizeChatId(chat.chat_name ?? chat.file_name);
  if (!target_chat_id) {
    throw new Error('最近聊天缺少聊天文件名。');
  }

  if (chat.is_group && chat.group) {
    const group = findGroupById(chat.group);
    if (!group) {
      throw new Error('未找到对应群组。');
    }

    if (String(getContext().groupId ?? '') !== chat.group) {
      const opened = await bridge.openGroupById(chat.group);
      assert_operation_live();
      if (!opened && String(getContext().groupId ?? '') !== chat.group) {
        throw new Error('群组切换被聊天保存或生成状态阻止。');
      }
    }
    if (String(getContext().groupId ?? '') !== chat.group) {
      throw new Error('群组未能正确激活。');
    }

    bridge.setActiveGroup(chat.group);
    void SillyTavern.saveSettingsDebounced?.();
    if (normalizeChatId(getContext().getCurrentChatId?.()) !== target_chat_id) {
      await SillyTavern.openGroupChat(chat.group, target_chat_id);
      assert_operation_live();
    }
    if (
      String(getContext().groupId ?? '') !== chat.group ||
      normalizeChatId(getContext().getCurrentChatId?.()) !== target_chat_id
    ) {
      throw new Error('群组聊天不存在或未能正确打开。');
    }
    return;
  }

  if (chat.avatar) {
    let character_id = getContext().characters.findIndex(character => character.avatar === chat.avatar);
    if (character_id === -1) {
      throw new Error('未找到对应角色。');
    }
    if (!(await characterChatExists(chat.avatar, target_chat_id))) {
      assert_operation_live();
      throw new Error('角色聊天已不存在。');
    }
    assert_operation_live();
    character_id = getContext().characters.findIndex(character => character.avatar === chat.avatar);
    if (character_id === -1) {
      throw new Error('角色已不存在。');
    }
    await SillyTavern.selectCharacterById(character_id);
    assert_operation_live();
    const active_character = getContext().characters[Number(getContext().characterId)];
    if (getContext().groupId || active_character?.avatar !== chat.avatar) {
      throw new Error('角色切换被聊天保存或生成状态阻止。');
    }

    bridge.setActiveCharacter(chat.avatar);
    void SillyTavern.saveSettingsDebounced?.();
    if (normalizeChatId(getContext().getCurrentChatId?.()) !== target_chat_id) {
      if (!(await characterChatExists(chat.avatar, target_chat_id))) {
        assert_operation_live();
        throw new Error('角色聊天已不存在。');
      }
      assert_operation_live();
      if (getContext().groupId) {
        throw new Error('角色已不再处于激活状态。');
      }
      const current_character = getContext().characters[Number(getContext().characterId)];
      if (current_character?.avatar !== chat.avatar) {
        throw new Error('角色已不再处于激活状态。');
      }
      bridge.setActiveCharacter(chat.avatar);
      await SillyTavern.openCharacterChat(target_chat_id);
      assert_operation_live();
    }
    const final_character = getContext().characters[Number(getContext().characterId)];
    if (
      getContext().groupId ||
      final_character?.avatar !== chat.avatar ||
      normalizeChatId(getContext().getCurrentChatId?.()) !== target_chat_id
    ) {
      throw new Error('角色聊天未能正确打开。');
    }
    return;
  }

  throw new Error('最近聊天缺少角色或群组标识。');
}

function normalizeProductName(raw_value: string | null | undefined, source: 'version' | 'logo' | 'plain'): string | undefined {
  let value = String(raw_value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) {
    return undefined;
  }

  if (source === 'version') {
    const version_match = value.match(/^(.+?)\s+v?\d+(?:\.\d+){1,3}(?:[-+][0-9a-z.-]+)?(?:\s|$)/i);
    if (!version_match) {
      return undefined;
    }
    value = version_match[1].trim();
  } else if (source === 'logo') {
    value = value.replace(/\s+(?:logo|徽标|標誌|标志)$/i, '').trim();
  }

  if (!value || value.length > 64 || value.includes('://')) {
    return undefined;
  }
  return value;
}

function getHostProductName(host_document = getHostDocument()): string {
  for (const selector of ['.welcomeHeaderVersionDisplay', '#version_display_welcome', '#version_display']) {
    const product_name = normalizeProductName(host_document.querySelector(selector)?.textContent, 'version');
    if (product_name) {
      return product_name;
    }
  }

  const application_name = normalizeProductName(
    host_document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content,
    'plain',
  );
  if (application_name) {
    return application_name;
  }

  const logo_name = normalizeProductName(
    host_document.querySelector<HTMLImageElement>('.welcomePanel .welcomeHeaderLogo')?.alt,
    'logo',
  );
  if (logo_name) {
    return logo_name;
  }

  return normalizeProductName(host_document.title, 'plain') ?? DEFAULT_PRODUCT_NAME;
}

function mountSidebar(on_refresh: () => void): { $list: JQuery<HTMLElement>; destroy: () => void } {
  const host_window = getHostWindow();
  const host_document = getHostDocument();
  const $sidebar = createScriptIdDiv().attr('id', SIDEBAR_ID).addClass('th-modern-sidebar recentChat');
  const $brand = $('<div>').addClass('th-modern-sidebar-brand');
  const $brand_main = $('<span>').addClass('th-modern-brand-main').appendTo($brand);
  const $brand_logo = $('<img>').addClass('th-modern-brand-logo welcomeHeaderLogo').attr('src', 'img/logo.png').appendTo($brand_main);
  const $brand_name = $('<span>').addClass('th-modern-brand-name').appendTo($brand_main);
  const syncBrand = () => {
    const product_name = getHostProductName(host_document);
    $brand_name.text(product_name);
    $brand_logo.attr('alt', `${product_name} Logo`);
  };
  syncBrand();
  const brand_observer = new host_window.MutationObserver(syncBrand);
  ['.welcomeHeaderVersionDisplay', '#version_display_welcome', '#version_display'].forEach(selector => {
    const element = host_document.querySelector(selector);
    if (element) {
      brand_observer.observe(element, { childList: true, characterData: true, subtree: true });
    }
  });
  const $sidebar_collapse_button = $('<button>')
    .attr({ type: 'button', title: '折叠侧边栏', 'aria-pressed': 'false' })
    .addClass('th-modern-icon-button th-modern-sidebar-toggle bi bi-chevron-left')
    .appendTo($brand);

  const $recent = $('<section>').addClass('th-modern-recent-section');
  const recent_list_id = `${SIDEBAR_ID}-recent-list`;
  const $recent_header = $('<div>').addClass('th-modern-section-header');
  const $recent_actions = $('<span>').addClass('th-modern-section-actions');
  const $recent_toggle = $('<button>')
    .attr({ type: 'button', title: '折叠最近聊天', 'aria-controls': recent_list_id, 'aria-expanded': 'true' })
    .addClass('th-modern-section-title th-modern-recent-toggle');
  const $collapse_icon = $('<span>')
    .attr('aria-hidden', 'true')
    .addClass('th-modern-icon-button th-modern-recent-collapse bi bi-chevron-up')
    .appendTo($recent_toggle);
  $('<span>').addClass('th-modern-section-label').text('最近聊天').appendTo($recent_toggle);

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
    $recent_toggle.attr({ title, 'aria-expanded': String(!collapsed) });
    $collapse_icon
      .toggleClass('bi-chevron-up', !collapsed)
      .toggleClass('bi-chevron-down', collapsed);
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
  $recent_toggle.on('click', event => {
    event.preventDefault();
    toggleRecentCollapse();
  });
  const $refresh_button = $('<button>')
    .attr({ type: 'button', title: '刷新最近聊天' })
    .addClass('th-modern-icon-button bi bi-arrow-clockwise')
    .on('click', event => {
      event.preventDefault();
      on_refresh();
    });
  $recent_actions.append($refresh_button);
  $recent_header.append($recent_toggle, $recent_actions);

  const $list = $('<div>').attr('id', recent_list_id).addClass('th-modern-recent-list');
  $recent.append($recent_header, $list);
  $sidebar.append($brand, $recent).appendTo('body');
  const body_observer = new host_window.MutationObserver(syncSidebarToggleButton);
  body_observer.observe(getHostDocument().body, { attributes: true, attributeFilter: ['class'] });
  setSidebarCollapsed(readStoredBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY), false);
  setRecentCollapsed(readStoredBoolean(RECENT_COLLAPSED_STORAGE_KEY), false);
  syncSidebarToggleButton();

  return {
    $list,
    destroy: () => {
      body_observer.disconnect();
      brand_observer.disconnect();
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

function mountRecentChats($list: JQuery<HTMLElement>): { refresh: () => void; destroy: () => void } {
  const bridge_controller = createHostNavigationBridge();
  let request_controller: AbortController | undefined;
  let request_revision = 0;
  let navigation_revision = 0;
  let navigation_running = false;
  let destroyed = false;

  const setNavigationRunning = (running: boolean) => {
    navigation_running = running;
    $list.toggleClass('is-navigating', running).attr('aria-busy', String(running));
    $list.find<HTMLButtonElement>('button').prop('disabled', running);
  };

  const openChat = (chat: RecentChat) => {
    if (destroyed || navigation_running || isCurrentChat(chat)) {
      return;
    }

    const revision = ++navigation_revision;
    const assertOperationLive = () => {
      if (destroyed || revision !== navigation_revision) {
        throw new DOMException('导航已取消。', 'AbortError');
      }
    };

    setNavigationRunning(true);
    void bridge_controller
      .get()
      .then(async bridge => {
        assertOperationLive();
        await openRecentChat(chat, bridge, assertOperationLive);
      })
      .catch(error => {
        if (isAbortError(error)) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        toastr.error(`打开最近聊天失败：${message}`, SCRIPT_NAME);
        console.error(`[${SCRIPT_NAME}] 打开最近聊天失败。`, error);
      })
      .finally(() => {
        if (!destroyed && revision === navigation_revision) {
          setNavigationRunning(false);
        }
      });
  };

  const refresh = () => {
    if (destroyed) {
      return;
    }

    request_controller?.abort();
    request_controller = new AbortController();
    const revision = ++request_revision;
    renderRecentLoading($list);
    void fetchRecentChats(request_controller.signal)
      .then(chats => {
        if (destroyed || revision !== request_revision) {
          return;
        }
        $list.empty();
        if (chats.length === 0) {
          $list.append($('<div>').addClass('th-modern-recent-state').text('暂无最近聊天'));
          return;
        }
        chats.forEach(chat => {
          $list.append(createRecentChatElement(chat, openChat));
        });
        if (navigation_running) {
          setNavigationRunning(true);
        }
      })
      .catch(error => {
        if (destroyed || revision !== request_revision || isAbortError(error)) {
          return;
        }
        renderRecentError($list, error);
      });
  };

  return {
    refresh,
    destroy: () => {
      destroyed = true;
      request_revision += 1;
      navigation_revision += 1;
      request_controller?.abort();
      request_controller = undefined;
      bridge_controller.destroy();
      setNavigationRunning(false);
    },
  };
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

function applyDockedDrawerPin(content: HTMLElement) {
  if (content.dataset[DRAWER_DOCKED_WAS_PINNED_DATA] === undefined) {
    const was_pinned = content.classList.contains('pinnedOpen');
    content.dataset[DRAWER_DOCKED_WAS_PINNED_DATA] = String(was_pinned);
    if (!was_pinned) {
      content.dataset[DRAWER_DOCKED_PIN_DATA] = 'true';
    }
  }
  content.classList.add('pinnedOpen');
}

function removeDockedDrawerPin(content: HTMLElement) {
  if (content.dataset[DRAWER_DOCKED_WAS_PINNED_DATA] === undefined) {
    return;
  }

  const was_pinned = content.dataset[DRAWER_DOCKED_WAS_PINNED_DATA] === 'true';
  const pinned_by_docked_mode = content.dataset[DRAWER_DOCKED_PIN_DATA] === 'true';
  if (pinned_by_docked_mode) {
    content.classList.remove('pinnedOpen');
  } else if (was_pinned) {
    content.classList.add('pinnedOpen');
  }
  delete content.dataset[DRAWER_DOCKED_PIN_DATA];
  delete content.dataset[DRAWER_DOCKED_WAS_PINNED_DATA];
}

function syncDockedDrawerPins(open_contents: HTMLElement[]) {
  const host_document = getHostDocument();
  const should_pin = host_document.body.classList.contains(BODY_CLASS_DOCKED_DRAWER);
  const open_content_set = new Set(open_contents);
  host_document
    .querySelectorAll<HTMLElement>('#top-settings-holder > .drawer > .drawer-content')
    .forEach(content => {
      if (should_pin && open_content_set.has(content)) {
        applyDockedDrawerPin(content);
        return;
      }
      if (content.classList.contains(DRAWER_FULLSCREEN_CONTENT_CLASS)) {
        return;
      }
      removeDockedDrawerPin(content);
    });
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

function mountDrawerEnhancements(): { destroy: () => void } {
  const host_document = getHostDocument();
  const host_window = host_document.defaultView ?? window;
  const original_toggle_attributes = new Map<HTMLElement, { title: string | null; ariaLabel: string | null; written: string }>();
  let scheduled_reconcile = 0;
  let pending_drawer_switch: HTMLElement | undefined;
  let drawer_switch_timeout = 0;

  const clearDrawerSwitch = () => {
    if (drawer_switch_timeout !== 0) {
      host_window.clearTimeout(drawer_switch_timeout);
      drawer_switch_timeout = 0;
    }
    pending_drawer_switch = undefined;
    host_document.body.classList.remove(BODY_CLASS_DRAWER_SWITCHING);
  };

  const beginDrawerSwitch = (target_content: HTMLElement) => {
    pending_drawer_switch = target_content;
    host_document.body.classList.add(BODY_CLASS_DRAWER_SWITCHING);
    if (drawer_switch_timeout !== 0) {
      host_window.clearTimeout(drawer_switch_timeout);
    }
    drawer_switch_timeout = host_window.setTimeout(() => {
      drawer_switch_timeout = 0;
      pending_drawer_switch = undefined;
      host_document.body.classList.remove(BODY_CLASS_DRAWER_SWITCHING);
      syncDrawerOpenState();
    }, DRAWER_SWITCH_FALLBACK_MS);
  };

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
    syncDockedDrawerPins(open_contents);
    syncDrawerOpenState(open_contents);
    if (
      pending_drawer_switch &&
      (!pending_drawer_switch.isConnected || pending_drawer_switch.classList.contains('openDrawer'))
    ) {
      clearDrawerSwitch();
    }
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
        const element = toggle as HTMLElement;
        const original = original_toggle_attributes.get(element);
        if (original) {
          original.written = label;
        } else {
          original_toggle_attributes.set(element, {
            title: element.getAttribute('title'),
            ariaLabel: element.getAttribute('aria-label'),
            written: label,
          });
        }
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
    const drawer_toggle = target?.closest<HTMLElement>('#top-settings-holder > .drawer > .drawer-toggle');
    const drawer_opener = target?.closest<HTMLElement>('.drawer-opener');
    if (host_document.body.classList.contains(BODY_CLASS_DOCKED_DRAWER) && (drawer_toggle || drawer_opener)) {
      const target_drawer = drawer_toggle?.parentElement ??
        (drawer_opener?.dataset.target ? host_document.getElementById(drawer_opener.dataset.target) : null);
      const target_content = target_drawer?.querySelector<HTMLElement>(':scope > .drawer-content');
      const open_contents = Array.from(
        host_document.querySelectorAll<HTMLElement>('#top-settings-holder > .drawer > .drawer-content.openDrawer'),
      );
      if (target_content && !target_content.classList.contains('openDrawer') && open_contents.length > 0) {
        beginDrawerSwitch(target_content);
      }
      open_contents.forEach(content => {
        if (content !== target_content) {
          removeDockedDrawerPin(content);
        }
      });
    }

    const action = target?.closest(`.${DRAWER_FULLSCREEN_CLASS}, .${DRAWER_CLOSE_CLASS}`);
    if (!action) {
      if (drawer_toggle) {
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

    const native_toggle = content.parentElement?.querySelector<HTMLElement>(':scope > .drawer-toggle');
    if (native_toggle) {
      native_toggle.click();
      scheduleReconcileDrawerFullscreen();
      return;
    }
    closeDrawerContent(content);
  };

  const holder = $('#top-settings-holder')[0];
  const content_class_observer =
    holder instanceof host_window.HTMLElement
      ? new host_window.MutationObserver(() => {
          scheduleReconcileDrawerFullscreen();
        })
      : undefined;
  const observeDrawerContentClasses = () => {
    content_class_observer?.disconnect();
    holder
      ?.querySelectorAll<HTMLElement>(':scope > .drawer > .drawer-content')
      .forEach(content => content_class_observer?.observe(content, { attributes: true, attributeFilter: ['class'] }));
  };
  const enhanceAndObserveDrawers = () => {
    enhanceDrawers();
    observeDrawerContentClasses();
  };

  enhanceAndObserveDrawers();
  const observer =
    holder instanceof host_window.HTMLElement
      ? new host_window.MutationObserver(mutations => {
          if (
            mutations.some(
              mutation =>
                mutation.type === 'childList' &&
                (mutation.target === holder ||
                  (mutation.target instanceof host_window.Element &&
                    mutation.target.matches('#top-settings-holder > .drawer'))),
            )
          ) {
            enhanceAndObserveDrawers();
          }
        })
      : undefined;
  observer?.observe(holder, { childList: true, subtree: true });
  const body_class_observer = new host_window.MutationObserver(() => {
    scheduleReconcileDrawerFullscreen();
  });
  body_class_observer.observe(host_document.body, { attributes: true, attributeFilter: ['class'] });
  host_document.addEventListener('click', handleDrawerActionClick, true);

  return {
    destroy: () => {
      if (scheduled_reconcile !== 0) {
        host_window.cancelAnimationFrame(scheduled_reconcile);
      }
      clearDrawerSwitch();
      observer?.disconnect();
      content_class_observer?.disconnect();
      body_class_observer.disconnect();
      host_document.removeEventListener('click', handleDrawerActionClick, true);
      clearDrawerFullscreen();
      host_document
        .querySelectorAll<HTMLElement>('#top-settings-holder > .drawer > .drawer-content')
        .forEach(removeDockedDrawerPin);
      $(`.${TOPBAR_LABEL_CLASS}`).remove();
      $(`.${DRAWER_TITLEBAR_CLASS}`).remove();
      original_toggle_attributes.forEach((original, toggle) => {
        if (toggle.getAttribute('title') === original.written) {
          if (original.title === null) {
            toggle.removeAttribute('title');
          } else {
            toggle.setAttribute('title', original.title);
          }
        }
        if (toggle.getAttribute('aria-label') === original.written) {
          if (original.ariaLabel === null) {
            toggle.removeAttribute('aria-label');
          } else {
            toggle.setAttribute('aria-label', original.ariaLabel);
          }
        }
      });
      original_toggle_attributes.clear();
    },
  };
}

function showFailsafeRestoreConfirm(
  store: ReturnType<typeof useModernLayoutStore>,
  onClose: () => void,
): () => void {
  const host_document = getHostDocument();
  const previous_focus = host_document.activeElement as HTMLElement | null;
  $('.th-modern-failsafe-overlay', host_document).remove();

  const $overlay = $('<div>').addClass('th-modern-failsafe-overlay');
  const title_id = 'th-modern-failsafe-title';
  const description_id = 'th-modern-failsafe-description';
  const $dialog = $('<div>')
    .attr({
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': title_id,
      'aria-describedby': description_id,
    })
    .addClass('th-modern-failsafe-dialog')
    .appendTo($overlay);
  $('<strong>').attr('id', title_id).text('关闭现代化界面？').appendTo($dialog);
  $('<p>')
    .attr('id', description_id)
    .text(`将立即还原 ${getHostProductName(host_document)} 原始布局，并保持关闭状态。之后可以在酒馆助手设置里重新启用。`)
    .appendTo($dialog);
  const $actions = $('<div>').addClass('th-modern-failsafe-actions').appendTo($dialog);
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    $overlay.off('keydown', onDialogKeyDown);
    $overlay.remove();
    onClose();
    if (previous_focus?.isConnected && typeof previous_focus.focus === 'function') {
      previous_focus.focus();
    }
  };

  const $cancel = $('<button>')
    .attr('type', 'button')
    .addClass('menu_button')
    .text('取消')
    .on('click', close)
    .appendTo($actions);
  const $confirm = $('<button>')
    .attr('type', 'button')
    .addClass('menu_button th-modern-failsafe-confirm')
    .text('关闭并还原')
    .on('click', () => {
      store.disableModernLayout();
      toastr.warning('已关闭现代化界面。', SCRIPT_NAME);
      close();
    })
    .appendTo($actions);

  function onDialogKeyDown(event: JQuery.KeyDownEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const first = $cancel[0];
    const last = $confirm[0];
    if (event.shiftKey && host_document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && host_document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  $overlay.on('click', event => {
    if (event.target === $overlay[0]) {
      close();
    }
  });
  $overlay.on('keydown', onDialogKeyDown);
  $(host_document.body).append($overlay);
  $cancel[0].focus();
  return close;
}

function mountFailsafeRestore(store: ReturnType<typeof useModernLayoutStore>): { destroy: () => void } {
  const host_document = getHostDocument();
  const host_window = getHostWindow();
  let typed_buffer = '';
  let is_prompt_open = false;
  let close_prompt: (() => void) | undefined;

  const openConfirm = () => {
    if (is_prompt_open || !store.is_active) {
      return;
    }
    is_prompt_open = true;
    close_prompt = showFailsafeRestoreConfirm(store, () => {
      is_prompt_open = false;
      close_prompt = undefined;
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

  const appendShortcut = (panel: Element) => {
    const shortcuts = panel.querySelector<HTMLElement>('.welcomeShortcuts');
    if (!shortcuts || shortcuts.querySelector(`.${FAILSAFE_SHORTCUT_CLASS}`)) {
      return;
    }

    const button = host_document.createElement('button');
    button.type = 'button';
    button.className = `menu_button menu_button_icon ${FAILSAFE_SHORTCUT_CLASS}`;
    button.title = '关闭现代化界面并还原原始布局';
    button.setAttribute('aria-label', '重置界面');
    const icon = host_document.createElement('i');
    icon.className = 'fa-solid fa-arrow-rotate-left';
    icon.setAttribute('aria-hidden', 'true');
    const label = host_document.createElement('span');
    label.textContent = '重置界面';
    button.append(icon, label);
    shortcuts.append(button);
  };

  const scanForWelcomePanels = (root: ParentNode) => {
    if (root instanceof host_window.Element && root.matches('.welcomePanel')) {
      appendShortcut(root);
    }
    root.querySelectorAll('.welcomePanel').forEach(appendShortcut);
  };

  const onFailsafeShortcutClick = (event: MouseEvent) => {
    const target = event.target instanceof host_window.Element ? event.target : null;
    if (!target?.closest(`.${FAILSAFE_SHORTCUT_CLASS}`)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openConfirm();
  };

  scanForWelcomePanels(host_document);
  const welcome_observer = new host_window.MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node instanceof host_window.Element) {
          scanForWelcomePanels(node);
        }
      });
    });
  });
  const chat = host_document.querySelector('#chat');
  if (chat) {
    welcome_observer.observe(chat, { childList: true, subtree: true });
  }

  host_document.addEventListener('keydown', onKeyDown, true);
  host_document.addEventListener('click', onFailsafeShortcutClick, true);

  return {
    destroy: () => {
      welcome_observer.disconnect();
      close_prompt?.();
      host_document.removeEventListener('keydown', onKeyDown, true);
      host_document.removeEventListener('click', onFailsafeShortcutClick, true);
      host_document.querySelectorAll(`.${FAILSAFE_SHORTCUT_CLASS}`).forEach(button => button.remove());
    },
  };
}

type FloatingInlineStyles = {
  maxWidth: string;
  maxHeight: string;
  left: string;
  top: string;
};

type FloatingStyleRecord = {
  original: FloatingInlineStyles;
  applied: Partial<FloatingInlineStyles>;
};

function setTrackedFloatingStyle(
  element: HTMLElement,
  property: keyof FloatingInlineStyles,
  value: string,
  records: Map<HTMLElement, FloatingStyleRecord>,
) {
  let record = records.get(element);
  if (!record) {
    record = {
      original: {
        maxWidth: element.style.maxWidth,
        maxHeight: element.style.maxHeight,
        left: element.style.left,
        top: element.style.top,
      },
      applied: {},
    };
    records.set(element, record);
  } else if (record.applied[property] !== undefined && element.style[property] !== record.applied[property]) {
    record.original[property] = element.style[property];
  }
  if (element.style[property] !== value) {
    element.style[property] = value;
  }
  record.applied[property] = value;
}

function clampFloatingElement(element: HTMLElement, records: Map<HTMLElement, FloatingStyleRecord>) {
  const host_window = element.ownerDocument.defaultView ?? getHostWindow();
  const style = host_window.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    (style.position !== 'absolute' && style.position !== 'fixed')
  ) {
    return;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) {
    return;
  }

  const margin = 8;
  const max_width = Math.max(160, host_window.innerWidth - margin * 2);
  const max_height = Math.max(120, host_window.innerHeight - margin * 2);
  const max_width_value = `${max_width}px`;
  const max_height_value = `${max_height}px`;

  const next_left = Math.min(Math.max(rect.left, margin), host_window.innerWidth - Math.min(rect.width, max_width) - margin);
  const next_top = Math.min(Math.max(rect.top, margin), host_window.innerHeight - Math.min(rect.height, max_height) - margin);
  const should_adjust_left = Math.abs(next_left - rect.left) > 1;
  const should_adjust_top = Math.abs(next_top - rect.top) > 1;
  const offset_parent = (should_adjust_left || should_adjust_top) && style.position === 'absolute' ? element.offsetParent : null;
  const offset_parent_rect = offset_parent?.getBoundingClientRect();
  let left_value: string | undefined;
  let top_value: string | undefined;

  if (should_adjust_left) {
    const margin_left = parseCssPixelValue(style.marginLeft, 0);
    const left =
      style.position === 'fixed'
        ? next_left
        : offset_parent && offset_parent_rect
          ? next_left - offset_parent_rect.left - offset_parent.clientLeft + offset_parent.scrollLeft - margin_left
          : next_left + host_window.scrollX - margin_left;
    left_value = `${left}px`;
  }
  if (should_adjust_top) {
    const margin_top = parseCssPixelValue(style.marginTop, 0);
    const top =
      style.position === 'fixed'
        ? next_top
        : offset_parent && offset_parent_rect
          ? next_top - offset_parent_rect.top - offset_parent.clientTop + offset_parent.scrollTop - margin_top
          : next_top + host_window.scrollY - margin_top;
    top_value = `${top}px`;
  }

  setTrackedFloatingStyle(element, 'maxWidth', max_width_value, records);
  setTrackedFloatingStyle(element, 'maxHeight', max_height_value, records);
  if (left_value !== undefined) {
    setTrackedFloatingStyle(element, 'left', left_value, records);
  }
  if (top_value !== undefined) {
    setTrackedFloatingStyle(element, 'top', top_value, records);
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
  const selector = selectors.join(', ');
  const style_records = new Map<HTMLElement, FloatingStyleRecord>();
  let frame = 0;

  const clampAll = () => {
    frame = 0;
    style_records.forEach((_, element) => {
      if (!element.isConnected) {
        style_records.delete(element);
      }
    });
    host_document.querySelectorAll<HTMLElement>(selector).forEach(element => {
      clampFloatingElement(element, style_records);
    });
  };

  const schedule = () => {
    if (host_document.body.classList.contains(BODY_CLASS_RESIZING)) {
      return;
    }
    if (frame !== 0) {
      return;
    }
    frame = host_window.requestAnimationFrame(clampAll);
  };

  const containsFloatingElement = (node: Node) =>
    node instanceof host_window.Element && (node.matches(selector) || Boolean(node.querySelector(selector)));
  const observer = new host_window.MutationObserver(mutations => {
    if (mutations.some(mutation => [...mutation.addedNodes].some(containsFloatingElement))) {
      schedule();
    }
  });
  observer.observe(host_document.body, { childList: true });
  const handlePopupInput = (event: Event) => {
    if (
      event.target instanceof host_window.Element &&
      event.target.matches('.ui-autocomplete-input, .select2-search__field')
    ) {
      schedule();
    }
  };
  host_document.addEventListener('click', schedule, true);
  host_document.addEventListener('focusin', schedule, true);
  host_document.addEventListener('input', handlePopupInput, true);
  host_window.addEventListener('resize', schedule);

  return {
    destroy: () => {
      if (frame !== 0) {
        host_window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      host_document.removeEventListener('click', schedule, true);
      host_document.removeEventListener('focusin', schedule, true);
      host_document.removeEventListener('input', handlePopupInput, true);
      host_window.removeEventListener('resize', schedule);
      style_records.forEach((record, element) => {
        (Object.keys(record.applied) as Array<keyof FloatingInlineStyles>).forEach(property => {
          if (element.style[property] === record.applied[property]) {
            element.style[property] = record.original[property];
          }
        });
      });
      style_records.clear();
    },
  };
}

function mountResponsiveMode(store: ReturnType<typeof useModernLayoutStore>): { destroy: () => void } {
  const host_document = getHostDocument();
  const host_window = host_document.defaultView ?? window;
  const compact_query = host_window.matchMedia(COMPACT_TWO_COLUMN_QUERY);

  let sync_frame = 0;
  const sync = () => {
    applyBodyState(store.settings, store.is_active, store.should_use_two_column);
  };
  const scheduleSync = () => {
    if (sync_frame !== 0) {
      return;
    }
    sync_frame = host_window.requestAnimationFrame(() => {
      sync_frame = 0;
      sync();
    });
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

    if (body.classList.contains(BODY_CLASS_TEMP_EXPANDED) && !is_sidebar_area) {
      body.classList.remove(BODY_CLASS_TEMP_EXPANDED);
    }
  };

  compact_query.addEventListener('change', scheduleSync);
  host_window.addEventListener('resize', scheduleSync);
  host_document.addEventListener('pointerdown', handlePointerDown, true);
  sync();

  return {
    destroy: () => {
      if (sync_frame !== 0) {
        host_window.cancelAnimationFrame(sync_frame);
      }
      compact_query.removeEventListener('change', scheduleSync);
      host_window.removeEventListener('resize', scheduleSync);
      host_document.removeEventListener('pointerdown', handlePointerDown, true);
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
    const nav_min_height = parseCssPixelValue(
      body_style.getPropertyValue('--th-modern-left-nav-min-height'),
      LEFT_NAV_MIN_HEIGHT_FALLBACK,
    );
    const recent_min_height = parseCssPixelValue(
      body_style.getPropertyValue('--th-modern-recent-min-height'),
      LEFT_NAV_RECENT_MIN_HEIGHT_FALLBACK,
    );
    const max_height = Math.max(
      nav_min_height,
      host_window.innerHeight - nav_top - recent_min_height - LEFT_NAV_BOTTOM_GAP,
    );
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
    const next_height = Math.ceil(Math.min(Math.max(content_height, nav_min_height), max_height));
    setHostCssVariable(LEFT_NAV_HEIGHT_VARIABLE, `${next_height}px`);
  };

  const schedule = () => {
    if (frame !== 0) {
      return;
    }
    frame = host_window.requestAnimationFrame(update);
  };

  const toggle_resize_observer =
    holder instanceof host_window.HTMLElement ? new host_window.ResizeObserver(schedule) : undefined;
  const observeDrawerToggles = () => {
    toggle_resize_observer?.disconnect();
    holder
      ?.querySelectorAll<HTMLElement>(':scope > .drawer > .drawer-toggle')
      .forEach(toggle => toggle_resize_observer?.observe(toggle));
  };
  const holder_observer =
    holder instanceof host_window.HTMLElement
      ? new host_window.MutationObserver(mutations => {
          if (
            mutations.some(
              mutation =>
                mutation.target === holder ||
                (mutation.target instanceof host_window.Element &&
                  mutation.target.matches('#top-settings-holder > .drawer')),
            )
          ) {
            observeDrawerToggles();
            schedule();
          }
        })
      : undefined;
  holder_observer?.observe(holder!, { childList: true, subtree: true });
  observeDrawerToggles();
  let is_two_column_active =
    host_document.body.classList.contains(BODY_CLASS_ENABLED) &&
    host_document.body.classList.contains(BODY_CLASS_TWO_COLUMN);
  const body_observer = new host_window.MutationObserver(() => {
    const next_is_two_column_active =
      host_document.body.classList.contains(BODY_CLASS_ENABLED) &&
      host_document.body.classList.contains(BODY_CLASS_TWO_COLUMN);
    if (next_is_two_column_active !== is_two_column_active) {
      is_two_column_active = next_is_two_column_active;
      schedule();
    }
  });
  body_observer.observe(host_document.body, { attributes: true, attributeFilter: ['class'] });
  host_window.addEventListener('resize', schedule);
  schedule();

  return {
    destroy: () => {
      if (frame !== 0) {
        host_window.cancelAnimationFrame(frame);
      }
      holder_observer?.disconnect();
      toggle_resize_observer?.disconnect();
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
    const is_docked_drawer = body.classList.contains(BODY_CLASS_DOCKED_DRAWER);
    if (
      kind === 'sidebar' &&
      (!sidebar ||
        (open_drawer && !is_docked_drawer) ||
        body.classList.contains(BODY_CLASS_SIDEBAR_COLLAPSED) ||
        body.classList.contains(BODY_CLASS_AUTO_COLLAPSE))
    ) {
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
        const docked_max_width = open_drawer
          ? host_window.innerWidth - open_drawer.getBoundingClientRect().width - DOCKED_DRAWER_MIN_CHAT_WIDTH - MAIN_LAYOUT_GAP * 2
          : LEFT_SIDEBAR_MAX_WIDTH;
        const max_width = is_docked_drawer ? Math.min(LEFT_SIDEBAR_MAX_WIDTH, docked_max_width) : LEFT_SIDEBAR_MAX_WIDTH;
        scheduleWidthApply(
          Math.round(clamp(start_width + delta, LEFT_SIDEBAR_MIN_WIDTH, max_width, DEFAULT_LEFT_SIDEBAR_WIDTH)),
        );
        return;
      }

      const reserved_width = is_docked_drawer
        ? DOCKED_DRAWER_MIN_CHAT_WIDTH + MAIN_LAYOUT_GAP * 2
        : OVERLAY_PANEL_RESERVED_WIDTH;
      const max_width = Math.max(OVERLAY_PANEL_MIN_WIDTH, host_window.innerWidth - drawer_left - reserved_width);
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

  const shouldUseExpandedSelectors = () => {
    return desktop_query.matches && host_document.body.classList.contains(BODY_CLASS_TWO_COLUMN);
  };

  const restoreSelectSize = (select: HTMLSelectElement) => {
    if (!original_select_sizes.has(select)) {
      return;
    }
    const original_size = original_select_sizes.get(select);
    if (original_size === undefined) {
      return;
    }
    if (original_size === null) {
      if (select.hasAttribute('size')) {
        select.removeAttribute('size');
      }
    } else if (select.getAttribute('size') !== original_size) {
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
    const size = String(Math.max(2, select.options.length));
    if (select.getAttribute('size') !== size) {
      select.setAttribute('size', size);
    }
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
    const source_config = getApiSourceSelector();
    setSelectListMode(
      '#rm_api_block #chat_completion_source',
      Boolean(main_api_block && source_config?.selector === '#rm_api_block #chat_completion_source' && use_expanded_selectors),
    );
    setSelectListMode(
      '#rm_api_block #textgen_type',
      Boolean(main_api_block && source_config?.selector === '#rm_api_block #textgen_type' && use_expanded_selectors),
    );

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
  };

  const enhanceApiPanel = () => {
    const api_panel = host_document.querySelector<HTMLElement>('#rm_api_block');
    if (!api_panel?.classList.contains('openDrawer')) {
      setSelectListMode('#rm_api_block #main_api', false);
      setSelectListMode('#rm_api_block #chat_completion_source', false);
      setSelectListMode('#rm_api_block #textgen_type', false);
      return;
    }

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
  };

  const scheduleApiPanelEnhancement = () => {
    if (scheduled_enhance_frame !== 0) {
      return;
    }
    scheduled_enhance_frame = host_window.requestAnimationFrame(() => {
      scheduled_enhance_frame = 0;
      enhanceApiPanel();
    });
  };

  enhanceApiPanel();
  const api_panel = host_document.querySelector('#rm_api_block');
  const observer =
    api_panel instanceof host_window.HTMLElement
      ? new host_window.MutationObserver(() => {
          scheduleApiPanelEnhancement();
        })
      : undefined;
  if (api_panel instanceof host_window.HTMLElement) {
    observer?.observe(api_panel, { childList: true, subtree: true });
  }
  const panel_state_observer =
    api_panel instanceof host_window.HTMLElement
      ? new host_window.MutationObserver(() => {
          scheduleApiPanelEnhancement();
        })
      : undefined;
  panel_state_observer?.observe(api_panel!, { attributes: true, attributeFilter: ['class'] });
  let use_expanded_selectors = shouldUseExpandedSelectors();
  const handleApiLayoutChange = () => {
    const next_use_expanded_selectors = shouldUseExpandedSelectors();
    if (next_use_expanded_selectors === use_expanded_selectors) {
      return;
    }
    use_expanded_selectors = next_use_expanded_selectors;
    scheduleApiPanelEnhancement();
  };
  const body_observer = new host_window.MutationObserver(() => {
    handleApiLayoutChange();
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
  desktop_query.addEventListener('change', handleApiLayoutChange);

  return {
    destroy: () => {
      clearScheduledApiPanelEnhancement();
      observer?.disconnect();
      panel_state_observer?.disconnect();
      body_observer.disconnect();
      host_document.removeEventListener('input', handleApiSelectorChange);
      host_document.removeEventListener('change', handleApiSelectorChange);
      desktop_query.removeEventListener('change', handleApiLayoutChange);
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

function shouldUseDockedDrawer(
  settings: ModernLayoutSettings,
  is_active: boolean,
  should_use_two_column: boolean,
): boolean {
  if (!is_active || !should_use_two_column || !settings.desktopDockedDrawer) {
    return false;
  }

  const host_document = getHostDocument();
  const host_window = getHostWindow();
  if (!host_window.matchMedia(DESKTOP_TWO_COLUMN_QUERY).matches) {
    return false;
  }

  const viewport_width = Math.min(host_window.innerWidth, host_document.documentElement.clientWidth || host_window.innerWidth);
  const left_width = clamp(
    settings.leftSidebarWidth,
    LEFT_SIDEBAR_MIN_WIDTH,
    LEFT_SIDEBAR_MAX_WIDTH,
    DEFAULT_LEFT_SIDEBAR_WIDTH,
  );
  const panel_width = clamp(
    settings.overlayPanelWidth,
    OVERLAY_PANEL_MIN_WIDTH,
    Number.MAX_SAFE_INTEGER,
    DEFAULT_OVERLAY_PANEL_WIDTH,
  );
  return viewport_width >= left_width + panel_width + DOCKED_DRAWER_MIN_CHAT_WIDTH + MAIN_LAYOUT_GAP * 2;
}

function applyBodyState(settings: ModernLayoutSettings, is_active: boolean, should_use_two_column: boolean) {
  const host_document = getHostDocument();
  const host_window = getHostWindow();
  const $body = $(host_document.body);
  const should_auto_collapse = is_active && should_use_two_column && host_window.matchMedia(COMPACT_TWO_COLUMN_QUERY).matches;
  const should_use_docked_drawer = shouldUseDockedDrawer(settings, is_active, should_use_two_column);
  $body
    .toggleClass(BODY_CLASS_ENABLED, is_active)
    .toggleClass(BODY_CLASS_TWO_COLUMN, should_use_two_column)
    .toggleClass(BODY_CLASS_DOCKED_DRAWER, should_use_docked_drawer)
    .toggleClass(BODY_CLASS_MAIN_FILL, is_active && should_use_two_column && settings.mainChatMaxWidth === 0)
    .toggleClass(BODY_CLASS_REDUCE_MOTION, is_active && settings.reduceMotion)
    .toggleClass(BODY_CLASS_REDUCE_ADVANCED_EFFECTS, is_active && settings.reduceAdvancedEffects)
    .toggleClass(BODY_CLASS_AUTO_COLLAPSE, should_auto_collapse)
    .removeClass(BODY_CLASS_LEGACY_THREE_COLUMN);
  if (!should_auto_collapse || $body.hasClass(BODY_CLASS_SIDEBAR_COLLAPSED)) {
    $body.removeClass(BODY_CLASS_TEMP_EXPANDED);
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
    '--th-modern-main-min-width',
    `${clamp(settings.mainChatMaxWidth, 0, Number.MAX_SAFE_INTEGER, DEFAULT_MAIN_CHAT_MIN_WIDTH)}px`,
  );
}

function clearBodyState() {
  $(getHostDocument().body).removeClass(
    `${BODY_CLASS_ENABLED} ${BODY_CLASS_TWO_COLUMN} ${BODY_CLASS_LEGACY_THREE_COLUMN} ${BODY_CLASS_DOCKED_DRAWER} ${BODY_CLASS_MAIN_FILL} ${BODY_CLASS_REDUCE_MOTION} ${BODY_CLASS_REDUCE_ADVANCED_EFFECTS} ${BODY_CLASS_SIDEBAR_COLLAPSED} ${BODY_CLASS_AUTO_COLLAPSE} ${BODY_CLASS_TEMP_EXPANDED} ${BODY_CLASS_RESIZING} ${BODY_CLASS_DRAWER_FULLSCREEN} ${BODY_CLASS_DRAWER_OPEN} ${BODY_CLASS_DRAWER_SWITCHING}`,
  );
  removeHostCssVariable('--th-modern-left-width');
  removeHostCssVariable('--th-modern-overlay-width');
  removeHostCssVariable('--th-modern-main-min-width');
  removeHostCssVariable(LEFT_NAV_HEIGHT_VARIABLE);
}

function runCleanup(cleanup: (() => void) | undefined) {
  if (!cleanup) {
    return;
  }
  try {
    cleanup();
  } catch (error) {
    console.error(`[${SCRIPT_NAME}] 清理运行时资源失败。`, error);
  }
}

function runCleanupStack(cleanups: Array<() => void>) {
  while (cleanups.length > 0) {
    runCleanup(cleanups.pop());
  }
}

function mountPreferredResources(): { destroy: () => void } {
  const cleanups: Array<() => void> = [];
  try {
    cleanups.push(mountIconStylesheet().destroy);
    cleanups.push(teleportStyle().destroy);
    return { destroy: _.once(() => runCleanupStack(cleanups)) };
  } catch (error) {
    runCleanupStack(cleanups);
    throw error;
  }
}

function mountActiveRuntime(store: ReturnType<typeof useModernLayoutStore>): { destroy: () => void } {
  const cleanups: Array<() => void> = [clearBodyState];
  let recent_chats: ReturnType<typeof mountRecentChats> | undefined;

  try {
    const sidebar = mountSidebar(() => recent_chats?.refresh());
    cleanups.push(sidebar.destroy);
    recent_chats = mountRecentChats(sidebar.$list);
    cleanups.push(recent_chats.destroy);
    cleanups.push(mountDrawerEnhancements().destroy);
    cleanups.push(mountExtensionSettings(store).destroy);
    cleanups.push(mountSidebarNavSizer().destroy);
    cleanups.push(mountFailsafeRestore(store).destroy);
    cleanups.push(mountFloatingMenuPositioner().destroy);
    cleanups.push(mountResponsiveMode(store).destroy);
    cleanups.push(mountResizeHandles(store).destroy);
    cleanups.push(mountApiPanelEnhancements().destroy);
    cleanups.push(mountWorldInfoEditor(store).destroy);
    cleanups.push(mountCharacterManagement(store).destroy);

    const stop_state_watch = watch(
      () => [klona(store.settings), store.should_use_two_column] as const,
      ([settings, should_use_two_column]) => {
        applyBodyState(settings, true, should_use_two_column);
      },
      { immediate: true, deep: true, flush: 'sync' },
    );
    cleanups.push(stop_state_watch);

    const refresh_recent_chats = _.debounce(() => recent_chats?.refresh(), 500);
    cleanups.push(refresh_recent_chats.cancel);
    const events = [
      eventOn(tavern_events.APP_READY, refresh_recent_chats),
      eventOn(tavern_events.CHAT_CHANGED, refresh_recent_chats),
      eventOn(tavern_events.CHAT_CREATED, refresh_recent_chats),
      eventOn(tavern_events.CHAT_DELETED, refresh_recent_chats),
      eventOn(tavern_events.MESSAGE_SENT, refresh_recent_chats),
      eventOn(tavern_events.MESSAGE_RECEIVED, refresh_recent_chats),
      eventOn(tavern_events.CHARACTER_PAGE_LOADED, refresh_recent_chats),
    ];
    cleanups.push(() => events.forEach(event => event.stop()));
    refresh_recent_chats();

    return { destroy: _.once(() => runCleanupStack(cleanups)) };
  } catch (error) {
    runCleanupStack(cleanups);
    throw error;
  }
}

function getRuntimeRegistry(): Map<string, RuntimeDisposer> {
  const host_window = getHostWindow();
  const existing = _.get(host_window, RUNTIME_REGISTRY_PATH) as unknown;
  if (
    existing &&
    typeof (existing as Map<string, RuntimeDisposer>).get === 'function' &&
    typeof (existing as Map<string, RuntimeDisposer>).set === 'function'
  ) {
    return existing as Map<string, RuntimeDisposer>;
  }

  const registry = new Map<string, RuntimeDisposer>();
  _.set(host_window, RUNTIME_REGISTRY_PATH, registry);
  return registry;
}

function initializeModernLayout(context: PluginActivationContext): PluginRuntime {
  const host_window = getHostWindow();
  const script_window = window;
  const previous_dispose = _.get(host_window, LEGACY_RUNTIME_DISPOSE_PATH) as unknown;
  if (typeof previous_dispose === 'function') {
    (previous_dispose as RuntimeDisposer)();
    _.unset(host_window, LEGACY_RUNTIME_DISPOSE_PATH);
  }

  const script_id = getScriptId();
  const runtime_registry = getRuntimeRegistry();
  runtime_registry.get(script_id)?.({ unregisterUnique: false });
  void checkMinimumVersion('4.0.0', SCRIPT_NAME);

  const pinia = getActivePinia() ?? createPinia();
  setActivePinia(pinia);
  const store = useModernLayoutStore();
  let destroy_panel: (() => void) | undefined;
  let preferred_resources: ReturnType<typeof mountPreferredResources> | undefined;
  let active_runtime: ReturnType<typeof mountActiveRuntime> | undefined;
  let stop_runtime_watch: (() => void) | undefined;
  let destroy_all: RuntimeDisposer | undefined;

  try {
    destroy_panel = initPanel(pinia, context).destroy;
    const syncRuntime = () => {
      if (!store.should_enable) {
        active_runtime?.destroy();
        active_runtime = undefined;
        preferred_resources?.destroy();
        preferred_resources = undefined;
        return;
      }

      preferred_resources ??= mountPreferredResources();
      if (store.is_active) {
        active_runtime ??= mountActiveRuntime(store);
      } else {
        active_runtime?.destroy();
        active_runtime = undefined;
      }
    };
    stop_runtime_watch = watch(() => [store.should_enable, store.is_active] as const, syncRuntime, {
      immediate: true,
      flush: 'sync',
    });

    const handlePageHide = () => destroy_all?.();
    destroy_all = _.once((options: { unregisterUnique?: boolean } = {}) => {
      script_window.removeEventListener('pagehide', handlePageHide);
      runCleanup(stop_runtime_watch);
      stop_runtime_watch = undefined;
      runCleanup(active_runtime?.destroy);
      active_runtime = undefined;
      runCleanup(preferred_resources?.destroy);
      preferred_resources = undefined;
      runCleanup(destroy_panel);
      destroy_panel = undefined;
      if (runtime_registry.get(script_id) === destroy_all) {
        runtime_registry.delete(script_id);
      }
      store.destroy({ unregisterUnique: options.unregisterUnique });
    });

    runtime_registry.set(script_id, destroy_all);
    script_window.addEventListener('pagehide', handlePageHide);
    return { dispose: () => destroy_all?.() };
  } catch (error) {
    runCleanup(stop_runtime_watch);
    runCleanup(active_runtime?.destroy);
    runCleanup(preferred_resources?.destroy);
    runCleanup(destroy_panel);
    store.destroy();
    throw error;
  }
}

export async function activate(context: PluginActivationContext): Promise<PluginRuntime> {
  await new Promise<void>(resolve => $(resolve));
  return initializeModernLayout(context);
}
