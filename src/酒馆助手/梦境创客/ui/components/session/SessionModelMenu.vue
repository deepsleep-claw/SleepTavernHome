<template>
  <div
    class="dca-session-model-menu"
    :class="[`mode-${mode}`, { 'has-hidden-trigger': hideTrigger, 'is-open': visibleOpen }]"
    :style="panelStyle"
  >
    <button
      v-if="!hideTrigger"
      class="dca-session-model-trigger"
      type="button"
      :disabled="(state.busy && !isRunning) || (mode === 'reasoning' && !supportsReasoning)"
      @click="toggle"
    >
      <i :class="triggerIcon" aria-hidden="true"></i>
      <span>{{ triggerLabel }}</span>
      <small v-if="mode === 'combined' && supportsReasoning">{{ reasoningLabel }}</small>
      <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
    </button>
    <template v-if="visibleOpen">
      <div class="dca-model-menu-backdrop" role="presentation" @pointerdown.stop="close"></div>
      <section
        class="dca-model-menu-panel"
        :class="[`mode-${mode}`, `level-${activeLevel}`]"
        role="dialog"
        aria-modal="false"
        :aria-label="levelTitle"
        @pointerdown.stop
        @click.stop
      >
        <Transition :name="pageTransitionName" mode="out-in">
          <div v-if="activeLevel === 'root'" key="root" class="dca-model-menu-page dca-model-menu-root">
            <strong class="dca-model-menu-title">模型与推理</strong>
            <button type="button" @click="navigateTo('models')">
              <span class="dca-model-menu-icon"><i class="fa-solid fa-microchip" aria-hidden="true"></i></span>
              <span class="dca-model-menu-copy"
                ><strong>模型</strong
                ><small>{{
                  selectedModel ? `${selectedProvider?.name} · ${selectedModel.name}` : '尚未选择'
                }}</small></span
              >
              <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </button>
            <button type="button" :disabled="!supportsReasoning" @click="navigateTo('reasoning')">
              <span class="dca-model-menu-icon"><i class="fa-solid fa-brain" aria-hidden="true"></i></span>
              <span class="dca-model-menu-copy"
                ><strong>推理强度</strong><small>{{ supportsReasoning ? reasoningLabel : '该模型不支持' }}</small></span
              >
              <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </button>
          </div>
          <div
            v-else-if="activeLevel === 'models'"
            key="models"
            class="dca-model-menu-page dca-model-menu-list dca-model-list"
          >
            <header class="dca-model-subpage-header">
              <button v-if="mode === 'combined'" type="button" aria-label="返回模型与推理" @click="navigateBack">
                <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
              </button>
              <span v-else aria-hidden="true"></span>
              <strong>选择模型</strong><span aria-hidden="true"></span>
            </header>
            <label class="dca-model-search">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              <input v-model="modelQuery" type="search" placeholder="搜索模型" autocomplete="off" />
            </label>
            <div class="dca-model-list-scroll">
              <section v-for="provider in filteredProviders" :key="provider.id">
                <h4>{{ provider.name }}</h4>
                <button
                  v-for="model in provider.models"
                  :key="model.id"
                  type="button"
                  :class="{ active: model.id === selectedModel?.id && provider.id === selectedProvider?.id }"
                  @click="chooseModel(provider.id, model.id)"
                >
                  <span class="dca-model-menu-copy"
                    ><strong>{{ model.name }}</strong
                    ><small>{{ model.modelId }}</small></span
                  >
                  <i
                    v-if="model.id === selectedModel?.id && provider.id === selectedProvider?.id"
                    class="fa-solid fa-check"
                    aria-hidden="true"
                  ></i>
                </button>
              </section>
              <div v-if="filteredProviders.length === 0" class="dca-empty">
                {{ availableProviders.length === 0 ? '设置里还没有启用的 Provider 与模型。' : '没有匹配的模型。' }}
              </div>
            </div>
          </div>
          <div v-else key="reasoning" class="dca-model-menu-page dca-model-menu-list dca-reasoning-list">
            <header class="dca-model-subpage-header">
              <button v-if="mode === 'combined'" type="button" aria-label="返回模型与推理" @click="navigateBack">
                <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
              </button>
              <span v-else aria-hidden="true"></span>
              <strong>选择推理强度</strong><span aria-hidden="true"></span>
            </header>
            <div class="dca-reasoning-scroll">
              <button
                v-for="option in reasoningOptions"
                :key="option.value"
                type="button"
                :class="{ active: option.value === activeEffort }"
                @click="chooseReasoning(option.value)"
              >
                <span class="dca-model-menu-copy"
                  ><strong>{{ option.label }}</strong
                  ><small>{{ option.description }}</small></span
                >
                <i v-if="option.value === activeEffort" class="fa-solid fa-check" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </Transition>
      </section>
      <span v-if="!hideTrigger" class="dca-model-menu-anchor" aria-hidden="true"></span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { findSelectedModel } from '../../../core/provider/provider-config';
import { useDreamCardAgent } from '../../composables/runtime';

export type SessionModelMenuMode = 'combined' | 'model' | 'reasoning';

const props = withDefaults(defineProps<{ hideTrigger?: boolean; mode?: SessionModelMenuMode; open?: boolean }>(), {
  hideTrigger: false,
  mode: 'combined',
  open: undefined,
});
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
const { action, runtime, state } = useDreamCardAgent();
const localOpen = ref(false);
const level = ref<'models' | 'reasoning' | 'root'>('root');
const navigationDirection = ref<'back' | 'forward'>('forward');
const modelQuery = ref('');
const visibleOpen = computed(() => props.open ?? localOpen.value);
const current = computed(() => findSelectedModel(state.value.providers ?? [], state.value.active?.modelSelection));
const selectedProvider = computed(() => current.value?.provider);
const selectedModel = computed(() => current.value?.model);
const availableProviders = computed(() =>
  (state.value.providers ?? [])
    .filter(provider => provider.enabled)
    .map(provider => ({ ...provider, models: provider.models.filter(model => model.enabled) }))
    .filter(provider => provider.models.length),
);
const filteredProviders = computed(() => {
  const query = modelQuery.value.trim().toLocaleLowerCase();
  if (!query) return availableProviders.value;
  return availableProviders.value
    .map(provider => ({
      ...provider,
      models: provider.models.filter(model =>
        [provider.name, model.name, model.modelId].some(value => value.toLocaleLowerCase().includes(query)),
      ),
    }))
    .filter(provider => provider.models.length);
});
const activeEffort = computed(() => state.value.active?.modelControls?.reasoningEffort ?? 'auto');
const supportsReasoning = computed(() =>
  Boolean(selectedModel.value && selectedModel.value.modelSettings.capabilities.reasoning !== 'disabled'),
);
const isRunning = computed(() => ['running', 'waiting-approval'].includes(state.value.active?.status ?? ''));
const reasoningOptions = computed(() => [
  { description: '由接口或模型自行决定', label: '自动', value: 'auto' },
  { description: '本会话关闭推理', label: '关闭推理', value: 'off' },
  ...(selectedModel.value?.modelSettings.reasoningEfforts ?? []).map(item => ({
    description: item.id,
    label: item.name,
    value: item.id,
  })),
]);
const reasoningLabel = computed(
  () => reasoningOptions.value.find(item => item.value === activeEffort.value)?.label ?? '自动',
);
const activeLevel = computed(() => {
  if (props.mode === 'model') return 'models';
  if (props.mode === 'reasoning') return 'reasoning';
  return level.value;
});
const levelTitle = computed(() =>
  activeLevel.value === 'root' ? '模型与推理' : activeLevel.value === 'models' ? '选择模型' : '选择推理强度',
);
const pageTransitionName = computed(() =>
  navigationDirection.value === 'back' ? 'dca-menu-page-back' : 'dca-menu-page-forward',
);
const visibleModelCount = computed(() =>
  filteredProviders.value.reduce((count, provider) => count + provider.models.length, 0),
);
const panelStyle = computed(() => {
  const page = activeLevel.value;
  const height =
    page === 'root'
      ? 178
      : page === 'models'
        ? Math.min(560, Math.max(240, 156 + filteredProviders.value.length * 32 + visibleModelCount.value * 64))
        : Math.min(480, 68 + reasoningOptions.value.length * 64);
  return {
    '--dca-model-panel-height': `${height}px`,
    '--dca-model-panel-width': page === 'models' ? '20rem' : '18rem',
  };
});
const triggerIcon = computed(() =>
  props.mode === 'model'
    ? 'fa-solid fa-microchip'
    : props.mode === 'reasoning'
      ? 'fa-solid fa-brain'
      : 'fa-solid fa-bolt',
);
const triggerLabel = computed(() =>
  props.mode === 'reasoning' ? reasoningLabel.value : (selectedModel.value?.name ?? '未选择模型'),
);

watch(
  () => props.mode,
  () => resetLevel(),
);

function resetLevel() {
  navigationDirection.value = 'forward';
  level.value = props.mode === 'combined' ? 'root' : props.mode === 'model' ? 'models' : 'reasoning';
}

function navigateTo(target: 'models' | 'reasoning') {
  navigationDirection.value = 'forward';
  level.value = target;
}

function navigateBack() {
  navigationDirection.value = 'back';
  modelQuery.value = '';
  level.value = 'root';
}

function setOpen(value: boolean) {
  if (props.open === undefined) localOpen.value = value;
  emit('update:open', value);
  if (!value) {
    modelQuery.value = '';
    resetLevel();
  }
}

function toggle() {
  resetLevel();
  setOpen(!visibleOpen.value);
}

function close() {
  setOpen(false);
}

async function chooseModel(providerId: string, modelId: string) {
  const selected = findSelectedModel(state.value.providers, { providerId, modelId });
  if (!selected) return;
  const effort = activeEffort.value;
  if (
    effort !== 'auto' &&
    effort !== 'off' &&
    !selected.model.modelSettings.reasoningEfforts.some(item => item.id === effort)
  ) {
    await action(() => runtime.setModelControls({ reasoningEffort: 'auto' }));
  }
  if (!(await action(() => runtime.selectSessionModel({ providerId, modelId })))) return;
  if (props.mode === 'combined') navigateBack();
  else close();
}

async function chooseReasoning(value: string) {
  if (!(await action(() => runtime.setModelControls({ reasoningEffort: value })))) return;
  if (props.mode === 'combined') navigateBack();
  else close();
}
</script>

<style lang="scss">
.dca-session-model-menu {
  position: relative;
  min-width: 0;
}
.dca-app .dca-session-model-trigger {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 2.1rem;
  align-items: center;
  justify-content: flex-start;
  gap: 0.3rem;
  border-color: var(--dca-border);
  border-radius: var(--dca-radius-sm);
  padding: 0.25rem 0.55rem;
  background: var(--dca-raised);
  color: var(--dca-text-secondary);
  font-size: 0.72rem;
  text-align: left;
}
.dca-app .dca-session-model-trigger:hover:not(:disabled) {
  border-color: var(--dca-border-strong);
  background: color-mix(in srgb, var(--dca-text) 6%, var(--dca-raised));
}
.dca-session-model-trigger span {
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-session-model-trigger small {
  color: var(--dca-text-muted);
}
.dca-session-model-trigger > i:last-child {
  margin-left: auto;
}
.dca-model-menu-backdrop {
  position: fixed;
  z-index: 10000;
  background: transparent;
  inset: 0;
}
.dca-model-menu-panel {
  position: absolute;
  z-index: 10001;
  right: 0;
  bottom: calc(100% + 0.65rem);
  display: flex;
  width: min(var(--dca-model-panel-width), calc(100vw - 1.5rem));
  height: min(var(--dca-model-panel-height), calc(100vh - 6rem));
  max-height: min(35rem, calc(100vh - 6rem));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--dca-border-strong);
  border-radius: var(--dca-radius-lg);
  padding: 0.75rem;
  background: var(--dca-surface);
  box-shadow: var(--dca-shadow-3);
  transform-origin: bottom center;
  transition:
    width 240ms cubic-bezier(0.22, 1, 0.36, 1),
    height 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.dca-session-model-menu.mode-combined .dca-model-menu-panel,
.dca-session-model-menu.has-hidden-trigger .dca-model-menu-panel {
  right: auto;
  left: 0;
}
.dca-model-menu-anchor {
  position: absolute;
  z-index: 10002;
  bottom: calc(100% + 0.27rem);
  left: 50%;
  width: 0.8rem;
  height: 0.8rem;
  border-right: 1px solid var(--dca-border-strong);
  border-bottom: 1px solid var(--dca-border-strong);
  background: var(--dca-surface);
  pointer-events: none;
  transform: translateX(-50%) rotate(45deg);
}
.dca-model-menu-page {
  width: 100%;
  height: 100%;
}
.dca-model-menu-root,
.dca-model-menu-list {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.45rem;
  overscroll-behavior: contain;
}
.dca-model-menu-title {
  padding: 0.15rem 0 0.55rem;
  text-align: center;
}
.dca-app .dca-model-menu-root > button {
  display: grid;
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  justify-content: stretch;
  justify-items: start;
  gap: 0.65rem;
  min-height: 3.6rem;
  border-color: var(--dca-border);
  padding: 0.55rem 0.75rem;
  background: var(--dca-raised);
  text-align: left;
}
.dca-model-menu-icon {
  display: grid !important;
  width: 1.8rem;
  height: 1.8rem;
  place-items: center;
  border-radius: var(--dca-radius-sm);
  background: var(--dca-accent-soft);
  color: var(--dca-accent-strong);
}
.dca-model-menu-root > button:hover:not(:disabled),
.dca-model-menu-list button:hover,
.dca-model-menu-list button.active {
  background: color-mix(in srgb, var(--dca-accent) 11%, var(--dca-raised));
}
.dca-model-menu-copy {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: flex-start;
  flex-direction: column;
  text-align: left;
}
.dca-model-menu-root > button > i:last-child,
.dca-model-menu-list button > i:last-child {
  justify-self: end;
}
.dca-model-menu-root small,
.dca-model-menu-list small {
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-model-search {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.55rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0 0.7rem;
  background: var(--dca-raised);
  color: var(--dca-text-muted);
}
.dca-model-search:focus-within {
  border-color: var(--dca-accent);
  box-shadow: 0 0 0 2px var(--dca-focus-ring);
}
.dca-model-subpage-header {
  display: grid;
  min-height: 2.2rem;
  flex: 0 0 auto;
  grid-template-columns: 2rem minmax(0, 1fr) 2rem;
  align-items: center;
  margin: -0.2rem 0 0.2rem;
}
.dca-model-subpage-header > strong {
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-app .dca-model-subpage-header > button {
  display: grid;
  width: 2rem;
  min-width: 2rem;
  height: 2rem;
  min-height: 2rem;
  place-items: center;
  justify-self: start;
  border-color: transparent;
  padding: 0;
  background: transparent;
  color: var(--dca-text-secondary);
}
.dca-app .dca-model-subpage-header > button:hover:not(:disabled) {
  border-color: transparent;
  background: color-mix(in srgb, var(--dca-text) 7%, transparent);
}
.dca-app .dca-model-search input {
  min-width: 0;
  min-height: 2.65rem;
  flex: 1;
  border: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
}
.dca-model-list-scroll {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 0.2rem;
  scrollbar-gutter: stable;
}
.dca-model-menu-list section h4 {
  margin: 0.7rem 0.4rem 0.3rem;
  color: var(--dca-text-muted);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.dca-model-menu-list section:first-child h4 {
  margin-top: 0.35rem;
}
.dca-model-menu-list section > button,
.dca-reasoning-scroll > button {
  display: grid;
  width: 100%;
  min-height: 3.45rem;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.3rem;
  border-color: var(--dca-border);
  padding: 0.55rem 0.7rem;
  background: transparent;
  text-align: left;
  justify-content: stretch;
  justify-items: start;
}
.dca-model-menu-list button.active {
  border-color: color-mix(in srgb, var(--dca-accent) 50%, var(--dca-border));
  background: var(--dca-highlight);
}
.dca-model-menu-list button > i {
  color: var(--dca-accent-strong);
}
.dca-reasoning-list {
  min-height: 0;
}
.dca-reasoning-scroll {
  min-height: 0;
  overflow-y: auto;
  padding-right: 0.2rem;
  scrollbar-gutter: stable;
}
.dca-menu-page-forward-enter-active,
.dca-menu-page-forward-leave-active,
.dca-menu-page-back-enter-active,
.dca-menu-page-back-leave-active {
  transition:
    opacity 180ms ease,
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.dca-menu-page-forward-enter-from,
.dca-menu-page-back-leave-to {
  opacity: 0;
  transform: translateX(18%);
}
.dca-menu-page-forward-leave-to,
.dca-menu-page-back-enter-from {
  opacity: 0;
  transform: translateX(-18%);
}
@media (max-width: 720px) {
  .dca-model-menu-panel {
    height: min(var(--dca-model-panel-height), calc(100dvh - 8.5rem));
    max-height: min(34rem, calc(100dvh - 8.5rem));
    border-radius: var(--dca-radius-lg);
    padding: 0.75rem;
  }
  .dca-session-model-trigger span {
    max-width: min(42vw, 10rem);
  }
  .dca-model-menu-root > button {
    min-height: 3.4rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dca-model-menu-panel,
  .dca-menu-page-forward-enter-active,
  .dca-menu-page-forward-leave-active,
  .dca-menu-page-back-enter-active,
  .dca-menu-page-back-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
