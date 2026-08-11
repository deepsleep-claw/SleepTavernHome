<template>
  <nav class="dca-tabs" aria-label="已打开页面">
    <button
      v-if="isMobile"
      class="dca-tab dca-mobile-navigation-tab"
      type="button"
      title="角色与会话"
      @click="mobileSurface = 'navigation'"
    >
      <i class="fa-solid fa-bars" aria-hidden="true"></i>
    </button>
    <button
      class="dca-tab dca-tab-home"
      type="button"
      :class="{ active: workspaceView === 'home' }"
      title="会话列表"
      @click="workspaceView = 'home'"
    >
      <i class="fa-solid fa-house" aria-hidden="true"></i>
    </button>
    <div
      v-for="session in openedSessions"
      :key="session.sessionId"
      class="dca-session-tab"
      :class="{
        active: workspaceView === 'session' && state.active?.sessionId === session.sessionId,
        running: isSessionTabRunning(session.sessionId),
        readonly: session.readonly,
      }"
    >
      <button class="dca-session-tab-open" type="button" @click="openSessionTab(session.sessionId)">
        <i v-if="session.readonly" class="fa-solid fa-lock" aria-hidden="true"></i>
        <span>{{ session.title }}</span>
        <small v-if="state.developerMode">r{{ session.revision }}</small>
      </button>
      <button
        class="dca-session-tab-close"
        type="button"
        :disabled="isSessionTabRunning(session.sessionId)"
        :title="
          isSessionTabRunning(session.sessionId)
            ? '任务运行期间不能关闭页签，可以切换到其它页签'
            : '关闭页签（不会删除会话）'
        "
        @click.stop="closeSessionTab(session.sessionId)"
      >
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
    </div>
    <button
      class="dca-tab dca-new-tab"
      type="button"
      :disabled="!canCreateSession || state.busy"
      :title="
        state.currentCharacter
          ? state.profiles.length
            ? '新建会话'
            : '请先配置 API Profile'
          : '请先在酒馆中打开一张角色卡'
      "
      @click="createSession"
    >
      <i class="fa-solid fa-plus" aria-hidden="true"></i>
    </button>
    <button
      class="dca-tab dca-settings-tab"
      type="button"
      :class="{ active: workspaceView === 'settings' }"
      title="设置"
      @click="workspaceView = 'settings'"
    >
      <i class="fa-solid fa-gear" aria-hidden="true"></i><span>设置</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useDreamCardAgent } from '../composables/runtime';

const {
  closeSessionTab,
  createSession,
  isMobile,
  isSessionTabRunning,
  mobileSurface,
  openSessionTab,
  openedSessionIds,
  state,
  workspaceView,
} = useDreamCardAgent();

const allSessions = computed(() =>
  (state.value.characterGroups ?? []).flatMap(group =>
    group.sessions.map(session => ({ ...session, readonly: !group.available, groupCurrent: group.current })),
  ),
);
const openedSessions = computed(() =>
  openedSessionIds.value
    .map(id => allSessions.value.find(item => item.sessionId === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter(item => item.groupCurrent || item.readonly)
    .map(item =>
      item.sessionId === state.value.active?.sessionId ? { ...item, title: state.value.active.title } : item,
    ),
);
const canCreateSession = computed(() => Boolean(state.value.currentCharacter && state.value.profiles.length));
</script>

<style lang="scss">
.dca-tabs {
  display: flex;
  flex: 0 0 auto;
  min-height: 2.5rem;
  align-items: stretch;
  gap: 0.2rem;
  overflow-x: auto;
  border-bottom: 1px solid var(--dca-border);
  padding: 0.3rem 0.5rem 0;
  background: var(--dca-surface);
  scrollbar-width: thin;
}

.dca-app .dca-tab {
  flex: 0 0 auto;
  border-color: transparent;
  border-bottom: 0;
  border-radius: var(--dca-radius-sm) var(--dca-radius-sm) 0 0;
  background: transparent;
  color: var(--dca-text-muted);
}

.dca-app .dca-tab:hover:not(:disabled) {
  border-color: transparent;
  background: var(--dca-accent-soft);
}

.dca-app .dca-tab.active {
  background: var(--dca-canvas);
  color: var(--dca-text);
  box-shadow: inset 0 2px 0 var(--dca-accent);
}

.dca-session-tab {
  position: relative;
  display: block;
  height: 2.2rem;
  flex: 0 0 auto;
  min-width: 7rem;
  max-width: 15rem;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: var(--dca-radius-sm) var(--dca-radius-sm) 0 0;
  background: transparent;
  color: var(--dca-text-muted);
}

.dca-session-tab:hover {
  background: var(--dca-accent-soft);
}

.dca-session-tab.active {
  background: var(--dca-canvas);
  color: var(--dca-text);
  box-shadow: inset 0 2px 0 var(--dca-accent);
}

.dca-session-tab.running .dca-session-tab-open::before {
  width: 0.42rem;
  height: 0.42rem;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--dca-success);
  box-shadow: 0 0 0 3px var(--dca-success-soft);
  content: '';
}

.dca-session-tab.readonly {
  color: #91a1c8;
}
.dca-session-tab.readonly .dca-session-tab-open > i {
  font-size: 0.68rem;
  color: #8298d2;
}

.dca-session-tab > button {
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
}

.dca-session-tab > button:hover:not(:disabled) {
  background: transparent;
}

.dca-app .dca-session-tab-open {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: flex-start;
  gap: 0.4rem;
  overflow: hidden;
  border-radius: inherit;
  padding: 0.35rem 2.35rem 0.35rem 0.7rem;
  text-align: left;
}

.dca-session-tab-open span {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-session-tab-open small {
  flex: 0 0 auto;
  color: var(--dca-text-muted);
}

.dca-session-tab-close {
  position: absolute;
  z-index: 3;
  top: 50%;
  right: 0.22rem;
  display: grid;
  width: 1.55rem;
  height: 1.55rem;
  min-height: 1.55rem;
  padding: 0;
  place-items: center;
  border-radius: 0.35rem;
  opacity: 0.62;
  pointer-events: auto;
  transform: translateY(-50%);
}

.dca-session-tab-close:hover:not(:disabled),
.dca-session-tab-close:focus-visible {
  background: rgba(255, 255, 255, 0.1) !important;
  opacity: 1;
}

.dca-session-tab-close:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.dca-settings-tab {
  margin-left: auto;
}

.dca-settings-tab span {
  margin-left: 0.35rem;
}

@media (max-width: 720px) {
  .dca-settings-tab span,
  .dca-session-tab-open small {
    display: none;
  }
}
</style>
