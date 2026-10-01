<template>
  <div
    v-if="store.open && store.enabled"
    ref="root"
    class="dr2-backdrop"
    @pointerdown.self="close"
    @keydown="onKeydown"
  >
    <section class="dr2-panel" role="dialog" aria-modal="true" aria-label="梦境自修复 V2">
      <header class="dr2-header">
        <div><strong>梦境自修复 V2</strong><small>格式补全 · 内容修复 · 变量联动</small></div>
        <button type="button" aria-label="关闭" @click="close">×</button>
      </header>
      <nav class="dr2-tabs" aria-label="面板页面">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          :class="{ active: tab === item.id }"
          :aria-pressed="tab === item.id"
          @click="tab = item.id"
        >
          {{ item.label }}
        </button>
      </nav>
      <div class="dr2-body">
        <template v-if="tab === 'run'">
          <div class="dr2-status" role="status">
            <span :class="{ 'dr2-dot-busy': store.busy }" class="dr2-dot"></span>{{ store.stage }}
          </div>
          <div class="dr2-grid">
            <label class="dr2-card"
              ><input v-model="store.settings.format" type="checkbox" :disabled="store.busy" /><span
                ><b>格式补全</b><small>补齐当前回复中缺失的附加格式。</small></span
              ></label
            >
            <label class="dr2-card"
              ><input v-model="store.settings.review" type="checkbox" :disabled="store.busy" /><span
                ><b>内容修复</b><small>检查整条回复，应用段落和跨行补丁。</small></span
              ></label
            >
          </div>
          <label class="dr2-check"><input v-model="store.settings.auto" type="checkbox" />回复完成后自动运行</label>
          <label class="dr2-check"
            ><input
              v-model="store.settings.link_mvu"
              type="checkbox"
              :disabled="!mvu.enabled || store.busy"
            />手动修复与还原后关联更新 MVU</label
          >
          <p class="dr2-muted">MVU：{{ mvuLabel }}</p>
          <p v-if="store.error" class="dr2-error" role="alert">{{ store.error }}</p>
          <pre v-if="store.result" class="dr2-result">{{ store.result }}</pre>
          <details v-if="store.stream_text">
            <summary>生成内容</summary>
            <pre class="dr2-preview">{{ store.stream_text }}</pre>
          </details>
          <div class="dr2-actions">
            <button
              type="button"
              :disabled="store.busy || !hasMessage"
              @click="perform(() => controller.patchAction(getLastMessageId(), 'reverse'))"
            >
              还原本轮补丁
            </button>
            <button type="button" :disabled="store.busy || !hasMessage || !mvu.enabled || mvu.busy" @click="reprocess">
              重新处理 MVU
            </button>
          </div>
        </template>
        <template v-else-if="tab === 'prompts'">
          <label class="dr2-field"
            ><span>格式补全提示词</span
            ><textarea v-model="store.settings.format_prompt" rows="8" spellcheck="false"></textarea>
          </label>
          <button
            class="dr2-text-button"
            type="button"
            @click="store.settings.format_prompt = DEFAULT_SETTINGS.format_prompt"
          >
            恢复默认格式提示词
          </button>
          <label class="dr2-field"
            ><span>内容修复提示词</span
            ><textarea v-model="store.settings.review_prompt" rows="11" spellcheck="false"></textarea>
          </label>
          <button
            class="dr2-text-button"
            type="button"
            @click="store.settings.review_prompt = DEFAULT_SETTINGS.review_prompt"
          >
            恢复默认修复提示词
          </button>
          <p class="dr2-muted">支持酒馆变量宏。组合模板保留宏文本，实际请求在发送时展开。</p>
          <label class="dr2-check"
            ><input v-model="store.settings.intercept" type="checkbox" />替换预设末尾 user 消息的尾部</label
          >
          <label class="dr2-field"
            ><span>保留到此定位点</span><input v-model="store.settings.tail" type="text" spellcheck="false"
          /></label>
          <label class="dr2-field"
            ><span>结果插入位置：匹配内容之前，留空则追加到末尾</span
            ><input v-model="store.settings.insert_before" type="text" spellcheck="false"
          /></label>
          <details>
            <summary>补丁输出协议</summary>
            <pre class="dr2-preview">{{ protocol }}</pre>
          </details>
        </template>
        <template v-else-if="tab === 'model'">
          <label class="dr2-field"
            ><span>模型来源</span
            ><select v-model="store.settings.source">
              <option value="current">使用酒馆当前连接</option>
              <option value="custom">自定义聊天补全 API</option>
            </select></label
          >
          <template v-if="store.settings.source === 'custom'">
            <label class="dr2-field"
              ><span>API 地址</span
              ><input
                v-model="store.settings.apiurl"
                type="url"
                placeholder="https://example.com/v1"
                spellcheck="false"
            /></label>
            <label class="dr2-field"
              ><span>API 密钥</span><input v-model="store.settings.key" type="password" autocomplete="off"
            /></label>
            <label class="dr2-field"
              ><span>模型名称</span
              ><input v-model="store.settings.model" list="dr2-models" type="text" spellcheck="false" /><datalist
                id="dr2-models"
              >
                <option v-for="model in models" :key="model" :value="model"></option></datalist
            ></label>
            <button type="button" :disabled="loading_models || !store.settings.apiurl" @click="loadModels">
              {{ loading_models ? '获取中…' : '获取模型列表' }}
            </button>
            <p v-if="model_error" class="dr2-error">{{ model_error }}</p>
            <div class="dr2-grid">
              <label class="dr2-field"
                ><span>温度</span
                ><input v-model.number="store.settings.temperature" type="number" min="0" max="2" step="0.1"
              /></label>
              <label class="dr2-field"
                ><span>最大回复 Token</span
                ><input v-model.number="store.settings.max_tokens" type="number" min="256" max="131072" step="256"
              /></label>
            </div>
          </template>
          <label class="dr2-check"><input v-model="store.settings.stream" type="checkbox" />在面板中显示流式生成</label>
          <label class="dr2-field"
            ><span>请求超时（秒）</span
            ><input v-model.number="store.settings.timeout_seconds" type="number" min="30" max="1800"
          /></label>
        </template>
        <template v-else>
          <div class="dr2-actions">
            <button type="button" @click="refreshPreview">刷新组合模板</button
            ><button type="button" @click="actual = !actual">
              {{ actual ? '查看组合模板' : '查看最近一次实际请求' }}
            </button>
          </div>
          <p class="dr2-muted">
            {{ actual ? '最近一次修复请求发送时展开的完整文本。' : '本次任务尾部，随模块和提示词配置更新。' }}
          </p>
          <pre class="dr2-preview">{{ actual ? store.actual_request || '尚未发送修复请求。' : preview }}</pre>
        </template>
      </div>
      <footer class="dr2-footer">
        <span>{{ store.busy ? store.stage : '处理当前最后一条角色回复' }}</span>
        <button v-if="store.busy" type="button" class="dr2-primary" @click="controller.stop">停止</button>
        <button
          v-else
          type="button"
          class="dr2-primary"
          :disabled="!hasMessage || (!store.settings.format && !store.settings.review) || mvu.busy"
          @click="start"
        >
          开始修复
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getMvuStatus, updateMvu } from './mvu';
import protocol from './prompts/protocol.md?raw';
import type { RepairController } from './runtime';
import { DEFAULT_SETTINGS, useRepairStore } from './settings';

const { controller } = defineProps<{ controller: RepairController }>();
const store = useRepairStore();
const tabs = [
  { id: 'run', label: '运行' },
  { id: 'prompts', label: '提示词' },
  { id: 'model', label: '模型' },
  { id: 'preview', label: '组合预览' },
];
const tab = ref('run');
const root = ref<HTMLElement>();
const actual = ref(false);
const preview = ref('');
const hasMessage = ref(false);
const mvu = ref(getMvuStatus());
const models = ref<string[]>([]);
const loading_models = ref(false);
const model_error = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
let previous_focus: HTMLElement | null = null;
const mvuLabel = computed(() =>
  mvu.value.enabled
    ? `${mvu.value.mode === 'extra' ? '独立模型解析' : '随正文输出'}${mvu.value.busy ? '，正在处理' : ''}`
    : mvu.value.available && !mvu.value.version
      ? '联动接口待更新'
      : '未启用',
);

function refreshPreview() {
  try {
    preview.value = controller.preview();
  } catch (error) {
    preview.value = String(error);
  }
}
function refreshStatus() {
  mvu.value = getMvuStatus();
  hasMessage.value = getChatMessages(-1)[0]?.role === 'assistant';
}
async function perform(action: () => Promise<unknown>) {
  store.error = '';
  try {
    await action();
  } catch (error) {
    store.error = error instanceof Error ? error.message : String(error);
  }
}
function start() {
  tab.value = 'run';
  void perform(() => controller.run());
}
async function reprocess() {
  await perform(async () => {
    store.busy = true;
    store.stage = 'MVU 关联更新';
    try {
      await updateMvu(getLastMessageId());
      store.result = 'MVU 关联处理完成。';
    } finally {
      store.busy = false;
      store.stage = '就绪';
    }
  });
}
async function loadModels() {
  loading_models.value = true;
  model_error.value = '';
  try {
    models.value = await getModelList({ apiurl: store.settings.apiurl, key: store.settings.key });
  } catch (error) {
    model_error.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading_models.value = false;
  }
}
function close() {
  store.open = false;
  previous_focus?.focus();
}
function onKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
  if (event.key !== 'Tab') return;
  const controls = [
    ...(root.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea, select, summary',
    ) ?? []),
  ];
  const first = controls[0];
  const last = controls.at(-1);
  const active = root.value?.ownerDocument.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last?.focus();
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}
watch(() => store.settings, refreshPreview, { deep: true });
watch(
  () => store.open,
  async open => {
    if (open) {
      previous_focus = window.parent.document.activeElement as HTMLElement | null;
      refreshStatus();
      refreshPreview();
      await nextTick();
      root.value?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  },
);
onMounted(() => {
  refreshStatus();
  refreshPreview();
  timer = setInterval(() => {
    if (store.open) refreshStatus();
  }, 1000);
});
onBeforeUnmount(() => {
  clearInterval(timer);
});
</script>

<style scoped>
.dr2-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(0 0 0 / 58%);
  color: var(--SmartThemeBodyColor, #eee);
}
.dr2-panel {
  box-sizing: border-box;
  width: min(820px, 100%);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--SmartThemeBorderColor, #555);
  border-radius: 16px;
  background: var(--SmartThemeBlurTintColor, #232329);
  box-shadow: 0 20px 60px #0008;
  backdrop-filter: blur(20px);
  text-align: left;
}
.dr2-header,
.dr2-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
}
.dr2-header {
  border-bottom: 1px solid #8884;
}
.dr2-header strong {
  font-size: 1.15rem;
}
.dr2-header small,
.dr2-card small {
  display: block;
  opacity: 0.7;
  margin-top: 5px;
  line-height: 1.5;
}
.dr2-header > button {
  font-size: 1.4rem;
  min-width: 40px;
}
.dr2-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 20px 0;
}
.dr2-tabs button {
  flex: 1;
}
.dr2-tabs button.active {
  background: #9172c84d;
  border-color: #a78acb;
}
.dr2-body {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px;
  min-height: 0;
}
.dr2-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 14px 0;
}
.dr2-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
  border: 1px solid #8885;
  border-radius: 10px;
}
.dr2-card input {
  margin-top: 4px;
}
.dr2-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 14px 0 6px;
}
.dr2-check {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 16px 0;
}
.dr2-panel button,
.dr2-panel input:not([type='checkbox']),
.dr2-panel textarea,
.dr2-panel select {
  box-sizing: border-box;
  min-height: 40px;
  border: 1px solid #8886;
  border-radius: 8px;
  padding: 8px 12px;
  background: #8881;
  color: inherit;
  font: inherit;
}
.dr2-panel button {
  cursor: pointer;
}
.dr2-panel button:disabled {
  cursor: default;
  opacity: 0.45;
}
.dr2-panel textarea,
.dr2-panel input:not([type='checkbox']),
.dr2-panel select {
  width: 100%;
  min-width: 0;
}
.dr2-panel select option {
  color: #eee;
  background: #25252c;
}
.dr2-panel textarea {
  resize: vertical;
  line-height: 1.65;
}
.dr2-panel input[type='checkbox'] {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: #ac90d1;
}
.dr2-panel :focus-visible {
  outline: 2px solid #bc9de5;
  outline-offset: 2px;
}
.dr2-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
.dr2-panel .dr2-text-button {
  border: 0;
  padding-left: 0;
  font-size: 0.9em;
  text-decoration: underline;
}
.dr2-muted {
  opacity: 0.7;
  font-size: 0.9em;
  line-height: 1.6;
}
.dr2-error {
  padding: 12px;
  border-radius: 8px;
  background: #b9464626;
  color: #ffb7b7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dr2-preview,
.dr2-result {
  padding: 14px;
  margin: 12px 0;
  border: 1px solid #8884;
  border-radius: 8px;
  background: #0002;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.9em;
  line-height: 1.65;
  font-family: inherit;
}
.dr2-status {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dr2-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8ebd9a;
}
.dr2-dot-busy {
  background: #e4ba78;
}
.dr2-footer {
  border-top: 1px solid #8884;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
.dr2-footer > span {
  font-size: 0.85em;
  opacity: 0.7;
}
.dr2-panel .dr2-primary {
  background: #a287c7;
  color: #17121e;
  border-color: transparent;
  font-weight: 600;
  min-width: 110px;
}
.dr2-panel summary {
  cursor: pointer;
  margin: 16px 0;
}
@media (max-width: 600px) {
  .dr2-backdrop {
    padding: 6px;
  }
  .dr2-panel {
    max-height: calc(100dvh - 12px);
    border-radius: 12px;
  }
  .dr2-header,
  .dr2-footer {
    padding: 12px;
  }
  .dr2-tabs {
    padding: 10px 12px 0;
    gap: 4px;
  }
  .dr2-tabs button {
    padding: 8px 4px;
    font-size: 0.9em;
  }
  .dr2-body {
    padding: 12px;
  }
  .dr2-grid {
    grid-template-columns: 1fr;
  }
  .dr2-footer > span {
    max-width: 55%;
  }
}
</style>
