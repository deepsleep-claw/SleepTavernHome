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
        :disabled="!state.currentCharacter || state.busy"
        :title="newSessionTitle"
        @click="createSessionFromTop"
      >
        <i class="fa-solid fa-plus" aria-hidden="true"></i><span v-if="!collapsed">新建会话</span>
      </button>
      <button type="button" title="设置" @click="openSettingsFromSidebar">
        <i class="fa-solid fa-gear" aria-hidden="true"></i><span v-if="!collapsed">设置</span>
      </button>
    </div>

    <div v-if="!collapsed" class="dca-character-groups">
      <div class="dca-sidebar-section-title">
        <span>角色与会话</span><small>{{ groups.length }}</small>
      </div>
      <section
        v-for="group in groups"
        :key="group.bindingId"
        class="dca-character-group"
        :class="{ current: group.current, unavailable: !group.available }"
      >
        <div class="dca-character-heading">
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
          <button
            v-if="group.available"
            class="dca-character-new"
            type="button"
            :title="`为 ${group.characterName} 新建会话`"
            @click.stop="createSessionForCharacter(group.bindingId)"
          >
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
          </button>
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
  </aside>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { findSelectedModel } from '../../../core/provider/provider-config';
import { useDreamCardAgent } from '../../composables/runtime';
import AllSessionsDialog from './AllSessionsDialog.vue';

const {
  createSession,
  createSessionForCharacter,
  isMobile,
  mobileSurface,
  openCharacterSession,
  openSettings,
  sidebarCollapsed,
  state,
} = useDreamCardAgent();
const expandedBindingIds = reactive(new Set<string>());
const failedAvatarIds = reactive(new Set<string>());
const allSessionsBindingId = ref<string>();
const groups = computed(() => state.value.characterGroups ?? []);
const collapsed = computed(() => !isMobile.value && sidebarCollapsed.value);
const newSessionTitle = computed(() => (state.value.currentCharacter ? '新建会话' : '请先在酒馆中打开一张角色卡'));
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
    if (bindingId) expandedBindingIds.add(bindingId);
  },
  { immediate: true },
);

function toggleGroup(bindingId: string) {
  if (expandedBindingIds.has(bindingId)) expandedBindingIds.delete(bindingId);
  else expandedBindingIds.add(bindingId);
}

function characterAvatarUrl(avatarId: string): string {
  return `/thumbnail?type=avatar&file=${encodeURIComponent(avatarId)}`;
}

async function createSessionFromTop() {
  await createSession();
  if (isMobile.value) mobileSurface.value = 'workspace';
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
.dca-character-groups {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 0 0.65rem 1rem;
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
.dca-character-heading {
  position: relative;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--dca-radius-sm);
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
  padding: 0.5rem 2.35rem 0.5rem 0.45rem;
  background: transparent;
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
.dca-character-new {
  position: absolute;
  top: 0.67rem;
  right: 0.35rem;
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
.dca-character-new:focus-visible {
  opacity: 1;
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
}
</style>
