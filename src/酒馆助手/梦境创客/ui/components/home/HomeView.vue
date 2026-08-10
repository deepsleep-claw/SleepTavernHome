<template>
  <section class="dca-home">
    <div class="dca-home-inner">
      <header class="dca-home-brand">
        <span class="dca-home-logo">梦</span>
        <div class="dca-home-brand-text">
          <h1>梦境创客</h1>
          <p>和 Agent 一起，把灵感整理成完整的角色卡。</p>
        </div>
        <div v-if="state.currentCharacter" class="dca-home-character" title="当前打开的角色卡">
          <i class="fa-regular fa-address-card" aria-hidden="true"></i>
          <span>{{ state.currentCharacter.name }}</span>
        </div>
      </header>

      <div v-if="!state.currentCharacter" class="dca-home-notice">
        <i class="fa-regular fa-address-card" aria-hidden="true"></i>
        <div>
          <strong>请先打开一张角色卡</strong>
          <p>梦境创客只编辑当前打开的单角色卡。</p>
        </div>
      </div>

      <div class="dca-home-columns">
        <div class="dca-home-col">
          <h4>开始</h4>
          <button
            class="dca-home-action dca-home-action-primary"
            type="button"
            :disabled="!canCreateSession || state.busy"
            @click="createSession"
          >
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            <span><strong>新建会话</strong><small>从一个新的创作目标开始</small></span>
          </button>
          <button
            v-if="state.profiles.length === 0"
            class="dca-home-action"
            type="button"
            @click="openSettings('api')"
          >
            <i class="fa-solid fa-plug" aria-hidden="true"></i>
            <span><strong>配置 API</strong><small>连接用于角色创作的模型</small></span>
          </button>
          <button class="dca-home-action" type="button" @click="openSettings('general')">
            <i class="fa-solid fa-gear" aria-hidden="true"></i>
            <span><strong>打开设置</strong><small>调整预设、Skill 与界面选项</small></span>
          </button>
        </div>

        <div v-if="state.currentCharacter" class="dca-home-col">
          <h4>
            近期会话
            <span>{{ currentSessions.length }} 个会话</span>
          </h4>
          <div v-if="recentSessions.length" class="dca-recent-list">
            <div v-for="session in recentSessions" :key="session.sessionId" class="dca-recent-item">
              <div v-if="deletePendingSessionId === session.sessionId" class="dca-recent-delete-confirm">
                <span>确认删除“{{ session.title }}”？</span>
                <button type="button" @click="deletePendingSessionId = ''">取消</button>
                <button class="dca-btn-danger" type="button" @click="confirmDeleteSession(session.sessionId)">
                  确认删除
                </button>
              </div>
              <template v-else>
                <button class="dca-recent-open" type="button" @click="openSessionTab(session.sessionId)">
                  <i class="fa-regular fa-message" aria-hidden="true"></i>
                  <span>
                    <strong>{{ session.title }}</strong>
                    <small>
                      {{ formatSessionDate(session.updatedAt)
                      }}<template v-if="state.developerMode"> · r{{ session.revision }}</template>
                    </small>
                  </span>
                </button>
                <button
                  class="dca-icon-btn dca-recent-delete"
                  type="button"
                  :disabled="isSessionTabRunning(session.sessionId)"
                  :title="
                    isSessionTabRunning(session.sessionId) ? '运行中或等待处理的会话不能删除' : '删除会话'
                  "
                  @click="deletePendingSessionId = session.sessionId"
                >
                  <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                </button>
              </template>
            </div>
          </div>
          <p v-else class="dca-home-empty">还没有会话。点击“新建会话”开始第一次创作。</p>
          <button
            v-if="currentSessions.length > 8"
            class="dca-text-link dca-home-more"
            type="button"
            @click="showAllSessions = !showAllSessions"
          >
            {{ showAllSessions ? '收起' : '全部会话' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { formatSessionDate } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';

const { createSession, deleteSession, isSessionTabRunning, openSessionTab, openSettings, state } = useDreamCardAgent();

const showAllSessions = ref(false);
const deletePendingSessionId = ref('');
const currentSessions = computed(() =>
  state.value.sessions.filter(item => item.bindingId === state.value.currentCharacter?.bindingId),
);
const recentSessions = computed(() =>
  showAllSessions.value ? currentSessions.value : currentSessions.value.slice(0, 8),
);
const canCreateSession = computed(() => Boolean(state.value.currentCharacter && state.value.profiles.length));

async function confirmDeleteSession(sessionId: string) {
  if (await deleteSession(sessionId)) deletePendingSessionId.value = '';
}

watch(
  () => state.value.currentCharacter?.bindingId,
  () => {
    showAllSessions.value = false;
    deletePendingSessionId.value = '';
  },
);
</script>

<style lang="scss">
.dca-home {
  height: 100%;
  overflow: auto;
}

.dca-home-inner {
  width: min(64rem, 100%);
  margin: 0 auto;
  padding: clamp(2rem, 7vh, 4.5rem) clamp(1.25rem, 4vw, 3rem) 3rem;
}

// ---------- 品牌区 ----------

.dca-home-brand {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: clamp(1.75rem, 5vh, 3rem);
}

.dca-home-logo {
  display: grid;
  width: 3rem;
  height: 3rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--dca-radius-md);
  background: var(--dca-accent);
  color: #fff;
  font-size: 1.35rem;
  font-weight: 900;
}

.dca-home-brand-text {
  min-width: 0;
}

.dca-home-brand-text h1 {
  margin: 0;
  font-size: 1.65rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1.2;
}

.dca-home-brand-text p {
  margin: 0.15rem 0 0;
  color: var(--dca-text-muted);
  font-size: 0.88rem;
}

.dca-home-character {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.45rem;
  margin-left: auto;
  color: var(--dca-text-secondary);
  font-size: 0.86rem;
}

.dca-home-character i {
  color: var(--dca-accent);
}

.dca-home-notice {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 2rem;
  border-left: 3px solid var(--dca-accent);
  border-radius: 0 var(--dca-radius-md) var(--dca-radius-md) 0;
  padding: 0.75rem 0.9rem;
  background: var(--dca-accent-soft);
}

.dca-home-notice > i {
  color: var(--dca-accent);
  font-size: 1.4rem;
}

.dca-home-notice p {
  margin: 0.15rem 0 0;
  color: var(--dca-text-secondary);
  font-size: 0.86rem;
}

// ---------- 双栏 ----------

.dca-home-columns {
  display: grid;
  grid-template-columns: minmax(15rem, 0.85fr) minmax(0, 1.35fr);
  gap: clamp(2rem, 6vw, 4.5rem);
  align-items: start;
}

.dca-home-col {
  min-width: 0;
}

.dca-home-col > h4 {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.65rem;
  margin: 0 0 0.55rem;
  padding: 0 0.65rem;
  color: var(--dca-text-muted);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.dca-home-col > h4 > span {
  color: var(--dca-text-disabled);
  font-size: 0.74rem;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

// ---------- 开始操作 ----------

.dca-app .dca-home-action {
  display: grid;
  width: 100%;
  grid-template-columns: 1.7rem minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem;
  border-color: transparent;
  border-radius: var(--dca-radius-md);
  padding: 0.55rem 0.65rem;
  background: transparent;
  text-align: left;
}

.dca-app .dca-home-action:hover:not(:disabled) {
  border-color: transparent;
  background: var(--dca-raised);
}

.dca-home-action > i {
  color: var(--dca-accent);
  font-size: 1rem;
  text-align: center;
}

.dca-home-action span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dca-home-action strong {
  color: var(--dca-text);
}

.dca-home-action small {
  color: var(--dca-text-muted);
  font-size: 0.78rem;
}

.dca-app .dca-home-action-primary {
  background: var(--dca-accent-soft);
}

.dca-app .dca-home-action-primary:hover:not(:disabled) {
  background: rgb(157 124 255 / 20%);
}

.dca-home-action-primary > i {
  color: var(--dca-accent-strong);
}

// ---------- 近期会话 ----------

.dca-recent-list {
  display: flex;
  flex-direction: column;
}

.dca-recent-item {
  display: flex;
  min-width: 0;
  align-items: center;
  border-radius: var(--dca-radius-md);
}

.dca-recent-item:hover {
  background: var(--dca-raised);
}

.dca-app .dca-recent-open {
  display: grid;
  min-width: 0;
  flex: 1 1 auto;
  grid-template-columns: 1.4rem minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem;
  border-color: transparent;
  border-radius: var(--dca-radius-md);
  padding: 0.5rem 0.65rem;
  background: transparent;
  text-align: left;
}

.dca-app .dca-recent-open:hover:not(:disabled) {
  border-color: transparent;
  background: transparent;
}

.dca-recent-open > i {
  color: var(--dca-text-muted);
  font-size: 0.85rem;
  text-align: center;
}

.dca-recent-open:hover:not(:disabled) > i {
  color: var(--dca-accent);
}

.dca-recent-open span {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.65rem;
}

.dca-recent-open strong {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-recent-open small {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--dca-text-muted);
  font-size: 0.76rem;
}

.dca-app .dca-recent-delete {
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  margin-right: 0.35rem;
  color: var(--dca-text-muted);
  opacity: 0.35;
}

.dca-recent-item:hover .dca-recent-delete,
.dca-recent-delete:focus-visible {
  color: var(--dca-danger);
  opacity: 1;
}

.dca-recent-delete-confirm {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.65rem;
  background: var(--dca-danger-soft);
}

.dca-recent-delete-confirm > span {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-home-empty {
  margin: 0.3rem 0 0;
  padding: 0 0.65rem;
  color: var(--dca-text-muted);
  font-size: 0.86rem;
}

.dca-home-more {
  margin: 0.35rem 0 0 0.65rem;
}

@media (max-width: 720px) {
  .dca-home-inner {
    padding-top: 1.5rem;
  }

  .dca-home-brand {
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }

  .dca-home-logo {
    width: 2.5rem;
    height: 2.5rem;
  }

  .dca-home-brand-text h1 {
    font-size: 1.35rem;
  }

  .dca-home-character {
    margin-left: 0;
  }

  .dca-home-columns {
    grid-template-columns: 1fr;
    gap: 1.75rem;
  }

  .dca-app .dca-recent-delete {
    opacity: 0.75;
  }

  .dca-recent-delete-confirm {
    flex-wrap: wrap;
  }
}
</style>
