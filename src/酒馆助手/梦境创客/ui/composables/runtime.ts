// Runtime 订阅与跨组件上下文。
// 根组件调用 provideDreamCardAgent() 建立唯一订阅；
// 叶子组件用 useDreamCardAgent() 读取状态并调用动作，不各自订阅 Runtime。
import { inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey, type Ref } from 'vue';
import type { AgentSkill } from '../../core/skills/types';
import {
  getDreamCardAgentRuntime,
  type DreamCardAgentRuntime,
  type DreamCardAgentRuntimeState,
} from '../../runtime/dream-card-agent-runtime';

export type WorkspaceView = 'home' | 'session' | 'settings';
export type SettingsSection = 'agent' | 'api' | 'diagnostics' | 'general' | 'preset' | 'skills' | 'storage';
export type SidebarTab = 'context' | 'diff' | 'files';

export type SkillEditorRequest = { deleting: boolean; skill?: AgentSkill };
export type SidebarFocusRequest = { filePath?: string; tab: SidebarTab };

export type DreamCardAgentContext = {
  action: (work: () => Promise<unknown>) => Promise<boolean>;
  closeSessionTab: (id: string) => Promise<void>;
  createSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<boolean>;
  isSessionTabRunning: (id: string) => boolean;
  openSessionTab: (id: string) => Promise<void>;
  openSettings: (section: SettingsSection) => void;
  openedSessionIds: Ref<string[]>;
  runtime: DreamCardAgentRuntime;
  settingsSection: Ref<SettingsSection>;
  sidebarFocus: Ref<SidebarFocusRequest | undefined>;
  skillEditorRequest: Ref<SkillEditorRequest | undefined>;
  state: Ref<DreamCardAgentRuntimeState>;
  workspaceView: Ref<WorkspaceView>;
};

const key: InjectionKey<DreamCardAgentContext> = Symbol('dca-runtime');

export function provideDreamCardAgent(): DreamCardAgentContext {
  const runtime = getDreamCardAgentRuntime();
  const state = ref<DreamCardAgentRuntimeState>(runtime.snapshot());
  const workspaceView = ref<WorkspaceView>('home');
  const settingsSection = ref<SettingsSection>('general');
  const openedSessionIds = ref<string[]>([]);
  const sidebarFocus = ref<SidebarFocusRequest>();
  const skillEditorRequest = ref<SkillEditorRequest>();
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
    return ['awaiting-approval', 'committing', 'running', 'waiting-approval'].includes(
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
    toastr.success('会话及其快照已删除。', '梦境创客');
    return true;
  }

  function openSettings(section: SettingsSection) {
    settingsSection.value = section;
    workspaceView.value = 'settings';
  }

  onMounted(() => {
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
  onBeforeUnmount(() => unsubscribe());

  const context: DreamCardAgentContext = {
    action,
    closeSessionTab,
    createSession,
    deleteSession,
    isSessionTabRunning,
    openSessionTab,
    openSettings,
    openedSessionIds,
    runtime,
    settingsSection,
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
