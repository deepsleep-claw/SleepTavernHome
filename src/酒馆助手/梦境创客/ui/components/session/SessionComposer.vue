<template>
  <div class="dca-composer">
    <div ref="composerShell" class="dca-composer-shell" :class="{ compact }" @dragover.prevent @drop.prevent="handleDrop">
      <div v-if="attachments.length" class="dca-attachment-tray">
        <article v-for="attachment in attachments" :key="attachment.id" class="dca-attachment-chip">
          <img v-if="attachment.previewUrl" :src="attachment.previewUrl" :alt="attachment.file.name" />
          <i v-else class="fa-regular fa-file-lines" aria-hidden="true"></i>
          <div><strong>{{ attachment.file.name }}</strong><small>{{ formatBytes(attachment.file.size) }}</small></div>
          <button class="dca-icon-btn" type="button" :title="`移除 ${attachment.file.name}`" @click="removeAttachment(attachment.id)"><i class="fa-solid fa-xmark"></i></button>
        </article>
      </div>

      <div v-if="compact" class="dca-composer-control-strip">
        <SessionModelMenu />
        <DcaSelect class="dca-composer-select dca-mode-select" aria-label="审批模式" :model-value="state.approvalMode ?? state.active?.mode ?? 'normal'" :options="approvalModeOptions" title="审批模式" @update:model-value="changeMode" />
        <button v-if="supportsWebSearch" class="dca-web-toggle" :class="{ active: state.active?.modelControls?.webSearch }" type="button" @click="toggleWebSearch"><i class="fa-solid fa-globe"></i><span>联网</span></button>
        <button v-if="canResume" type="button" :disabled="state.busy" @click="resume">继续</button>
      </div>

      <div :class="compact ? 'dca-compact-input-row' : 'dca-desktop-input'">
        <div v-if="compact" class="dca-plus-wrap">
          <button class="dca-composer-icon" type="button" :disabled="!canAddAttachments" title="添加附件" @click="plusOpen = !plusOpen"><i class="fa-solid fa-plus"></i></button>
          <div v-if="plusOpen" class="dca-plus-menu">
            <button type="button" :disabled="!canAddAttachments" @click="openFilePicker"><i class="fa-solid fa-paperclip"></i><span>添加文件</span></button>
            <button type="button" :disabled="!canAddImages" @click="openImagePicker"><i class="fa-regular fa-image"></i><span>添加图片</span></button>
          </div>
        </div>
        <textarea
          v-model="message"
          rows="3"
          :disabled="!canCompose"
          :placeholder="isRunning ? '中途引导：补充当前目标' : '告诉梦境创客你想怎样修改角色卡……'"
          @keydown="handleKeydown"
          @paste="handlePaste"
        ></textarea>
        <button v-if="compact" class="dca-send-button" :class="actionClasses" type="button" :disabled="!canUsePrimaryAction" :title="primaryActionLabel" :aria-label="primaryActionLabel" @click="handlePrimaryAction"><i :class="primaryActionIcon"></i></button>
      </div>

      <div v-if="!compact" class="dca-composer-footer">
        <div class="dca-composer-left">
          <button class="dca-composer-icon" type="button" :disabled="!canAddAttachments" title="添加文件" @click="openFilePicker"><i class="fa-solid fa-paperclip"></i></button>
          <button class="dca-composer-icon" type="button" :disabled="!canAddImages" :title="supportsVision ? '添加图片，也可以直接粘贴' : '当前模型不支持视觉'" @click="openImagePicker"><i class="fa-regular fa-image"></i></button>
          <DcaSelect class="dca-composer-select dca-mode-select" aria-label="审批模式" :model-value="state.approvalMode ?? state.active?.mode ?? 'normal'" :options="approvalModeOptions" title="审批模式" @update:model-value="changeMode" />
          <button v-if="supportsWebSearch" class="dca-web-toggle" :class="{ active: state.active?.modelControls?.webSearch }" type="button" @click="toggleWebSearch"><i class="fa-solid fa-globe"></i><span>联网</span></button>
        </div>
        <div class="dca-composer-right">
          <button v-if="canResume" type="button" :disabled="state.busy" @click="resume">从中断处继续</button>
          <SessionModelMenu />
          <button class="dca-send-button" :class="actionClasses" type="button" :disabled="!canUsePrimaryAction" :title="primaryActionLabel" :aria-label="primaryActionLabel" @click="handlePrimaryAction"><i :class="primaryActionIcon"></i></button>
        </div>
      </div>
      <input ref="fileInput" hidden multiple type="file" @change="selectFiles" />
      <input ref="imageInput" accept="image/*" hidden multiple type="file" @change="selectImages" />
    </div>
    <small class="dca-shortcut-hint">{{ shortcutHint }} · 可拖入文件或粘贴图片</small>

    <div v-if="showFullAccessWarning" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-full-access-warning" role="dialog" aria-modal="true">
        <header><i class="fa-solid fa-shield-halved"></i><div><strong>开启完全权限模式？</strong><span>之后所有工具调用都会自动放行，包括删除、覆盖和聊天操作。文件锁与只读权限仍然有效。</span></div></header>
        <footer><button type="button" @click="showFullAccessWarning = false">取消</button><button class="danger" type="button" @click="enableFullAccess">我了解风险，开启</button></footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { providerAdapterCapabilities } from '../../../core/provider-probe';
import { findSelectedModel } from '../../../core/provider/provider-config';
import { fileToSessionAttachment, isImageAttachment, validateAttachmentFiles } from '../../../core/session/attachments';
import { formatBytes } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSelect from '../DcaSelect.vue';
import SessionModelMenu from './SessionModelMenu.vue';

type AttachmentDraft = { file: File; id: string; previewUrl?: string };
const { action, runtime, state } = useDreamCardAgent();
const message = ref('');
const attachments = ref<AttachmentDraft[]>([]);
const attachmentBusy = ref(false);
const showFullAccessWarning = ref(false);
const plusOpen = ref(false);
const compact = ref(false);
const composerShell = ref<HTMLElement>();
const fileInput = ref<HTMLInputElement>();
const imageInput = ref<HTMLInputElement>();
let resizeObserver: ResizeObserver | undefined;

const selected = computed(() => findSelectedModel(state.value.providers ?? [], state.value.active?.modelSelection));
const selectedModel = computed(() => selected.value?.model);
const selectedProvider = computed(() => selected.value?.provider);
const adapterCapabilities = computed(() => selected.value ? providerAdapterCapabilities(selectedProvider.value!.interfaceType, selectedModel.value!.compatibilityMode) : undefined);
const supportsWebSearch = computed(() => Boolean(selectedModel.value && adapterCapabilities.value?.nativeWebSearch && selectedModel.value.modelSettings.capabilities.webSearch !== 'disabled'));
const supportsVision = computed(() => Boolean(selectedModel.value && selectedModel.value.modelSettings.capabilities.vision !== 'disabled'));
const approvalModeOptions = [
  { label: '审批：手动', value: 'normal' }, { label: '审批：YOLO', value: 'yolo' }, { label: '审批：完全权限', value: 'full' },
];
const isRunning = computed(() => ['running', 'waiting-approval'].includes(state.value.active?.status ?? ''));
const canResume = computed(() => ['abnormal', 'failed', 'stopped', 'context-exhausted'].includes(state.value.active?.status ?? ''));
const canSend = computed(() => Boolean(state.value.active && ['completed', 'idle'].includes(state.value.active.status)));
const canCompose = computed(() => isRunning.value || canSend.value);
const canAddAttachments = computed(() => canSend.value && !state.value.busy && !attachmentBusy.value);
const canAddImages = computed(() => canAddAttachments.value && supportsVision.value);
const canSubmit = computed(() => (Boolean(message.value.trim()) || (!isRunning.value && attachments.value.length > 0)) && !attachmentBusy.value && (isRunning.value || (canSend.value && !state.value.busy)));
const primaryAction = computed<'guidance' | 'send' | 'stop'>(() => !isRunning.value ? 'send' : message.value.trim() ? 'guidance' : 'stop');
const primaryActionLabel = computed(() => primaryAction.value === 'stop' ? '停止当前任务' : primaryAction.value === 'guidance' ? '发送中途引导' : '发送消息');
const primaryActionIcon = computed(() => primaryAction.value === 'stop' ? 'fa-solid fa-stop' : primaryAction.value === 'guidance' ? 'fa-solid fa-paper-plane' : 'fa-solid fa-arrow-up');
const actionClasses = computed(() => ({ 'dca-guidance-button': primaryAction.value === 'guidance', 'dca-stop-button': primaryAction.value === 'stop' }));
const canUsePrimaryAction = computed(() => primaryAction.value === 'stop' || canSubmit.value);
const shortcutHint = computed(() => isRunning.value ? '运行中：发送即中途引导' : state.value.sendWithCtrlEnter ? 'Ctrl + Enter 发送' : 'Enter 发送 · Shift + Enter 换行');

async function submit() {
  const text = message.value;
  if (isRunning.value) {
    if (!text.trim()) return;
    try { runtime.enqueueGuidance(text); message.value = ''; }
    catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '梦境创客'); }
    return;
  }
  if (!text.trim() && attachments.value.length === 0) return;
  attachmentBusy.value = true;
  let converted;
  try { converted = await Promise.all(attachments.value.map(item => fileToSessionAttachment(item.file))); }
  catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '梦境创客'); attachmentBusy.value = false; return; }
  attachmentBusy.value = false;
  const previous = attachments.value; message.value = ''; attachments.value = [];
  const succeeded = await action(() => runtime.send(text, converted));
  if (succeeded) previous.forEach(revokePreview); else { message.value = text; attachments.value = previous; }
}
function handlePrimaryAction() { if (primaryAction.value === 'stop') runtime.stop(); else void submit(); }
function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.key !== 'Enter') return;
  const shouldSend = state.value.sendWithCtrlEnter ? (event.ctrlKey || event.metaKey) && !event.shiftKey : !event.shiftKey;
  if (shouldSend) { event.preventDefault(); void submit(); }
}
function handlePaste(event: ClipboardEvent) { const files = [...(event.clipboardData?.files ?? [])]; if (files.length) { event.preventDefault(); addFiles(files); } }
function handleDrop(event: DragEvent) { const files = [...(event.dataTransfer?.files ?? [])]; if (files.length) addFiles(files); }
function selectFiles(event: Event) { const input = event.target as HTMLInputElement; addFiles([...(input.files ?? [])]); input.value = ''; }
function selectImages(event: Event) { const input = event.target as HTMLInputElement; addFiles([...(input.files ?? [])].filter(file => isImageAttachment({ mediaType: file.type }))); input.value = ''; }
function openFilePicker() { plusOpen.value = false; fileInput.value?.click(); }
function openImagePicker() { plusOpen.value = false; imageInput.value?.click(); }
function addFiles(files: File[]) {
  if (!canAddAttachments.value) return;
  if (files.some(file => isImageAttachment({ mediaType: file.type })) && !supportsVision.value) { toastr.error('当前模型不支持视觉，无法添加图片。', '梦境创客'); return; }
  try { validateAttachmentFiles([...attachments.value.map(item => item.file), ...files]); }
  catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '梦境创客'); return; }
  attachments.value = [...attachments.value, ...files.map(file => ({
    file, id: crypto.randomUUID(), previewUrl: isImageAttachment({ mediaType: file.type }) && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
  }))];
}
function removeAttachment(id: string) { const item = attachments.value.find(value => value.id === id); if (item) revokePreview(item); attachments.value = attachments.value.filter(value => value.id !== id); }
function revokePreview(item: AttachmentDraft) { if (item.previewUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(item.previewUrl); }
async function resume() { await action(() => runtime.resume()); }
async function toggleWebSearch() { await action(() => runtime.setModelControls({ webSearch: !state.value.active?.modelControls?.webSearch })); }
async function changeMode(mode: string) { if (mode === 'full') { showFullAccessWarning.value = true; return; } await action(() => runtime.setMode(mode === 'yolo' ? 'yolo' : 'normal')); }
async function enableFullAccess() { if (await action(() => runtime.setMode('full'))) showFullAccessWarning.value = false; }

onMounted(() => {
  if (!composerShell.value) return;
  resizeObserver = new ResizeObserver(entries => { compact.value = (entries[0]?.contentRect.width ?? 1000) < 680; });
  resizeObserver.observe(composerShell.value);
});
onBeforeUnmount(() => { resizeObserver?.disconnect(); attachments.value.forEach(revokePreview); });
</script>

<style lang="scss">
.dca-composer { display: flex; flex: 0 0 auto; flex-direction: column; gap: .3rem; border-top: 1px solid var(--dca-border); padding: .65rem .75rem .55rem; background: var(--dca-surface); }
.dca-composer-shell { display: flex; width: min(56rem, 100%); flex-direction: column; gap: .3rem; align-self: center; border: 1px solid var(--dca-border-strong); border-radius: 1rem; padding: .45rem; background: var(--dca-canvas); box-shadow: var(--dca-shadow-1); }
.dca-composer-shell:focus-within { border-color: color-mix(in srgb, var(--dca-accent) 65%, transparent); box-shadow: 0 0 0 2px var(--dca-focus-ring); }
.dca-desktop-input textarea, .dca-compact-input-row textarea { width: 100%; min-height: 4.6rem; border: 0; padding: .45rem .55rem; background: transparent; box-shadow: none; resize: none; }
.dca-compact-input-row { display: grid; grid-template-columns: 2.1rem minmax(0, 1fr) 2.1rem; align-items: end; gap: .3rem; }
.dca-compact-input-row textarea { min-height: 3.2rem; }
.dca-composer-control-strip { display: flex; min-width: 0; align-items: center; gap: .25rem; overflow-x: auto; padding: .05rem; }
.dca-composer-control-strip > * { flex: 0 0 auto; }
.dca-attachment-tray { display: flex; gap: .4rem; padding: .15rem; overflow-x: auto; }
.dca-attachment-chip { display: grid; min-width: 10rem; max-width: 15rem; grid-template-columns: 2.2rem minmax(0, 1fr) auto; align-items: center; gap: .4rem; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-md); padding: .28rem; background: var(--dca-raised); }
.dca-attachment-chip > img, .dca-attachment-chip > i { width: 2.2rem; height: 2.2rem; border-radius: var(--dca-radius-sm); object-fit: cover; }
.dca-attachment-chip > i { display: grid; place-items: center; background: var(--dca-accent-soft); color: var(--dca-accent); }
.dca-attachment-chip > div { display: flex; min-width: 0; flex-direction: column; }
.dca-attachment-chip strong, .dca-attachment-chip small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dca-attachment-chip strong { font-size: .76rem; }.dca-attachment-chip small { color: var(--dca-text-muted); font-size: .68rem; }
.dca-composer-footer, .dca-composer-left, .dca-composer-right { display: flex; align-items: center; }
.dca-composer-footer { justify-content: space-between; gap: .5rem; }.dca-composer-left, .dca-composer-right { min-width: 0; gap: .25rem; }.dca-composer-right { justify-content: flex-end; }
.dca-app .dca-composer-icon, .dca-app .dca-send-button { display: grid; width: 2rem; min-width: 2rem; height: 2rem; min-height: 2rem; place-items: center; border-color: transparent; border-radius: var(--dca-radius-md); padding: 0; background: transparent; color: var(--dca-text-secondary); }
.dca-app .dca-composer-icon:hover:not(:disabled) { background: var(--dca-raised); }
.dca-app .dca-send-button { background: var(--dca-text); color: var(--dca-canvas); }.dca-app .dca-send-button:hover:not(:disabled) { background: var(--dca-accent); color: white; }
.dca-app .dca-send-button.dca-guidance-button { background: var(--dca-accent); color: var(--dca-on-accent); box-shadow: 0 0 0 3px var(--dca-accent-soft); }
.dca-app .dca-send-button.dca-stop-button { background: var(--dca-danger); color: var(--dca-on-accent); box-shadow: 0 0 0 3px var(--dca-danger-soft); }
.dca-composer-select { width: auto; min-width: 6.6rem; }.dca-app .dca-composer-select .dca-select-trigger { min-height: 1.95rem; border-color: transparent; padding: .15rem .42rem; background: transparent; color: var(--dca-text-secondary); font-size: .72rem; }
.dca-app .dca-web-toggle { display: flex; min-height: 1.9rem; align-items: center; gap: .3rem; border-color: transparent; border-radius: var(--dca-radius-md); padding: .2rem .42rem; background: transparent; color: var(--dca-text-muted); font-size: .72rem; }.dca-app .dca-web-toggle.active { border-color: color-mix(in srgb, var(--dca-accent) 45%, transparent); background: var(--dca-accent-soft); color: var(--dca-accent); }
.dca-plus-wrap { position: relative; }.dca-plus-menu { position: absolute; z-index: 20; bottom: 2.5rem; left: 0; display: flex; width: 11rem; flex-direction: column; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-md); padding: .3rem; background: var(--dca-surface); box-shadow: var(--dca-shadow-2); }.dca-plus-menu button { display: flex; align-items: center; gap: .5rem; border-color: transparent; background: transparent; text-align: left; }
.dca-shortcut-hint { width: min(56rem, 100%); align-self: center; padding: 0 .35rem; color: var(--dca-text-muted); font-size: .68rem; text-align: right; }
@media (max-width: 720px) { .dca-composer { padding: .45rem max(.45rem, env(safe-area-inset-right)) max(.4rem, env(safe-area-inset-bottom)) max(.45rem, env(safe-area-inset-left)); }.dca-composer-shell { border-radius: var(--dca-radius-lg); }.dca-shortcut-hint { display: none; } }
</style>
