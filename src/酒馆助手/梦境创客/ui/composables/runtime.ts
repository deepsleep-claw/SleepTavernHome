// Runtime 订阅与跨组件上下文。
// 根组件调用 provideDreamCardAgent() 建立唯一订阅；
// 叶子组件用 useDreamCardAgent() 读取状态并调用动作，不各自订阅 Runtime。
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
  type InjectionKey,
  type Ref,
} from 'vue';
import type { AgentSkill } from '../../core/skills/types';
import { type DreamCardAgentRuntimeState } from '../../runtime/dream-card-agent-runtime';
import {
  clientEnvironment,
  readClientHost,
  getDreamCardAgentClient,
  type DreamCardAgentClient,
} from '../runtime-client';
import {
  bindMobileHistory,
  createWorkspaceNavigation,
  provideWorkspaceNavigation,
  useBackLayer,
} from './workspace-navigation';
import { connectNotifications, createNotificationCenter, notify, type NotificationCenter } from './notifications';
import { useRuntimeNotifications } from './notification-sources';
import { createResourceDrafts, type ResourceDrafts } from './resource-drafts';

export type WorkspaceView = 'home' | 'session' | 'settings';
export type SettingsSection =
  'agent' | 'api' | 'diagnostics' | 'general' | 'preset' | 'resources' | 'skills' | 'storage' | 'theme' | 'update';
export type SidebarTab = 'context' | 'diff' | 'files';

export type SkillEditorRequest = { builtin?: boolean; deleting: boolean; skill?: AgentSkill };
export type SidebarFocusRequest = { filePath?: string; tab: SidebarTab };
export type MobileSurface = 'navigation' | 'workspace';
export type CharacterSwitchRequest = {
  characterName: string;
  kind: 'create' | 'open';
  resolve: (confirmed: boolean) => void;
};

export type DreamCardAgentContext = {
  resourceDrafts: ResourceDrafts;
  navigation: ReturnType<typeof createWorkspaceNavigation>;
  notifications: NotificationCenter;
  backupConflictsOpen: Ref<boolean>;
  action: (work: () => Promise<unknown>) => Promise<boolean>;
  closeSessionTab: (id: string) => Promise<void>;
  confirmCharacterSwitch: (confirmed: boolean) => void;
  createSession: () => Promise<void>;
  createGlobalSession: () => Promise<void>;
  createSessionForAvatar: (avatarId: string) => Promise<void>;
  createSessionForCharacter: (bindingId: string) => Promise<void>;
  deleteCharacterSession: (bindingId: string, id: string) => Promise<boolean>;
  deleteSession: (id: string) => Promise<boolean>;
  forkSessionFromMessage: (messageId: string) => Promise<void>;
  isSessionTabRunning: (id: string) => boolean;
  openSessionTab: (id: string) => Promise<void>;
  openCharacterSession: (bindingId: string, id: string) => Promise<void>;
  openSettings: (section: SettingsSection) => void;
  openedSessionIds: Ref<string[]>;
  characterSwitchRequest: Ref<CharacterSwitchRequest | undefined>;
  isMobile: Ref<boolean>;
  mobileSurface: Ref<MobileSurface>;
  runtime: DreamCardAgentClient;
  settingsSection: Ref<SettingsSection>;
  sidebarCollapsed: Ref<boolean>;
  sidebarFocus: Ref<SidebarFocusRequest | undefined>;
  skillEditorRequest: Ref<SkillEditorRequest | undefined>;
  state: Ref<DreamCardAgentRuntimeState>;
  workspaceView: Ref<WorkspaceView>;
};

const key: InjectionKey<DreamCardAgentContext> = Symbol('dca-runtime');

export function provideDreamCardAgent(): DreamCardAgentContext {
  const runtime = getDreamCardAgentClient();
  // Runtime每次发布的都是完整新快照；浅响应避免Vue反复代理庞大的文件树、事件和历史正文。
  const state = shallowRef<DreamCardAgentRuntimeState>(runtime.snapshot());
  const notifications = createNotificationCenter();
  const resourceDrafts = createResourceDrafts();
  const backupConflictsOpen = ref(false);
  const disconnectNotifications = connectNotifications(notifications);
  const workspaceView = ref<WorkspaceView>('home');
  const settingsSection = ref<SettingsSection>('general');
  const openedSessionIds = ref<string[]>([]);
  const sidebarFocus = ref<SidebarFocusRequest>();
  const skillEditorRequest = ref<SkillEditorRequest>();
  const characterSwitchRequest = ref<CharacterSwitchRequest>();
  const isMobile = ref(false);
  const mobileSurface = ref<MobileSurface>('workspace');
  const sidebarCollapsed = ref(localStorage.getItem('dream-card-agent:sidebar-collapsed') === 'true');
  let settingsReturn: WorkspaceView = 'home';
  const navigation = createWorkspaceNavigation(
    isMobile,
    () => {
      if (workspaceView.value === 'settings')
        workspaceView.value = settingsReturn === 'session' && state.value.active ? 'session' : 'home';
      else workspaceView.value = 'home';
    },
    () => workspaceView.value !== 'home',
  );
  provideWorkspaceNavigation(navigation);
  watch(
    workspaceView,
    (next, previous) => {
      if (next === 'settings' && previous !== 'settings') settingsReturn = previous;
    },
    { flush: 'sync' },
  );
  useBackLayer(
    computed(() => mobileSurface.value === 'navigation'),
    () => {
      mobileSurface.value = 'workspace';
    },
    navigation,
  );
  useBackLayer(notifications.open, notifications.close, navigation);
  useBackLayer(
    backupConflictsOpen,
    () => {
      backupConflictsOpen.value = false;
    },
    navigation,
  );
  useBackLayer(
    computed(() => Boolean(characterSwitchRequest.value)),
    () => confirmCharacterSwitch(false),
    navigation,
  );
  let releaseHistory = () => {};
  const escapeLayer = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !navigation.layers.value.length || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    navigation.back();
  };
  let initialStateReceived = false;
  let unsubscribe = () => {};

  async function action(work: () => Promise<unknown>): Promise<boolean> {
    try {
      await work();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (state.value.error !== message) notify.error(message, '梦境创客');
      return false;
    }
  }

  async function refresh() {
    try {
      await runtime.refreshCharacter();
    } catch {
      // 刷新错误由运行时状态进入通知中心。
    }
  }

  async function createSession() {
    let sessionId = '';
    const succeeded = await action(async () => {
      sessionId = (await runtime.createSession()).sessionId;
    });
    if (succeeded && sessionId) {
      ensureSessionTab(sessionId);
      workspaceView.value = 'session';
    }
  }

  async function createGlobalSession() {
    let sessionId = '';
    const succeeded = await action(async () => {
      sessionId = (await runtime.createSession({ scope: 'global' })).sessionId;
    });
    if (succeeded && sessionId) {
      ensureSessionTab(sessionId);
      workspaceView.value = 'session';
      if (isMobile.value) mobileSurface.value = 'workspace';
    }
  }

  async function createSessionForAvatar(avatarId: string) {
    const character = state.value.availableCharacters.find(item => item.avatarId === avatarId);
    if (!character) {
      notify.error('角色卡已经不可用。', '梦境创客');
      return;
    }
    if (
      state.value.currentCharacter?.avatarId !== avatarId &&
      !(await requestCharacterSwitch(character.name, 'create'))
    ) {
      return;
    }
    let sessionId = '';
    const succeeded = await action(async () => {
      sessionId = (await runtime.selectCharacterAndCreateSession(avatarId)).sessionId;
    });
    if (succeeded && sessionId) {
      ensureSessionTab(sessionId);
      workspaceView.value = 'session';
      if (isMobile.value) mobileSurface.value = 'workspace';
    }
  }

  function requestCharacterSwitch(characterName: string, kind: CharacterSwitchRequest['kind']): Promise<boolean> {
    return new Promise(resolve => {
      characterSwitchRequest.value = { characterName, kind, resolve };
    });
  }

  function confirmCharacterSwitch(confirmed: boolean) {
    const request = characterSwitchRequest.value;
    characterSwitchRequest.value = undefined;
    request?.resolve(confirmed);
  }

  async function createSessionForCharacter(bindingId: string) {
    const group = state.value.characterGroups?.find(item => item.bindingId === bindingId);
    if (!group?.available) {
      notify.error('角色卡已不可用，不能新建会话。', '梦境创客');
      return;
    }
    if (group.current) {
      await createSession();
    } else {
      if (!(await requestCharacterSwitch(group.characterName, 'create'))) return;
      let sessionId = '';
      const succeeded = await action(async () => {
        sessionId = (await runtime.switchCharacterAndCreateSession(bindingId)).sessionId;
      });
      if (succeeded && sessionId) {
        ensureSessionTab(sessionId);
        workspaceView.value = 'session';
      }
    }
    if (isMobile.value) mobileSurface.value = 'workspace';
  }

  async function openCharacterSession(bindingId: string, id: string) {
    const group = state.value.characterGroups?.find(item => item.bindingId === bindingId);
    if (!group) return;
    if (state.value.active?.sessionId === id) {
      ensureSessionTab(id);
      workspaceView.value = 'session';
      if (isMobile.value) mobileSurface.value = 'workspace';
      return;
    }
    let succeeded = false;
    if (!group.available) {
      succeeded = await action(() => runtime.openHistorySession(bindingId, id));
    } else if (group.current) {
      succeeded = await action(() => runtime.openSession(id));
    } else {
      if (!(await requestCharacterSwitch(group.characterName, 'open'))) return;
      succeeded = await action(() => runtime.switchCharacterAndOpenSession(bindingId, id));
    }
    if (succeeded) {
      ensureSessionTab(id);
      workspaceView.value = 'session';
      if (isMobile.value) mobileSurface.value = 'workspace';
    }
  }

  async function openSessionTab(id: string) {
    if (state.value.active?.sessionId === id) {
      ensureSessionTab(id);
      workspaceView.value = 'session';
      return;
    }
    if (await action(() => runtime.openSession(id))) {
      ensureSessionTab(id);
      workspaceView.value = 'session';
    }
  }

  async function forkSessionFromMessage(messageId: string) {
    let sessionId = '';
    const succeeded = await action(async () => {
      sessionId = (await runtime.forkSession(messageId)).sessionId;
    });
    if (!succeeded || !sessionId) return;
    ensureSessionTab(sessionId);
    workspaceView.value = 'session';
    if (isMobile.value) mobileSurface.value = 'workspace';
    notify.success('已从该轮输出创建分叉会话。', '梦境创客');
  }

  function isSessionTabRunning(id: string): boolean {
    return ['running', 'waiting-approval'].includes(state.value.sessionStatuses[id] ?? '');
  }

  function ensureSessionTab(id: string) {
    if (!openedSessionIds.value.includes(id)) openedSessionIds.value = [...openedSessionIds.value, id];
  }

  async function closeSessionTab(id: string) {
    if (isSessionTabRunning(id)) return;
    const wasActive = state.value.active?.sessionId === id;
    if (!(await action(async () => runtime.closeSession(id)))) return;
    openedSessionIds.value = openedSessionIds.value.filter(item => item !== id);
    if (workspaceView.value === 'session' && wasActive) workspaceView.value = 'home';
  }

  async function deleteSession(id: string): Promise<boolean> {
    const wasActive = state.value.active?.sessionId === id;
    if (!(await action(() => runtime.deleteSession(id)))) return false;
    openedSessionIds.value = openedSessionIds.value.filter(item => item !== id);
    if (workspaceView.value === 'session' && wasActive) workspaceView.value = 'home';
    notify.success('会话及其操作记录已删除。', '梦境创客');
    return true;
  }

  async function deleteCharacterSession(bindingId: string, id: string): Promise<boolean> {
    const wasActive = state.value.active?.sessionId === id;
    if (!(await action(() => runtime.deleteCharacterSession(bindingId, id)))) return false;
    openedSessionIds.value = openedSessionIds.value.filter(item => item !== id);
    if (workspaceView.value === 'session' && wasActive) workspaceView.value = 'home';
    notify.success('会话及其操作记录已删除。', '梦境创客');
    return true;
  }

  function openSettings(section: SettingsSection) {
    settingsSection.value = section;
    workspaceView.value = 'settings';
  }

  const updateViewport = () => {
    const next = window.innerWidth <= 720;
    if (next !== isMobile.value) {
      isMobile.value = next;
      mobileSurface.value = 'workspace';
    }
  };

  onMounted(() => {
    updateViewport();
    document.addEventListener('keydown', escapeLayer);
    const historyClient = {
      canGoBack: () => isMobile.value && navigation.canGoBack.value,
      back: navigation.back,
      subscribe: (update: () => void) => watch([isMobile, navigation.canGoBack], update, { flush: 'post' }),
    };
    const environment = clientEnvironment();
    const host = readClientHost(environment?.host ?? window.parent);
    releaseHistory =
      environment?.mode !== 'detached' && host?.registerMobileNavigation
        ? host.registerMobileNavigation(window, historyClient)
        : bindMobileHistory(window, historyClient).destroy;
    window.addEventListener('resize', updateViewport);
    unsubscribe = runtime.subscribe(next => {
      state.value = next;
      if (!initialStateReceived) {
        initialStateReceived = true;
        const id = next.active?.sessionId;
        openedSessionIds.value = [...new Set([...next.loadedSessionIds, ...(id ? [id] : [])])];
        workspaceView.value = id ? 'session' : 'home';
      }
    });
    void refresh();
  });
  onBeforeUnmount(() => {
    resourceDrafts.dispose();
    releaseHistory();
    document.removeEventListener('keydown', escapeLayer);
    disconnectNotifications();
    notifications.dispose();
    window.removeEventListener('resize', updateViewport);
    unsubscribe();
  });
  watch(sidebarCollapsed, value => localStorage.setItem('dream-card-agent:sidebar-collapsed', String(value)));

  const context: DreamCardAgentContext = {
    resourceDrafts,
    navigation,
    notifications,
    backupConflictsOpen,
    action,
    closeSessionTab,
    confirmCharacterSwitch,
    createGlobalSession,
    createSession,
    createSessionForAvatar,
    createSessionForCharacter,
    deleteCharacterSession,
    deleteSession,
    forkSessionFromMessage,
    isSessionTabRunning,
    openSessionTab,
    openCharacterSession,
    openSettings,
    openedSessionIds,
    characterSwitchRequest,
    isMobile,
    mobileSurface,
    runtime,
    settingsSection,
    sidebarCollapsed,
    sidebarFocus,
    skillEditorRequest,
    state: state as Ref<DreamCardAgentRuntimeState>,
    workspaceView,
  };
  provide(key, context);
  useRuntimeNotifications(context);
  return context;
}

export function useDreamCardAgent(): DreamCardAgentContext {
  const context = inject(key);
  if (!context) throw new Error('useDreamCardAgent() 只能在梦境创客工作台组件树内使用。');
  return context;
}
