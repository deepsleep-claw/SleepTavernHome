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
            :disabled="!canCreateSession || state.busy"
            :title="createTitle"
            @click="createSession"
          >
            <i class="fa-solid fa-plus" aria-hidden="true"></i> 新建会话
          </button>
          <button type="button" @click="openSettings('general')">
            <i class="fa-solid fa-gear" aria-hidden="true"></i> 打开设置
          </button>
        </div>
        <button
          v-if="state.currentCharacter && state.profiles.length === 0"
          class="dca-configure-api"
          type="button"
          @click="openSettings('api')"
        >
          还没有 API Profile，先去完成配置 <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
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
              <span>确定删除“{{ session.title }}”及其全部快照？</span>
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
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { formatSessionDate } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';
const { createSession, deleteSession, isSessionTabRunning, openCharacterSession, openSettings, state } =
  useDreamCardAgent();
const deletePendingSessionId = ref('');
const currentSessions = computed(() =>
  state.value.sessions.filter(item => item.bindingId === state.value.currentCharacter?.bindingId),
);
const recentSessions = computed(() => currentSessions.value.slice(0, 5));
const canCreateSession = computed(() => Boolean(state.value.currentCharacter && state.value.profiles.length));
const createTitle = computed(() =>
  !state.value.currentCharacter
    ? '请先在酒馆中打开一张角色卡'
    : state.value.profiles.length === 0
      ? '请先配置 API Profile'
      : '新建会话',
);
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
  background:
    radial-gradient(circle at 52% 20%, rgba(47, 65, 139, 0.24), transparent 34%),
    linear-gradient(145deg, #0a1225, #101a33 58%, #0a1328);
}
.dca-home::before {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(115deg, transparent 40%, rgba(80, 87, 211, 0.06) 40.2%, transparent 40.5%),
    linear-gradient(150deg, transparent 62%, rgba(65, 107, 211, 0.06) 62.2%, transparent 62.5%);
  content: '';
  pointer-events: none;
}
.dca-home-stars {
  position: absolute;
  inset: 0;
  opacity: 0.48;
  background-image:
    radial-gradient(circle at 18% 20%, #8fa7ff 0 1px, transparent 1.5px),
    radial-gradient(circle at 77% 17%, #c6d0ff 0 1px, transparent 1.5px),
    radial-gradient(circle at 63% 31%, #657fff 0 1px, transparent 1.5px),
    radial-gradient(circle at 35% 11%, #fff 0 1px, transparent 1.5px);
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
  background: radial-gradient(circle at 30% 25%, #a580ff, #5d4ce0 48%, #2847ba);
  box-shadow: 0 1rem 3rem rgba(80, 65, 222, 0.35);
  color: #fff;
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
  color: #8065ff;
  font-style: normal;
  text-shadow: 0 0 2rem rgba(102, 81, 255, 0.4);
}
.dca-welcome-hero > p {
  max-width: 40rem;
  margin: 0.75rem 0 0;
  color: var(--dca-text-muted);
  font-size: clamp(0.88rem, 1.5vw, 1rem);
}
.dca-welcome-character {
  margin-top: 0.8rem;
  color: #9eb2e8;
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
  border-color: rgba(116, 133, 192, 0.25);
  background: rgba(25, 36, 66, 0.7);
}
.dca-welcome-actions button.primary {
  border-color: #4774ef;
  background: linear-gradient(135deg, #3475ef, #6751e4);
  color: #fff;
  box-shadow: 0 0.8rem 2rem rgba(45, 86, 210, 0.25);
}
.dca-configure-api {
  margin-top: 0.7rem;
  border: 0 !important;
  background: transparent !important;
  color: #87a8ff !important;
  font-size: 0.74rem !important;
}
.dca-welcome-recents {
  margin-top: clamp(2.2rem, 6vh, 4.5rem);
  border: 1px solid rgba(105, 124, 175, 0.2);
  border-radius: 0.85rem;
  background: linear-gradient(145deg, rgba(19, 29, 54, 0.82), rgba(13, 23, 46, 0.72));
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.02);
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
  background: rgba(74, 101, 171, 0.1);
}
.dca-recent-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 0.55rem;
  background: rgba(116, 74, 235, 0.18);
  color: #9f7fff;
}
.dca-recent-icon.tone-1 {
  background: rgba(69, 91, 226, 0.18);
  color: #7194ff;
}
.dca-recent-icon.tone-2 {
  background: rgba(43, 156, 200, 0.16);
  color: #59c2ea;
}
.dca-recent-icon.tone-3 {
  background: rgba(232, 167, 53, 0.15);
  color: #f1bb54;
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
  color: #f2a3b3;
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
  border-color: rgba(231, 83, 113, 0.35);
  background: var(--dca-danger-soft);
  color: #f2a3b3;
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
  color: #6479ae;
}
.dca-welcome-empty p {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
}
.dca-welcome-footer {
  margin-top: clamp(2rem, 5vh, 4rem);
  color: #596784;
  font-size: 0.72rem;
  text-align: center;
}
.dca-welcome-footer span {
  margin: 0 0.65rem;
}
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
