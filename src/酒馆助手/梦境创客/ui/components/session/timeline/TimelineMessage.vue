<template>
  <ManualChangeCard v-if="item.kind === 'manual'" :item="item" />
  <article v-else class="dca-message" :class="`dca-message-${item.kind}`">
    <header>
      <span>{{ itemKindLabel(item.kind) }}</span>
      <small>{{ formatTime(item.at) }}</small>
    </header>
    <template v-if="editing">
      <textarea v-model="editDraft" rows="3"></textarea>
      <div class="dca-row-actions dca-message-edit-actions">
        <button type="button" @click="saveEdit">保存</button>
        <button class="dca-btn-ghost" type="button" @click="cancelEdit">取消</button>
      </div>
    </template>
    <div v-else-if="item.attachments?.length" class="dca-message-attachments">
      <span v-for="attachment in item.attachments" :key="attachment.id" :class="{ missing: attachment.missing }">
        <i
          :class="attachment.mediaType.startsWith('image/') ? 'fa-regular fa-image' : 'fa-regular fa-file-lines'"
          aria-hidden="true"
        ></i>
        <span>{{ attachment.filename }}</span>
        <small>{{ attachment.missing ? '已清理' : formatBytes(attachment.size) }}</small>
      </span>
    </div>
    <!-- eslint-disable vue/no-v-html -- 内容已由 ui/markdown.ts 的默认安全 Schema 清洗。 -->
    <div
      v-if="!editing && item.content && isMarkdownMessage(item)"
      class="dca-markdown"
      v-html="renderMessageMarkdown(item.content)"
    ></div>
    <!-- eslint-enable vue/no-v-html -->
    <p v-else-if="!editing && item.content">{{ cleanGuidance(item.content) }}</p>
    <footer v-if="item.kind === 'user' && !editing && state.activeSessionAccess === 'live'" class="dca-message-actions">
      <button type="button" :disabled="!canModifyHistory" @click="undoTo">回退本轮修改</button>
      <button
        class="dca-icon-btn"
        type="button"
        title="编辑并可重新发送"
        :disabled="!canModifyHistory"
        @click="beginEdit"
      >
        <i class="fa-solid fa-pencil" aria-hidden="true"></i>
      </button>
      <button type="button" :disabled="!canSend" @click="resend">重新发送</button>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SessionUiItem } from '../../../../core/session/types';
import { formatBytes, formatTime } from '../../../composables/format';
import { useDreamCardAgent } from '../../../composables/runtime';
import { cleanGuidance, isMarkdownMessage, itemKindLabel } from '../../../composables/timeline';
import { renderMarkdown } from '../../../markdown';
import ManualChangeCard from './ManualChangeCard.vue';

const props = defineProps<{ item: SessionUiItem }>();

const { action, runtime, state } = useDreamCardAgent();

const editing = ref(false);
const editDraft = ref('');

const canModifyHistory = computed(() =>
  Boolean(
    state.value.active &&
    !state.value.busy &&
    !state.value.active.approval &&
    !['awaiting-approval', 'committing', 'running', 'waiting-approval'].includes(state.value.active.status),
  ),
);

const canSend = computed(() =>
  Boolean(
    state.value.activeSessionAccess === 'live' &&
    state.value.active &&
    !state.value.busy &&
    ['completed', 'idle'].includes(state.value.active.status) &&
    !state.value.active.approval,
  ),
);

function renderMessageMarkdown(value: string): string {
  return renderMarkdown(cleanGuidance(value));
}

function beginEdit() {
  editDraft.value = props.item.content;
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
  editDraft.value = '';
}

function saveEdit() {
  runtime.editUserMessage(props.item.id, editDraft.value);
  cancelEdit();
}

async function undoTo() {
  await action(() => runtime.undoToUserMessage(props.item.id));
}

async function resend() {
  await action(() => runtime.resend(props.item.id));
}
</script>

<style lang="scss">
.dca-message {
  max-width: 88%;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-lg);
  padding: 0.55rem 0.75rem;
  background: var(--dca-surface);
  box-shadow: var(--dca-shadow-1);
}

.dca-message-user {
  align-self: flex-end;
  border-color: rgb(157 124 255 / 35%);
  background: linear-gradient(160deg, rgb(157 124 255 / 16%), rgb(157 124 255 / 8%));
}

.dca-message-assistant {
  align-self: flex-start;
}

.dca-message-guidance {
  border-style: dashed;
  border-color: rgb(223 177 94 / 55%);
  background: var(--dca-warning-soft);
}

.dca-message > header {
  display: flex;
  justify-content: space-between;
  gap: 0.65rem;
  color: var(--dca-text-muted);
  font-size: 0.74rem;
}

.dca-message > header > span {
  font-weight: 600;
}

.dca-message p {
  margin: 0.35rem 0 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.dca-message .dca-markdown {
  margin-top: 0.35rem;
}

.dca-message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.4rem;
}

.dca-message-attachments > span {
  display: flex;
  max-width: 18rem;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-sm);
  padding: 0.25rem 0.4rem;
  background: var(--dca-raised);
  font-size: 0.74rem;
}

.dca-message-attachments > span.missing {
  border-color: rgb(224 108 130 / 45%);
  color: var(--dca-danger);
}

.dca-message-attachments > span > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-message-attachments small {
  color: var(--dca-text-muted);
  white-space: nowrap;
}

.dca-message-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.3rem;
  border-top: 1px solid var(--dca-border);
  margin-top: 0.5rem;
  padding-top: 0.4rem;
}

.dca-app .dca-message-actions button {
  min-height: 0;
  padding: 0.24rem 0.45rem;
  font-size: 0.76rem;
}

.dca-message-edit-actions {
  justify-content: flex-end;
  margin-top: 0.4rem;
}

.dca-message textarea {
  margin-top: 0.4rem;
}

@media (max-width: 720px) {
  .dca-message {
    max-width: 97%;
  }
}
</style>
