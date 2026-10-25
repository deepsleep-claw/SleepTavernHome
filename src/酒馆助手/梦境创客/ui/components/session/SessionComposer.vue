<template>
  <div ref="composerRoot" class="dca-composer" @focusout="handleFocusOut">
    <div v-if="shortcut" ref="shortcutMenu" class="dca-shortcut-anchor">
      <ComposerSuggestionPanel
        :items="shortcutItems"
        :selected-index="shortcutIndex"
        :category="referenceCategory"
        :references="shortcut.kind === 'reference'"
        :heading="shortcut.command?.usage ?? '选择指令'"
        :height="shortcutHeight"
        :list-id="suggestionId"
        @select="selectShortcut"
        @category="selectReferenceCategory"
      />
    </div>
    <div
      ref="composerShell"
      class="dca-composer-shell"
      :class="{ compact }"
      @dragover.prevent
      @drop.prevent="handleDrop"
    >
      <div v-if="attachments.length" class="dca-attachment-tray">
        <article v-for="attachment in attachments" :key="attachment.id" class="dca-attachment-chip">
          <img v-if="previewUrl(attachment)" :src="previewUrl(attachment)" :alt="attachment.file.name" />
          <i v-else class="fa-regular fa-file-lines" aria-hidden="true"></i>
          <div>
            <strong>{{ attachment.file.name }}</strong
            ><small>{{ formatBytes(attachment.file.size) }}</small>
          </div>
          <button
            class="dca-icon-btn"
            type="button"
            :title="`移除 ${attachment.file.name}`"
            @click="removeAttachment(attachment.id)"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </article>
      </div>

      <div v-if="compact" class="dca-composer-control-strip">
        <SessionModelMenu mode="combined" />
        <DcaSelect
          class="dca-composer-select dca-mode-select"
          aria-label="审批模式"
          :model-value="state.active?.mode ?? state.approvalMode ?? 'normal'"
          :options="approvalModeOptions"
          title="审批模式"
          @update:model-value="changeMode"
        />
        <button v-if="canResume" type="button" :disabled="state.busy" @click="resume">继续</button>
      </div>

      <div :class="compact ? 'dca-compact-input-row' : 'dca-desktop-input'">
        <div v-if="compact" class="dca-compact-left-controls">
          <button
            v-if="supportsWebSearch"
            class="dca-composer-icon dca-compact-web-toggle"
            :class="{ active: state.active?.modelControls?.webSearch }"
            type="button"
            title="切换联网搜索"
            @click="toggleWebSearch"
          >
            <i class="fa-solid fa-globe"></i>
          </button>
          <div class="dca-plus-wrap">
            <button class="dca-composer-icon" type="button" title="更多选项" @click="togglePlusMenu">
              <i class="fa-solid fa-plus"></i>
            </button>
            <WorkspaceMenu
              :open="plusOpen"
              :title="plusLevel === 'agent' ? '选择 Agent' : plusLevel === 'approval' ? '审批模式' : '更多操作'"
              :can-back="plusLevel !== 'root'"
              panel-class="dca-plus-menu"
              @close="plusOpen = false"
              @back="plusLevel = 'root'"
            >
              <template v-if="plusLevel === 'root'">
                <button type="button" @click="openShortcut('command')"><span>/</span><span>选择指令</span></button>
                <button type="button" @click="openShortcut('reference')"><span>@</span><span>引用内容</span></button>
                <button type="button" :disabled="!canAddAttachments" @click="openFilePicker">
                  <i class="fa-solid fa-paperclip"></i><span>添加文件</span>
                </button>
                <button type="button" :disabled="!canAddImages" @click="openImagePicker">
                  <i class="fa-regular fa-image"></i><span>添加图片</span>
                </button>
                <button type="button" @click="openCompactModelMenu">
                  <i class="fa-solid fa-microchip"></i><span>模型与推理</span>
                </button>
                <button type="button" @click="plusLevel = 'agent'">
                  <i class="fa-solid fa-robot"></i><span>选择 Agent</span>
                </button>
                <button type="button" @click="plusLevel = 'approval'">
                  <i class="fa-solid fa-shield-halved"></i><span>审批模式</span
                  ><small>{{ currentApprovalLabel }}</small>
                </button>
                <button v-if="supportsWebSearch" type="button" @click="toggleWebSearchFromMenu">
                  <i class="fa-solid fa-globe"></i
                  ><span>{{ state.active?.modelControls?.webSearch ? '关闭联网' : '开启联网' }}</span>
                </button>
              </template>
              <template v-else>
                <button type="button" @click="plusLevel = 'root'">
                  <i class="fa-solid fa-arrow-left"></i><span>返回</span>
                </button>
                <SessionAgentPicker v-if="plusLevel === 'agent'" mode="menu" @picked="plusOpen = false" />
                <template v-else>
                  <button
                    v-for="option in approvalModeOptions"
                    :key="option.value"
                    type="button"
                    :class="{ active: option.value === (state.active?.mode ?? state.approvalMode ?? 'normal') }"
                    @click="changeModeFromMenu(option.value)"
                  >
                    <i
                      class="fa-solid fa-check"
                      :class="{ invisible: option.value !== (state.active?.mode ?? state.approvalMode ?? 'normal') }"
                    ></i>
                    <span>{{ option.label }}</span>
                  </button>
                </template>
              </template>
            </WorkspaceMenu>
          </div>
        </div>
        <textarea
          ref="messageInput"
          v-model="message"
          :rows="compact ? 2 : 3"
          aria-label="消息输入"
          :enterkeyhint="mobileTextInput ? 'enter' : 'send'"
          aria-autocomplete="list"
          :aria-expanded="Boolean(shortcut)"
          :aria-controls="shortcut ? suggestionId : undefined"
          :aria-activedescendant="shortcutItems[shortcutIndex] ? `${suggestionId}-${shortcutIndex}` : undefined"
          :disabled="!canCompose || !draftReady"
          :placeholder="
            isRunning
              ? '补充、纠正或调整当前任务……'
              : canResume
                ? '发送新要求保留已有修改，或点击继续恢复原任务……'
                : '告诉梦境创客你想做什么……'
          "
          @keydown="handleKeydown"
          @compositionstart="composing = true"
          @compositionend="composing = false"
          @input="updateShortcut"
          @click="updateShortcut"
          @keyup.left="updateShortcut"
          @keyup.right="updateShortcut"
          @paste="handlePaste"
        ></textarea>
        <button
          v-if="compact"
          class="dca-send-button"
          :class="actionClasses"
          type="button"
          :disabled="!canUsePrimaryAction"
          :title="primaryActionLabel"
          :aria-label="primaryActionLabel"
          @click="handlePrimaryAction"
        >
          <i :class="primaryActionIcon"></i>
        </button>
      </div>
      <SessionModelMenu v-if="compact" v-model:open="compactModelOpen" hide-trigger mode="combined" />

      <div v-if="!compact" class="dca-composer-footer">
        <div class="dca-composer-left">
          <button
            class="dca-composer-icon"
            type="button"
            :disabled="!canAddAttachments"
            title="添加文件"
            @click="openFilePicker"
          >
            <i class="fa-solid fa-paperclip"></i>
          </button>
          <button
            class="dca-composer-icon"
            type="button"
            :disabled="!canAddImages"
            :title="supportsVision ? '添加图片，也可以直接粘贴' : '当前模型不支持视觉'"
            @click="openImagePicker"
          >
            <i class="fa-regular fa-image"></i>
          </button>
          <DcaSelect
            class="dca-composer-select dca-mode-select"
            aria-label="审批模式"
            :model-value="state.active?.mode ?? state.approvalMode ?? 'normal'"
            :options="approvalModeOptions"
            title="审批模式"
            @update:model-value="changeMode"
          />
          <button
            v-if="supportsWebSearch"
            class="dca-web-toggle"
            :class="{ active: state.active?.modelControls?.webSearch }"
            type="button"
            @click="toggleWebSearch"
          >
            <i class="fa-solid fa-globe"></i><span>联网</span>
          </button>
        </div>
        <div class="dca-composer-right">
          <button v-if="canResume" type="button" :disabled="state.busy" @click="resume">从中断处继续</button>
          <SessionModelMenu mode="model" />
          <SessionModelMenu v-if="supportsReasoning" mode="reasoning" />
          <button
            class="dca-send-button"
            :class="actionClasses"
            type="button"
            :disabled="!canUsePrimaryAction"
            :title="primaryActionLabel"
            :aria-label="primaryActionLabel"
            @click="handlePrimaryAction"
          >
            <i :class="primaryActionIcon"></i>
          </button>
        </div>
      </div>
      <input ref="fileInput" hidden multiple type="file" @change="selectFiles" />
      <button
        v-if="isRunning && message.trim()"
        class="dca-independent-stop"
        type="button"
        aria-label="停止当前任务"
        @click="runtime.stop()"
      >
        停止当前任务
      </button>
      <input ref="imageInput" accept="image/*" hidden multiple type="file" @change="selectImages" />
    </div>
    <small class="dca-shortcut-hint">{{ shortcutHint }} · / 指令 · @ 分类引用</small>
    <ComposerHelpDialog v-if="helpOpen" @close="closeHelp" @choose="insertCommand" />

    <WorkspaceMenu
      :open="showFullAccessWarning"
      title="开启完全权限模式？"
      panel-class="dca-modal dca-full-access-warning"
      backdrop-class="dca-modal-backdrop"
      @close="showFullAccessWarning = false"
    >
      <header>
        <i class="fa-solid fa-shield-halved"></i>
        <div>
          <strong>开启完全权限模式？</strong
          ><span>之后所有工具调用都会自动放行，包括删除、覆盖和聊天操作。文件锁与只读权限仍然有效。</span>
        </div>
      </header>
      <footer>
        <button type="button" @click="showFullAccessWarning = false">取消</button
        ><button class="danger" type="button" @click="enableFullAccess">我了解风险，开启</button>
      </footer>
    </WorkspaceMenu>
  </div>
</template>

<script setup lang="ts">
import { notify } from '../../composables/notifications';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { providerAdapterCapabilities } from '../../../core/provider-probe';
import { findSelectedModel } from '../../../core/provider/provider-config';
import { fileToSessionAttachment, isImageAttachment, validateAttachmentFiles } from '../../../core/session/attachments';
import { formatBytes } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';
import { useStoredDraft } from '../../composables/stored-draft';
import { useMobileTextInput } from '../../composables/mobile-input';
import { useBackLayer } from '../../composables/workspace-navigation';
import WorkspaceMenu from '../WorkspaceMenu.vue';
import { useComposerSubmission } from '../../composables/composer-submission';
import { composerShortcut } from '../../composables/composer-shortcuts';
import {
  composerCommandContext,
  createComposerSuggestionSource,
  type ComposerSuggestion,
} from '../../composables/composer-catalog';
import {
  assertCommandArguments,
  commandDisabledReason,
  parseComposerCommand,
  type ComposerCommandId,
} from '../../../core/session/composer-commands';
import { REFERENCE_CATEGORIES, type ReferenceCategory } from '../../../core/session/composer-references';
import ComposerSuggestionPanel from './ComposerSuggestionPanel.vue';
import ComposerHelpDialog from './ComposerHelpDialog.vue';
import DcaSelect from '../DcaSelect.vue';
import SessionModelMenu from './SessionModelMenu.vue';
import SessionAgentPicker from './SessionAgentPicker.vue';

type AttachmentDraft = { file: File; id: string };
const previews = new Map<string, string>();
const { action, runtime, state, sidebarCollapsed, sidebarFocus } = useDreamCardAgent();
const composerRoot = ref<HTMLElement>();
const suggestionId = `dca-composer-${useId()}`;
const helpOpen = ref(false);
const {
  draft,
  ready: draftReady,
  capture: captureDraft,
} = useStoredDraft<{ message: string; attachments: AttachmentDraft[] }>(
  () => (state.value.active?.sessionId ? `composer:${state.value.active.sessionId}` : ''),
  () => ({ message: '', attachments: [] }),
);
const submission = useComposerSubmission(runtime, () => state.value.active?.sessionId ?? '');
const { pending: submissionPending } = submission;
const composing = ref(false);
const message = computed({
  get: () => draft.value.message,
  set: value => {
    draft.value = { ...draft.value, message: value };
  },
});
const attachments = computed({
  get: () => draft.value.attachments,
  set: value => {
    draft.value = { ...draft.value, attachments: value };
  },
});
const messageInput = ref<HTMLTextAreaElement>();
const shortcutMenu = ref<HTMLElement>();
const shortcutHeight = ref(256);
const caret = ref(0);
const shortcutsDismissed = ref(false);
const shortcutIndex = ref(0);
const referenceCategory = ref<ReferenceCategory | 'all'>('all');
const shortcut = computed(() => (shortcutsDismissed.value ? undefined : composerShortcut(message.value, caret.value)));
const suggestionSource = createComposerSuggestionSource();
const candidates = computed(() => (shortcut.value ? suggestionSource(shortcut.value, state.value) : []));
const shortcutItems = computed(() => {
  const current = shortcut.value;
  if (!current) return [];
  if (current.kind === 'reference')
    return REFERENCE_CATEGORIES.filter(
      category => referenceCategory.value === 'all' || category.id === referenceCategory.value,
    ).flatMap(category =>
      candidates.value
        .filter(item => item.category === category.id)
        .slice(0, referenceCategory.value === 'all' ? 10 : 60),
    );
  return [...new Set(candidates.value.map(item => item.group))]
    .flatMap(group => candidates.value.filter(item => item.group === group))
    .slice(0, 60);
});
watch(shortcutItems, items => {
  if (!items[shortcutIndex.value] || items[shortcutIndex.value].disabledReason)
    shortcutIndex.value = Math.max(
      0,
      items.findIndex(item => !item.disabledReason),
    );
});

function updateShortcut() {
  updateShortcutHeight();
  caret.value = messageInput.value?.selectionStart ?? message.value.length;
  shortcutIndex.value = 0;
  shortcutsDismissed.value = false;
}

function updateShortcutHeight() {
  const panel = composerShell.value?.closest('.dca-session-panel');
  const toolbar = panel?.querySelector('.dca-session-bar')?.getBoundingClientRect();
  const root = panel?.getBoundingClientRect() ?? composerShell.value?.closest('.dca-app')?.getBoundingClientRect();
  const composer = composerShell.value?.getBoundingClientRect();
  if (root && composer)
    shortcutHeight.value = Math.max(104, Math.min(320, composer.top - (toolbar?.bottom ?? root.top) - 12));
}

async function selectShortcut(item: ComposerSuggestion) {
  const current = shortcut.value;
  if (!current || !shortcutItems.value.some(candidate => candidate.id === item.id && candidate.value === item.value))
    return;
  if (item.disabledReason) {
    notify.error(item.disabledReason, '梦境创客');
    return;
  }
  const insertion = `${item.value} `;
  message.value = message.value.slice(0, current.start) + insertion + message.value.slice(current.end);
  const position = current.start + insertion.length;
  shortcutsDismissed.value = !(current.kind === 'command' && ['model', 'effort', 'skill'].includes(item.id));
  await nextTick();
  messageInput.value?.focus();
  messageInput.value?.setSelectionRange(position, position);
  caret.value = position;
  updateShortcutHeight();
}
async function selectReferenceCategory(category: ReferenceCategory | 'all') {
  referenceCategory.value = category;
  shortcutIndex.value = 0;
  await nextTick();
  messageInput.value?.focus();
  messageInput.value?.setSelectionRange(caret.value, caret.value);
}
function dismissOutside(event: PointerEvent) {
  if (event.target instanceof Node && !composerRoot.value?.contains(event.target)) shortcutsDismissed.value = true;
}
function handleFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !composerRoot.value?.contains(event.relatedTarget))
    shortcutsDismissed.value = true;
}
async function closeHelp() {
  helpOpen.value = false;
  await nextTick();
  messageInput.value?.focus();
}
async function insertCommand(id: ComposerCommandId) {
  helpOpen.value = false;
  message.value = `/${id} `;
  await nextTick();
  messageInput.value?.focus();
  messageInput.value?.setSelectionRange(message.value.length, message.value.length);
  updateShortcut();
}
const showFullAccessWarning = ref(false);
const mobileTextInput = useMobileTextInput();
useBackLayer(helpOpen, () => {
  helpOpen.value = false;
});
useBackLayer(
  computed(() => Boolean(shortcut.value)),
  () => {
    shortcutsDismissed.value = true;
  },
);

async function openShortcut(kind: 'command' | 'reference') {
  plusOpen.value = false;
  if (kind === 'command') {
    await nextTick();
    helpOpen.value = true;
    return;
  }
  const input = messageInput.value;
  const position = input?.selectionStart ?? message.value.length;
  const prefix = position && !/\s/u.test(message.value[position - 1]) ? ' @' : '@';
  message.value = message.value.slice(0, position) + prefix + message.value.slice(position);
  await nextTick();
  input?.focus();
  input?.setSelectionRange(position + prefix.length, position + prefix.length);
  updateShortcut();
}
const plusOpen = ref(false);
const plusLevel = ref<'approval' | 'root' | 'agent'>('root');
const compactModelOpen = ref(false);
const compact = ref(window.innerWidth <= 720);
const composerShell = ref<HTMLElement>();
const fileInput = ref<HTMLInputElement>();
const imageInput = ref<HTMLInputElement>();
let resizeObserver: ResizeObserver | undefined;

const selected = computed(() => findSelectedModel(state.value.providers ?? [], state.value.active?.modelSelection));
const selectedModel = computed(() => selected.value?.model);
const selectedProvider = computed(() => selected.value?.provider);
const adapterCapabilities = computed(() =>
  selected.value
    ? providerAdapterCapabilities(selectedProvider.value!.interfaceType, selectedModel.value!.compatibilityMode)
    : undefined,
);
const supportsWebSearch = computed(() =>
  Boolean(
    selectedModel.value &&
    adapterCapabilities.value?.nativeWebSearch &&
    selectedModel.value.modelSettings.capabilities.webSearch !== 'disabled',
  ),
);
const supportsVision = computed(() =>
  Boolean(selectedModel.value && selectedModel.value.modelSettings.capabilities.vision !== 'disabled'),
);
const supportsReasoning = computed(() =>
  Boolean(selectedModel.value && selectedModel.value.modelSettings.capabilities.reasoning !== 'disabled'),
);
const approvalModeOptions = [
  { label: '审批：手动', value: 'normal' },
  { label: '审批：YOLO', value: 'yolo' },
  { label: '审批：完全权限', value: 'full' },
];
const isRunning = computed(() => ['running', 'waiting-approval'].includes(state.value.active?.status ?? ''));
const canResume = computed(() =>
  ['abnormal', 'failed', 'stopped', 'context-exhausted'].includes(state.value.active?.status ?? ''),
);
const canSend = computed(() => Boolean(state.value.active && !isRunning.value));
const canCompose = computed(() => isRunning.value || canSend.value);
const canAddAttachments = computed(() => canSend.value && !state.value.busy && !submissionPending.value);
const canAddImages = computed(() => canAddAttachments.value && supportsVision.value);
const parsedCommand = computed(() => parseComposerCommand(message.value));
const isLocalCommand = computed(() => ['help', 'context', 'stop'].includes(parsedCommand.value?.command?.id ?? ''));
const canSubmit = computed(
  () =>
    (Boolean(message.value.trim()) || (!isRunning.value && attachments.value.length > 0)) &&
    (!submissionPending.value || isLocalCommand.value) &&
    (isLocalCommand.value || isRunning.value || (canSend.value && !state.value.busy)),
);
const primaryAction = computed<'guidance' | 'send' | 'stop' | 'command'>(() =>
  parsedCommand.value?.command ? 'command' : !isRunning.value ? 'send' : message.value.trim() ? 'guidance' : 'stop',
);
const primaryActionLabel = computed(() =>
  primaryAction.value === 'command'
    ? `执行 /${parsedCommand.value!.command!.id}`
    : primaryAction.value === 'stop'
      ? '停止当前任务'
      : submissionPending.value
        ? '正在提交'
        : primaryAction.value === 'guidance'
          ? '发送中途引导'
          : '发送消息',
);
const primaryActionIcon = computed(() =>
  primaryAction.value === 'stop'
    ? 'fa-solid fa-stop'
    : primaryAction.value === 'guidance'
      ? 'fa-solid fa-paper-plane'
      : 'fa-solid fa-arrow-up',
);
const actionClasses = computed(() => ({
  'dca-guidance-button': primaryAction.value === 'guidance',
  'dca-stop-button': primaryAction.value === 'stop',
}));
const canUsePrimaryAction = computed(() => primaryAction.value === 'stop' || canSubmit.value);
const shortcutHint = computed(() =>
  mobileTextInput.value
    ? '回车换行 · 点击按钮发送'
    : isRunning.value
      ? '运行中：发送即中途引导'
      : state.value.sendWithCtrlEnter
        ? 'Ctrl + Enter 发送'
        : 'Enter 发送 · Shift + Enter 换行',
);
const currentApprovalLabel = computed(
  () =>
    approvalModeOptions.find(
      option => option.value === (state.value.active?.mode ?? state.value.approvalMode ?? 'normal'),
    )?.label ?? '审批模式',
);

async function submit() {
  if (!canSubmit.value || !draftReady.value) return;
  const text = message.value;
  const sessionId = state.value.active?.sessionId;
  if (!sessionId) return;
  const previous = [...attachments.value];
  const parsed = parseComposerCommand(text);
  const kind = parsed ? 'command' : isRunning.value ? 'guidance' : 'message';
  const settleDraft = captureDraft();
  try {
    if (parsed) {
      if (!parsed.command) throw new Error(`未知指令 /${parsed.name}，输入 /help 查看用法。`);
      const command = parsed.command;
      assertCommandArguments(command, parsed.args);
      if (previous.length) throw new Error('指令请单独提交，附件已保留。');
      const reason = commandDisabledReason(command, composerCommandContext(state.value));
      if (reason) throw new Error(reason);
      if (['model', 'effort', 'skill'].includes(command.id) && !parsed.args) {
        await insertCommand(command.id);
        return;
      }
      shortcutsDismissed.value = true;
      if (command.id === 'help' || command.id === 'context' || command.id === 'stop') {
        if (command.id === 'help') helpOpen.value = true;
        else if (command.id === 'context') {
          sidebarCollapsed.value = false;
          sidebarFocus.value = { tab: 'context' };
        } else runtime.stopSession(sessionId);
        settleDraft({ message: '', attachments: [] });
        return;
      }
    }
    await submission.submit(
      async id => {
        const converted =
          kind === 'message' ? await Promise.all(previous.map(item => fileToSessionAttachment(item.file))) : [];
        if (state.value.active?.sessionId !== sessionId) return undefined;
        return runtime.submitInput({ id, sessionId, kind, text, attachments: converted });
      },
      () => {
        if (settleDraft({ message: '', attachments: kind === 'guidance' ? previous : [] }) && kind !== 'guidance') {
          previous.forEach(revokePreview);
        }
      },
    );
  } catch (error) {
    notify.error(error instanceof Error ? error.message : String(error), '梦境创客');
  }
}
function handlePrimaryAction() {
  if (primaryAction.value === 'stop') runtime.stop();
  else void submit();
}
function handleKeydown(event: KeyboardEvent) {
  if (composing.value || event.isComposing || event.keyCode === 229) return;
  if (mobileTextInput.value && event.key === 'Enter' && !event.ctrlKey && !event.metaKey) return;
  if (shortcut.value && event.key === 'Escape') {
    event.preventDefault();
    shortcutsDismissed.value = true;
    return;
  }
  if (shortcutItems.value.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      for (let step = 0; step < shortcutItems.value.length; step++) {
        shortcutIndex.value =
          (shortcutIndex.value + direction + shortcutItems.value.length) % shortcutItems.value.length;
        if (!shortcutItems.value[shortcutIndex.value].disabledReason) break;
      }
      void nextTick(() =>
        shortcutMenu.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }),
      );
      return;
    }
    if (
      (event.key === 'Enter' || event.key === 'Tab') &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      void selectShortcut(shortcutItems.value[shortcutIndex.value] ?? shortcutItems.value[0]);
      return;
    }
  }
  if (event.key !== 'Enter') return;
  const shouldSend = state.value.sendWithCtrlEnter
    ? (event.ctrlKey || event.metaKey) && !event.shiftKey
    : !event.shiftKey;
  if (shouldSend) {
    event.preventDefault();
    void submit();
  }
}
function handlePaste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length) {
    event.preventDefault();
    addFiles(files);
  }
}
function handleDrop(event: DragEvent) {
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length) addFiles(files);
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
function openFilePicker() {
  plusOpen.value = false;
  fileInput.value?.click();
}
function openImagePicker() {
  plusOpen.value = false;
  imageInput.value?.click();
}
function togglePlusMenu() {
  plusOpen.value = !plusOpen.value;
  plusLevel.value = 'root';
}
function openCompactModelMenu() {
  plusOpen.value = false;
  compactModelOpen.value = true;
}
function addFiles(files: File[]) {
  if (!canAddAttachments.value) return;
  if (files.some(file => isImageAttachment({ mediaType: file.type })) && !supportsVision.value) {
    notify.error('当前模型不支持视觉，无法添加图片。', '梦境创客');
    return;
  }
  try {
    validateAttachmentFiles([...attachments.value.map(item => item.file), ...files]);
  } catch (error) {
    notify.error(error instanceof Error ? error.message : String(error), '梦境创客');
    return;
  }
  attachments.value = [
    ...attachments.value,
    ...files.map(file => ({
      file,
      id: crypto.randomUUID(),
    })),
  ];
}
function removeAttachment(id: string) {
  const item = attachments.value.find(value => value.id === id);
  if (item) revokePreview(item);
  attachments.value = attachments.value.filter(value => value.id !== id);
}
function revokePreview(item: AttachmentDraft) {
  const url = previews.get(item.id);
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  previews.delete(item.id);
}
function previewUrl(item: AttachmentDraft): string | undefined {
  if (!isImageAttachment({ mediaType: item.file.type }) || typeof URL.createObjectURL !== 'function') return undefined;
  let url = previews.get(item.id);
  if (!url) {
    url = URL.createObjectURL(item.file);
    previews.set(item.id, url);
  }
  return url;
}
async function resume() {
  await action(() => runtime.resume());
}
async function toggleWebSearch() {
  await action(() => runtime.setModelControls({ webSearch: !state.value.active?.modelControls?.webSearch }));
}
async function toggleWebSearchFromMenu() {
  plusOpen.value = false;
  await toggleWebSearch();
}
async function changeMode(mode: string) {
  if (mode === 'full') {
    showFullAccessWarning.value = true;
    return;
  }
  await action(() => runtime.setSessionMode(mode === 'yolo' ? 'yolo' : 'normal'));
}
async function changeModeFromMenu(mode: string) {
  plusOpen.value = false;
  plusLevel.value = 'root';
  await changeMode(mode);
}
async function enableFullAccess() {
  if (await action(() => runtime.setSessionMode('full'))) showFullAccessWarning.value = false;
}

watch(
  () => state.value.active?.sessionId,
  () => {
    shortcutsDismissed.value = true;
    plusOpen.value = false;
    showFullAccessWarning.value = false;
    compactModelOpen.value = false;
    helpOpen.value = false;
    referenceCategory.value = 'all';
  },
  { flush: 'sync' },
);

onMounted(() => {
  document.addEventListener('pointerdown', dismissOutside);
  window.addEventListener('resize', updateShortcutHeight);
  window.visualViewport?.addEventListener('resize', updateShortcutHeight);
  if (!composerShell.value) return;
  resizeObserver = new ResizeObserver(entries => {
    compact.value = (entries[0]?.contentRect.width ?? 1000) < 680;
    void nextTick(updateShortcutHeight);
  });
  resizeObserver.observe(composerShell.value);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', dismissOutside);
  window.removeEventListener('resize', updateShortcutHeight);
  window.visualViewport?.removeEventListener('resize', updateShortcutHeight);
  resizeObserver?.disconnect();
  for (const url of previews.values()) URL.revokeObjectURL?.(url);
  previews.clear();
});
</script>

<style lang="scss">
.dca-composer {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.3rem;
  border-top: 1px solid var(--dca-border);
  padding: 0.45rem 0.65rem 0.4rem;
  background: var(--dca-surface);
}
.dca-shortcut-anchor {
  display: contents;
}
.dca-shortcut-menu {
  position: absolute;
  bottom: 100%;
  left: 0.75rem;
  z-index: 30;
  width: min(36rem, calc(100% - 1.5rem));
  max-height: 16rem;
  overflow: hidden auto;
  border: 1px solid var(--dca-border-strong);
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--dca-surface) 88%, var(--dca-text) 12%);
  box-shadow: var(--dca-shadow-1);
  padding: 0.2rem;
}
.dca-composer .dca-shortcut-menu button {
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 1.875rem;
  margin: 0;
  border: 0;
  border-radius: 0.6rem;
  background: transparent;
  box-shadow: none;
  font-size: 0.8rem;
  line-height: 1.3;
  text-align: left;
  gap: 0.45rem;
  padding: 0.25rem 0.45rem;
}
.dca-composer .dca-shortcut-menu button.active,
.dca-composer .dca-shortcut-menu button:hover {
  background: var(--dca-accent-soft);
}
.dca-shortcut-menu button > i {
  flex: 0 0 1rem;
  width: 1rem;
  text-align: center;
  color: var(--dca-text-secondary);
  font-size: 0.75rem;
}
.dca-shortcut-name {
  flex: 0 1 auto;
  max-width: 48%;
  color: var(--dca-text);
  font-weight: 500;
}
.dca-shortcut-detail {
  flex: 1 1 0;
  color: var(--dca-text-muted);
}
.dca-shortcut-name,
.dca-shortcut-detail {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
@media (pointer: coarse) {
  .dca-composer .dca-shortcut-menu button {
    min-height: 2.125rem;
  }
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
}
.dca-composer-shell:focus-within {
  border-color: color-mix(in srgb, var(--dca-accent) 65%, transparent);
  box-shadow: 0 0 0 2px var(--dca-focus-ring);
}
.dca-composer .dca-desktop-input textarea,
.dca-composer .dca-compact-input-row textarea {
  width: 100%;
  min-height: 4.6rem;
  border: 0;
  padding: 0.45rem 0.55rem;
  background: transparent;
  box-shadow: none;
  resize: none;
}
.dca-compact-input-row {
  display: grid;
  grid-template-columns: 2.1rem minmax(0, 1fr) 2.1rem;
  align-items: end;
  gap: 0.3rem;
}
.dca-composer .dca-compact-input-row textarea {
  min-height: 3.2rem;
}
.dca-compact-left-controls {
  display: flex;
  min-height: 3.2rem;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 0.1rem;
}
.dca-composer-control-strip {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.25rem;
  overflow: visible;
  padding: 0.05rem;
}
.dca-composer-control-strip > * {
  min-width: 0;
  flex: 0 1 auto;
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
  border-radius: var(--dca-radius-md);
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
.dca-app .dca-send-button.dca-guidance-button {
  background: var(--dca-accent);
  color: var(--dca-on-accent);
  box-shadow: 0 0 0 3px var(--dca-accent-soft);
}
.dca-app .dca-send-button.dca-stop-button {
  background: var(--dca-danger);
  color: var(--dca-on-accent);
  box-shadow: 0 0 0 3px var(--dca-danger-soft);
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
.dca-app .dca-web-toggle {
  display: flex;
  min-height: 1.9rem;
  align-items: center;
  gap: 0.3rem;
  border-color: transparent;
  border-radius: var(--dca-radius-md);
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
.dca-plus-wrap {
  position: relative;
}
.dca-plus-menu {
  position: absolute;
  z-index: 20;
  bottom: 2.5rem;
  left: 0;
  display: flex;
  width: 13rem;
  flex-direction: column;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.3rem;
  background: var(--dca-surface);
  box-shadow: var(--dca-shadow-2);
}
.dca-app .dca-plus-menu button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.5rem;
  border-color: transparent;
  background: transparent;
  text-align: left;
}
.dca-app .dca-plus-menu button > i {
  flex: 0 0 1rem;
  width: 1rem;
}
.dca-app .dca-plus-menu button > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.dca-plus-menu button.active {
  background: var(--dca-accent-soft);
}
.dca-plus-menu button small {
  margin-left: auto;
  color: var(--dca-text-muted);
  font-size: 0.65rem;
}
.dca-plus-menu .invisible {
  visibility: hidden;
}
.dca-app .dca-compact-web-toggle.active {
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
@media (max-width: 720px) {
  .dca-composer {
    padding: 0.25rem max(0.35rem, env(safe-area-inset-right)) max(0.25rem, env(safe-area-inset-bottom))
      max(0.35rem, env(safe-area-inset-left));
  }
  .dca-composer-shell {
    border-radius: var(--dca-radius-lg);
    gap: 0.15rem;
    padding: 0.25rem;
  }
  .dca-composer .dca-compact-input-row textarea {
    padding: 0.25rem 0.4rem;
  }
  .dca-app .dca-composer-control-strip .dca-select-trigger {
    min-height: 2.25rem;
  }
  .dca-shortcut-hint {
    display: none;
  }
  .dca-composer-control-strip > .dca-session-model-menu {
    max-width: min(13rem, 56vw);
    flex: 0 1 auto;
    overflow: visible;
  }
  .dca-composer-control-strip > .dca-mode-select {
    flex: 0 1 auto;
  }
  .dca-composer-control-strip .dca-session-model-trigger {
    width: auto;
    max-width: 100%;
    min-height: 2.25rem;
    border-color: transparent;
    padding: 0.15rem 0.42rem;
    background: transparent;
  }
  .dca-composer-control-strip .dca-session-model-trigger:hover:not(:disabled),
  .dca-composer-control-strip .dca-session-model-menu.is-open .dca-session-model-trigger {
    border-color: transparent;
    background: var(--dca-raised);
  }
  .dca-composer-control-strip .dca-session-model-trigger > span {
    max-width: min(8.5rem, 32vw);
  }
  .dca-composer-control-strip .dca-mode-select {
    min-width: 7rem;
    max-width: 9rem;
  }
}
</style>
