<template>
  <div class="dca-session-model-menu">
    <button class="dca-session-model-trigger" type="button" :disabled="state.busy && !isRunning" @click="toggle">
      <i class="fa-solid fa-bolt" aria-hidden="true"></i>
      <span>{{ selectedModel?.name ?? '未选择模型' }}</span>
      <small v-if="supportsReasoning">{{ reasoningLabel }}</small>
      <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
    </button>
    <div v-if="open" class="dca-model-menu-backdrop" role="presentation" @pointerdown.self="close">
      <section class="dca-model-menu-panel" role="dialog" aria-modal="false" aria-label="模型与推理设置">
        <header>
          <button v-if="level !== 'root'" class="dca-icon-btn" type="button" title="返回" @click="level = 'root'"><i class="fa-solid fa-arrow-left"></i></button>
          <strong>{{ levelTitle }}</strong>
          <button class="dca-icon-btn" type="button" title="关闭" @click="close"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div v-if="level === 'root'" class="dca-model-menu-root">
          <button type="button" @click="level = 'models'">
            <i class="fa-solid fa-microchip"></i><span><strong>模型</strong><small>{{ selectedModel ? `${selectedProvider?.name} · ${selectedModel.name}` : '尚未选择' }}</small></span><i class="fa-solid fa-chevron-right"></i>
          </button>
          <button type="button" :disabled="!supportsReasoning" @click="level = 'reasoning'">
            <i class="fa-solid fa-brain"></i><span><strong>推理强度</strong><small>{{ supportsReasoning ? reasoningLabel : '该模型不支持' }}</small></span><i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
        <div v-else-if="level === 'models'" class="dca-model-menu-list">
          <section v-for="provider in availableProviders" :key="provider.id">
            <h4>{{ provider.name }}</h4>
            <button
              v-for="model in provider.models"
              :key="model.id"
              type="button"
              :class="{ active: model.id === selectedModel?.id && provider.id === selectedProvider?.id }"
              @click="chooseModel(provider.id, model.id)"
            >
              <span><strong>{{ model.name }}</strong><small>{{ model.modelId }}</small></span>
              <i v-if="model.id === selectedModel?.id && provider.id === selectedProvider?.id" class="fa-solid fa-check"></i>
            </button>
          </section>
          <div v-if="availableProviders.length === 0" class="dca-empty">设置里还没有启用的 Provider 与模型。</div>
        </div>
        <div v-else class="dca-model-menu-list">
          <button
            v-for="option in reasoningOptions"
            :key="option.value"
            type="button"
            :class="{ active: option.value === activeEffort }"
            @click="chooseReasoning(option.value)"
          >
            <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
            <i v-if="option.value === activeEffort" class="fa-solid fa-check"></i>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { findSelectedModel } from '../../../core/provider/provider-config';
import { useDreamCardAgent } from '../../composables/runtime';

const { action, runtime, state } = useDreamCardAgent();
const open = ref(false);
const level = ref<'models' | 'reasoning' | 'root'>('root');
const current = computed(() => findSelectedModel(state.value.providers ?? [], state.value.active?.modelSelection));
const selectedProvider = computed(() => current.value?.provider);
const selectedModel = computed(() => current.value?.model);
const availableProviders = computed(() => (state.value.providers ?? [])
  .filter(provider => provider.enabled)
  .map(provider => ({ ...provider, models: provider.models.filter(model => model.enabled) }))
  .filter(provider => provider.models.length));
const activeEffort = computed(() => state.value.active?.modelControls?.reasoningEffort ?? 'auto');
const supportsReasoning = computed(() => Boolean(selectedModel.value && selectedModel.value.modelSettings.capabilities.reasoning !== 'disabled'));
const isRunning = computed(() => ['running', 'waiting-approval'].includes(state.value.active?.status ?? ''));
const reasoningOptions = computed(() => [
  { description: '由接口或模型自行决定', label: '自动', value: 'auto' },
  { description: '本会话关闭推理', label: '关闭推理', value: 'off' },
  ...(selectedModel.value?.modelSettings.reasoningEfforts ?? []).map(item => ({ description: item.id, label: item.name, value: item.id })),
]);
const reasoningLabel = computed(() => reasoningOptions.value.find(item => item.value === activeEffort.value)?.label ?? '自动');
const levelTitle = computed(() => level.value === 'root' ? '模型与推理' : level.value === 'models' ? '选择模型' : '推理强度');

function toggle() { open.value = !open.value; level.value = 'root'; }
function close() { open.value = false; level.value = 'root'; }
async function chooseModel(providerId: string, modelId: string) {
  const selected = findSelectedModel(state.value.providers, { providerId, modelId });
  if (!selected) return;
  const effort = activeEffort.value;
  if (effort !== 'auto' && effort !== 'off' && !selected.model.modelSettings.reasoningEfforts.some(item => item.id === effort)) {
    await action(() => runtime.setModelControls({ reasoningEffort: 'auto' }));
  }
  if (await action(() => runtime.selectSessionModel({ providerId, modelId }))) level.value = 'root';
}
async function chooseReasoning(value: string) {
  if (await action(() => runtime.setModelControls({ reasoningEffort: value }))) level.value = 'root';
}
</script>

<style lang="scss">
.dca-session-model-menu { position: relative; min-width: 0; }
.dca-app .dca-session-model-trigger { display: flex; min-width: 0; min-height: 1.95rem; align-items: center; gap: .3rem; border-color: transparent; padding: .2rem .45rem; background: transparent; color: var(--dca-text-secondary); font-size: .72rem; }
.dca-session-model-trigger span { max-width: 10rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dca-session-model-trigger small { color: var(--dca-text-muted); }
.dca-model-menu-backdrop { position: fixed; z-index: 80; inset: 0; pointer-events: auto; }
.dca-model-menu-panel { position: absolute; right: 3.5rem; bottom: 5.2rem; display: flex; width: min(25rem, calc(100vw - 2rem)); max-height: min(32rem, 70vh); flex-direction: column; border: 1px solid var(--dca-border-strong); border-radius: var(--dca-radius-lg); padding: .5rem; background: var(--dca-surface); box-shadow: var(--dca-shadow-3); pointer-events: auto; }
.dca-model-menu-panel > header { display: grid; grid-template-columns: 2rem minmax(0, 1fr) 2rem; align-items: center; border-bottom: 1px solid var(--dca-border); padding-bottom: .4rem; }
.dca-model-menu-panel > header strong { text-align: center; }
.dca-model-menu-panel > header > strong:first-child { grid-column: 2; }
.dca-model-menu-root, .dca-model-menu-list { display: flex; min-height: 0; flex-direction: column; gap: .25rem; overflow-y: auto; padding-top: .4rem; }
.dca-model-menu-root > button, .dca-model-menu-list button { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .55rem; border-color: transparent; padding: .55rem; background: transparent; text-align: left; }
.dca-model-menu-list button { grid-template-columns: minmax(0, 1fr) auto; }
.dca-model-menu-root > button:hover:not(:disabled), .dca-model-menu-list button:hover, .dca-model-menu-list button.active { background: var(--dca-accent-soft); }
.dca-model-menu-root span, .dca-model-menu-list button span { display: flex; min-width: 0; flex-direction: column; }
.dca-model-menu-root small, .dca-model-menu-list small { overflow: hidden; color: var(--dca-text-muted); font-size: .68rem; text-overflow: ellipsis; white-space: nowrap; }
.dca-model-menu-list section h4 { margin: .45rem .55rem .15rem; color: var(--dca-text-muted); font-size: .7rem; font-weight: 600; text-transform: uppercase; }
@media (max-width: 720px) {
  .dca-model-menu-backdrop { background: color-mix(in srgb, #000 42%, transparent); pointer-events: auto; }
  .dca-model-menu-panel { right: 0; bottom: 0; left: 0; width: 100%; max-height: 72vh; border-radius: var(--dca-radius-lg) var(--dca-radius-lg) 0 0; padding: .65rem max(.65rem, env(safe-area-inset-right)) max(.65rem, env(safe-area-inset-bottom)) max(.65rem, env(safe-area-inset-left)); }
  .dca-session-model-trigger span { max-width: 8rem; }
}
</style>
