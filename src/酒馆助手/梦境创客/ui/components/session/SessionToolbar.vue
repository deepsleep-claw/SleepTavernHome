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
      <small
        >{{ state.active?.scope === 'global' ? '全局会话' : state.active?.characterName }} · {{
          state.activeSessionAccess === 'readonly-history'
            ? '只读历史记录'
            : state.active?.mode === 'yolo'
              ? 'YOLO：低风险自动写入'
              : '普通：批准后写入'
        }}</small
      >
    </div>
    <div class="dca-session-controls">
      <label v-if="state.activeSessionAccess === 'live'" class="dca-session-agent-select">
        <span>Agent</span>
        <DcaSelect
          :model-value="selectedAgentId"
          :options="agentOptions"
          placeholder="请选择 Agent"
          aria-label="当前会话 Agent"
          :disabled="!state.active || isSessionTabRunning(state.active.sessionId)"
          @update:model-value="requestAgentChange"
        />
      </label>
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
    <div v-if="pendingAgentId" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-agent-change-dialog" role="dialog" aria-modal="true" @click.stop>
        <header>
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <div>
            <strong>切换当前会话的 Agent？</strong>
            <span>这个会话已经开始。新的预设、Skill 与工具会立即生效，并可能失去已有请求的缓存命中。</span>
          </div>
        </header>
        <footer>
          <button type="button" @click="pendingAgentId = ''">取消</button>
          <button class="dca-btn-primary" type="button" @click="confirmAgentChange">仍然切换</button>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSelect from '../DcaSelect.vue';

defineProps<{ sidebarCollapsed: boolean }>();
const emit = defineEmits<{ 'toggle-sidebar': [] }>();

const { action, deleteCharacterSession, deleteSession, isSessionTabRunning, runtime, state } = useDreamCardAgent();

const renaming = ref(false);
const titleDraft = ref('');
const deletePending = ref(false);
const pendingAgentId = ref('');
const agentOptions = computed(() =>
  state.value.agentConfigurations.map(configuration => ({ label: configuration.name, value: configuration.id })),
);
const selectedAgentId = computed(() => {
  const id = state.value.active?.agentConfiguration.id ?? '';
  return state.value.agentConfigurations.some(configuration => configuration.id === id) ? id : '';
});
const hasStarted = computed(() => state.value.active?.ui.some(item => item.kind === 'user') === true);

watch(
  () => state.value.active?.sessionId,
  () => {
    renaming.value = false;
    titleDraft.value = '';
    deletePending.value = false;
    pendingAgentId.value = '';
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

function requestAgentChange(id: string) {
  if (!id || id === selectedAgentId.value) return;
  if (hasStarted.value) pendingAgentId.value = id;
  else void applyAgent(id);
}

async function applyAgent(id: string) {
  if (await action(() => runtime.applyAgentConfiguration(id))) {
    pendingAgentId.value = '';
    toastr.success('当前会话的 Agent 已切换。', '梦境创客');
  }
}

async function confirmAgentChange() {
  if (pendingAgentId.value) await applyAgent(pendingAgentId.value);
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
.dca-agent-change-dialog > header { display: flex; gap: .7rem; }
.dca-agent-change-dialog > header > i { color: var(--dca-warning); }
.dca-agent-change-dialog > header > div { display: grid; gap: .2rem; }
.dca-agent-change-dialog > header span { color: var(--dca-text-muted); font-size: .78rem; }
.dca-agent-change-dialog > footer { display: flex; justify-content: flex-end; gap: .5rem; }

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

@media (max-width: 720px) {
  .dca-session-agent-select { min-width: 0; max-width: 10rem; }
  .dca-session-agent-select > span { display: none; }
  .dca-session-agent-select > .dca-select { min-width: 0; }
  .dca-sidebar-toggle span {
    display: none;
  }

  .dca-session-delete-confirm > span {
    display: none;
  }
}
</style>
