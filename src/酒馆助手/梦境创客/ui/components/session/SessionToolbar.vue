<template>
  <div ref="toolbarRoot" class="dca-session-bar" :class="{ 'is-narrow': toolbarWidth < 680 || isMobile }">
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
        <button
          v-if="state.activeSessionAccess === 'live'"
          class="dca-icon-btn"
          type="button"
          title="重命名会话"
          @click="beginRename"
        >
          <i class="fa-solid fa-pencil" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div class="dca-session-controls">
      <SessionAgentPicker v-if="state.activeSessionAccess === 'live' && toolbarWidth >= 680 && !isMobile" />
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
import { useElementWidth } from '../../composables/element-width';
import { useDreamCardAgent } from '../../composables/runtime';
import SessionAgentPicker from './SessionAgentPicker.vue';

defineProps<{ sidebarCollapsed: boolean }>();
const emit = defineEmits<{ 'toggle-sidebar': [] }>();

const { action, deleteCharacterSession, deleteSession, isMobile, isSessionTabRunning, runtime, state } = useDreamCardAgent();

const renaming = ref(false);
const toolbarRoot = ref<HTMLElement>();
const toolbarWidth = useElementWidth(toolbarRoot);
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
  const bindingId = state.value.active?.bindingId;
  if (!sessionId || !bindingId) return;
  const deleted =
    state.value.activeSessionAccess === 'readonly-history'
      ? await deleteCharacterSession(bindingId, sessionId)
      : await deleteSession(sessionId);
  if (deleted) deletePending.value = false;
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
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
}

.dca-session-bar-main > small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  width: 100%;
  min-width: 0;
  max-width: 26rem;
  padding: 0.3rem 0.5rem;
  font-weight: 700;
}

.dca-session-controls {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.dca-session-agent-select {
  display: flex;
  min-width: 12rem;
  align-items: center;
  gap: 0.4rem;
}
.dca-session-agent-select > span {
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}
.dca-session-agent-select > .dca-select {
  min-width: 9rem;
  flex: 1;
}
.dca-agent-change-dialog {
  width: min(32rem, calc(100vw - 2rem));
}
.dca-agent-change-dialog > header {
  display: flex;
  gap: 0.7rem;
}
.dca-agent-change-dialog > header > i {
  color: var(--dca-warning);
}
.dca-agent-change-dialog > header > div {
  display: grid;
  gap: 0.2rem;
}
.dca-agent-change-dialog > header span {
  color: var(--dca-text-muted);
  font-size: 0.78rem;
}
.dca-agent-change-dialog > footer {
  display: flex;
  justify-content: flex-end;
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

.dca-app .dca-sidebar-toggle span {
  font-size: 0.82rem;
}

.dca-session-bar.is-narrow {
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
  .dca-session-bar-main {
    flex: 1 1 auto;
    width: auto;
  }
  .dca-session-controls {
    flex: 0 0 auto;
    flex-wrap: nowrap;
    gap: 0.25rem;
  }
  .dca-sidebar-toggle span {
    display: none;
  }
}

@media (max-width: 720px) {
  .dca-session-agent-select {
    min-width: 0;
    max-width: 10rem;
  }
  .dca-session-agent-select > span {
    display: none;
  }
  .dca-session-agent-select > .dca-select {
    min-width: 0;
  }
  .dca-sidebar-toggle span {
    display: none;
  }

  .dca-session-delete-confirm > span {
    display: none;
  }
}
</style>
