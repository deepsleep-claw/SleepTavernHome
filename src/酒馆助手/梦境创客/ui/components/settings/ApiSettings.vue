<template>
  <section class="dca-section-stack">
    <header class="dca-section-header">
      <div>
        <h3>API Profile</h3>
        <p>接口格式决定请求结构，兼容模式处理渠道差异；模型模板只在你点击“应用”时复制参数。</p>
      </div>
    </header>
    <div class="dca-resource-toolbar">
      <label class="dca-field">
        <span>已保存 Profile</span>
        <select :value="state.activeProfileId" @change="selectProfile">
          <option value="">请选择</option>
          <option v-for="profile in state.profiles" :key="profile.id" :value="profile.id">
            {{ profile.name }} · {{ profile.model }}
          </option>
        </select>
      </label>
      <div class="dca-row-actions">
        <button type="button" @click="resetProfileForm">新建</button>
        <button v-if="profileForm.id" class="dca-btn-danger" type="button" @click="removeProfile">删除</button>
      </div>
    </div>

    <div class="dca-form-grid">
      <label class="dca-field"><span>名称</span><input v-model="profileForm.name" type="text" /></label>
      <label class="dca-field">
        <span>接口格式</span>
        <select v-model="profileForm.interfaceType">
          <option value="openai-responses">OpenAI Responses</option>
          <option value="openai-chat">OpenAI Chat</option>
          <option value="anthropic">Anthropic Messages</option>
        </select>
      </label>
      <label class="dca-field">
        <span>兼容模式</span>
        <select v-model="profileForm.compatibilityMode">
          <option value="standard">标准</option>
          <option value="deepseek">DeepSeek</option>
        </select>
      </label>
      <label class="dca-field wide">
        <span>Base URL</span>
        <input v-model="profileForm.baseURL" type="url" placeholder="API版本根路径，例如 https://服务地址/v1" />
      </label>
      <label class="dca-field wide">
        <span>模型</span>
        <div class="dca-model-picker">
          <SearchableCombobox
            v-model="profileForm.model"
            free-input
            :options="modelOptions.map(model => ({ label: model, value: model }))"
            placeholder="输入模型 ID，或从接口返回列表中选择"
          />
          <button type="button" :disabled="modelsLoading || !profileForm.baseURL.trim()" @click="fetchModels">
            <i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i>
            {{ modelsLoading ? '读取中' : '获取模型' }}
          </button>
        </div>
        <small v-if="modelOptions.length">接口返回 {{ modelOptions.length }} 个模型；输入框仍允许填写任意 ID。</small>
      </label>
      <label class="dca-field">
        <span>API Key</span>
        <input
          v-model="profileForm.apiKey"
          type="password"
          autocomplete="off"
          :placeholder="profileForm.id ? '留空则保留已保存Key' : '加盐混淆保存'"
        />
      </label>
      <label class="dca-field wide">
        <span>自定义请求头（JSON，默认空）</span>
        <textarea
          v-model="profileForm.headers"
          rows="4"
          :placeholder="profileForm.id ? '留空则保留已保存请求头' : '{}'"
          spellcheck="false"
        ></textarea>
      </label>
    </div>

    <section class="dca-model-config">
      <header>
        <div>
          <strong>模型配置模板</strong>
          <small>根据模型 ID 推荐；应用后仍可逐项修改</small>
        </div>
        <span class="dca-config-source" :class="templateSourceClass">{{ templateSourceLabel }}</span>
      </header>
      <div class="dca-template-picker">
        <SearchableCombobox v-model="selectedTemplateId" :options="templateOptions" placeholder="搜索模型模板" />
        <button type="button" :disabled="!selectedTemplate" @click="applyTemplate">应用</button>
        <button type="button" :disabled="cloudLoading" @click="refreshCloudCatalog">
          <i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i>
          {{ cloudLoading ? '补充中' : '云端补充' }}
        </button>
      </div>
      <p v-if="selectedTemplate" class="dca-template-summary">
        {{ selectedTemplate.name }} · 上下文 {{ formatTokens(selectedTemplate.settings.contextWindow) }} · 输出
        {{ formatTokens(selectedTemplate.settings.maxOutputTokens) }}
        <a v-if="selectedTemplate.sourceUrl" :href="selectedTemplate.sourceUrl" target="_blank" rel="noreferrer">来源</a>
      </p>
      <div class="dca-config-divider"></div>
      <div class="dca-form-grid" @input.capture="markModelSettingsCustom" @change.capture="markModelSettingsCustom">
        <label class="dca-field">
          <span>上下文窗口</span>
          <input v-model.number="profileForm.contextWindow" min="0" step="1" type="number" />
          <small>填 0 使用自动值；无法识别时按 128K 估算。</small>
        </label>
        <label class="dca-field">
          <span>模型输出上限</span>
          <input v-model.number="profileForm.maxOutputTokens" min="0" step="1" type="number" />
          <small>填 0 表示不主动传入 maxOutputTokens。</small>
        </label>
        <label class="dca-field" :class="{ 'dca-sampling-muted': samplingIgnoredWhenReasoning }">
          <span>
            温度
            <i
              v-if="samplingIgnoredWhenReasoning"
              class="fa-solid fa-circle-exclamation dca-field-hint"
              title="当前兼容模式的思考状态下不会发送此参数；保存值会保留，关闭思考后恢复使用。"
              aria-label="思考状态下不发送"
            ></i>
          </span>
          <input v-model.number="profileForm.temperature" min="0" step="0.01" type="number" placeholder="自动" />
        </label>
        <label class="dca-field" :class="{ 'dca-sampling-muted': samplingIgnoredWhenReasoning }">
          <span>
            Top P
            <i
              v-if="samplingIgnoredWhenReasoning"
              class="fa-solid fa-circle-exclamation dca-field-hint"
              title="当前兼容模式的思考状态下不会发送此参数；保存值会保留，关闭思考后恢复使用。"
              aria-label="思考状态下不发送"
            ></i>
          </span>
          <input v-model.number="profileForm.topP" min="0" max="1" step="0.01" type="number" placeholder="自动" />
        </label>
        <label v-for="capability in capabilityFields" :key="capability.key" class="dca-field">
          <span>{{ capability.label }}</span>
          <select v-model="profileForm.capabilities[capability.key]">
            <option value="auto">自动</option>
            <option value="enabled">支持</option>
            <option value="disabled">不支持</option>
          </select>
        </label>
        <label class="dca-field wide">
          <span>自定义推理强度</span>
          <textarea
            v-model="profileForm.reasoningEfforts"
            rows="5"
            spellcheck="false"
            placeholder="低:low&#10;高:high&#10;极高:xhigh&#10;最高:max"
          ></textarea>
          <small>每行“显示名称:传给接口的 ID”。不确定时可留空，仅显示自动与关闭。</small>
        </label>
      </div>
    </section>

    <p class="dca-security-note">
      AES-GCM 与固定脚本密码只能避免明文展示，不是安全保险箱。建议只在本地酒馆使用。
    </p>
    <div class="dca-resource-savebar">
      <span>{{ profileForm.id ? '正在编辑已保存 Profile' : '正在创建新 Profile' }}</span>
      <button class="dca-btn-primary" type="button" @click="saveProfile">保存 Profile</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  builtinModelTemplates,
  filterModelTemplatesForScope,
  fetchModelsDevCatalog,
  matchModelTemplates,
  settingsForAppliedTemplate,
  type CapabilitySetting,
  type AppliedModelTemplate,
  type ModelCapabilityKey,
  type ModelTemplate,
} from '../../../core/provider/model-catalog';
import type { ApiProfileInput } from '../../../core/provider/profiles';
import { useDreamCardAgent } from '../../composables/runtime';
import SearchableCombobox, { type ComboboxOption } from '../SearchableCombobox.vue';

type ProfileForm = {
  apiKey: string;
  baseURL: string;
  capabilities: Record<ModelCapabilityKey, CapabilitySetting>;
  compatibilityMode: ApiProfileInput['compatibilityMode'];
  contextWindow: number;
  headers: string;
  id: string;
  interfaceType: ApiProfileInput['interfaceType'];
  maxOutputTokens: number;
  model: string;
  name: string;
  reasoningEfforts: string;
  temperature: number | string;
  topP: number | string;
};

const { action, runtime, state } = useDreamCardAgent();
const builtinTemplates = builtinModelTemplates();
const cloudTemplates = ref<ModelTemplate[]>([]);
const cloudLoading = ref(false);
const modelOptions = ref<string[]>([]);
const modelsLoading = ref(false);
const selectedTemplateId = ref('custom');
const appliedTemplateReference = ref<AppliedModelTemplate>();
let formLoading = false;
let cloudAttempted = false;
let modelMatchTimer: number | undefined;

const profileForm = reactive<ProfileForm>(emptyProfileForm());
const capabilityFields: { key: ModelCapabilityKey; label: string }[] = [
  { key: 'vision', label: '视觉能力' },
  { key: 'reasoning', label: '推理能力' },
  { key: 'webSearch', label: '内置联网工具' },
  { key: 'toolCalling', label: '工具调用' },
];

const allTemplates = computed(() => {
  const result = new Map<string, ModelTemplate>();
  [...builtinTemplates, ...cloudTemplates.value].forEach(template => result.set(template.id, template));
  return [...result.values()];
});
const templateScope = computed(() => ({
  compatibilityMode: profileForm.compatibilityMode,
  interfaceType: profileForm.interfaceType,
}));
const availableTemplates = computed(() => filterModelTemplatesForScope(allTemplates.value, templateScope.value));
const rankedTemplates = computed(() => {
  const matches = matchModelTemplates(profileForm.model, availableTemplates.value, 50, templateScope.value);
  const matched = new Set(matches.map(item => item.template.id));
  return [...matches.map(item => item.template), ...availableTemplates.value.filter(item => !matched.has(item.id))];
});
const templateOptions = computed<ComboboxOption[]>(() => [
  { description: '保留你手动填写的参数', label: '自定义', value: 'custom' },
  ...rankedTemplates.value.map(template => ({
    description: `${sourceLabel(template.source)} · ${formatTokens(template.settings.contextWindow)} 上下文`,
    label: `${template.name}（${template.provider}）`,
    value: template.id,
  })),
]);
const selectedTemplate = computed(() => availableTemplates.value.find(template => template.id === selectedTemplateId.value));
const samplingIgnoredWhenReasoning = computed(() => profileForm.compatibilityMode === 'deepseek');
const templateSourceLabel = computed(() => {
  if (selectedTemplateId.value === 'custom') return '自定义';
  return sourceLabel(selectedTemplate.value?.source ?? 'builtin');
});
const templateSourceClass = computed(() => selectedTemplate.value?.source ?? 'custom');

watch(
  () => state.value.activeProfileId,
  id => {
    const profile = state.value.profiles.find(item => item.id === id);
    formLoading = true;
    if (profile) {
      Object.assign(profileForm, {
        apiKey: '',
        baseURL: profile.baseURL,
        capabilities: { ...profile.modelSettings.capabilities },
        compatibilityMode: profile.compatibilityMode,
        contextWindow: profile.modelSettings.contextWindow,
        headers: '',
        id: profile.id,
        interfaceType: profile.interfaceType,
        maxOutputTokens: profile.modelSettings.maxOutputTokens,
        model: profile.model,
        name: profile.name,
        reasoningEfforts: formatReasoningEfforts(profile.modelSettings.reasoningEfforts),
        temperature: profile.modelSettings.temperature ?? '',
        topP: profile.modelSettings.topP ?? '',
      });
      selectedTemplateId.value = profile.appliedModelTemplate?.id ?? 'custom';
      appliedTemplateReference.value = profile.appliedModelTemplate
        ? { ...profile.appliedModelTemplate }
        : undefined;
    }
    modelOptions.value = [];
    queueMicrotask(() => {
      formLoading = false;
    });
  },
  { immediate: true },
);

watch(
  () => profileForm.model,
  model => {
    if (formLoading) return;
    const localMatch = matchModelTemplates(model, builtinTemplates, 1, templateScope.value)[0];
    selectedTemplateId.value = localMatch && localMatch.score >= 0.78 ? localMatch.template.id : 'custom';
    appliedTemplateReference.value = undefined;
    if (modelMatchTimer !== undefined) window.clearTimeout(modelMatchTimer);
    if (!localMatch || localMatch.score < 0.85) {
      modelMatchTimer = window.setTimeout(() => void loadCloudCatalog(false), 350);
    }
  },
);

watch(
  () => [profileForm.interfaceType, profileForm.compatibilityMode] as const,
  () => {
    if (formLoading) return;
    const localMatch = matchModelTemplates(profileForm.model, builtinTemplates, 1, templateScope.value)[0];
    selectedTemplateId.value = localMatch && localMatch.score >= 0.78 ? localMatch.template.id : 'custom';
    appliedTemplateReference.value = undefined;
  },
);

function emptyProfileForm(): ProfileForm {
  return {
    apiKey: '',
    baseURL: '',
    capabilities: { reasoning: 'auto', toolCalling: 'auto', vision: 'auto', webSearch: 'auto' },
    compatibilityMode: 'standard',
    contextWindow: 0,
    headers: '{}',
    id: '',
    interfaceType: 'openai-chat',
    maxOutputTokens: 0,
    model: '',
    name: '',
    reasoningEfforts: '',
    temperature: '',
    topP: '',
  };
}

function resetProfileForm() {
  formLoading = true;
  Object.assign(profileForm, emptyProfileForm());
  selectedTemplateId.value = 'custom';
  appliedTemplateReference.value = undefined;
  modelOptions.value = [];
  queueMicrotask(() => {
    formLoading = false;
  });
}

function parseReasoningEfforts(source: string) {
  return source
    .split(/\r?\n/gu)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const separator = line.indexOf(':');
      if (separator <= 0 || separator === line.length - 1) throw new Error(`推理强度格式错误：${line}`);
      return { id: line.slice(separator + 1).trim(), name: line.slice(0, separator).trim() };
    });
}

function formatReasoningEfforts(efforts: { id: string; name: string }[]) {
  return efforts.map(item => `${item.name}:${item.id}`).join('\n');
}

function optionalNumber(value: number | string): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function profileInput(): ApiProfileInput {
  const headers = profileForm.headers.trim() ? (JSON.parse(profileForm.headers) as Record<string, string>) : undefined;
  return {
    apiKey: profileForm.apiKey,
    appliedModelTemplate: appliedTemplateReference.value ? { ...appliedTemplateReference.value } : null,
    baseURL: profileForm.baseURL,
    compatibilityMode: profileForm.compatibilityMode,
    headers,
    id: profileForm.id || undefined,
    interfaceType: profileForm.interfaceType,
    model: profileForm.model,
    modelSettings: {
      capabilities: { ...profileForm.capabilities },
      contextWindow: profileForm.contextWindow,
      maxOutputTokens: profileForm.maxOutputTokens,
      reasoningEfforts: parseReasoningEfforts(profileForm.reasoningEfforts),
      temperature: optionalNumber(profileForm.temperature),
      topP: optionalNumber(profileForm.topP),
    },
    name: profileForm.name,
  };
}

function applyTemplate() {
  const template = selectedTemplate.value;
  if (!template) return;
  formLoading = true;
  const settings = settingsForAppliedTemplate(template, {
    capabilities: { ...profileForm.capabilities },
    contextWindow: profileForm.contextWindow,
    maxOutputTokens: profileForm.maxOutputTokens,
    reasoningEfforts: parseReasoningEfforts(profileForm.reasoningEfforts),
    temperature: optionalNumber(profileForm.temperature),
    topP: optionalNumber(profileForm.topP),
  });
  Object.assign(profileForm, {
    capabilities: { ...settings.capabilities },
    contextWindow: settings.contextWindow,
    maxOutputTokens: settings.maxOutputTokens,
    reasoningEfforts: formatReasoningEfforts(settings.reasoningEfforts),
    temperature: settings.temperature ?? '',
    topP: settings.topP ?? '',
  });
  appliedTemplateReference.value = { id: template.id, revision: template.revision, source: template.source };
  queueMicrotask(() => {
    formLoading = false;
  });
}

function markModelSettingsCustom() {
  if (!formLoading) {
    selectedTemplateId.value = 'custom';
    appliedTemplateReference.value = undefined;
  }
}

async function saveProfile() {
  try {
    if (await action(() => runtime.saveProfile(profileInput()))) {
      profileForm.apiKey = '';
      profileForm.headers = '';
    }
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
  }
}

async function fetchModels() {
  modelsLoading.value = true;
  try {
    modelOptions.value = await runtime.listModels(profileInput());
    if (modelOptions.value.length === 0) toastr.warning('接口返回了空模型列表。', '梦境创客');
    else toastr.success(`已读取 ${modelOptions.value.length} 个模型。`, '梦境创客');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
  } finally {
    modelsLoading.value = false;
  }
}

async function loadCloudCatalog(notify: boolean) {
  if (cloudLoading.value || (cloudAttempted && !notify)) return;
  cloudAttempted = true;
  cloudLoading.value = true;
  try {
    cloudTemplates.value = await fetchModelsDevCatalog();
    const match = matchModelTemplates(profileForm.model, allTemplates.value, 1, templateScope.value)[0];
    if (selectedTemplateId.value === 'custom' && match) selectedTemplateId.value = match.template.id;
    if (notify) toastr.success(`云端补充了 ${cloudTemplates.value.length} 个模型模板。`, '梦境创客');
  } catch (error) {
    if (notify) toastr.warning(error instanceof Error ? error.message : String(error), '梦境创客');
  } finally {
    cloudLoading.value = false;
  }
}

async function refreshCloudCatalog() {
  cloudAttempted = false;
  await loadCloudCatalog(true);
}

async function removeProfile() {
  if (await action(() => runtime.removeProfile(profileForm.id))) resetProfileForm();
}

async function selectProfile(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  if (id) await action(() => runtime.selectProfile(id));
}

function sourceLabel(source: ModelTemplate['source']) {
  return source === 'builtin' ? '内置资料' : source === 'cloud' ? 'models.dev 云端' : '接口元数据';
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}
</script>

<style lang="scss">
.dca-model-picker,
.dca-template-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.4rem;
}

.dca-template-picker {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.dca-model-config {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-lg);
  padding: 0.75rem;
  background: var(--dca-surface);
}

.dca-model-config > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.dca-model-config > header > div {
  display: flex;
  flex-direction: column;
}

.dca-model-config > header small,
.dca-template-summary {
  color: var(--dca-text-muted);
  font-size: 0.76rem;
}

.dca-config-source {
  border-radius: 999px;
  padding: 0.16rem 0.48rem;
  background: var(--dca-raised);
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}

.dca-config-source.builtin {
  background: var(--dca-accent-soft);
  color: var(--dca-accent);
}

.dca-template-summary {
  margin: 0;
}

.dca-template-summary a {
  margin-left: 0.35rem;
}

.dca-config-divider {
  height: 1px;
  background: var(--dca-border);
}

.dca-sampling-muted > span,
.dca-sampling-muted input {
  color: var(--dca-text-muted);
}

.dca-field-hint {
  margin-left: 0.25rem;
  cursor: help;
}

.dca-security-note {
  margin: 0;
  border-left: 3px solid var(--dca-warning);
  padding-left: 0.65rem;
  color: var(--dca-text-muted);
  font-size: 0.82rem;
}

@media (max-width: 620px) {
  .dca-template-picker {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .dca-template-picker > :first-child {
    grid-column: 1 / -1;
  }
}
</style>
