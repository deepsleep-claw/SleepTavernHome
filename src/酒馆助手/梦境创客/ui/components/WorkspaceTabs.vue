<template>
  <nav class="dca-tabs" aria-label="已打开页面">
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
      class="dca-tab dca-session-tab"
      :class="{
        active: workspaceView === 'session' && state.active?.sessionId === session.sessionId,
        running: isSessionTabRunning(session.sessionId),
      }"
    >
      <button class="dca-session-tab-open" type="button" @click="openSessionTab(session.sessionId)">
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
        @click="closeSessionTab(session.sessionId)"
      >
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
    </div>
    <button
      class="dca-tab dca-new-tab"
      type="button"
      :disabled="!canCreateSession || state.busy"
      title="新建会话"
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

const { closeSessionTab, createSession, isSessionTabRunning, openSessionTab, openedSessionIds, state, workspaceView } =
  useDreamCardAgent();

const currentSessions = computed(() =>
  state.value.sessions.filter(item => item.bindingId === state.value.currentCharacter?.bindingId),
);
const openedSessions = computed(() =>
  openedSessionIds.value
    .map(id => currentSessions.value.find(item => item.sessionId === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
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
  display: flex;
  min-width: 7rem;
  max-width: 15rem;
  align-items: stretch;
  border: 1px solid transparent;
  border-bottom: 0;
}

.dca-session-tab.running::before {
  width: 0.42rem;
  height: 0.42rem;
  align-self: center;
  margin-left: 0.5rem;
  border-radius: 50%;
  background: var(--dca-success);
  box-shadow: 0 0 0 3px var(--dca-success-soft);
  content: '';
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

.dca-session-tab-open {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.dca-session-tab-open span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-session-tab-open small {
  color: var(--dca-text-muted);
}

.dca-session-tab-close {
  width: 1.7rem;
  min-height: 0;
  padding: 0;
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
