<template>
  <div class="dca-dialog-backdrop" @click.self="$emit('close')">
    <section class="dca-all-dialog" role="dialog" aria-modal="true" aria-labelledby="dca-all-title">
      <header>
        <span class="dca-character-avatar">{{ group?.characterName.slice(0, 1) || '?' }}</span>
        <div>
          <h2 id="dca-all-title">{{ group?.characterName }}</h2>
          <p>{{ group?.sessions.length ?? 0 }} 个会话{{ group?.available ? '' : ' · 只读历史' }}</p>
        </div>
        <button class="dca-icon-btn" type="button" title="关闭" @click="$emit('close')">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </header>
      <label class="dca-all-search"
        ><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i
        ><input v-model="query" type="search" placeholder="搜索会话标题"
      /></label>
      <div class="dca-all-list">
        <article v-for="session in sessions" :key="session.sessionId">
          <button class="dca-all-open" type="button" @click="open(session.sessionId)">
            <span
              class="dca-session-state"
              :class="`state-${state.sessionStatuses[session.sessionId] ?? session.status}`"
            ></span>
            <span
              ><strong>{{ session.title }}</strong
              ><small
                >{{ formatDate(session.updatedAt) }} ·
                {{ statusName(state.sessionStatuses[session.sessionId] ?? session.status) }}</small
              ></span
            >
          </button>
          <button
            class="dca-icon-btn dca-danger-ghost"
            type="button"
            :disabled="isSessionTabRunning(session.sessionId)"
            title="删除会话"
            @click="deletePending = session.sessionId"
          >
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        </article>
        <div v-if="sessions.length === 0" class="dca-empty">没有匹配的会话。</div>
      </div>
      <div v-if="deletePending" class="dca-inline-confirm">
        <span>确认永久删除“{{ pendingTitle }}”及其快照？</span>
        <button type="button" @click="deletePending = undefined">取消</button>
        <button class="danger" type="button" @click="remove">确认删除</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';
const props = defineProps<{ bindingId: string }>();
const emit = defineEmits<{ close: [] }>();
const { deleteCharacterSession, isSessionTabRunning, openCharacterSession, state } = useDreamCardAgent();
const query = ref('');
const deletePending = ref<string>();
const group = computed(() => state.value.characterGroups?.find(item => item.bindingId === props.bindingId));
const sessions = computed(() =>
  (group.value?.sessions ?? []).filter(item =>
    item.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  ),
);
const pendingTitle = computed(
  () => group.value?.sessions.find(item => item.sessionId === deletePending.value)?.title ?? '此会话',
);
async function open(id: string) {
  await openCharacterSession(props.bindingId, id);
  emit('close');
}
async function remove() {
  if (deletePending.value && (await deleteCharacterSession(props.bindingId, deletePending.value)))
    deletePending.value = undefined;
}
function formatDate(value: number) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function statusName(value: string) {
  return (
    (
      {
        completed: '已完成',
        running: '运行中',
        stopped: '已停止',
        abnormal: '异常',
        idle: '空闲',
        failed: '失败',
      } as Record<string, string>
    )[value] ?? value
  );
}
</script>

<style lang="scss">
.dca-dialog-backdrop {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(3, 7, 18, 0.72);
  backdrop-filter: blur(8px);
}
.dca-all-dialog {
  display: flex;
  width: min(42rem, 100%);
  max-height: min(44rem, 90vh);
  flex-direction: column;
  border: 1px solid var(--dca-border-strong);
  border-radius: 1rem;
  background: #101a31;
  box-shadow: 0 1.5rem 5rem rgba(0, 0, 0, 0.45);
}
.dca-all-dialog > header {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 1rem;
  border-bottom: 1px solid var(--dca-border);
}
.dca-all-dialog > header > div {
  min-width: 0;
  flex: 1;
}
.dca-all-dialog h2,
.dca-all-dialog p {
  margin: 0;
}
.dca-all-dialog h2 {
  font-size: 1rem;
}
.dca-all-dialog p {
  color: var(--dca-text-muted);
  font-size: 0.75rem;
}
.dca-all-search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.8rem 1rem;
  padding: 0 0.75rem;
  border: 1px solid var(--dca-border);
  border-radius: 0.6rem;
  background: rgba(4, 10, 24, 0.6);
  color: var(--dca-text-muted);
}
.dca-all-search input {
  width: 100%;
  border: 0;
  padding-inline: 0;
  background: transparent;
}
.dca-all-list {
  min-height: 9rem;
  overflow-y: auto;
  padding: 0 1rem 1rem;
}
.dca-all-list article {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--dca-border);
}
.dca-all-open {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 0.65rem;
  border: 0;
  padding: 0.75rem 0.4rem;
  background: transparent;
  text-align: left;
}
.dca-all-open > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.dca-all-open strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-all-open small {
  color: var(--dca-text-muted);
}
.dca-inline-confirm {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--dca-border);
  background: rgba(122, 38, 61, 0.12);
}
.dca-inline-confirm span {
  flex: 1;
  font-size: 0.78rem;
}
.dca-inline-confirm .danger {
  border-color: rgba(248, 113, 113, 0.45);
  color: #fca5a5;
}
@media (max-width: 720px) {
  .dca-dialog-backdrop {
    padding: 0.55rem;
  }
  .dca-all-dialog {
    max-height: calc(100vh - 1.1rem);
  }
  .dca-inline-confirm {
    flex-wrap: wrap;
  }
  .dca-inline-confirm span {
    flex-basis: 100%;
  }
}
</style>
