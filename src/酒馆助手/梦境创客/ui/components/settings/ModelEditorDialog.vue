<template>
  <div
    v-if="open"
    class="dca-modal-backdrop dca-model-editor-backdrop"
    role="presentation"
    @pointerdown.stop
    @click.stop
  >
    <section
      class="dca-modal dca-model-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dca-model-editor-title"
      @pointerdown.stop
      @click.stop
    >
      <header>
        <div>
          <h3 id="dca-model-editor-title">{{ copying ? '复制模型' : form.id ? '编辑模型' : '添加模型' }}</h3>
          <p>模型保存实际 ID、兼容模式、能力和请求覆盖；同一实际 ID 可以添加多次。</p>
        </div>
        <button class="dca-icon-btn" type="button" title="关闭模型设置" @pointerdown.stop @click.stop="emit('close')">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </header>

      <div v-if="loading" class="dca-empty">正在读取模型设置……</div>
      <div v-else class="dca-model-editor-body">
        <div class="dca-form-grid">
          <label class="dca-field"><span>显示名称</span><input v-model="form.name" type="text" /></label>
          <label class="dca-field"><span>实际模型 ID</span><input v-model="form.modelId" type="text" /></label>
          <label class="dca-field dca-inline-check">
            <input v-model="form.enabled" type="checkbox" /><span>启用模型（禁用后不会出现在会话选择器）</span>
          </label>
          <label class="dca-field">
            <span>兼容模式</span>
            <DcaSelect
              aria-label="模型兼容模式"
              :model-value="form.compatibilityMode"
              :options="compatibilityOptions"
              @update:model-value="updateCompatibility"
            />
          </label>
        </div>

        <section class="dca-model-template-box">
          <header>
            <div><strong>模型配置模板</strong><small>模板只是可应用的初始值，不是独立 Profile</small></div>
            <span>{{ templateSource }}</span>
          </header>
          <div class="dca-template-picker">
            <SearchableCombobox
              v-model="selectedTemplateId"
              :options="templateOptions"
              placeholder="搜索本地或云端模板"
            />
            <button type="button" :disabled="!selectedTemplate" @click="applySelectedTemplate">应用</button>
            <button type="button" :disabled="cloudLoading" @click="loadCloud">
              {{ cloudLoading ? '读取中' : '云端补充' }}
            </button>
          </div>
          <small v-if="selectedTemplate">
            {{ selectedTemplate.name }} · {{ formatTokens(selectedTemplate.settings.contextWindow) }} 上下文 ·
            {{ formatTokens(selectedTemplate.settings.maxOutputTokens) }} 输出
          </small>
        </section>

        <div class="dca-form-grid" @input.capture="markCustom" @change.capture="markCustom">
          <label class="dca-field"
            ><span>上下文窗口</span><input v-model.number="form.contextWindow" min="0" type="number" /><small
              >0 表示自动。</small
            ></label
          >
          <label class="dca-field"
            ><span>输出上限</span><input v-model.number="form.maxOutputTokens" min="0" type="number" /><small
              >0 表示不主动发送限制。</small
            ></label
          >
          <label class="dca-field" :class="{ muted: samplingIgnored }">
            <span
              >温度
              <i
                v-if="samplingIgnored"
                class="fa-solid fa-circle-exclamation"
                title="当前模式会保留但不发送此参数。"
              ></i
            ></span>
            <input v-model.number="form.temperature" min="0" step="0.01" type="number" placeholder="自动" />
          </label>
          <label class="dca-field" :class="{ muted: samplingIgnored }">
            <span
              >Top P
              <i
                v-if="samplingIgnored"
                class="fa-solid fa-circle-exclamation"
                title="当前模式会保留但不发送此参数。"
              ></i
            ></span>
            <input v-model.number="form.topP" min="0" max="1" step="0.01" type="number" placeholder="自动" />
          </label>
          <label v-for="field in capabilityFields" :key="field.key" class="dca-field">
            <span>{{ field.label }}</span>
            <DcaSelect
              :aria-label="field.label"
              :model-value="form.capabilities[field.key]"
              :options="capabilityOptions"
              @update:model-value="updateCapability(field.key, $event)"
            />
          </label>
          <label class="dca-field wide">
            <span>推理强度</span>
            <textarea
              v-model="form.reasoningEfforts"
              rows="4"
              spellcheck="false"
              placeholder="低:low&#10;高:high"
            ></textarea>
          </label>
        </div>

        <details class="dca-advanced-request">
          <summary>高级请求设置（模型层覆盖 Provider）</summary>
          <div class="dca-form-grid">
            <label class="dca-field wide">
              <span>包含主体参数</span>
              <textarea v-model="form.bodyParameters" rows="8" spellcheck="false" placeholder="reasoning:&#10;  effort: high"></textarea>
              <small>null 可删除 Provider 层的同名字段；模型、消息、工具和流式字段不会被覆盖。</small>
            </label>
            <label class="dca-field wide">
              <span>排除主体参数</span>
              <textarea v-model="form.excludedBodyParameters" rows="5" spellcheck="false" placeholder="- frequency_penalty&#10;- presence_penalty"></textarea>
              <small>与Provider层合并去重，只删除请求主体的顶层字段。</small>
            </label>
            <label class="dca-field wide">
              <span>包含请求标头</span>
              <textarea v-model="form.requestHeaders" rows="6" spellcheck="false" placeholder="X-Custom-Header: value"></textarea>
            </label>
          </div>
        </details>
      </div>

      <footer>
        <button type="button" @click="emit('close')">取消</button>
        <button class="dca-btn-primary" type="button" :disabled="loading" @click="save">保存模型</button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  builtinModelTemplates,
  defaultModelSettings,
  fetchModelsDevCatalog,
  filterModelTemplatesForScope,
  matchModelTemplates,
  settingsForAppliedTemplate,
  type AppliedModelTemplate,
  type CapabilitySetting,
  type ModelCapabilityKey,
  type ModelTemplate,
} from '../../../core/provider/model-catalog';
import type { ApiModel, ApiModelInput, ApiProvider } from '../../../core/provider/provider-config';
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSelect, { type SelectOption } from '../DcaSelect.vue';
import SearchableCombobox, { type ComboboxOption } from '../SearchableCombobox.vue';

const props = defineProps<{ copying?: boolean; model?: ApiModel; open: boolean; provider?: ApiProvider }>();
const emit = defineEmits<{ close: []; saved: [model: ApiModel] }>();
const { action, runtime } = useDreamCardAgent();
const builtins = builtinModelTemplates();
const clouds = ref<ModelTemplate[]>([]);
const cloudLoading = ref(false);
const loading = ref(false);
const selectedTemplateId = ref('custom');
const appliedTemplate = ref<AppliedModelTemplate>();
let applying = false;
let autoApplied = false;

type Form = {
  bodyParameters: string;
  capabilities: Record<ModelCapabilityKey, CapabilitySetting>;
  compatibilityMode: ApiModelInput['compatibilityMode'];
  contextWindow: number;
  enabled: boolean;
  excludedBodyParameters: string;
  id: string;
  maxOutputTokens: number;
  modelId: string;
  name: string;
  reasoningEfforts: string;
  requestHeaders: string;
  temperature: number | string;
  topP: number | string;
};

const form = reactive<Form>(emptyForm());
const compatibilityOptions: SelectOption[] = [
  { label: '标准', value: 'standard' },
  { label: 'DeepSeek', value: 'deepseek' },
];
const capabilityOptions: SelectOption[] = [
  { label: '自动', value: 'auto' },
  { label: '支持', value: 'enabled' },
  { label: '不支持', value: 'disabled' },
];
const capabilityFields: Array<{ key: ModelCapabilityKey; label: string }> = [
  { key: 'vision', label: '视觉能力' },
  { key: 'reasoning', label: '推理能力' },
  { key: 'webSearch', label: '内置联网' },
  { key: 'toolCalling', label: '工具调用' },
];
const allTemplates = computed(() => [...builtins, ...clouds.value]);
const availableTemplates = computed(() =>
  filterModelTemplatesForScope(allTemplates.value, {
    compatibilityMode: form.compatibilityMode,
    interfaceType: props.provider?.interfaceType ?? 'openai-chat',
  }),
);
const rankedTemplates = computed(() => {
  const matches = matchModelTemplates(form.modelId, availableTemplates.value, 100);
  const ids = new Set(matches.map(item => item.template.id));
  return [...matches.map(item => item.template), ...availableTemplates.value.filter(item => !ids.has(item.id))];
});
const templateOptions = computed<ComboboxOption[]>(() => [
  { label: '自定义', description: '保留手动配置', value: 'custom' },
  ...rankedTemplates.value.map(template => ({
    description: `${template.source === 'builtin' ? '本地' : '云端'} · ${formatTokens(template.settings.contextWindow)}`,
    label: `${template.name}（${template.provider}）`,
    value: template.id,
  })),
]);
const selectedTemplate = computed(() => availableTemplates.value.find(item => item.id === selectedTemplateId.value));
const templateSource = computed(() =>
  selectedTemplate.value?.source === 'cloud' ? 'models.dev' : selectedTemplate.value ? '本地配置' : '自定义',
);
const samplingIgnored = computed(() => form.compatibilityMode === 'deepseek');

watch(
  () => [props.open, props.model?.id, props.copying] as const,
  async ([open]) => {
    if (!open) return;
    loading.value = true;
    applying = true;
    autoApplied = false;
    try {
      Object.assign(form, emptyForm());
      if (props.model) {
        const request = props.provider ? await runtime.revealModel(props.provider.id, props.model.id) : undefined;
        Object.assign(form, {
          bodyParameters: request?.bodyParameters.text ?? '',
          capabilities: { ...props.model.modelSettings.capabilities },
          compatibilityMode: props.model.compatibilityMode,
          contextWindow: props.model.modelSettings.contextWindow,
          enabled: props.model.enabled,
          excludedBodyParameters: request?.excludedBodyParameters.text ?? '',
          id: props.copying ? '' : props.model.id,
          maxOutputTokens: props.model.modelSettings.maxOutputTokens,
          modelId: props.model.modelId,
          name: props.copying ? `${props.model.name} 2` : props.model.name,
          reasoningEfforts: formatEfforts(props.model.modelSettings.reasoningEfforts),
          requestHeaders: request?.requestHeaders.text ?? '',
          temperature: props.model.modelSettings.temperature ?? '',
          topP: props.model.modelSettings.topP ?? '',
        });
        appliedTemplate.value = props.model.appliedModelTemplate ? { ...props.model.appliedModelTemplate } : undefined;
        selectedTemplateId.value = props.model.appliedModelTemplate?.id ?? 'custom';
        autoApplied = true;
      } else {
        selectedTemplateId.value = 'custom';
        appliedTemplate.value = undefined;
      }
    } finally {
      applying = false;
      loading.value = false;
    }
  },
  { immediate: true },
);

watch(
  () => form.modelId,
  modelId => {
    if (applying || form.id || autoApplied || !modelId.trim()) return;
    const match = matchModelTemplates(
      modelId,
      builtins.filter(item => !item.interfaceType || item.interfaceType === props.provider?.interfaceType),
      1,
    )[0];
    if (!match) return;
    selectedTemplateId.value = match.template.id;
    applyTemplate(match.template);
    autoApplied = true;
  },
);

function emptyForm(): Form {
  const settings = defaultModelSettings();
  return {
    bodyParameters: '',
    capabilities: { ...settings.capabilities },
    compatibilityMode: 'standard',
    contextWindow: 0,
    enabled: true,
    excludedBodyParameters: '',
    id: '',
    maxOutputTokens: 0,
    modelId: '',
    name: '',
    reasoningEfforts: '',
    requestHeaders: '',
    temperature: '',
    topP: '',
  };
}

function parseEfforts(source: string) {
  return source
    .split(/\r?\n/gu)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const separator = line.indexOf(':');
      if (separator <= 0 || separator === line.length - 1) throw new Error(`推理强度格式错误：${line}`);
      return { name: line.slice(0, separator).trim(), id: line.slice(separator + 1).trim() };
    });
}
function formatEfforts(value: Array<{ id: string; name: string }>) {
  return value.map(item => `${item.name}:${item.id}`).join('\n');
}
function optionalNumber(value: number | string) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function currentSettings() {
  return {
    capabilities: { ...form.capabilities },
    contextWindow: form.contextWindow,
    maxOutputTokens: form.maxOutputTokens,
    reasoningEfforts: parseEfforts(form.reasoningEfforts),
    temperature: optionalNumber(form.temperature),
    topP: optionalNumber(form.topP),
  };
}

function applyTemplate(template: ModelTemplate) {
  applying = true;
  const settings = settingsForAppliedTemplate(template, currentSettings());
  Object.assign(form, {
    capabilities: { ...settings.capabilities },
    compatibilityMode: template.compatibilityMode ?? form.compatibilityMode,
    contextWindow: settings.contextWindow,
    maxOutputTokens: settings.maxOutputTokens,
    reasoningEfforts: formatEfforts(settings.reasoningEfforts),
    temperature: settings.temperature ?? '',
    topP: settings.topP ?? '',
  });
  appliedTemplate.value = { id: template.id, revision: template.revision, source: template.source };
  queueMicrotask(() => {
    applying = false;
  });
}
function applySelectedTemplate() {
  if (selectedTemplate.value) applyTemplate(selectedTemplate.value);
}
function markCustom() {
  if (!applying) {
    selectedTemplateId.value = 'custom';
    appliedTemplate.value = undefined;
  }
}

async function loadCloud() {
  cloudLoading.value = true;
  try {
    clouds.value = await fetchModelsDevCatalog();
    toastr.success(`读取了 ${clouds.value.length} 个云端模型模板。`, '梦境创客');
  } catch (error) {
    toastr.warning(error instanceof Error ? error.message : String(error), '梦境创客');
  } finally {
    cloudLoading.value = false;
  }
}

function updateCompatibility(value: string) {
  if (value === 'standard' || value === 'deepseek') form.compatibilityMode = value;
}
function updateCapability(key: ModelCapabilityKey, value: string) {
  if (value === 'auto' || value === 'enabled' || value === 'disabled') form.capabilities[key] = value;
}

async function save() {
  if (!props.provider) return;
  let saved: ApiModel | undefined;
  const succeeded = await action(async () => {
    saved = await runtime.saveModel(props.provider!.id, {
      appliedModelTemplate: appliedTemplate.value ?? null,
      bodyParameters: { text: form.bodyParameters },
      compatibilityMode: form.compatibilityMode,
      enabled: form.enabled,
      excludedBodyParameters: { text: form.excludedBodyParameters },
      id: form.id || undefined,
      modelId: form.modelId,
      modelSettings: currentSettings(),
      name: form.name,
      requestHeaders: { text: form.requestHeaders },
    });
  });
  if (succeeded && saved) emit('saved', saved);
}

function formatTokens(value: number) {
  if (!value) return '自动';
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}
</script>

<style lang="scss">
.dca-model-editor {
  display: flex;
  width: min(58rem, calc(100vw - 2rem));
  max-height: min(90vh, 54rem);
  flex-direction: column;
  overflow: hidden;
}
.dca-model-editor > header,
.dca-model-editor > footer {
  flex: 0 0 auto;
}
.dca-model-editor > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.dca-model-editor > header > div {
  min-width: 0;
}
.dca-model-editor > header > .dca-icon-btn {
  flex: 0 0 auto;
}
.dca-model-editor-body {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.8rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0.1rem 0.35rem 0.1rem 0.1rem;
  scrollbar-gutter: stable;
}
.dca-model-template-box {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.7rem;
  background: var(--dca-raised);
}
.dca-model-template-box > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.dca-model-template-box > header > div {
  display: flex;
  flex-direction: column;
}
.dca-model-template-box small,
.dca-model-template-box > header span {
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}
.dca-model-editor .dca-template-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.4rem;
}
.dca-inline-check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
}
.dca-inline-check input {
  width: auto;
}
.dca-model-editor .muted {
  color: var(--dca-text-muted);
}
.dca-advanced-request {
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.65rem;
}
.dca-advanced-request summary {
  cursor: pointer;
  font-weight: 600;
}
.dca-advanced-request[open] summary {
  margin-bottom: 0.7rem;
}
@media (max-width: 720px) {
  .dca-model-editor-backdrop {
    padding: 0;
    place-items: stretch;
  }
  .dca-model-editor {
    width: 100%;
    height: 100%;
    max-height: none;
    border: 0;
    border-radius: 0;
    padding-top: max(3.35rem, calc(0.85rem + env(safe-area-inset-top)));
  }
  .dca-model-editor .dca-template-picker {
    grid-template-columns: 1fr 1fr;
  }
  .dca-model-editor .dca-template-picker > :first-child {
    grid-column: 1 / -1;
  }
}
</style>
