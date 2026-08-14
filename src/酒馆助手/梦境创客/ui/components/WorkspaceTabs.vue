<template>
  <nav class="dca-tabs" aria-label="已打开页面">
    <div class="dca-tab-strip">
      <button
        v-if="isMobile"
        class="dca-tab dca-mobile-navigation-tab"
        type="button"
        title="角色与会话"
        @click="mobileSurface = 'navigation'"
      >
        <i class="fa-solid fa-bars" aria-hidden="true"></i>
      </button>
      <div v-if="isMobile" class="dca-mobile-brand">
        <i class="fa-solid fa-address-card" aria-hidden="true"></i>
        <strong :title="mobileCharacterTitle">{{ mobileCharacterTitle }}</strong>
      </div>
      <template v-if="!isMobile">
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
            :title="isSessionTabRunning(session.sessionId) ? '停止任务并关闭页签' : '关闭页签（不会删除会话）'"
            @click.stop="requestClose(session.sessionId)"
          >
            <i
              :class="isSessionTabRunning(session.sessionId) ? 'fa-solid fa-stop' : 'fa-solid fa-xmark'"
              aria-hidden="true"
            ></i>
          </button>
        </div>
        <button
          class="dca-tab dca-new-tab"
          type="button"
          :disabled="state.busy"
          title="新建会话"
          @click="newSessionChoiceOpen = true"
        >
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
        </button>
      </template>
    </div>
    <div class="dca-tab-actions">
      <button
        class="dca-tab dca-version-tab"
        type="button"
        :class="{ available: updaterSnapshot.updateAvailable }"
        :title="versionTitle"
        @click="openSettings('update')"
      >
        <template v-if="updaterSnapshot.updateAvailable && updaterSnapshot.latestVersion">
          <span class="dca-version-new">新版本 v{{ updaterSnapshot.latestVersion }}</span>
          <span class="dca-version-current"
            ><span class="dca-version-current-prefix">当前 </span>v{{ updaterSnapshot.runningVersion }}</span
          >
        </template>
        <span v-else class="dca-version-current">v{{ updaterSnapshot.runningVersion }}</span>
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
    </div>
    <div v-if="closingSessionId" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-stop-close-dialog" role="dialog" aria-modal="true">
        <header>
          <i class="fa-solid fa-stop" aria-hidden="true"></i>
          <div>
            <strong>停止任务并关闭页签？</strong
            ><span>当前模型或工具调用会被中断；已成功写入的实时文件修改会保留。</span>
          </div>
        </header>
        <footer>
          <button type="button" @click="closingSessionId = ''">取消</button>
          <button class="danger" type="button" @click="confirmStopAndClose">停止并关闭</button>
        </footer>
      </section>
    </div>
    <div v-if="newSessionChoiceOpen" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-tab-new-session-dialog" role="dialog" aria-modal="true">
        <header><strong>新建会话</strong><button class="dca-icon-btn" type="button" @click="newSessionChoiceOpen = false"><i class="fa-solid fa-xmark"></i></button></header>
        <div class="dca-tab-new-session-kinds">
          <button class="dca-btn-start" type="button" @click="createGlobalFromTab"><i class="fa-solid fa-globe"></i><span><strong>全局会话</strong><small>不绑定角色卡</small></span></button>
          <button class="dca-btn-start" type="button" @click="showCharacterChoices = !showCharacterChoices"><i class="fa-regular fa-address-card"></i><span><strong>角色卡会话</strong><small>选择酒馆角色卡</small></span></button>
        </div>
        <div v-if="showCharacterChoices" class="dca-tab-character-list">
          <button v-for="character in state.availableCharacters" :key="character.avatarId" type="button" @click="createCharacterFromTab(character.avatarId)">
            <span>{{ character.name }}</span><i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      </section>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDreamCardAgent } from '../composables/runtime';
import { useDreamCardAgentUpdater } from '../updater';

const {
  closeSessionTab,
  createGlobalSession,
  createSession,
  createSessionForAvatar,
  isMobile,
  isSessionTabRunning,
  mobileSurface,
  openSessionTab,
  openSettings,
  openedSessionIds,
  runtime,
  state,
  workspaceView,
} = useDreamCardAgent();
const { snapshot: updaterSnapshot } = useDreamCardAgentUpdater();

const allSessions = computed(() =>
  [
    ...(state.value.globalSessions ?? []).map(session => ({ ...session, readonly: false, groupCurrent: true })),
    ...(state.value.characterGroups ?? []).flatMap(group =>
      group.sessions.map(session => ({ ...session, readonly: !group.available, groupCurrent: group.current })),
    ),
  ],
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
const mobileCharacterTitle = computed(() => state.value.currentCharacter?.name || '未打开角色卡');
const closingSessionId = ref('');
const newSessionChoiceOpen = ref(false);
const showCharacterChoices = ref(false);
const versionTitle = computed(() => {
  if (updaterSnapshot.value.status === 'checking')
    return `正在检查更新 · 当前 v${updaterSnapshot.value.runningVersion}`;
  if (updaterSnapshot.value.updateAvailable && updaterSnapshot.value.latestVersion) {
    return `发现新版本 v${updaterSnapshot.value.latestVersion} · 当前 v${updaterSnapshot.value.runningVersion}`;
  }
  return `梦境创客 v${updaterSnapshot.value.runningVersion}`;
});

function requestClose(sessionId: string) {
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

async function createGlobalFromTab() {
  newSessionChoiceOpen.value = false;
  await createGlobalSession();
}

async function createCharacterFromTab(avatarId: string) {
  newSessionChoiceOpen.value = false;
  showCharacterChoices.value = false;
  await createSessionForAvatar(avatarId);
}
</script>

<style lang="scss">
.dca-tabs {
  display: flex;
  flex: 0 0 auto;
  min-height: 2.5rem;
  align-items: stretch;
  gap: 0.2rem;
  border-bottom: 1px solid var(--dca-border);
  padding: 0.3rem 4.7rem 0 0.5rem;
  background: var(--dca-surface);
}

.dca-tab-strip {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: stretch;
  gap: 0.2rem;
  overflow-x: auto;
  scrollbar-width: thin;
}

.dca-tab-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: stretch;
  gap: 0.2rem;
}

.dca-app .dca-tab {
  flex: 0 0 auto;
  border-color: transparent;
  border-bottom: 0;
  border-radius: var(--dca-radius-sm) var(--dca-radius-sm) 0 0;
  background: transparent;
  color: var(--dca-text-muted);
}

.dca-mobile-brand {
  display: none;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.4rem;
  color: var(--dca-text);
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
  color: var(--dca-text-secondary);
}
.dca-session-tab.readonly .dca-session-tab-open > i {
  font-size: 0.68rem;
  color: var(--dca-accent-strong);
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
  background: var(--dca-highlight) !important;
  opacity: 1;
}

.dca-session-tab-close:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.dca-stop-close-dialog {
  width: min(32rem, calc(100vw - 2rem));
}
.dca-stop-close-dialog > header {
  display: flex;
  gap: 0.7rem;
}
.dca-stop-close-dialog > header i {
  color: var(--dca-danger);
}
.dca-stop-close-dialog > header div {
  display: grid;
  gap: 0.2rem;
}
.dca-stop-close-dialog > header span {
  color: var(--dca-text-muted);
  font-size: 0.78rem;
}
.dca-stop-close-dialog > footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.dca-tab-new-session-dialog { display: grid; width: min(32rem, calc(100vw - 2rem)); gap: .7rem; }
.dca-tab-new-session-dialog > header { display: flex; align-items: center; justify-content: space-between; }
.dca-tab-new-session-kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.dca-tab-new-session-kinds > button { display: flex; align-items: center; justify-content: flex-start; gap: .65rem; border-color: var(--dca-border); padding: .7rem; background: var(--dca-surface); text-align: left; }
.dca-tab-new-session-kinds > button > i { color: var(--dca-accent-strong); }
.dca-tab-new-session-kinds > button > span { display: grid; gap: .1rem; }
.dca-tab-new-session-kinds small { color: var(--dca-text-muted); }
.dca-tab-character-list { display: grid; max-height: min(26rem, 50vh); gap: .2rem; overflow: auto; scrollbar-gutter: stable; }
.dca-tab-character-list > button { display: flex; align-items: center; justify-content: space-between; border-color: transparent; background: var(--dca-raised); text-align: left; }

.dca-version-tab {
  flex: 0 0 auto;
}

.dca-app .dca-version-tab {
  gap: 0.45rem;
  font-variant-numeric: tabular-nums;
}

.dca-version-new {
  border: 1px solid color-mix(in srgb, var(--dca-accent) 55%, transparent);
  border-radius: var(--dca-radius-sm);
  padding: 0.12rem 0.42rem;
  color: var(--dca-accent-strong);
}

.dca-version-current {
  color: var(--dca-text-muted);
  white-space: nowrap;
}

.dca-settings-tab span {
  margin-left: 0.35rem;
}

@media (max-width: 720px) {
  .dca-tabs {
    min-width: 0;
    padding-right: 2.65rem;
  }

  .dca-tab-strip {
    overflow: hidden;
  }

  .dca-settings-tab span,
  .dca-session-tab-open small {
    display: none;
  }

  .dca-version-tab {
    padding-inline: 0.32rem !important;
  }

  .dca-version-new {
    padding-inline: 0.3rem;
  }

  .dca-version-current-prefix {
    display: none;
  }

  .dca-mobile-brand {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    justify-content: center;
    padding: 0 0.35rem;
  }

  .dca-mobile-brand > strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dca-mobile-brand > i {
    flex: 0 0 auto;
  }

  .dca-tab-home,
  .dca-new-tab,
  .dca-session-tab {
    display: none !important;
  }
}
</style>
