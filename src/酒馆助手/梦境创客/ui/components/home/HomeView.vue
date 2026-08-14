<template>
  <section class="dca-home">
    <div class="dca-home-stars" aria-hidden="true"></div>
    <div class="dca-home-inner">
      <div class="dca-welcome-hero">
        <span class="dca-welcome-mark"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i></span>
        <h1>欢迎使用 <em>梦境创客</em></h1>
        <p>创建世界、塑造角色、编排 Agent 工作流，构建你的独特梦境宇宙。</p>
        <span v-if="state.currentCharacter" class="dca-welcome-character"
          ><i class="fa-regular fa-address-card" aria-hidden="true"></i> 当前角色 ·
          {{ state.currentCharacter.name }}</span
        >
        <div class="dca-welcome-actions">
          <button
            class="primary"
            type="button"
            :disabled="state.busy"
            title="新建会话"
            @click="newSessionOpen = true"
          >
            <i class="fa-solid fa-plus" aria-hidden="true"></i> 新建会话
          </button>
          <button type="button" @click="openSettings('general')">
            <i class="fa-solid fa-gear" aria-hidden="true"></i> 打开设置
          </button>
        </div>
        <button
          v-if="state.currentCharacter && availableModelCount === 0"
          class="dca-configure-api"
          type="button"
          @click="openSettings('api')"
        >
          还没有可用的 Provider 模型，先去完成配置 <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
        </button>
      </div>

      <section class="dca-welcome-recents">
        <header>
          <h2>最近会话</h2>
          <span v-if="state.currentCharacter">{{ state.currentCharacter.name }}</span>
        </header>
        <div v-if="recentSessions.length" class="dca-welcome-recent-list">
          <div v-for="(session, index) in recentSessions" :key="session.sessionId" class="dca-recent-item">
            <div v-if="deletePendingSessionId === session.sessionId" class="dca-welcome-delete-confirm">
              <span>确定删除“{{ session.title }}”及其全部操作记录？</span>
              <button type="button" @click="deletePendingSessionId = ''">取消</button>
              <button class="danger" type="button" @click="confirmDeleteSession(session.sessionId)">确认删除</button>
            </div>
            <template v-else>
              <button class="dca-recent-open" type="button" @click="openCurrentSession(session.sessionId)">
                <span class="dca-recent-icon" :class="`tone-${index % 4}`"
                  ><i :class="recentIcon(index)" aria-hidden="true"></i
                ></span>
                <span class="dca-recent-copy"
                  ><strong>{{ session.title }}</strong
                  ><small>Agent · {{ activeAgentName }}</small></span
                >
                <time>{{ formatSessionDate(session.updatedAt) }}</time>
              </button>
              <button
                class="dca-welcome-delete"
                type="button"
                :disabled="isSessionTabRunning(session.sessionId)"
                :title="isSessionTabRunning(session.sessionId) ? '任务运行期间不能删除会话' : '删除会话'"
                @click.stop="deletePendingSessionId = session.sessionId"
              >
                <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
              </button>
            </template>
          </div>
        </div>
        <div v-else class="dca-welcome-empty">
          <i class="fa-regular fa-comments" aria-hidden="true"></i>
          <strong>{{ state.currentCharacter ? '还没有会话' : '请先在酒馆中打开一张角色卡' }}</strong>
          <p>
            {{
              state.currentCharacter
                ? '点击上方“新建会话”，开始第一次创作。'
                : '打开后，这里会显示当前角色最近的创作记录。'
            }}
          </p>
        </div>
      </section>
      <footer class="dca-welcome-footer">梦境创客 <span>·</span> 由 AI 驱动的角色创作与协作空间</footer>
    </div>
    <div v-if="newSessionOpen" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-home-new-session" role="dialog" aria-modal="true">
        <header><div><strong>新建会话</strong><span>选择全局工作区，或从酒馆角色卡开始。</span></div><button class="dca-icon-btn" type="button" @click="newSessionOpen = false"><i class="fa-solid fa-xmark"></i></button></header>
        <div class="dca-home-session-kinds">
          <button class="dca-btn-start" type="button" @click="createGlobal"><i class="fa-solid fa-globe"></i><span><strong>全局会话</strong><small>管理跨角色文件、资源与角色导航</small></span></button>
          <button class="dca-btn-start" type="button" @click="showCharacters = !showCharacters"><i class="fa-regular fa-address-card"></i><span><strong>角色卡会话</strong><small>选择酒馆中的角色卡</small></span></button>
        </div>
        <div v-if="showCharacters" class="dca-home-character-list">
          <button v-for="character in state.availableCharacters" :key="character.avatarId" type="button" @click="createForCharacter(character.avatarId)"><span>{{ character.name }}</span><i class="fa-solid fa-chevron-right"></i></button>
          <div v-if="state.availableCharacters.length === 0" class="dca-welcome-empty">酒馆中没有可用的单角色卡</div>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { formatSessionDate } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';
const { createGlobalSession, createSessionForAvatar, deleteSession, isSessionTabRunning, openCharacterSession, openSettings, state } =
  useDreamCardAgent();
const deletePendingSessionId = ref('');
const newSessionOpen = ref(false);
const showCharacters = ref(false);
const currentSessions = computed(() =>
  state.value.sessions.filter(item => item.bindingId === state.value.currentCharacter?.bindingId),
);
const recentSessions = computed(() => currentSessions.value.slice(0, 5));
const availableModelCount = computed(() => (state.value.providers ?? [])
  .filter(provider => provider.enabled)
  .reduce((total, provider) => total + provider.models.filter(model => model.enabled).length, 0));
const activeAgentName = computed(
  () =>
    state.value.agentConfigurations.find(item => item.id === state.value.activeAgentConfigurationId)?.name ??
    '默认 Agent',
);
async function openCurrentSession(sessionId: string) {
  if (state.value.currentCharacter) await openCharacterSession(state.value.currentCharacter.bindingId, sessionId);
}
async function confirmDeleteSession(sessionId: string) {
  if (await deleteSession(sessionId)) deletePendingSessionId.value = '';
}
async function createGlobal() {
  newSessionOpen.value = false;
  await createGlobalSession();
}
async function createForCharacter(avatarId: string) {
  newSessionOpen.value = false;
  showCharacters.value = false;
  await createSessionForAvatar(avatarId);
}
watch(
  () => state.value.currentCharacter?.bindingId,
  () => {
    deletePendingSessionId.value = '';
  },
);
function recentIcon(index: number) {
  return [
    'fa-regular fa-file-lines',
    'fa-solid fa-wand-sparkles',
    'fa-regular fa-address-card',
    'fa-solid fa-diagram-project',
  ][index % 4];
}
</script>

<style lang="scss">
.dca-home {
  position: relative;
  height: 100%;
  overflow: auto;
  background: var(--dca-home-background);
  scrollbar-gutter: stable;
}
.dca-home::before {
  position: absolute;
  inset: 0;
  background: var(--dca-home-pattern);
  content: '';
  pointer-events: none;
}
.dca-home-stars {
  position: absolute;
  inset: 0;
  opacity: 0.48;
  background-image: var(--dca-home-stars);
  background-size:
    23rem 19rem,
    31rem 27rem,
    37rem 23rem,
    29rem 33rem;
  pointer-events: none;
}
.dca-home-inner {
  position: relative;
  z-index: 1;
  width: min(68rem, 100%);
  min-height: 100%;
  margin: 0 auto;
  padding: clamp(2rem, 6vh, 4.5rem) clamp(1rem, 4vw, 3rem) 1.25rem;
}
.dca-welcome-hero {
  display: flex;
  align-items: center;
  flex-direction: column;
  text-align: center;
}
.dca-welcome-mark {
  display: grid;
  width: 4.1rem;
  height: 4.1rem;
  margin-bottom: 1rem;
  place-items: center;
  border-radius: 1.25rem;
  background: var(--dca-brand-gradient);
  box-shadow: var(--dca-home-brand-shadow);
  color: var(--dca-on-accent);
  font-size: 1.65rem;
  transform: rotate(-7deg);
}
.dca-welcome-hero h1 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 750;
  letter-spacing: 0.01em;
}
.dca-welcome-hero h1 em {
  color: var(--dca-accent);
  font-style: normal;
  text-shadow: var(--dca-home-brand-shadow);
}
.dca-welcome-hero > p {
  max-width: 40rem;
  margin: 0.75rem 0 0;
  color: var(--dca-text-muted);
  font-size: clamp(0.88rem, 1.5vw, 1rem);
}
.dca-welcome-character {
  margin-top: 0.8rem;
  color: var(--dca-text-secondary);
  font-size: 0.76rem;
}
.dca-welcome-actions {
  display: flex;
  gap: 0.8rem;
  margin-top: 2rem;
}
.dca-welcome-actions button {
  min-width: 10.6rem;
  min-height: 3.25rem;
  border-color: var(--dca-border-strong);
  background: color-mix(in srgb, var(--dca-raised) 88%, transparent);
}
.dca-welcome-actions button.primary {
  border-color: var(--dca-accent);
  background: var(--dca-accent);
  color: var(--dca-on-accent);
  box-shadow: var(--dca-shadow-2);
}
.dca-configure-api {
  margin-top: 0.7rem;
  border: 0 !important;
  background: transparent !important;
  color: var(--dca-accent-strong) !important;
  font-size: 0.74rem !important;
}
.dca-welcome-recents {
  margin-top: clamp(2.2rem, 6vh, 4.5rem);
  border: 1px solid var(--dca-border);
  border-radius: 0.85rem;
  background: color-mix(in srgb, var(--dca-surface) 88%, transparent);
  box-shadow: inset 0 1px var(--dca-highlight);
  backdrop-filter: blur(12px);
}
.dca-welcome-recents > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.15rem;
  border-bottom: 1px solid var(--dca-border);
}
.dca-welcome-recents h2 {
  margin: 0;
  font-size: 0.92rem;
}
.dca-welcome-recents header span {
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}
.dca-welcome-recent-list {
  padding: 0.15rem 1.15rem;
}
.dca-app .dca-welcome-recent-list .dca-recent-item {
  position: relative;
  width: 100%;
  min-height: 3.8rem;
  border-bottom: 1px solid var(--dca-border);
}
.dca-app .dca-welcome-recent-list .dca-recent-item:last-child {
  border-bottom: 0;
}
.dca-app .dca-welcome-recent-list .dca-recent-open {
  position: absolute;
  inset: 0;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  align-items: center;
  gap: 0.75rem;
  border: 0;
  border-radius: 0;
  padding: 0.55rem 2.8rem 0.55rem 0;
  background: transparent;
  text-align: left;
}
.dca-app .dca-welcome-recent-list .dca-recent-open:hover {
  background: var(--dca-sidebar-hover);
}
.dca-recent-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 0.55rem;
  background: var(--dca-accent-soft);
  color: var(--dca-accent-strong);
}
.dca-recent-icon.tone-1 {
  background: var(--dca-info-soft);
  color: var(--dca-info);
}
.dca-recent-icon.tone-2 {
  background: var(--dca-success-soft);
  color: var(--dca-success);
}
.dca-recent-icon.tone-3 {
  background: var(--dca-warning-soft);
  color: var(--dca-warning);
}
.dca-recent-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.dca-recent-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 520;
}
.dca-recent-copy small,
.dca-welcome-recent-list time,
.dca-welcome-delete {
  color: var(--dca-text-muted);
  font-size: 0.7rem;
}
.dca-welcome-delete {
  position: absolute;
  z-index: 3;
  top: 50%;
  right: 0.25rem;
  display: grid;
  width: 2rem;
  height: 2rem;
  min-height: 2rem;
  padding: 0;
  place-items: center;
  border-color: transparent;
  background: transparent;
  opacity: 0.58;
  transform: translateY(-50%);
}
.dca-recent-item:hover .dca-welcome-delete,
.dca-welcome-delete:focus-visible {
  opacity: 1;
}
.dca-welcome-delete:hover:not(:disabled) {
  background: var(--dca-danger-soft);
  color: var(--dca-danger);
}
.dca-welcome-delete-confirm {
  display: flex;
  min-height: 3.8rem;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
  padding: 0.45rem 0;
}
.dca-welcome-delete-confirm > span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--dca-text-secondary);
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-welcome-delete-confirm > button {
  min-height: 2rem;
  padding: 0.3rem 0.65rem;
  font-size: 0.72rem;
}
.dca-welcome-delete-confirm > button.danger {
  border-color: color-mix(in srgb, var(--dca-danger) 35%, transparent);
  background: var(--dca-danger-soft);
  color: var(--dca-danger);
}
.dca-welcome-empty {
  display: flex;
  min-height: 12rem;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 2rem;
  color: var(--dca-text-muted);
  text-align: center;
}
.dca-welcome-empty > i {
  margin-bottom: 0.7rem;
  font-size: 1.7rem;
  color: var(--dca-text-disabled);
}
.dca-welcome-empty p {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
}
.dca-welcome-footer {
  margin-top: clamp(2rem, 5vh, 4rem);
  color: var(--dca-text-muted);
  font-size: 0.72rem;
  text-align: center;
}
.dca-welcome-footer span {
  margin: 0 0.65rem;
}
.dca-home-new-session { display: grid; width: min(34rem, calc(100vw - 2rem)); max-height: min(42rem, calc(100vh - 2rem)); gap: .75rem; }
.dca-home-new-session > header { display: flex; align-items: flex-start; justify-content: space-between; gap: .7rem; }
.dca-home-new-session > header > div { display: grid; gap: .15rem; }
.dca-home-new-session > header span { color: var(--dca-text-muted); font-size: .76rem; }
.dca-home-session-kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.dca-home-session-kinds > button { display: flex; align-items: center; justify-content: flex-start; gap: .65rem; padding: .75rem; text-align: left; }
.dca-home-session-kinds > button > i { color: var(--dca-accent-strong); }
.dca-home-session-kinds > button > span { display: grid; gap: .1rem; }
.dca-home-session-kinds small { color: var(--dca-text-muted); }
.dca-home-character-list { display: grid; min-height: 0; max-height: 24rem; gap: .2rem; overflow: auto; scrollbar-gutter: stable; }
.dca-home-character-list > button { display: flex; align-items: center; justify-content: space-between; border-color: transparent; background: var(--dca-raised); text-align: left; }
@media (max-width: 720px) {
  .dca-home-inner {
    padding-top: 1.6rem;
  }
  .dca-welcome-mark {
    width: 3.3rem;
    height: 3.3rem;
  }
  .dca-welcome-actions {
    width: 100%;
    flex-direction: column;
    gap: 0.55rem;
    margin-top: 1.3rem;
  }
  .dca-welcome-actions button {
    width: 100%;
    min-height: 2.8rem;
  }
  .dca-welcome-recents {
    margin-top: 1.8rem;
  }
  .dca-welcome-recent-list {
    padding-inline: 0.75rem;
  }
  .dca-welcome-recent-list time {
    display: none;
  }
  .dca-welcome-delete {
    opacity: 0.75;
  }
  .dca-welcome-delete-confirm > span {
    white-space: normal;
  }
  .dca-welcome-footer {
    margin-top: 2rem;
  }
}
</style>
