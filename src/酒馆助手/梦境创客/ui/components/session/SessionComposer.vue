<template>
  <div class="dca-composer">
    <div class="dca-composer-shell" @dragover.prevent @drop.prevent="handleDrop">
      <div v-if="attachments.length" class="dca-attachment-tray">
        <article v-for="attachment in attachments" :key="attachment.id" class="dca-attachment-chip">
          <img v-if="attachment.previewUrl" :src="attachment.previewUrl" :alt="attachment.file.name" />
          <i v-else class="fa-regular fa-file-lines" aria-hidden="true"></i>
          <div>
            <strong>{{ attachment.file.name }}</strong>
            <small>{{ formatBytes(attachment.file.size) }}</small>
          </div>
          <button
            class="dca-icon-btn"
            type="button"
            :title="`移除 ${attachment.file.name}`"
            @click="removeAttachment(attachment.id)"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </article>
      </div>

      <textarea
        v-model="message"
        rows="3"
        :disabled="!canCompose"
        :placeholder="
          isRunning
            ? '中途引导：追加到下一次工具调用后；若本轮已完成则成为下一条消息'
            : '告诉梦境创客你想怎样修改角色卡……'
        "
        @keydown="handleKeydown"
        @paste="handlePaste"
      ></textarea>

      <div class="dca-composer-footer">
        <div class="dca-composer-left">
          <input ref="fileInput" hidden multiple type="file" @change="selectFiles" />
          <input ref="imageInput" accept="image/*" hidden multiple type="file" @change="selectImages" />
          <button
            class="dca-composer-icon"
            type="button"
            :disabled="!canAddAttachments"
            title="添加文件"
            aria-label="添加文件"
            @click="fileInput?.click()"
          >
            <i class="fa-solid fa-paperclip" aria-hidden="true"></i>
          </button>
          <button
            class="dca-composer-icon"
            type="button"
            :disabled="!canAddImages"
            :title="supportsVision ? '添加图片，也可以直接粘贴' : '当前API Profile明确标记为不支持视觉'"
            aria-label="添加图片"
            @click="imageInput?.click()"
          >
            <i class="fa-regular fa-image" aria-hidden="true"></i>
          </button>
          <DcaSelect
            class="dca-composer-select dca-mode-select"
            aria-label="审批模式"
            :model-value="state.active?.mode ?? 'normal'"
            :options="approvalModeOptions"
            :disabled="isRunning || state.busy || !state.active"
            title="修改审批模式"
            @update:model-value="changeMode"
          />
          <button
            v-if="supportsWebSearch"
            class="dca-web-toggle"
            :class="{ active: state.active?.modelControls?.webSearch }"
            type="button"
            :disabled="isRunning || state.busy"
            :title="state.active?.modelControls?.webSearch ? '内置联网已开启' : '开启内置联网'"
            @click="toggleWebSearch"
          >
            <i class="fa-solid fa-globe" aria-hidden="true"></i>
            <span>联网</span>
          </button>
        </div>

        <div class="dca-composer-right">
          <button v-if="canResume" type="button" :disabled="state.busy" @click="resume">从中断处继续</button>
          <DcaSelect
            class="dca-composer-select dca-profile-select"
            aria-label="API Profile"
            :model-value="state.activeProfileId ?? ''"
            :options="profileSelectOptions"
            :disabled="isRunning || state.busy || state.profiles.length === 0"
            title="切换API Profile"
            @update:model-value="changeProfile"
          />
          <DcaSelect
            v-if="supportsReasoning"
            class="dca-composer-select dca-reasoning-select"
            aria-label="推理强度"
            :model-value="state.active?.modelControls?.reasoningEffort ?? 'auto'"
            :options="reasoningOptions"
            :disabled="isRunning || state.busy"
            title="本会话的推理强度"
            @update:model-value="changeReasoning"
          />
          <button
            class="dca-send-button"
            :class="{
              'dca-guidance-button': primaryAction === 'guidance',
              'dca-stop-button': primaryAction === 'stop',
            }"
            type="button"
            :disabled="!canUsePrimaryAction"
            :title="primaryActionLabel"
            :aria-label="primaryActionLabel"
            @click="handlePrimaryAction"
          >
            <i :class="primaryActionIcon" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
    <small class="dca-shortcut-hint">{{ shortcutHint }} · 可拖入文件或粘贴图片</small>
    <div v-if="showFullAccessWarning" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-full-access-warning" role="dialog" aria-modal="true">
        <header>
          <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
          <div>
            <strong>开启完全权限模式？</strong>
            <span>之后所有Agent工具调用都会自动放行，包括删除、覆盖和聊天操作。文件锁与只读权限仍然有效。</span>
          </div>
        </header>
        <footer>
          <button type="button" @click="showFullAccessWarning = false">取消</button>
          <button class="danger" type="button" @click="enableFullAccess">我了解风险，开启</button>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { providerAdapterCapabilities } from '../../../core/provider-probe';
import { fileToSessionAttachment, isImageAttachment, validateAttachmentFiles } from '../../../core/session/attachments';
import { formatBytes } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSelect from '../DcaSelect.vue';

type AttachmentDraft = {
  file: File;
  id: string;
  previewUrl?: string;
};

const { action, runtime, state } = useDreamCardAgent();

const message = ref('');
const attachments = ref<AttachmentDraft[]>([]);
const attachmentBusy = ref(false);
const showFullAccessWarning = ref(false);
const fileInput = ref<HTMLInputElement>();
const imageInput = ref<HTMLInputElement>();

const activeProfile = computed(() => state.value.profiles.find(profile => profile.id === state.value.activeProfileId));
const supportsWebSearch = computed(
  () =>
    Boolean(activeProfile.value) &&
    providerAdapterCapabilities(activeProfile.value!.interfaceType, activeProfile.value!.compatibilityMode)
      .nativeWebSearch &&
    activeProfile.value?.modelSettings?.capabilities.webSearch === 'enabled',
);
const supportsReasoning = computed(
  () => Boolean(activeProfile.value) && activeProfile.value?.modelSettings?.capabilities.reasoning !== 'disabled',
);
const supportsVision = computed(
  () => Boolean(activeProfile.value) && activeProfile.value?.modelSettings?.capabilities.vision !== 'disabled',
);
const reasoningEfforts = computed(() => activeProfile.value?.modelSettings?.reasoningEfforts ?? []);
const approvalModeOptions = [
  { label: '审批：手动', value: 'normal' },
  { label: '审批：YOLO', value: 'yolo' },
  { label: '审批：完全权限', value: 'full' },
];
const profileSelectOptions = computed(() => [
  { disabled: true, label: 'API Profile', value: '' },
  ...state.value.profiles.map(profile => ({ label: `API：${profile.name}`, value: profile.id })),
]);
const reasoningOptions = computed(() => [
  { label: '推理：自动', value: 'auto' },
  { label: '推理：关闭', value: 'off' },
  ...reasoningEfforts.value.map(effort => ({ label: `推理：${effort.name}`, value: effort.id })),
]);

const isRunning = computed(
  () => ['running', 'waiting-approval'].includes(state.value.active?.status ?? ''),
);
const canResume = computed(
  () => ['abnormal', 'failed', 'stopped', 'context-exhausted'].includes(state.value.active?.status ?? ''),
);
const canSend = computed(() =>
  Boolean(state.value.active && ['completed', 'idle'].includes(state.value.active.status)),
);
const canCompose = computed(() => isRunning.value || canSend.value);
const canAddAttachments = computed(() => canSend.value && !state.value.busy && !attachmentBusy.value);
const canAddImages = computed(() => canAddAttachments.value && supportsVision.value);
const canSubmit = computed(
  () =>
    (Boolean(message.value.trim()) || (!isRunning.value && attachments.value.length > 0)) &&
    !attachmentBusy.value &&
    (isRunning.value || (canSend.value && !state.value.busy)),
);
const primaryAction = computed<'guidance' | 'send' | 'stop'>(() => {
  if (!isRunning.value) return 'send';
  return message.value.trim() ? 'guidance' : 'stop';
});
const primaryActionLabel = computed(() => {
  if (primaryAction.value === 'stop') return '停止当前任务';
  if (primaryAction.value === 'guidance') return '发送中途引导';
  return '发送消息';
});
const primaryActionIcon = computed(() => {
  if (primaryAction.value === 'stop') return 'fa-solid fa-stop';
  if (primaryAction.value === 'guidance') return 'fa-solid fa-paper-plane';
  return 'fa-solid fa-arrow-up';
});
const canUsePrimaryAction = computed(() => primaryAction.value === 'stop' || canSubmit.value);
const shortcutHint = computed(() => {
  if (isRunning.value) return '运行中：发送即中途引导';
  return state.value.sendWithCtrlEnter ? 'Ctrl + Enter 发送' : 'Enter 发送 · Shift + Enter 换行';
});

async function submit() {
  const text = message.value;
  if (isRunning.value) {
    if (!text.trim()) return;
    try {
      runtime.enqueueGuidance(text);
      message.value = '';
    } catch (error) {
      toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
    }
    return;
  }
  if (!text.trim() && attachments.value.length === 0) return;
  attachmentBusy.value = true;
  let converted;
  try {
    converted = await Promise.all(attachments.value.map(attachment => fileToSessionAttachment(attachment.file)));
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
    attachmentBusy.value = false;
    return;
  }
  attachmentBusy.value = false;
  const previousAttachments = attachments.value;
  message.value = '';
  attachments.value = [];
  const succeeded = await action(() => runtime.send(text, converted));
  if (succeeded) {
    previousAttachments.forEach(revokePreview);
  } else {
    message.value = text;
    attachments.value = previousAttachments;
  }
}

function handlePrimaryAction() {
  if (primaryAction.value === 'stop') {
    stop();
    return;
  }
  void submit();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.key !== 'Enter') return;
  const shouldSend = state.value.sendWithCtrlEnter
    ? (event.ctrlKey || event.metaKey) && !event.shiftKey
    : !event.shiftKey;
  if (!shouldSend) return;
  event.preventDefault();
  void submit();
}

function handlePaste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length === 0) return;
  event.preventDefault();
  addFiles(files);
}

function handleDrop(event: DragEvent) {
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length > 0) addFiles(files);
}

function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  addFiles([...(input.files ?? [])]);
  input.value = '';
}

function selectImages(event: Event) {
  const input = event.target as HTMLInputElement;
  addFiles([...(input.files ?? [])].filter(file => isImageAttachment({ mediaType: file.type })));
  input.value = '';
}

function addFiles(files: File[]) {
  if (!canAddAttachments.value) return;
  const unsupportedImage = files.find(file => isImageAttachment({ mediaType: file.type })) && !supportsVision.value;
  if (unsupportedImage) {
    toastr.error('当前API Profile明确标记为不支持视觉，无法添加图片。', '梦境创客');
    return;
  }
  try {
    validateAttachmentFiles([...attachments.value.map(item => item.file), ...files]);
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
    return;
  }
  attachments.value = [
    ...attachments.value,
    ...files.map(file => ({
      file,
      id: crypto.randomUUID(),
      previewUrl:
        isImageAttachment({ mediaType: file.type }) && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(file)
          : undefined,
    })),
  ];
}

function removeAttachment(id: string) {
  const attachment = attachments.value.find(item => item.id === id);
  if (attachment) revokePreview(attachment);
  attachments.value = attachments.value.filter(item => item.id !== id);
}

function revokePreview(attachment: AttachmentDraft) {
  if (attachment.previewUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(attachment.previewUrl);
}

async function resume() {
  await action(() => runtime.resume());
}

async function toggleWebSearch() {
  await action(() => runtime.setModelControls({ webSearch: !state.value.active?.modelControls?.webSearch }));
}

async function changeReasoning(reasoningEffort: string) {
  await action(() => runtime.setModelControls({ reasoningEffort }));
}

async function changeProfile(id: string) {
  if (id) await action(() => runtime.selectProfile(id));
}

async function changeMode(mode: string) {
  if (mode === 'full') {
    showFullAccessWarning.value = true;
    return;
  }
  await action(() => runtime.setMode(mode === 'yolo' ? 'yolo' : 'normal'));
}

async function enableFullAccess() {
  const succeeded = await action(() => runtime.setMode('full'));
  if (succeeded) showFullAccessWarning.value = false;
}

function stop() {
  runtime.stop();
}

onBeforeUnmount(() => attachments.value.forEach(revokePreview));
</script>

<style lang="scss">
.dca-composer {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.3rem;
  border-top: 1px solid var(--dca-border);
  padding: 0.65rem 0.75rem 0.55rem;
  background: var(--dca-surface);
}

.dca-composer-shell {
  display: flex;
  width: min(56rem, 100%);
  flex-direction: column;
  gap: 0.3rem;
  align-self: center;
  border: 1px solid var(--dca-border-strong);
  border-radius: 1rem;
  padding: 0.45rem;
  background: var(--dca-canvas);
  box-shadow: var(--dca-shadow-1);
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.dca-composer-shell:focus-within {
  border-color: color-mix(in srgb, var(--dca-accent) 65%, transparent);
  box-shadow: 0 0 0 2px var(--dca-focus-ring);
}

.dca-app .dca-composer-shell textarea {
  width: 100%;
  min-height: 4.6rem;
  border: 0;
  padding: 0.45rem 0.55rem;
  background: transparent;
  box-shadow: none;
  resize: none;
}

.dca-app .dca-composer-shell textarea:focus {
  box-shadow: none;
}

.dca-attachment-tray {
  display: flex;
  gap: 0.4rem;
  padding: 0.15rem;
  overflow-x: auto;
}

.dca-attachment-chip {
  display: grid;
  min-width: 10rem;
  max-width: 15rem;
  grid-template-columns: 2.2rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.28rem;
  background: var(--dca-raised);
}

.dca-attachment-chip > img,
.dca-attachment-chip > i {
  width: 2.2rem;
  height: 2.2rem;
  border-radius: var(--dca-radius-sm);
  object-fit: cover;
}

.dca-attachment-chip > i {
  display: grid;
  place-items: center;
  background: var(--dca-accent-soft);
  color: var(--dca-accent);
}

.dca-attachment-chip > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dca-attachment-chip strong,
.dca-attachment-chip small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-attachment-chip strong {
  font-size: 0.76rem;
}

.dca-attachment-chip small {
  color: var(--dca-text-muted);
  font-size: 0.68rem;
}

.dca-composer-footer,
.dca-composer-left,
.dca-composer-right {
  display: flex;
  align-items: center;
}

.dca-composer-footer {
  justify-content: space-between;
  gap: 0.5rem;
}

.dca-composer-left,
.dca-composer-right {
  min-width: 0;
  gap: 0.25rem;
}

.dca-composer-right {
  justify-content: flex-end;
}

.dca-app .dca-composer-icon,
.dca-app .dca-send-button {
  display: grid;
  width: 2rem;
  min-width: 2rem;
  height: 2rem;
  min-height: 2rem;
  place-items: center;
  border-color: transparent;
  border-radius: 999px;
  padding: 0;
  background: transparent;
  color: var(--dca-text-secondary);
}

.dca-app .dca-composer-icon:hover:not(:disabled) {
  background: var(--dca-raised);
}

.dca-app .dca-send-button {
  background: var(--dca-text);
  color: var(--dca-canvas);
}

.dca-app .dca-send-button:hover:not(:disabled) {
  background: var(--dca-accent);
  color: white;
}

.dca-app button.dca-send-button.dca-guidance-button {
  background: var(--dca-accent);
  color: var(--dca-on-accent);
  box-shadow: 0 0 0 3px var(--dca-accent-soft);
}

.dca-app button.dca-send-button.dca-guidance-button:hover:not(:disabled) {
  background: var(--dca-accent-strong);
  color: var(--dca-canvas);
}

.dca-app button.dca-send-button.dca-stop-button {
  background: var(--dca-danger);
  color: var(--dca-on-accent);
  box-shadow: 0 0 0 3px var(--dca-danger-soft);
}

.dca-app button.dca-send-button.dca-stop-button:hover:not(:disabled) {
  background: var(--dca-danger);
  color: var(--dca-on-danger);
}

.dca-composer-select {
  width: auto;
  min-width: 6.6rem;
}

.dca-app .dca-composer-select .dca-select-trigger {
  min-height: 1.95rem;
  border-color: transparent;
  padding: 0.15rem 0.42rem;
  background: transparent;
  color: var(--dca-text-secondary);
  font-size: 0.72rem;
}

.dca-profile-select {
  width: min(12rem, 24vw);
  max-width: 12rem;
}

.dca-app .dca-web-toggle {
  display: flex;
  min-height: 1.85rem;
  align-items: center;
  gap: 0.3rem;
  border-color: transparent;
  padding: 0.2rem 0.42rem;
  background: transparent;
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}

.dca-app .dca-web-toggle.active {
  border-color: color-mix(in srgb, var(--dca-accent) 45%, transparent);
  background: var(--dca-accent-soft);
  color: var(--dca-accent);
}

.dca-shortcut-hint {
  width: min(56rem, 100%);
  align-self: center;
  padding: 0 0.35rem;
  color: var(--dca-text-muted);
  font-size: 0.68rem;
  text-align: right;
}

@media (max-width: 760px) {
  .dca-composer-footer {
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .dca-composer-left,
  .dca-composer-right {
    width: 100%;
    flex-wrap: wrap;
  }

  .dca-composer-right {
    justify-content: flex-end;
  }

  .dca-profile-select {
    width: min(8.5rem, 34vw);
    max-width: 8.5rem;
  }

  .dca-web-toggle span,
  .dca-shortcut-hint {
    display: none;
  }
}
</style>
