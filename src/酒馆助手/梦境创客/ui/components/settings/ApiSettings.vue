<template>
  <section class="dca-section-stack dca-provider-settings">
    <header class="dca-section-header">
      <div>
        <h3>Provider 与模型</h3>
        <p>Provider 保存连接；每个模型独立保存兼容模式、能力、上下文与请求覆盖。</p>
      </div>
    </header>

    <div class="dca-provider-layout">
      <aside class="dca-provider-list">
        <header><strong>Providers</strong><small>{{ state.providers.length }}</small></header>
        <button
          v-for="provider in state.providers"
          :key="provider.id"
          type="button"
          :class="{ active: selectedProviderId === provider.id, disabled: !provider.enabled }"
          @click="selectProvider(provider.id)"
        >
          <i class="fa-solid fa-server" aria-hidden="true"></i>
          <span><strong>{{ provider.name }}</strong><small>{{ provider.models.length }} 个模型</small></span>
          <i v-if="!provider.enabled" class="fa-solid fa-ban" title="已禁用" aria-label="已禁用"></i>
        </button>
        <div v-if="state.providers.length === 0" class="dca-empty">还没有 Provider。</div>
      </aside>

      <main class="dca-provider-main">
        <div class="dca-resource-toolbar dca-api-provider-toolbar">
          <div>
            <strong>{{ providerForm.id ? providerForm.name || '未命名 Provider' : '新建 Provider' }}</strong>
            <small>{{ providerForm.id ? `${selectedProvider?.models.length ?? 0} 个模型` : '保存连接后即可添加模型' }}</small>
          </div>
          <div class="dca-row-actions">
            <button type="button" @click="newProvider">新建</button>
            <button v-if="providerForm.id" type="button" @click="copyProvider">复制</button>
            <button type="button" @click="importInput?.click()">导入</button>
            <input ref="importInput" hidden accept="application/json,.json" type="file" @change="importProvider" />
            <button v-if="providerForm.id" type="button" @click="exportChoiceOpen = true">导出</button>
            <button v-if="providerForm.id" class="dca-btn-danger" type="button" @click="deleteTarget = 'provider'">删除</button>
            <button class="dca-btn-primary" type="button" @click="saveProvider">保存 Provider</button>
          </div>
        </div>

        <section class="dca-provider-card">
          <div class="dca-form-grid">
            <label class="dca-field"><span>名称</span><input v-model="providerForm.name" type="text" /></label>
            <label class="dca-field">
              <span>接口格式</span>
              <DcaSelect
                aria-label="Provider 接口格式"
                :model-value="providerForm.interfaceType"
                :options="interfaceOptions"
                @update:model-value="setInterfaceType"
              />
            </label>
            <label class="dca-field dca-provider-enabled"><input v-model="providerForm.enabled" type="checkbox" /><span>启用 Provider</span></label>
            <label class="dca-field wide"><span>Base URL</span><input v-model="providerForm.baseURL" type="url" placeholder="https://服务地址/v1" /></label>
            <label class="dca-field wide">
              <span>API Key</span>
              <input v-model="providerForm.apiKey" type="password" autocomplete="off" :placeholder="providerForm.id ? '留空则保留原 Key' : '仅在请求时临时解密'" />
            </label>
          </div>

          <div class="dca-model-fetch-row">
            <div><strong>从渠道拉取模型</strong><small>需要先填写 Base URL 和 API Key；不会发送额外测试请求。</small></div>
            <button type="button" :disabled="modelsLoading || !providerForm.baseURL.trim()" @click="fetchModels">
              <i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i>{{ modelsLoading ? '读取中' : '拉取模型' }}
            </button>
          </div>

          <details class="dca-advanced-request">
            <summary>高级请求设置（Provider 默认值）</summary>
            <div class="dca-form-grid">
              <label class="dca-field wide"><span>自定义请求标头（JSON）</span><textarea v-model="providerForm.headers" rows="5" spellcheck="false" placeholder="{}"></textarea></label>
              <label class="dca-field">
                <span>附加参数格式</span>
                <DcaSelect aria-label="Provider 附加参数格式" :model-value="providerForm.extraFormat" :options="extraFormatOptions" @update:model-value="convertExtraFormat" />
              </label>
              <label class="dca-field wide">
                <span>自定义附加参数</span>
                <textarea v-model="providerForm.extraText" rows="8" spellcheck="false" placeholder="metadata:&#10;  source: dream-card-agent"></textarea>
                <small>模型层递归覆盖这些值；数组与标量整体覆盖，null 删除继承字段。</small>
              </label>
            </div>
          </details>
        </section>

        <section class="dca-provider-models">
          <header>
            <div><strong>模型</strong><small>会话按 Provider 分组选择启用模型</small></div>
            <button type="button" :disabled="!providerForm.id" @click="openModelEditor()"><i class="fa-solid fa-plus" aria-hidden="true"></i> 手动添加</button>
          </header>
          <div v-if="!providerForm.id" class="dca-empty">先保存 Provider，再添加模型。</div>
          <div v-else-if="selectedProvider?.models.length === 0" class="dca-empty">尚未添加模型。可以手动添加，或从接口拉取。</div>
          <div v-else class="dca-model-list">
            <article v-for="model in selectedProvider?.models" :key="model.id" :class="{ disabled: !model.enabled }">
              <div class="dca-model-icon"><i class="fa-solid fa-microchip" aria-hidden="true"></i></div>
              <div>
                <strong>{{ model.name }}</strong><code>{{ model.modelId }}</code>
                <small>{{ compatibilityLabel(model.compatibilityMode) }} · {{ formatTokens(model.modelSettings.contextWindow) }} 上下文</small>
              </div>
              <span v-if="isDefaultModel(model.id)" class="dca-default-model"><i class="fa-solid fa-star" aria-hidden="true"></i> 新会话默认</span>
              <span v-if="!model.enabled" class="dca-model-disabled">已禁用</span>
              <div class="dca-row-actions">
                <button type="button" title="设为新会话默认" @click="setDefault(model.id)"><i class="fa-regular fa-star" aria-hidden="true"></i></button>
                <button type="button" title="编辑" @click="openModelEditor(model)"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                <button type="button" title="复制" @click="openModelEditor(model, true)"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
                <button class="dca-btn-danger" type="button" title="删除" @click="requestModelDelete(model)"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
              </div>
            </article>
          </div>
        </section>
        <p class="dca-security-note">API Key、请求标头和附加参数使用 AES-GCM 可逆混淆保存；这不是安全保险箱，建议只在本地酒馆使用。</p>
      </main>
    </div>

    <ModelEditorDialog
      :copying="copyingModel"
      :model="editingModel"
      :open="modelEditorOpen"
      :provider="selectedProvider"
      @close="modelEditorOpen = false"
      @saved="modelSaved"
    />

    <div v-if="remoteModelsOpen" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-remote-models" role="dialog" aria-modal="true" aria-labelledby="dca-remote-model-title">
        <header>
          <div><h3 id="dca-remote-model-title">渠道模型</h3><p>点击加号添加；同一实际 ID 可以添加多次。</p></div>
          <button class="dca-icon-btn" type="button" title="关闭" @click="remoteModelsOpen = false"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <label class="dca-search-field"><i class="fa-solid fa-magnifying-glass"></i><input v-model="remoteFilter" type="search" placeholder="筛选模型 ID" /></label>
        <div class="dca-remote-model-list">
          <div v-for="modelId in filteredRemoteModels" :key="modelId">
            <code>{{ modelId }}</code><small v-if="remoteCount(modelId)">已添加 ×{{ remoteCount(modelId) }}</small>
            <button type="button" :disabled="remoteAdding === modelId" @click="addRemoteModel(modelId)"><i class="fa-solid fa-plus"></i></button>
          </div>
        </div>
        <footer><span>共 {{ remoteModels.length }} 个模型</span><button type="button" @click="remoteModelsOpen = false">完成</button></footer>
      </section>
    </div>

    <div v-if="exportChoiceOpen" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-provider-confirm" role="dialog" aria-modal="true">
        <header><div><h3>导出 Provider</h3><p>默认不会导出 API Key、自定义标头和附加参数。</p></div></header>
        <footer>
          <button type="button" @click="exportChoiceOpen = false">取消</button>
          <button type="button" @click="exportProvider(false)">不含敏感配置</button>
          <button class="dca-btn-danger" type="button" @click="exportProvider(true)">包含敏感配置</button>
        </footer>
      </section>
    </div>

    <div v-if="deleteTarget" class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-provider-confirm" role="dialog" aria-modal="true">
        <header><div><h3>确认删除</h3><p>{{ deleteTarget === 'provider' ? '删除 Provider 会同时删除其中全部模型；历史会话不会逐条扫描。' : `删除模型“${deletingModel?.name}”？` }}</p></div></header>
        <footer><button type="button" @click="cancelDelete">取消</button><button class="dca-btn-danger" type="button" @click="confirmDelete">确认删除</button></footer>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { convertAdvancedRequestDocument, type AdvancedRequestFormat } from '../../../core/provider/advanced-request';
import { builtinModelTemplates, defaultModelSettings, matchModelTemplates, settingsForAppliedTemplate } from '../../../core/provider/model-catalog';
import type { ApiModel, ApiProvider, ApiProviderInput } from '../../../core/provider/provider-config';
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSelect, { type SelectOption } from '../DcaSelect.vue';
import ModelEditorDialog from './ModelEditorDialog.vue';

const { action, runtime, state } = useDreamCardAgent();
const selectedProviderId = ref('');
const importInput = ref<HTMLInputElement>();
const modelEditorOpen = ref(false);
const editingModel = ref<ApiModel>();
const copyingModel = ref(false);
const modelsLoading = ref(false);
const remoteModelsOpen = ref(false);
const remoteModels = ref<string[]>([]);
const remoteFilter = ref('');
const remoteAdding = ref('');
const exportChoiceOpen = ref(false);
const deleteTarget = ref<'model' | 'provider'>();
const deletingModel = ref<ApiModel>();

type ProviderForm = {
  apiKey: string; baseURL: string; enabled: boolean; extraFormat: AdvancedRequestFormat; extraText: string;
  headers: string; id: string; interfaceType: ApiProviderInput['interfaceType']; name: string;
};
const providerForm = reactive<ProviderForm>(emptyProviderForm());
const selectedProvider = computed(() => state.value.providers.find(item => item.id === selectedProviderId.value));
const interfaceOptions: SelectOption[] = [
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'OpenAI Chat / 兼容接口', value: 'openai-chat' },
  { label: 'Anthropic Messages', value: 'anthropic' },
];
const extraFormatOptions: SelectOption[] = [{ label: 'YAML', value: 'yaml' }, { label: 'JSON', value: 'json' }];
const filteredRemoteModels = computed(() => {
  const query = remoteFilter.value.trim().toLocaleLowerCase();
  return query ? remoteModels.value.filter(item => item.toLocaleLowerCase().includes(query)) : remoteModels.value;
});

watch(() => state.value.providers.map(item => item.id).join('|'), () => {
  if (selectedProviderId.value && state.value.providers.some(item => item.id === selectedProviderId.value)) return;
  selectedProviderId.value = state.value.providers[0]?.id ?? '';
}, { immediate: true });

watch(selectedProviderId, async id => {
  const provider = state.value.providers.find(item => item.id === id);
  if (!provider) { Object.assign(providerForm, emptyProviderForm()); return; }
  Object.assign(providerForm, {
    apiKey: '', baseURL: provider.baseURL, enabled: provider.enabled, extraFormat: 'yaml', extraText: '', headers: '{}',
    id: provider.id, interfaceType: provider.interfaceType, name: provider.name,
  });
  try {
    const values = await runtime.revealProvider(provider.id);
    if (selectedProviderId.value !== id) return;
    providerForm.headers = JSON.stringify(values.headers, null, 2);
    providerForm.extraFormat = values.extraParameters.format;
    providerForm.extraText = values.extraParameters.text;
  } catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '梦境创客'); }
}, { immediate: true });

function emptyProviderForm(): ProviderForm { return { apiKey: '', baseURL: '', enabled: true, extraFormat: 'yaml', extraText: '', headers: '{}', id: '', interfaceType: 'openai-chat', name: '' }; }
function selectProvider(id: string) { selectedProviderId.value = id; }
function newProvider() { selectedProviderId.value = ''; Object.assign(providerForm, emptyProviderForm()); }
function setInterfaceType(value: string) { if (value === 'anthropic' || value === 'openai-chat' || value === 'openai-responses') providerForm.interfaceType = value; }

function providerInput(): ApiProviderInput {
  let headers: Record<string, string>;
  try { headers = providerForm.headers.trim() ? JSON.parse(providerForm.headers) as Record<string, string> : {}; }
  catch (error) { throw new Error('Provider 自定义请求标头不是有效的JSON。', { cause: error }); }
  return {
    apiKey: providerForm.apiKey, baseURL: providerForm.baseURL, enabled: providerForm.enabled,
    extraParameters: { format: providerForm.extraFormat, text: providerForm.extraText }, headers,
    id: providerForm.id || undefined, interfaceType: providerForm.interfaceType, name: providerForm.name,
  };
}

async function saveProvider() {
  let saved: ApiProvider | undefined;
  const succeeded = await action(async () => { saved = await runtime.saveProvider(providerInput()); });
  if (succeeded && saved) { selectedProviderId.value = saved.id; providerForm.id = saved.id; providerForm.apiKey = ''; }
}
async function copyProvider() {
  if (!providerForm.id) return;
  let copied: ApiProvider | undefined;
  if (await action(async () => { copied = await runtime.copyProvider(providerForm.id); })) selectedProviderId.value = copied!.id;
}
async function convertExtraFormat(value: string) {
  if (value !== 'yaml' && value !== 'json') return;
  try { const result = convertAdvancedRequestDocument({ format: providerForm.extraFormat, text: providerForm.extraText }, value); providerForm.extraFormat = result.format; providerForm.extraText = result.text; }
  catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '梦境创客'); }
}

async function fetchModels() {
  modelsLoading.value = true;
  try {
    remoteModels.value = await runtime.listModels(providerInput()); remoteFilter.value = ''; remoteModelsOpen.value = true;
    if (!remoteModels.value.length) toastr.warning('接口返回了空模型列表。', '梦境创客');
  } catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '梦境创客'); }
  finally { modelsLoading.value = false; }
}
function remoteCount(modelId: string) { return selectedProvider.value?.models.filter(item => item.modelId === modelId).length ?? 0; }
function uniqueModelName(base: string) {
  const used = new Set(selectedProvider.value?.models.map(item => item.name.normalize('NFC')) ?? []);
  if (!used.has(base.normalize('NFC'))) return base;
  let index = 2; while (used.has(`${base} ${index}`.normalize('NFC'))) index += 1; return `${base} ${index}`;
}
async function addRemoteModel(modelId: string) {
  if (!selectedProvider.value) { toastr.error('请先保存 Provider。', '梦境创客'); return; }
  remoteAdding.value = modelId;
  try {
    const template = matchModelTemplates(modelId, builtinModelTemplates().filter(item => !item.interfaceType || item.interfaceType === selectedProvider.value!.interfaceType), 1)[0]?.template;
    const settings = template ? settingsForAppliedTemplate(template, defaultModelSettings()) : defaultModelSettings();
    await runtime.saveModel(selectedProvider.value.id, {
      appliedModelTemplate: template ? { id: template.id, revision: template.revision, source: template.source } : null,
      compatibilityMode: template?.compatibilityMode ?? 'standard', enabled: true, modelId, modelSettings: settings, name: uniqueModelName(modelId),
    });
  } catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '梦境创客'); }
  finally { remoteAdding.value = ''; }
}

function openModelEditor(model?: ApiModel, copy = false) { editingModel.value = model; copyingModel.value = copy; modelEditorOpen.value = true; }
function modelSaved() { modelEditorOpen.value = false; editingModel.value = undefined; copyingModel.value = false; }
function requestModelDelete(model: ApiModel) { deletingModel.value = model; deleteTarget.value = 'model'; }
function cancelDelete() { deleteTarget.value = undefined; deletingModel.value = undefined; }
async function confirmDelete() {
  const target = deleteTarget.value;
  if (target === 'provider' && providerForm.id) {
    if (await action(() => runtime.removeProvider(providerForm.id))) newProvider();
  } else if (target === 'model' && providerForm.id && deletingModel.value) {
    await action(() => runtime.removeModel(providerForm.id, deletingModel.value!.id));
  }
  cancelDelete();
}

async function setDefault(modelId: string) { if (selectedProvider.value) await action(() => runtime.selectDefaultModel({ providerId: selectedProvider.value!.id, modelId })); }
function isDefaultModel(modelId: string) { return state.value.defaultModelSelection?.providerId === selectedProvider.value?.id && state.value.defaultModelSelection.modelId === modelId; }

async function exportProvider(includeSecrets: boolean) {
  exportChoiceOpen.value = false;
  if (!providerForm.id) return;
  try {
    const source = await runtime.exportProviderBundle(providerForm.id, includeSecrets);
    const blob = new Blob([source], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${providerForm.name || 'provider'}.dream-provider.json`; anchor.click();
    queueMicrotask(() => URL.revokeObjectURL(url));
  } catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '梦境创客'); }
}
async function importProvider(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  let imported: ApiProvider | undefined;
  if (await action(async () => { imported = await runtime.importProviderBundle(await file.text()); })) selectedProviderId.value = imported!.id;
}

function compatibilityLabel(value: ApiModel['compatibilityMode']) { return value === 'deepseek' ? 'DeepSeek 模式' : '标准模式'; }
function formatTokens(value: number) { if (!value) return '自动'; if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`; if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`; return String(value); }
</script>

<style lang="scss">
.dca-provider-layout { display: grid; min-height: 32rem; grid-template-columns: 13rem minmax(0, 1fr); gap: .75rem; }
.dca-provider-list { display: flex; min-width: 0; flex-direction: column; gap: .25rem; border-right: 1px solid var(--dca-border); padding-right: .65rem; }
.dca-provider-list > header { display: flex; align-items: center; justify-content: space-between; padding: .35rem .45rem; }
.dca-provider-list > header small { color: var(--dca-text-muted); }
.dca-provider-list > button { display: grid; grid-template-columns: 1.2rem minmax(0, 1fr) auto; align-items: center; gap: .45rem; border-color: transparent; padding: .55rem; background: transparent; text-align: left; }
.dca-provider-list > button.active { border-color: var(--dca-border); background: var(--dca-accent-soft); color: var(--dca-accent); }
.dca-provider-list > button.disabled { opacity: .62; }
.dca-provider-list > button span { display: flex; min-width: 0; flex-direction: column; }
.dca-provider-list > button strong, .dca-provider-list > button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dca-provider-list > button small { color: var(--dca-text-muted); font-size: .68rem; }
.dca-provider-main { display: flex; min-width: 0; flex-direction: column; gap: .75rem; }
.dca-api-provider-toolbar { position: sticky; z-index: 5; top: 0; justify-content: space-between; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-md); padding: .55rem; background: color-mix(in srgb, var(--dca-surface) 94%, transparent); backdrop-filter: blur(10px); }
.dca-api-provider-toolbar > div:first-child { display: flex; min-width: 0; flex-direction: column; }
.dca-api-provider-toolbar small { color: var(--dca-text-muted); }
.dca-provider-card, .dca-provider-models { display: flex; flex-direction: column; gap: .7rem; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-lg); padding: .75rem; background: var(--dca-surface); }
.dca-provider-enabled { flex-direction: row; align-items: center; gap: .45rem; }
.dca-provider-enabled input { width: auto; }
.dca-model-fetch-row, .dca-provider-models > header { display: flex; align-items: center; justify-content: space-between; gap: .6rem; border-top: 1px solid var(--dca-border); padding-top: .7rem; }
.dca-model-fetch-row > div, .dca-provider-models > header > div { display: flex; flex-direction: column; }
.dca-model-fetch-row small, .dca-provider-models > header small { color: var(--dca-text-muted); font-size: .72rem; }
.dca-model-list { display: flex; flex-direction: column; gap: .4rem; }
.dca-model-list article { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto auto auto; align-items: center; gap: .55rem; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-md); padding: .55rem; background: var(--dca-raised); }
.dca-model-list article.disabled { opacity: .62; }
.dca-model-icon { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: var(--dca-radius-sm); background: var(--dca-accent-soft); color: var(--dca-accent); }
.dca-model-list article > div:nth-child(2) { display: flex; min-width: 0; flex-direction: column; }
.dca-model-list code { overflow: hidden; color: var(--dca-text-muted); font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }
.dca-model-list small { color: var(--dca-text-muted); font-size: .68rem; }
.dca-default-model { color: var(--dca-warning); font-size: .7rem; }
.dca-model-disabled { color: var(--dca-text-muted); font-size: .7rem; }
.dca-security-note { margin: 0; border-left: 3px solid var(--dca-warning); padding-left: .65rem; color: var(--dca-text-muted); font-size: .78rem; }
.dca-remote-models { width: min(42rem, calc(100vw - 2rem)); max-height: min(80vh, 44rem); }
.dca-search-field { display: flex; align-items: center; gap: .45rem; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-md); padding: .35rem .55rem; }
.dca-search-field input { flex: 1; border: 0; background: transparent; box-shadow: none; }
.dca-remote-model-list { display: flex; min-height: 10rem; flex-direction: column; gap: .25rem; overflow-y: auto; }
.dca-remote-model-list > div { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: .5rem; border-bottom: 1px solid var(--dca-border); padding: .45rem; }
.dca-remote-model-list small { color: var(--dca-text-muted); }
.dca-provider-confirm { width: min(34rem, calc(100vw - 2rem)); }
@media (max-width: 720px) {
  .dca-provider-layout { grid-template-columns: 1fr; }
  .dca-provider-list { max-height: 10rem; border-right: 0; border-bottom: 1px solid var(--dca-border); padding: 0 0 .55rem; overflow-y: auto; }
  .dca-api-provider-toolbar { position: static; align-items: stretch; }
  .dca-api-provider-toolbar .dca-row-actions { overflow-x: auto; }
  .dca-model-fetch-row { align-items: stretch; flex-direction: column; }
  .dca-model-list article { grid-template-columns: 2rem minmax(0, 1fr) auto; }
  .dca-model-list article > .dca-row-actions { grid-column: 2 / -1; justify-content: flex-end; }
  .dca-default-model, .dca-model-disabled { grid-column: 2 / -1; }
  .dca-remote-models { width: 100%; height: 100%; max-height: none; border-radius: 0; }
}
</style>
