<template>
  <div
    v-if="backupConflictsOpen && conflicts.length"
    class="dca-modal-backdrop"
    @click.self="close"
    @keydown.esc.stop="close"
  >
    <section
      ref="dialog"
      class="dca-modal dca-backup-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="处理备份冲突"
      tabindex="-1"
    >
      <header><strong>选择继续使用的会话记录</strong></header>
      <p>处理前会保留双方记录为恢复点，可以在“设置 → 文件与存储”中导出。</p>
      <article
        v-for="conflict in conflicts"
        :key="`${conflict.bindingId}:${conflict.sessionId}`"
        class="dca-backup-conflict"
      >
        <strong>{{ conflict.title }}</strong>
        <small
          >{{ conflict.characterName }} · 本机 {{ formatSessionDate(conflict.localUpdatedAt) }} · 后端
          {{ formatSessionDate(conflict.remoteUpdatedAt) }}</small
        >
        <p v-if="conflict.deleted">本机已删除这个会话，后端还保留着更新后的记录。</p>
        <div class="dca-backup-options">
          <button type="button" :disabled="busy || running(conflict)" @click="resolve(conflict, 'local')">
            {{ conflict.deleted ? '保留本机删除' : '保留本机版本' }}
            <small>{{ conflict.deleted ? '删除后端的会话备份' : '用本机记录替换后端备份' }}</small>
          </button>
          <button type="button" :disabled="busy || running(conflict)" @click="resolve(conflict, 'remote')">
            使用后端版本
            <small>用后端记录替换本机会话</small>
          </button>
        </div>
        <small v-if="running(conflict)">请先停止或完成这个会话的任务。</small>
      </article>
      <footer><button type="button" :disabled="busy" @click="close">稍后处理</button></footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { SessionBackupConflict, SessionBackupResolution } from '../../core/persistence/local-session-store';
import { formatSessionDate } from '../composables/format';
import { useDreamCardAgent } from '../composables/runtime';

const { action, runtime, state, backupConflictsOpen } = useDreamCardAgent();
const busy = ref(false);
const dialog = ref<HTMLElement>();
const status = computed(() => state.value.sessionBackup);
const conflicts = computed(() => status.value?.conflicts ?? []);

function running(conflict: SessionBackupConflict) {
  return ['running', 'waiting-approval'].includes(state.value.sessionStatuses[conflict.sessionId] ?? '');
}
function close() {
  if (!busy.value) backupConflictsOpen.value = false;
}
async function resolve(conflict: SessionBackupConflict, resolution: SessionBackupResolution) {
  if (busy.value) return;
  busy.value = true;
  try {
    await action(() => runtime.resolveSessionBackupConflict(conflict, resolution));
  } finally {
    busy.value = false;
  }
}
watch(conflicts, values => {
  if (!values.length) backupConflictsOpen.value = false;
});
watch(backupConflictsOpen, async open => {
  if (open) {
    await nextTick();
    dialog.value?.focus();
  }
});
</script>

<style scoped>
.dca-backup-dialog {
  width: min(36rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  overflow: auto;
}
.dca-backup-conflict {
  display: grid;
  gap: 0.6rem;
  padding: 0.8rem 0;
  border-top: 1px solid var(--dca-border);
}
.dca-backup-conflict > strong,
.dca-backup-conflict > small {
  overflow-wrap: anywhere;
}
.dca-backup-conflict small {
  color: var(--dca-text-muted);
}
.dca-backup-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}
.dca-backup-options button {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  white-space: normal;
}
@media (max-width: 480px) {
  .dca-backup-options {
    grid-template-columns: 1fr;
  }
}
</style>
