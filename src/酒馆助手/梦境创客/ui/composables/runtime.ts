// Runtime 订阅与跨组件上下文。
// 根组件调用 provideDreamCardAgent() 建立唯一订阅；
// 叶子组件用 useDreamCardAgent() 读取状态并调用动作，不各自订阅 Runtime。
import { inject, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from 'vue';
import type { AgentSkill } from '../../core/skills/types';
import {
  getDreamCardAgentRuntime,
  type DreamCardAgentRuntime,
  type DreamCardAgentRuntimeState,
} from '../../runtime/dream-card-agent-runtime';

export type WorkspaceView = 'home' | 'session' | 'settings';
export type SettingsSection = 'agent' | 'api' | 'diagnostics' | 'general' | 'preset' | 'skills' | 'storage' | 'theme';
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
  action: (work: () => Promise<unknown>) => Promise<boolean>;
  closeSessionTab: (id: string) => Promise<void>;
  confirmCharacterSwitch: (confirmed: boolean) => void;
  createSession: () => Promise<void>;
  createSessionForCharacter: (bindingId: string) => Promise<void>;
  deleteCharacterSession: (bindingId: string, id: string) => Promise<boolean>;
  deleteSession: (id: string) => Promise<boolean>;
  isSessionTabRunning: (id: string) => boolean;
  openSessionTab: (id: string) => Promise<void>;
  openCharacterSession: (bindingId: string, id: string) => Promise<void>;
  openSettings: (section: SettingsSection) => void;
  openedSessionIds: Ref<string[]>;
  characterSwitchRequest: Ref<CharacterSwitchRequest | undefined>;
  isMobile: Ref<boolean>;
  mobileSurface: Ref<MobileSurface>;
  runtime: DreamCardAgentRuntime;
  settingsSection: Ref<SettingsSection>;
  sidebarCollapsed: Ref<boolean>;
  sidebarFocus: Ref<SidebarFocusRequest | undefined>;
  skillEditorRequest: Ref<SkillEditorRequest | undefined>;
  state: Ref<DreamCardAgentRuntimeState>;
  workspaceView: Ref<WorkspaceView>;
};

const key: InjectionKey<DreamCardAgentContext> = Symbol('dca-runtime');

export function provideDreamCardAgent(): DreamCardAgentContext {
  const runtime = getDreamCardAgentRuntime();
  // Runtime每次发布的都是完整新快照；浅响应避免Vue反复代理庞大的文件树、事件和历史正文。
  const state = shallowRef<DreamCardAgentRuntimeState>(runtime.snapshot());
  const workspaceView = ref<WorkspaceView>('home');
  const settingsSection = ref<SettingsSection>('general');
  const openedSessionIds = ref<string[]>([]);
  const sidebarFocus = ref<SidebarFocusRequest>();
  const skillEditorRequest = ref<SkillEditorRequest>();
  const characterSwitchRequest = ref<CharacterSwitchRequest>();
  const isMobile = ref(false);
  const mobileSurface = ref<MobileSurface>('workspace');
  const sidebarCollapsed = ref(localStorage.getItem('dream-card-agent:sidebar-collapsed') === 'true');
  let initialStateReceived = false;
  let unsubscribe = () => {};

  async function action(work: () => Promise<unknown>): Promise<boolean> {
    try {
      await work();
      return true;
    } catch (error) {
      toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
      return false;
    }
  }

  async function refresh() {
    try {
      await runtime.refreshCharacter();
    } catch {
      // 刷新错误已经进入运行时状态并显示在窗口顶端，不再重复弹出全局Toast。
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
      toastr.error('角色卡已不可用，不能新建会话。', '梦境创客');
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

  function isSessionTabRunning(id: string): boolean {
    return ['running', 'waiting-approval'].includes(
      state.value.sessionStatuses[id] ?? '',
    );
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
    toastr.success('会话及其操作记录已删除。', '梦境创客');
    return true;
  }

  async function deleteCharacterSession(bindingId: string, id: string): Promise<boolean> {
    const wasActive = state.value.active?.sessionId === id;
    if (!(await action(() => runtime.deleteCharacterSession(bindingId, id)))) return false;
    openedSessionIds.value = openedSessionIds.value.filter(item => item !== id);
    if (workspaceView.value === 'session' && wasActive) workspaceView.value = 'home';
    toastr.success('会话及其操作记录已删除。', '梦境创客');
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
    window.removeEventListener('resize', updateViewport);
    unsubscribe();
  });
  watch(sidebarCollapsed, value => localStorage.setItem('dream-card-agent:sidebar-collapsed', String(value)));

  const context: DreamCardAgentContext = {
    action,
    closeSessionTab,
    confirmCharacterSwitch,
    createSession,
    createSessionForCharacter,
    deleteCharacterSession,
    deleteSession,
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
  return context;
}

export function useDreamCardAgent(): DreamCardAgentContext {
  const context = inject(key);
  if (!context) throw new Error('useDreamCardAgent() 只能在梦境创客工作台组件树内使用。');
  return context;
}
