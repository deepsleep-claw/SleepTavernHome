<template>
  <section class="dca-section-stack">
    <header class="dca-section-header">
      <div>
        <h3>存储与清理</h3>
        <p>会话是创作记录；安全清理不会删除仍在使用的对话或回退点。</p>
      </div>
      <button type="button" :disabled="storageCleaning || !state.currentCharacter" @click="cleanupStorage">
        <i class="fa-solid fa-broom" aria-hidden="true"></i>{{ storageCleaning ? '清理中' : '安全清理' }}
      </button>
    </header>
    <div class="dca-metric-grid">
      <div>
        <strong>{{ formatBytes(state.storage.currentCharacterBytes) }}</strong>
        <span>当前角色会话</span>
      </div>
      <div>
        <strong>{{ state.sessions.length }}</strong>
        <span>会话数量</span>
      </div>
      <div>
        <strong>{{ formatBytes(state.storage.globalSkillBytes) }}</strong>
        <span>全局 Skill</span>
      </div>
    </div>
    <div v-if="state.sessions.length" class="dca-storage-list">
      <article v-for="session in state.sessions" :key="session.sessionId" class="dca-storage-row">
        <div>
          <strong>{{ session.title }}</strong>
          <small>{{ formatSessionDate(session.updatedAt) }} · {{ formatBytes(session.size) }}</small>
        </div>
        <div v-if="storageDeletePending === session.sessionId" class="dca-row-actions">
          <span>确认删除此会话？</span>
          <button type="button" @click="storageDeletePending = ''">取消</button>
          <button class="dca-btn-danger" type="button" @click="deleteStoredSession(session.sessionId)">确认删除</button>
        </div>
        <button v-else class="dca-btn-danger" type="button" @click="storageDeletePending = session.sessionId">
          删除
        </button>
      </article>
    </div>
    <div v-else class="dca-empty">当前角色还没有已保存会话。</div>
    <div class="dca-danger-zone">
      <div>
        <strong>清空当前角色会话</strong>
        <small>API、预设和全局 Skill 不会被删除。</small>
      </div>
      <div v-if="storageClearPending" class="dca-row-actions">
        <button type="button" @click="storageClearPending = false">取消</button>
        <button class="dca-btn-danger" type="button" @click="clearStoredSessions">确认全部清空</button>
      </div>
      <button
        v-else
        class="dca-btn-danger"
        type="button"
        :disabled="state.sessions.length === 0"
        @click="storageClearPending = true"
      >
        清空全部会话
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { formatBytes, formatSessionDate } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';

const { action, deleteSession, openedSessionIds, runtime, state, workspaceView } = useDreamCardAgent();

const storageDeletePending = ref('');
const storageClearPending = ref(false);
const storageCleaning = ref(false);

async function cleanupStorage() {
  storageCleaning.value = true;
  try {
    const result = await runtime.cleanupCurrentCharacterStorage();
    toastr.success(
      result.cleanedSessions || result.removedFiles
        ? `已整理 ${result.cleanedSessions} 个会话并清理 ${result.removedFiles} 个孤立文件。`
        : '当前没有可回收数据。',
      '梦境创客',
    );
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '存储清理失败');
  } finally {
    storageCleaning.value = false;
  }
}

async function deleteStoredSession(sessionId: string) {
  if (await deleteSession(sessionId)) {
    storageDeletePending.value = '';
  }
}

async function clearStoredSessions() {
  if (await action(() => runtime.clearCurrentCharacterSessions())) {
    openedSessionIds.value = [];
    storageClearPending.value = false;
    workspaceView.value = 'home';
    toastr.success('已清空当前角色的全部梦境创客会话。', '梦境创客');
  }
}
</script>

<style lang="scss">
.dca-storage-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.dca-storage-row,
.dca-danger-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.6rem 0.75rem;
  background: var(--dca-surface);
}

.dca-storage-row > div:first-child,
.dca-danger-zone > div:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.1rem;
}

.dca-storage-row small,
.dca-danger-zone small {
  color: var(--dca-text-muted);
}

.dca-danger-zone {
  margin-top: auto;
  border-color: rgb(224 108 130 / 40%);
  background: var(--dca-danger-soft);
}
</style>
