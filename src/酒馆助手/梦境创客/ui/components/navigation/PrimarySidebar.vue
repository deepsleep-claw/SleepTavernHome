<template>
  <aside class="dca-primary-sidebar" :class="{ collapsed: collapsed }">
    <header class="dca-sidebar-brand">
      <div v-if="!collapsed" class="dca-sidebar-brand-identity">
        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
        <strong>{{ isMobile ? '角色与会话' : '梦境创客' }}</strong>
      </div>
      <button
        v-if="isMobile"
        class="dca-icon-btn"
        type="button"
        title="返回工作区"
        @click="mobileSurface = 'workspace'"
      >
        <i class="fa-solid fa-angles-left" aria-hidden="true"></i>
      </button>
      <button
        v-if="!isMobile"
        class="dca-icon-btn dca-sidebar-collapse"
        type="button"
        :title="collapsed ? '展开侧栏' : '收起侧栏'"
        @click="sidebarCollapsed = !sidebarCollapsed"
      >
        <i :class="collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left'" aria-hidden="true"></i>
      </button>
    </header>

    <div class="dca-sidebar-primary-actions">
      <button
        type="button"
        :disabled="state.busy"
        title="新建会话"
        @click="createSessionFromTop"
      >
        <i class="fa-solid fa-plus" aria-hidden="true"></i><span v-if="!collapsed">新建会话</span>
      </button>
      <button type="button" title="设置" @click="openSettingsFromSidebar">
        <i class="fa-solid fa-gear" aria-hidden="true"></i><span v-if="!collapsed">设置</span>
      </button>
    </div>

    <div v-if="newSessionMenuOpen && !collapsed" class="dca-new-session-menu" role="menu">
      <button class="dca-btn-start" type="button" role="menuitem" @click="createGlobalFromMenu">
        <i class="fa-solid fa-globe" aria-hidden="true"></i>
        <span><strong>全局会话</strong><small>不绑定角色卡，管理全局工作区与角色导航</small></span>
      </button>
      <button class="dca-btn-start" type="button" role="menuitem" @click="openCharacterPicker">
        <i class="fa-regular fa-address-card" aria-hidden="true"></i>
        <span><strong>角色卡会话</strong><small>选择酒馆中的一张角色卡开始创作</small></span>
      </button>
    </div>

    <section v-if="isMobile && !collapsed && openedSessions.length" class="dca-mobile-open-sessions">
      <div class="dca-sidebar-section-title">
        <span>已打开会话</span><small>{{ openedSessions.length }}</small>
      </div>
      <div class="dca-mobile-open-session-list">
        <div
          v-for="session in openedSessions"
          :key="session.sessionId"
          class="dca-mobile-open-session"
          :class="{ active: state.active?.sessionId === session.sessionId }"
        >
          <button type="button" class="dca-mobile-open-session-main" @click="openMobileSession(session)">
            <span
              class="dca-session-state"
              :class="`state-${state.sessionStatuses[session.sessionId] ?? session.status}`"
            ></span>
            <span>{{ session.title }}</span>
          </button>
          <button
            class="dca-icon-btn dca-mobile-open-session-close"
            type="button"
            :title="isSessionTabRunning(session.sessionId) ? '停止任务并关闭会话页签' : '关闭会话页签'"
            @click.stop="requestCloseSession(session.sessionId)"
          >
            <i
              :class="isSessionTabRunning(session.sessionId) ? 'fa-solid fa-stop' : 'fa-solid fa-xmark'"
              aria-hidden="true"
            ></i>
          </button>
        </div>
      </div>
    </section>

    <div v-if="!collapsed" class="dca-character-groups">
      <div class="dca-sidebar-section-title">
        <span>全局会话</span><small>{{ (state.globalSessions ?? []).length }}</small>
      </div>
      <section class="dca-global-session-group">
        <button
          v-for="session in (state.globalSessions ?? []).slice(0, 10)"
          :key="session.sessionId"
          type="button"
          :class="{ active: state.active?.sessionId === session.sessionId }"
          @click="openGlobalSession(session.sessionId)"
        >
          <i class="fa-solid fa-globe" aria-hidden="true"></i>
          <span>{{ session.title }}</span>
          <time>{{ relativeTime(session.updatedAt) }}</time>
        </button>
        <div v-if="(state.globalSessions ?? []).length === 0" class="dca-sidebar-empty">还没有全局会话</div>
      </section>
      <div class="dca-sidebar-section-title">
        <span>角色与会话</span><small>{{ groups.length }}</small>
      </div>
      <section
        v-for="group in groups"
        :key="group.bindingId"
        class="dca-character-group"
        :class="{ current: group.current, unavailable: !group.available }"
      >
        <div class="dca-character-heading" :class="{ 'menu-open': characterMenuBindingId === group.bindingId }">
          <button class="dca-character-toggle" type="button" @click="toggleGroup(group.bindingId)">
            <span class="dca-character-avatar">
              <img
                v-if="group.avatarId && !failedAvatarIds.has(group.avatarId)"
                :src="characterAvatarUrl(group.avatarId)"
                :alt="group.characterName"
                @error="failedAvatarIds.add(group.avatarId)"
              />
              <i v-else class="fa-regular fa-address-card" aria-hidden="true"></i>
            </span>
            <span class="dca-character-copy">
              <strong>{{ group.characterName || '未知角色' }}</strong>
              <small>{{
                group.current ? '当前角色' : group.available ? `${group.sessions.length} 个会话` : '角色卡不可用 · 只读'
              }}</small>
            </span>
          </button>
          <div class="dca-character-actions">
            <button
              v-if="group.available"
              class="dca-character-new"
              type="button"
              :title="`为 ${group.characterName} 新建会话`"
              @click.stop="createSessionForCharacter(group.bindingId)"
            >
              <i class="fa-solid fa-plus" aria-hidden="true"></i>
            </button>
            <button
              class="dca-character-more"
              type="button"
              :title="`${group.characterName} 的更多操作`"
              :aria-expanded="characterMenuBindingId === group.bindingId"
              @click.stop="toggleCharacterMenu(group.bindingId)"
            >
              <i class="fa-solid fa-ellipsis" aria-hidden="true"></i>
            </button>
          </div>
          <button
            v-if="characterMenuBindingId === group.bindingId"
            class="dca-character-menu-scrim"
            type="button"
            aria-label="关闭角色菜单"
            @click.stop="characterMenuBindingId = undefined"
          ></button>
          <div v-if="characterMenuBindingId === group.bindingId" class="dca-character-menu" role="menu" @click.stop>
            <button
              type="button"
              role="menuitem"
              :disabled="!group.available || state.busy"
              @click="createFromCharacterMenu(group.bindingId)"
            >
              <i class="fa-solid fa-plus" aria-hidden="true"></i><span>新建会话</span>
            </button>
            <button
              type="button"
              role="menuitem"
              :disabled="group.current"
              :title="group.current ? '当前打开的角色卡不能隐藏' : '隐藏到下次打开这张角色卡'"
              @click="requestHideCharacter(group.bindingId)"
            >
              <i class="fa-regular fa-eye-slash" aria-hidden="true"></i><span>隐藏角色卡</span>
            </button>
            <button
              class="danger"
              type="button"
              role="menuitem"
              :disabled="
                group.sessions.length === 0 || group.sessions.some(session => isSessionTabRunning(session.sessionId))
              "
              :title="
                group.sessions.some(session => isSessionTabRunning(session.sessionId))
                  ? '请先停止正在运行的会话'
                  : '删除该角色的全部会话'
              "
              @click="requestDeleteAllSessions(group.bindingId)"
            >
              <i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>删除全部会话</span>
            </button>
          </div>
        </div>
        <div v-if="expandedBindingIds.has(group.bindingId)" class="dca-character-sessions">
          <button
            v-for="session in group.sessions.slice(0, 10)"
            :key="session.sessionId"
            type="button"
            :class="{ active: state.active?.sessionId === session.sessionId }"
            @click="openCharacterSession(group.bindingId, session.sessionId)"
          >
            <span
              class="dca-session-state"
              :class="`state-${state.sessionStatuses[session.sessionId] ?? session.status}`"
            ></span>
            <span class="dca-character-session-title">{{ session.title }}</span>
            <time>{{ relativeTime(session.updatedAt) }}</time>
          </button>
          <div v-if="group.sessions.length === 0" class="dca-sidebar-empty">{{ group.error || '还没有会话' }}</div>
          <button
            v-if="group.sessions.length > 10"
            class="dca-all-sessions-button"
            type="button"
            @click="allSessionsBindingId = group.bindingId"
          >
            查看全部 {{ group.sessions.length }} 个会话 <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </button>
        </div>
      </section>
      <div v-if="groups.length === 0" class="dca-sidebar-empty dca-sidebar-empty-large">
        打开角色卡并创建会话后，会显示在这里。
      </div>
    </div>

    <footer v-if="!collapsed" class="dca-work-context">
      <div class="dca-work-context-character">
        <span class="dca-character-avatar">
          <img
            v-if="state.currentCharacter?.avatarId && !failedAvatarIds.has(state.currentCharacter.avatarId)"
            :src="characterAvatarUrl(state.currentCharacter.avatarId)"
            :alt="state.currentCharacter.name"
            @error="failedAvatarIds.add(state.currentCharacter.avatarId)"
          />
          <i v-else class="fa-regular fa-address-card" aria-hidden="true"></i>
        </span>
        <div>
          <strong>{{ state.currentCharacter?.name || '未打开角色卡' }}</strong
          ><small>当前工作上下文</small>
        </div>
      </div>
      <dl>
        <div>
          <dt>Agent</dt>
          <dd>{{ activeAgentName }}</dd>
        </div>
        <div>
          <dt>API</dt>
          <dd>{{ activeProfileName }}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd><span class="dca-context-dot"></span>{{ statusLabel }}</dd>
        </div>
      </dl>
    </footer>
    <AllSessionsDialog
      v-if="allSessionsBindingId"
      :binding-id="allSessionsBindingId"
      @close="allSessionsBindingId = undefined"
    />
    <div v-if="pendingCharacterAction" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-character-action-dialog" role="dialog" aria-modal="true" @click.stop>
        <header>
          <i
            :class="pendingCharacterAction.kind === 'hide' ? 'fa-regular fa-eye-slash' : 'fa-solid fa-trash-can'"
            aria-hidden="true"
          ></i>
          <div>
            <strong>{{ pendingCharacterAction.kind === 'hide' ? '隐藏这张角色卡？' : '删除全部会话？' }}</strong>
            <span v-if="pendingCharacterAction.kind === 'hide'">
              “{{ pendingCharacterGroup?.characterName }}”及其会话将从侧栏隐藏；下次在酒馆打开这张角色卡时会自动恢复。
            </span>
            <span v-else>
              将永久删除“{{ pendingCharacterGroup?.characterName }}”的 {{ pendingCharacterGroup?.sessions.length ?? 0 }}
              个会话及其操作记录，无法撤销。
            </span>
          </div>
        </header>
        <footer>
          <button type="button" @click="pendingCharacterAction = undefined">取消</button>
          <button
            :class="pendingCharacterAction.kind === 'delete' ? 'dca-btn-danger' : 'dca-btn-primary'"
            type="button"
            @click="confirmCharacterAction"
          >
            {{ pendingCharacterAction.kind === 'hide' ? '确认隐藏' : '确认全部删除' }}
          </button>
        </footer>
      </section>
    </div>
    <div v-if="closingSessionId" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-character-action-dialog" role="dialog" aria-modal="true" @click.stop>
        <header>
          <i class="fa-solid fa-stop" aria-hidden="true"></i>
          <div>
            <strong>停止任务并关闭会话页签？</strong>
            <span>当前模型或工具调用会被中断；已经成功写入的实时修改会保留。</span>
          </div>
        </header>
        <footer>
          <button type="button" @click="closingSessionId = ''">取消</button>
          <button class="dca-btn-danger" type="button" @click="confirmStopAndClose">停止并关闭</button>
        </footer>
      </section>
    </div>
    <div v-if="characterPickerOpen" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-character-picker" role="dialog" aria-modal="true" @click.stop>
        <header>
          <div><strong>选择角色卡</strong><span>从酒馆当前可用角色中创建独立会话。</span></div>
          <button class="dca-icon-btn" type="button" title="关闭" @click="characterPickerOpen = false">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>
        <label class="dca-character-picker-search">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input v-model="characterSearch" type="search" placeholder="搜索角色卡" />
        </label>
        <div class="dca-character-picker-list">
          <button
            v-for="character in filteredCharacters"
            :key="character.avatarId"
            type="button"
            @click="chooseCharacter(character.avatarId)"
          >
            <span class="dca-character-avatar">
              <img
                v-if="character.avatarId && !failedAvatarIds.has(character.avatarId)"
                :src="characterAvatarUrl(character.avatarId)"
                :alt="character.name"
                @error="failedAvatarIds.add(character.avatarId)"
              />
              <i v-else class="fa-regular fa-address-card" aria-hidden="true"></i>
            </span>
            <strong>{{ character.name }}</strong>
            <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
          </button>
          <div v-if="filteredCharacters.length === 0" class="dca-sidebar-empty">没有找到角色卡</div>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { findSelectedModel } from '../../../core/provider/provider-config';
import { useDreamCardAgent } from '../../composables/runtime';
import AllSessionsDialog from './AllSessionsDialog.vue';

const {
  action,
  closeSessionTab,
  createGlobalSession,
  createSession,
  createSessionForAvatar,
  createSessionForCharacter,
  isMobile,
  isSessionTabRunning,
  mobileSurface,
  openCharacterSession,
  openSettings,
  openedSessionIds,
  runtime,
  sidebarCollapsed,
  state,
  workspaceView,
} = useDreamCardAgent();
const expandedBindingIds = reactive(new Set<string>());
const failedAvatarIds = reactive(new Set<string>());
const allSessionsBindingId = ref<string>();
const characterMenuBindingId = ref<string>();
const closingSessionId = ref('');
const newSessionMenuOpen = ref(false);
const characterPickerOpen = ref(false);
const characterSearch = ref('');
const pendingCharacterAction = ref<{ bindingId: string; kind: 'delete' | 'hide' }>();
const HIDDEN_CHARACTERS_KEY = 'dream-card-agent:hidden-character-groups';
const hiddenBindingIds = reactive(new Set(readHiddenBindingIds()));
const groups = computed(() =>
  (state.value.characterGroups ?? []).filter(group => !hiddenBindingIds.has(group.bindingId)),
);
const allGroups = computed(() => state.value.characterGroups ?? []);
const openedSessions = computed(() =>
  openedSessionIds.value.flatMap(sessionId => {
    const globalSession = (state.value.globalSessions ?? []).find(session => session.sessionId === sessionId);
    if (globalSession) return [{ ...globalSession, bindingId: 'global', scope: 'global' as const }];
    const group = allGroups.value.find(item => item.sessions.some(session => session.sessionId === sessionId));
    const session = group?.sessions.find(item => item.sessionId === sessionId);
    return group && session ? [{ ...session, bindingId: group.bindingId, scope: 'character' as const }] : [];
  }),
);
const filteredCharacters = computed(() => {
  const query = characterSearch.value.trim().toLocaleLowerCase();
  return (state.value.availableCharacters ?? []).filter(
    character => !query || character.name.toLocaleLowerCase().includes(query),
  );
});
const pendingCharacterGroup = computed(() =>
  allGroups.value.find(group => group.bindingId === pendingCharacterAction.value?.bindingId),
);
const collapsed = computed(() => !isMobile.value && sidebarCollapsed.value);
const activeAgentName = computed(
  () =>
    state.value.agentConfigurations.find(item => item.id === state.value.activeAgentConfigurationId)?.name ?? '未配置',
);
const activeProfileName = computed(() => {
  const selected = findSelectedModel(state.value.providers ?? [], state.value.active?.modelSelection);
  return selected ? `${selected.provider.name} · ${selected.model.name}` : '未选择模型';
});
const statusLabel = computed(
  () => ({ running: '运行中', 'waiting-approval': '等待确认' })[state.value.active?.status ?? ''] ?? '就绪',
);

watch(
  () => state.value.currentCharacter?.bindingId,
  bindingId => {
    if (!bindingId) return;
    expandedBindingIds.add(bindingId);
    if (hiddenBindingIds.delete(bindingId)) saveHiddenBindingIds();
  },
  { immediate: true },
);

function toggleGroup(bindingId: string) {
  if (expandedBindingIds.has(bindingId)) expandedBindingIds.delete(bindingId);
  else expandedBindingIds.add(bindingId);
}

function readHiddenBindingIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_CHARACTERS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function saveHiddenBindingIds() {
  localStorage.setItem(HIDDEN_CHARACTERS_KEY, JSON.stringify([...hiddenBindingIds]));
}

function toggleCharacterMenu(bindingId: string) {
  characterMenuBindingId.value = characterMenuBindingId.value === bindingId ? undefined : bindingId;
}

async function createFromCharacterMenu(bindingId: string) {
  characterMenuBindingId.value = undefined;
  await createSessionForCharacter(bindingId);
}

function requestHideCharacter(bindingId: string) {
  const group = allGroups.value.find(item => item.bindingId === bindingId);
  if (!group || group.current) return;
  characterMenuBindingId.value = undefined;
  pendingCharacterAction.value = { bindingId, kind: 'hide' };
}

function requestDeleteAllSessions(bindingId: string) {
  const group = allGroups.value.find(item => item.bindingId === bindingId);
  if (!group?.sessions.length || group.sessions.some(session => isSessionTabRunning(session.sessionId))) return;
  characterMenuBindingId.value = undefined;
  pendingCharacterAction.value = { bindingId, kind: 'delete' };
}

async function confirmCharacterAction() {
  const request = pendingCharacterAction.value;
  const group = pendingCharacterGroup.value;
  if (!request || !group) return;
  if (request.kind === 'hide') {
    hiddenBindingIds.add(request.bindingId);
    saveHiddenBindingIds();
    const sessionIds = new Set(group.sessions.map(session => session.sessionId));
    openedSessionIds.value = openedSessionIds.value.filter(id => !sessionIds.has(id));
    pendingCharacterAction.value = undefined;
    toastr.success('角色卡已隐藏；下次打开时会自动恢复。', '梦境创客');
    return;
  }

  const sessionIds = group.sessions.map(session => session.sessionId);
  const activeWasDeleted = Boolean(state.value.active?.sessionId && sessionIds.includes(state.value.active.sessionId));
  const succeeded = await action(async () => {
    for (const sessionId of sessionIds) await runtime.deleteCharacterSession(request.bindingId, sessionId);
  });
  if (!succeeded) return;
  const deletedIds = new Set(sessionIds);
  openedSessionIds.value = openedSessionIds.value.filter(id => !deletedIds.has(id));
  if (activeWasDeleted) workspaceView.value = 'home';
  pendingCharacterAction.value = undefined;
  toastr.success(`已删除 ${sessionIds.length} 个会话及其操作记录。`, '梦境创客');
}

async function openMobileSession(session: (typeof openedSessions.value)[number]) {
  if (session.scope === 'global') await openGlobalSession(session.sessionId);
  else await openCharacterSession(session.bindingId, session.sessionId);
}

async function openGlobalSession(sessionId: string) {
  if (await action(() => runtime.openGlobalSession(sessionId))) {
    if (!openedSessionIds.value.includes(sessionId)) openedSessionIds.value = [...openedSessionIds.value, sessionId];
    workspaceView.value = 'session';
    if (isMobile.value) mobileSurface.value = 'workspace';
  }
}

function requestCloseSession(sessionId: string) {
  if (isSessionTabRunning(sessionId)) closingSessionId.value = sessionId;
  else void closeSessionTab(sessionId);
}

function confirmStopAndClose() {
  const sessionId = closingSessionId.value;
  if (!sessionId) return;
  runtime.stopSession(sessionId);
  openedSessionIds.value = openedSessionIds.value.filter(id => id !== sessionId);
  if (state.value.active?.sessionId === sessionId) workspaceView.value = 'home';
  closingSessionId.value = '';
}

function characterAvatarUrl(avatarId: string): string {
  return `/thumbnail?type=avatar&file=${encodeURIComponent(avatarId)}`;
}

async function createSessionFromTop() {
  if (collapsed.value) {
    await createGlobalSession();
    return;
  }
  newSessionMenuOpen.value = !newSessionMenuOpen.value;
}

async function createGlobalFromMenu() {
  newSessionMenuOpen.value = false;
  await createGlobalSession();
}

function openCharacterPicker() {
  newSessionMenuOpen.value = false;
  characterSearch.value = '';
  characterPickerOpen.value = true;
}

async function chooseCharacter(avatarId: string) {
  characterPickerOpen.value = false;
  await createSessionForAvatar(avatarId);
}

function openSettingsFromSidebar() {
  openSettings('general');
  if (isMobile.value) mobileSurface.value = 'workspace';
}

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)} 天`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
</script>

<style lang="scss">
.dca-primary-sidebar {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--dca-border);
  background: var(--dca-sidebar-background);
}
.dca-sidebar-brand {
  display: flex;
  height: 2.8rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0 0.75rem;
  border-bottom: 1px solid var(--dca-border);
}
.dca-sidebar-brand-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.55rem;
}
.dca-sidebar-brand-identity > i {
  color: var(--dca-accent-strong);
}
.dca-sidebar-brand-identity > strong {
  overflow: hidden;
  font-size: 0.86rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-sidebar-collapse {
  margin-left: 0;
}
.dca-sidebar-primary-actions {
  display: grid;
  flex: 0 0 auto;
  gap: 0.45rem;
  padding: 0.8rem;
}
.dca-sidebar-primary-actions button {
  display: flex;
  min-height: 2.55rem;
  align-items: center;
  gap: 0.7rem;
  justify-content: flex-start;
  border-color: var(--dca-border);
  background: var(--dca-highlight);
}
.dca-sidebar-primary-actions button:first-child {
  border-color: color-mix(in srgb, var(--dca-accent) 45%, transparent);
  background: var(--dca-sidebar-active);
}
.dca-new-session-menu {
  position: absolute;
  z-index: 15;
  top: 6.15rem;
  left: 0.7rem;
  display: grid;
  width: calc(100% - 1.4rem);
  gap: 0.2rem;
  border: 1px solid var(--dca-border-strong);
  border-radius: var(--dca-radius-md);
  padding: 0.3rem;
  background: var(--dca-raised);
  box-shadow: var(--dca-shadow-3);
}
.dca-new-session-menu > button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.65rem;
  border-color: transparent;
  padding: 0.6rem;
  background: transparent;
  text-align: left;
}
.dca-new-session-menu > button:hover { background: var(--dca-sidebar-hover); }
.dca-new-session-menu > button > i { width: 1.15rem; color: var(--dca-accent-strong); text-align: center; }
.dca-new-session-menu > button > span { display: grid; min-width: 0; gap: 0.08rem; }
.dca-new-session-menu small { color: var(--dca-text-muted); font-size: .68rem; }
.dca-character-groups {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 0 0.65rem 1rem;
  scrollbar-gutter: stable;
}
.dca-sidebar-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.35rem;
  color: var(--dca-text-muted);
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.dca-character-group {
  margin-bottom: 0.3rem;
}
.dca-global-session-group {
  display: grid;
  gap: .12rem;
  margin-bottom: .7rem;
}
.dca-global-session-group > button {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: .5rem;
  border-color: transparent;
  padding: .45rem .5rem;
  background: transparent;
  color: var(--dca-text-muted);
  text-align: left;
}
.dca-global-session-group > button:hover,
.dca-global-session-group > button.active { background: var(--dca-sidebar-active); color: var(--dca-text); }
.dca-global-session-group > button > i { flex: 0 0 auto; color: var(--dca-accent-strong); }
.dca-global-session-group > button > span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dca-global-session-group time { flex: 0 0 auto; font-size: .66rem; }
.dca-character-heading {
  position: relative;
  overflow: visible;
  border: 1px solid transparent;
  border-radius: var(--dca-radius-sm);
}
.dca-character-heading.menu-open {
  z-index: 10;
}
.dca-character-group.current .dca-character-heading {
  border-color: color-mix(in srgb, var(--dca-accent) 28%, var(--dca-border));
  background: var(--dca-sidebar-active);
  box-shadow: inset 2px 0 0 var(--dca-accent);
}
.dca-character-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.55rem;
  border: 0;
  padding: 0.5rem 4.35rem 0.5rem 0.45rem;
  background: transparent;
  border-radius: inherit;
  text-align: left;
}
.dca-character-toggle:hover {
  background: var(--dca-sidebar-hover);
}
.dca-character-avatar {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--dca-accent) 40%, transparent);
  border-radius: 0.65rem;
  background: var(--dca-avatar-gradient);
  color: var(--dca-on-accent);
  font-weight: 800;
  overflow: hidden;
}
.dca-character-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.dca-character-avatar > i {
  font-size: 0.92rem;
}
.dca-character-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.dca-character-copy strong {
  overflow: hidden;
  font-size: 0.86rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-character-copy small {
  color: var(--dca-text-muted);
  font-size: 0.68rem;
}
.dca-character-actions {
  position: absolute;
  top: 0.67rem;
  right: 0.35rem;
  z-index: 2;
  display: flex;
  gap: 0.12rem;
}
.dca-character-new,
.dca-character-more {
  display: grid;
  width: 1.7rem;
  min-width: 0;
  min-height: 1.7rem;
  padding: 0;
  place-items: center;
  border-color: transparent;
  background: transparent;
  opacity: 0;
}
.dca-character-heading:hover .dca-character-new,
.dca-character-heading:hover .dca-character-more,
.dca-character-new:focus-visible,
.dca-character-more:focus-visible,
.dca-character-more[aria-expanded='true'] {
  opacity: 1;
}
.dca-character-menu-scrim {
  position: fixed;
  z-index: 8;
  min-height: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  inset: 0;
}
.dca-character-menu {
  position: absolute;
  z-index: 9;
  top: 2.55rem;
  right: 0.3rem;
  display: flex;
  width: 12.5rem;
  flex-direction: column;
  gap: 0.15rem;
  border: 1px solid var(--dca-border-strong);
  border-radius: var(--dca-radius-md);
  padding: 0.3rem;
  background: var(--dca-raised);
  box-shadow: var(--dca-shadow-3);
}
.dca-character-menu > button {
  justify-content: flex-start;
  border-color: transparent;
  background: transparent;
  text-align: left;
}
.dca-character-menu > button.danger {
  color: var(--dca-danger);
}
.dca-character-group.unavailable {
  opacity: 0.66;
}
.dca-character-sessions {
  display: grid;
  gap: 0.15rem;
  margin: 0.1rem 0 0.5rem 1rem;
  padding-left: 0.65rem;
  border-left: 1px solid var(--dca-border);
}
.dca-character-sessions > button {
  display: flex;
  min-width: 0;
  min-height: 2.15rem;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  padding: 0.35rem 0.45rem;
  background: transparent;
  color: var(--dca-text-muted);
  text-align: left;
}
.dca-character-sessions > button:hover,
.dca-character-sessions > button.active {
  background: var(--dca-accent-soft);
  color: var(--dca-text);
}
.dca-character-session-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-character-sessions time {
  flex: 0 0 auto;
  font-size: 0.66rem;
}
.dca-session-state {
  width: 0.38rem;
  height: 0.38rem;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--dca-text-disabled);
}
.dca-session-state.state-running,
.dca-session-state.state-waiting-approval {
  background: var(--dca-success);
  box-shadow: 0 0 0 3px var(--dca-success-soft);
}
.dca-all-sessions-button {
  justify-content: center;
  color: var(--dca-accent-strong) !important;
  font-size: 0.73rem;
}
.dca-sidebar-empty {
  padding: 0.6rem;
  color: var(--dca-text-muted);
  font-size: 0.74rem;
  text-align: center;
}
.dca-sidebar-empty-large {
  margin-top: 2rem;
  line-height: 1.7;
}
.dca-work-context {
  flex: 0 0 auto;
  padding: 0.75rem;
  border-top: 1px solid var(--dca-border);
  background: color-mix(in srgb, var(--dca-canvas) 64%, transparent);
}
.dca-work-context-character {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.65rem;
}
.dca-work-context-character > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.dca-work-context-character strong {
  overflow: hidden;
  font-size: 0.84rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-work-context-character small {
  color: var(--dca-text-muted);
  font-size: 0.65rem;
}
.dca-work-context dl {
  display: grid;
  gap: 0.3rem;
  margin: 0;
  font-size: 0.68rem;
}
.dca-work-context dl div {
  display: flex;
  gap: 0.5rem;
}
.dca-work-context dt {
  width: 2.6rem;
  color: var(--dca-text-muted);
}
.dca-work-context dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-context-dot {
  display: inline-block;
  width: 0.4rem;
  height: 0.4rem;
  margin-right: 0.35rem;
  border-radius: 50%;
  background: var(--dca-success);
}
.dca-mobile-open-sessions {
  display: flex;
  min-height: 0;
  max-height: min(32vh, 14rem);
  flex: 0 1 auto;
  flex-direction: column;
  border-bottom: 1px solid var(--dca-border);
  padding: 0 0.65rem 0.65rem;
}
.dca-mobile-open-session-list {
  display: grid;
  min-height: 0;
  gap: 0.18rem;
  overflow-y: auto;
  padding-right: 0.2rem;
  scrollbar-gutter: stable;
}
.dca-mobile-open-session {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border: 1px solid transparent;
  border-radius: var(--dca-radius-sm);
}
.dca-mobile-open-session.active {
  border-color: color-mix(in srgb, var(--dca-accent) 32%, var(--dca-border));
  background: var(--dca-sidebar-active);
}
.dca-app .dca-mobile-open-session-main {
  min-width: 0;
  justify-content: flex-start;
  overflow: hidden;
  border-color: transparent;
  background: transparent;
  text-align: left;
}
.dca-mobile-open-session-main > span:nth-child(2) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-character-action-dialog > header {
  display: flex;
  gap: 0.75rem;
}
.dca-character-action-dialog > header > i {
  margin-top: 0.2rem;
  color: var(--dca-warning);
}
.dca-character-action-dialog > header > div {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.dca-character-action-dialog > header span {
  color: var(--dca-text-muted);
  font-size: 0.78rem;
}
.dca-character-action-dialog > footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
  margin-top: 1rem;
}
.dca-character-picker { display: flex; width: min(34rem, calc(100vw - 2rem)); max-height: min(42rem, calc(100vh - 2rem)); flex-direction: column; gap: .75rem; }
.dca-character-picker > header { display: flex; align-items: flex-start; justify-content: space-between; gap: .7rem; }
.dca-character-picker > header > div { display: grid; gap: .15rem; }
.dca-character-picker > header span { color: var(--dca-text-muted); font-size: .76rem; }
.dca-character-picker-search { display: flex; align-items: center; gap: .5rem; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-sm); padding: 0 .65rem; background: var(--dca-canvas); }
.dca-character-picker-search > i { color: var(--dca-text-muted); }
.dca-character-picker-search > input { min-width: 0; flex: 1; border: 0 !important; background: transparent !important; box-shadow: none !important; }
.dca-character-picker-list { display: grid; min-height: 0; gap: .25rem; overflow: auto; scrollbar-gutter: stable; }
.dca-character-picker-list > button { display: flex; align-items: center; justify-content: flex-start; gap: .65rem; border-color: var(--dca-border); padding: .5rem; background: var(--dca-surface); text-align: left; }
.dca-character-picker-list > button > strong { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dca-character-picker-list > button > i { color: var(--dca-text-muted); }
.dca-primary-sidebar.collapsed .dca-sidebar-brand {
  justify-content: center;
  padding: 0;
}
.dca-primary-sidebar.collapsed .dca-sidebar-collapse {
  margin: 0;
}
.dca-primary-sidebar.collapsed .dca-sidebar-primary-actions {
  padding: 0.55rem 0.35rem;
}
.dca-primary-sidebar.collapsed .dca-sidebar-primary-actions button {
  justify-content: center;
  padding: 0;
}
@media (max-width: 720px) {
  .dca-primary-sidebar {
    width: min(84vw, 22rem);
    border-right: 1px solid var(--dca-border-strong);
    box-shadow: var(--dca-shadow-3);
  }
  .dca-character-new {
    opacity: 1;
  }
  .dca-character-more {
    opacity: 1;
  }
}
</style>
