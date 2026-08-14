<template>
  <section class="dca-render-preview" :class="{ open: opened }">
    <header>
      <div>
        <i class="fa-solid fa-window-maximize" aria-hidden="true"></i>
        <span>交互预览</span>
        <small v-if="preview">{{ preview.renderer === 'tavern-helper' ? '酒馆助手 HTML' : '纯 HTML' }}</small>
      </div>
      <button v-if="preview" type="button" @click="opened ? close() : void open()">
        {{ opened ? '关闭预览' : '重新渲染' }}
      </button>
    </header>
    <p v-if="!preview">预览记录已丢失，或它不属于当前会话。</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <iframe
      v-if="opened && documentSource"
      ref="frame"
      :sandbox="preview.renderer === 'tavern-helper' ? 'allow-scripts allow-same-origin allow-forms allow-popups' : 'allow-scripts allow-forms allow-popups'"
      :srcdoc="documentSource"
      title="梦境创客 HTML 预览"
    ></iframe>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { parse } from 'yaml';
import { useDreamCardAgent } from '../../../composables/runtime';

const props = defineProps<{ renderId: string }>();
const { state } = useDreamCardAgent();
const opened = ref(false);
const documentSource = ref('');
const error = ref('');
const frame = ref<HTMLIFrameElement>();

const preview = computed(() => state.value.active?.renderPreviews[props.renderId]);

function literalRegex(value: string): RegExp {
  if (!value.startsWith('/')) return new RegExp(value, 'gu');
  let slash = value.length - 1;
  while (slash > 0) {
    if (value[slash] === '/' && value[slash - 1] !== '\\') break;
    slash -= 1;
  }
  if (slash <= 0) throw new Error('find_regex不是有效的 /pattern/flags 文本。');
  return new RegExp(value.slice(1, slash), value.slice(slash + 1));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function environmentScript(): string {
  const value = preview.value!;
  const json = JSON.stringify({
    data: value.data ?? null,
    inputText: value.inputText,
    preview: true,
    renderId: value.renderId,
    sourceType: value.sourceType,
  }).replace(/</gu, '\\u003c');
  return `<script>Object.defineProperty(window,'__DREAM_CREATOR_RENDER_ENV__',{value:Object.freeze(${json}),writable:false,configurable:false});${'</scr' + 'ipt>'}`;
}

async function open() {
  const value = preview.value;
  if (!value) return;
  error.value = '';
  try {
    const file = state.value.active?.workingFiles.find(candidate => candidate.path === value.sourcePath);
    if (!file) throw new Error(`预览源已不存在：${value.sourcePath}`);
    const nextHash = await sha256(file.content);
    if (nextHash !== value.sourceHash && !window.confirm('预览源在准备后已经改变。是否使用最新内容重新渲染？')) return;
    let html = file.content;
    if (value.sourceType === 'regex') {
      const regex = parse(file.content) as { find_regex?: unknown; replace_string?: unknown };
      if (typeof regex.find_regex !== 'string' || typeof regex.replace_string !== 'string') {
        throw new Error('正则预览文件缺少find_regex或replace_string。');
      }
      html = value.inputText.replace(literalRegex(regex.find_regex), regex.replace_string);
    }
    documentSource.value = `<!doctype html><html><head><meta charset="utf-8">${environmentScript()}</head><body>${html}</body></html>`;
    opened.value = true;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function close() {
  opened.value = false;
  documentSource.value = '';
  if (frame.value) frame.value.srcdoc = '';
}

onBeforeUnmount(close);
</script>

<style lang="scss">
.dca-render-preview {
  width: 100%;
  border: 1px solid var(--dca-border-strong);
  margin: 0.45rem 0;
  background: var(--dca-canvas);
}
.dca-render-preview > header {
  display: flex;
  min-height: 2.4rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.35rem 0.55rem;
}
.dca-render-preview > header > div { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
.dca-render-preview > header small { color: var(--dca-text-muted); }
.dca-render-preview > p { margin: 0; border-top: 1px solid var(--dca-border); padding: 0.55rem; color: var(--dca-text-muted); }
.dca-render-preview > p.error { color: var(--dca-danger); }
.dca-render-preview iframe {
  display: block;
  width: 100%;
  height: min(32rem, 60vh);
  border: 0;
  border-top: 1px solid var(--dca-border);
  background: white;
}
</style>
