<template>
  <div ref="wrapper" class="dca-vfs-editor" :class="{ 'is-fallback': status === 'fallback' }">
    <div v-show="status === 'ready'" ref="aceHost" class="dca-ace-host" aria-label="文件内容编辑器"></div>
    <textarea
      v-if="status !== 'ready'"
      :value="modelValue"
      :readonly="readonly"
      spellcheck="false"
      aria-label="文件内容编辑器"
      @input="emitTextarea"
    ></textarea>
    <small v-if="status === 'loading'" class="dca-editor-engine-state">正在加载增强编辑器，可直接继续输入…</small>
    <small v-else-if="status === 'fallback'" class="dca-editor-engine-state" title="两个CDN均不可用">
      增强编辑器不可用，已使用基础文本框
    </small>
    <span
      v-if="hoveredMarker"
      class="dca-ace-marker-tooltip"
      :style="{ left: `${tooltipPosition.x}px`, top: `${tooltipPosition.y}px` }"
      role="tooltip"
    >
      <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>{{ hoveredMarker.label }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  availableAceMode,
  hasAceTheme,
  languageForPath,
  loadAce,
  type AceEditor,
  type AceNamespace,
} from './ace-loader';

export type VfsEditorMarker = {
  endColumn: number;
  endLine: number;
  label: string;
  startColumn: number;
  startLine: number;
};

const props = withDefaults(
  defineProps<{
    markers?: VfsEditorMarker[];
    modelValue: string;
    path: string;
    readonly?: boolean;
  }>(),
  { markers: () => [], readonly: false },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const wrapper = ref<HTMLElement>();
const aceHost = ref<HTMLElement>();
const status = ref<'fallback' | 'loading' | 'ready'>('loading');
const hoveredMarker = ref<VfsEditorMarker>();
const tooltipPosition = ref({ x: 0, y: 0 });
let ace: AceNamespace | undefined;
let editor: AceEditor | undefined;
let markerIds: number[] = [];
let applyingExternalValue = false;
let mounted = true;

onMounted(() => void initialize());
onBeforeUnmount(() => {
  mounted = false;
  editor?.destroy();
  editor = undefined;
});

watch(
  () => props.modelValue,
  value => {
    if (!editor || editor.getValue() === value) return;
    const cursor = editor.getCursorPosition();
    applyingExternalValue = true;
    editor.setValue(value, -1);
    editor.moveCursorToPosition(cursor);
    applyingExternalValue = false;
  },
);
watch(
  () => props.readonly,
  value => editor?.setReadOnly(value),
);
watch(
  () => props.path,
  async path => {
    if (!editor) return;
    const language = languageForPath(path);
    const loadedAce = await loadAce(language);
    if (editor && loadedAce) editor.session.setMode(availableAceMode(loadedAce, language));
  },
);
watch(
  () => props.markers,
  () => applyMarkers(),
  { deep: true },
);

async function initialize(): Promise<void> {
  const language = languageForPath(props.path);
  const loadedAce = await loadAce(language);
  if (!mounted || !loadedAce) {
    status.value = 'fallback';
    return;
  }
  ace = loadedAce;
  await nextTick();
  if (!aceHost.value) {
    status.value = 'fallback';
    return;
  }
  editor = ace.edit(aceHost.value);
  editor.setValue(props.modelValue, -1);
  editor.setReadOnly(props.readonly);
  editor.setOptions({
    behavioursEnabled: true,
    displayIndentGuides: true,
    enableBasicAutocompletion: false,
    enableLiveAutocompletion: false,
    enableSnippets: false,
    fontFamily: 'var(--dca-font-mono)',
    fontSize: '12px',
    highlightActiveLine: true,
    showFoldWidgets: true,
    showPrintMargin: false,
    tabSize: 2,
    useSoftTabs: true,
    wrap: true,
  });
  editor.session.setUseWorker(false);
  editor.session.setMode(availableAceMode(ace, language));
  if (hasAceTheme(ace)) {
    editor.setTheme('ace/theme/tomorrow_night_eighties');
  }
  editor.renderer.setScrollMargin(8, 8);
  editor.on('change', () => {
    if (!applyingExternalValue && editor) emit('update:modelValue', editor.getValue());
  });
  editor.container.addEventListener('mousemove', handleMarkerHover);
  editor.container.addEventListener('mouseleave', clearMarkerHover);
  status.value = 'ready';
  applyMarkers();
  await nextTick();
  if (mounted) editor?.resize(true);
}

function emitTextarea(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}

function applyMarkers(): void {
  if (!ace || !editor) return;
  for (const id of markerIds) editor.session.removeMarker(id);
  markerIds = [];
  const { Range } = ace.require('ace/range');
  for (const marker of props.markers) {
    const range = new Range(marker.startLine, marker.startColumn, marker.endLine, marker.endColumn);
    markerIds.push(editor.session.addMarker(range, 'dca-ace-secret-marker', 'text', true));
  }
  editor.session.clearAnnotations();
  editor.session.setAnnotations(
    props.markers.map(marker => ({
      column: marker.startColumn,
      row: marker.startLine,
      text: marker.label,
      type: 'warning',
    })),
  );
}

function contains(marker: VfsEditorMarker, row: number, column: number): boolean {
  if (row < marker.startLine || row > marker.endLine) return false;
  if (row === marker.startLine && column < marker.startColumn) return false;
  if (row === marker.endLine && column >= marker.endColumn) return false;
  return true;
}

function handleMarkerHover(event: MouseEvent): void {
  if (!editor || !wrapper.value) return;
  const position = editor.renderer.screenToTextCoordinates(event.clientX, event.clientY);
  hoveredMarker.value = props.markers.find(marker => contains(marker, position.row, position.column));
  if (!hoveredMarker.value) return;
  const bounds = wrapper.value.getBoundingClientRect();
  tooltipPosition.value = {
    x: Math.min(bounds.width - 190, Math.max(8, event.clientX - bounds.left + 12)),
    y: Math.min(bounds.height - 34, Math.max(8, event.clientY - bounds.top + 12)),
  };
}

function clearMarkerHover(): void {
  hoveredMarker.value = undefined;
}
</script>

<style lang="scss">
.dca-vfs-editor {
  position: relative;
  display: flex;
  min-height: 8rem;
  flex: 1 1 auto;
  overflow: hidden;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-sm);
  background: #2d2d2d;
}

.dca-ace-host,
.dca-vfs-editor > textarea {
  width: 100%;
  height: 100%;
  min-height: 8rem;
  flex: 1 1 auto;
}

.dca-app .dca-vfs-editor > textarea {
  border: 0;
  border-radius: 0;
  font: 12px/1.5 var(--dca-font-mono);
  resize: none;
}

.dca-editor-engine-state {
  position: absolute;
  right: 0.5rem;
  bottom: 0.35rem;
  z-index: 5;
  border-radius: var(--dca-radius-sm);
  padding: 0.12rem 0.35rem;
  background: rgb(20 18 27 / 82%);
  color: var(--dca-text-muted);
  font-size: 0.68rem;
  pointer-events: none;
}

.dca-ace-marker-tooltip {
  position: absolute;
  z-index: 8;
  display: inline-flex;
  max-width: 18rem;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgb(243 190 79 / 45%);
  border-radius: var(--dca-radius-sm);
  padding: 0.25rem 0.45rem;
  background: #201c16;
  color: #f6d890;
  font-size: 0.72rem;
  pointer-events: none;
}

.dca-vfs-editor .dca-ace-secret-marker {
  position: absolute;
  border-bottom: 2px dotted #efbd55;
  background: rgb(239 189 85 / 18%);
}

.dca-vfs-editor .ace_gutter-cell.ace_warning {
  background-image: none;
}

.dca-vfs-editor .ace_gutter-cell.ace_warning::after {
  position: absolute;
  right: 0.25rem;
  color: #efbd55;
  content: '\f3ed';
  font-family: 'Font Awesome 6 Free';
  font-weight: 900;
}
</style>
