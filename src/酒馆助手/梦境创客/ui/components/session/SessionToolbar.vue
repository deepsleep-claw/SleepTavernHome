<template>
  <div class="dca-session-bar">
    <div class="dca-session-bar-main">
      <div v-if="renaming" class="dca-session-rename">
        <input
          v-model="titleDraft"
          maxlength="80"
          type="text"
          @keydown.enter.prevent="saveTitle"
          @keydown.escape.prevent="cancelRename"
        />
        <button class="dca-icon-btn" type="button" title="保存会话名称" @click="saveTitle">
          <i class="fa-solid fa-check" aria-hidden="true"></i>
        </button>
        <button class="dca-icon-btn" type="button" title="取消重命名" @click="cancelRename">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div v-else class="dca-session-title">
        <strong>{{ state.active?.title }}</strong>
        <button class="dca-icon-btn" type="button" title="重命名会话" @click="beginRename">
          <i class="fa-solid fa-pencil" aria-hidden="true"></i>
        </button>
      </div>
      <small
        >{{ state.active?.agentConfiguration?.name ?? '旧版会话配置' }} ·
        {{ state.active?.mode === 'yolo' ? 'YOLO：低风险自动写入' : '普通：批准后写入' }}</small
      >
    </div>
    <div class="dca-session-controls">
      <div v-if="deletePending" class="dca-session-delete-confirm">
        <span>删除当前会话？</span>
        <button type="button" @click="deletePending = false">取消</button>
        <button class="dca-btn-danger" type="button" @click="confirmDelete">确认删除</button>
      </div>
      <button
        v-else
        class="dca-icon-btn dca-session-delete"
        type="button"
        :disabled="!state.active || isSessionTabRunning(state.active.sessionId)"
        :title="
          state.active && isSessionTabRunning(state.active.sessionId)
            ? '运行中或等待处理的会话不能删除'
            : '删除当前会话'
        "
        @click="deletePending = true"
      >
        <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
      </button>
      <label class="dca-switch" title="YOLO 模式：低风险修改自动提交，高危操作仍需确认">
        <input type="checkbox" :checked="state.active?.mode === 'yolo'" @change="setYolo" />
        <span>YOLO</span>
      </label>
      <button
        class="dca-sidebar-toggle"
        type="button"
        :title="sidebarCollapsed ? '打开侧栏' : '收起侧栏'"
        @click="emit('toggle-sidebar')"
      >
        <i :class="sidebarCollapsed ? 'fa-solid fa-table-columns' : 'fa-solid fa-angles-right'" aria-hidden="true"></i>
        <span>{{ sidebarCollapsed ? '侧栏' : '收起' }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';

defineProps<{ sidebarCollapsed: boolean }>();
const emit = defineEmits<{ 'toggle-sidebar': [] }>();

const { action, deleteSession, isSessionTabRunning, runtime, state } = useDreamCardAgent();

const renaming = ref(false);
const titleDraft = ref('');
const deletePending = ref(false);

watch(
  () => state.value.active?.sessionId,
  () => {
    renaming.value = false;
    titleDraft.value = '';
    deletePending.value = false;
  },
);

function beginRename() {
  titleDraft.value = state.value.active?.title ?? '';
  renaming.value = true;
}

function cancelRename() {
  renaming.value = false;
  titleDraft.value = '';
}

async function saveTitle() {
  if (await action(() => runtime.renameSession(titleDraft.value))) cancelRename();
}

async function confirmDelete() {
  const sessionId = state.value.active?.sessionId;
  if (sessionId && (await deleteSession(sessionId))) deletePending.value = false;
}

function setYolo(event: Event) {
  if (state.value.active)
    void action(() => runtime.setMode((event.target as HTMLInputElement).checked ? 'yolo' : 'normal'));
}
</script>

<style lang="scss">
.dca-session-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  border-bottom: 1px solid var(--dca-border);
  padding: 0.45rem 0.75rem;
  background: var(--dca-surface);
}

.dca-session-bar-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dca-session-bar-main > small {
  color: var(--dca-text-muted);
  font-size: 0.74rem;
}

.dca-session-title,
.dca-session-rename {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.35rem;
}

.dca-session-title strong {
  overflow: hidden;
  font-size: 0.95rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-app .dca-session-rename input {
  width: min(26rem, 55vw);
  padding: 0.3rem 0.5rem;
  font-weight: 700;
}

.dca-session-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
}

.dca-app .dca-session-delete {
  color: var(--dca-text-muted);
}

.dca-app .dca-session-delete:hover:not(:disabled) {
  color: var(--dca-danger);
}

.dca-session-delete-confirm {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: var(--dca-radius-sm);
  padding: 0.25rem 0.35rem;
  background: var(--dca-danger-soft);
  font-size: 0.8rem;
  white-space: nowrap;
}

.dca-switch {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--dca-text-secondary);
  font-size: 0.82rem;
}

.dca-app .dca-sidebar-toggle span {
  font-size: 0.82rem;
}

@media (max-width: 720px) {
  .dca-sidebar-toggle span {
    display: none;
  }

  .dca-session-delete-confirm > span {
    display: none;
  }
}
</style>
