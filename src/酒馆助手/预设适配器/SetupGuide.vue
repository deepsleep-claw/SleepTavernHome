<template>
  <AdapterModal
    v-if="store.setup_guide"
    title="设置引导"
    wide
    :busy="store.is_applying"
    @close="store.closeSetupGuide()"
  >
    <div class="pa-guide-progress" aria-label="设置进度">
      <span
        v-for="(step, index) in store.setup_steps"
        :key="step.id"
        :class="{
          'pa-guide-current': index === store.setup_step_index,
          'pa-guide-passed': index < store.setup_step_index,
        }"
        :aria-current="index === store.setup_step_index ? 'step' : undefined"
      >
        <b>{{ index + 1 }}</b
        >{{ step.title }}
      </span>
    </div>
    <header class="pa-guide-heading">
      <small>第 {{ store.setup_step_index + 1 }} / {{ store.setup_steps.length }} 步</small>
      <h4>{{ store.setup_step.title }}</h4>
      <p>{{ store.setup_step.description }}</p>
    </header>
    <p v-if="store.loaded_preset_name !== store.setup_guide.preset_name" class="pa-modal-error">
      酒馆预设已切换，请关闭引导后重新开始。
    </p>
    <section v-for="group in store.setup_step_groups" :key="group.id" class="pa-guide-group">
      <h5>{{ group.label }}</h5>
      <div class="pa-guide-options">
        <button
          v-for="option in group.options"
          :key="option.id"
          type="button"
          class="pa-guide-option"
          :class="{ 'pa-guide-selected': option.status === 'active' }"
          :aria-pressed="option.status === 'active'"
          :disabled="store.is_applying || !option.selection_available || !option.requirements_met"
          :title="option.matched_summary"
          @click="store.selectSetupOption(group.id, option.id)"
        >
          <i
            :class="
              option.status === 'active'
                ? 'fa-solid fa-check-circle'
                : group.mode === 'multiple'
                  ? 'fa-regular fa-square'
                  : 'fa-regular fa-circle'
            "
            aria-hidden="true"
          ></i>
          <span
            ><strong>{{ option.label }}</strong
            ><small v-if="option.description">{{ option.description }}</small></span
          >
        </button>
      </div>
      <details v-if="store.setup_step.id === 'personality' && selectedContent(group)" class="pa-guide-content">
        <summary>查看当前人格内容</summary>
        <pre>{{ selectedContent(group) }}</pre>
      </details>
      <template v-if="showInputs(group)">
        <label v-for="input in group.variable_inputs" :key="input.id" class="pa-guide-input">
          <strong>{{ input.label }}</strong>
          <input
            :value="input.value"
            :disabled="store.is_applying || input.disabled"
            :placeholder="input.disabled ? '打开聊天后可填写' : input.label"
            @input="store.updateSetupInput(group.id, input.id, ($event.target as HTMLInputElement).value)"
          />
          <small v-if="input.description">{{ input.description }}</small>
        </label>
      </template>
    </section>
    <p v-if="store.setup_step_groups.length === 0" class="pa-guide-empty">当前预设没有这一页的设置，可以继续下一步。</p>
    <details v-if="store.setup_step.id === 'features'" class="pa-guide-overview">
      <summary>查看本次设置</summary>
      <dl>
        <template v-for="item in store.setup_overview" :key="item.label"
          ><dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd></template
        >
      </dl>
    </details>
    <p v-if="store.setup_error" class="pa-modal-error" role="alert">{{ store.setup_error }}</p>
    <template #footer>
      <button type="button" :disabled="store.is_applying" @click="store.closeSetupGuide()">稍后设置</button>
      <span class="pa-guide-footer-spacer"></span>
      <button
        type="button"
        :disabled="store.is_applying || store.setup_step_index === 0"
        @click="store.moveSetupGuide(-1)"
      >
        上一步
      </button>
      <button
        v-if="store.setup_step.id === 'database'"
        type="button"
        :disabled="store.is_applying"
        @click="store.skipSetupDatabase()"
      >
        跳过
      </button>
      <button
        v-if="store.setup_step.id !== 'features'"
        type="button"
        class="pa-modal-primary"
        :disabled="store.is_applying || !store.setup_can_advance"
        @click="store.moveSetupGuide(1)"
      >
        下一步
      </button>
      <button
        v-else
        type="button"
        class="pa-modal-primary"
        :disabled="store.is_applying || !store.setup_can_advance"
        @click="store.finishSetupGuide()"
      >
        {{ store.is_applying ? '应用中…' : '完成并应用' }}
      </button>
    </template>
  </AdapterModal>
</template>

<script setup lang="ts">
import AdapterModal from './AdapterModal.vue';
import { usePresetAdapterStore, type GroupView } from './store';

const store = usePresetAdapterStore();
function showInputs(group: GroupView) {
  const custom = group.options.filter(option => option.label.includes('自定义'));
  return custom.length === 0 || custom.some(option => option.status === 'active');
}
function selectedContent(group: GroupView) {
  const source = group.options.find(option => option.status === 'active')?.export_source;
  return source ? store.setup_guide?.preset.prompts[source.prompt_index]?.content : '';
}
</script>

<style>
.pa-guide-progress {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.8rem;
  margin-bottom: 1.1rem;
}
.pa-guide-progress > span {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--pa-muted);
  font-size: 0.76rem;
}
.pa-guide-progress b {
  display: grid;
  place-items: center;
  width: 1.4rem;
  height: 1.4rem;
  border: 1px solid var(--pa-border);
  border-radius: 50%;
}
.pa-guide-progress .pa-guide-current {
  color: var(--pa-gold);
}
.pa-guide-current b,
.pa-guide-progress .pa-guide-passed b {
  border-color: var(--pa-gold);
  background: var(--pa-highlight-soft);
  color: var(--pa-highlight-text);
}
.pa-guide-heading small,
.pa-guide-heading p,
.pa-guide-input small {
  color: var(--pa-muted);
}
.pa-guide-heading h4 {
  margin: 0.25rem 0 0.5rem;
  font-size: 1.3rem;
}
.pa-guide-group {
  margin-top: 1rem;
}
.pa-guide-group h5 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}
.pa-guide-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  gap: 0.5rem;
}
.pa-modal-panel button.pa-guide-option {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.7rem;
  text-align: left;
}
.pa-guide-option > i {
  margin-top: 0.2rem;
  color: var(--pa-muted);
}
.pa-guide-option span {
  min-width: 0;
}
.pa-guide-option strong,
.pa-guide-option small {
  display: block;
  overflow-wrap: anywhere;
}
.pa-guide-option small {
  margin-top: 0.3rem;
  color: var(--pa-muted);
  white-space: pre-line;
  font-size: 0.8rem;
}
.pa-modal-panel button.pa-guide-selected {
  border-color: var(--pa-gold);
  background: var(--pa-highlight-soft);
}
.pa-guide-selected > i {
  color: var(--pa-gold);
}
.pa-guide-input {
  display: grid;
  gap: 0.4rem;
  margin-top: 0.75rem;
}
.pa-guide-input input {
  width: 100%;
}
.pa-guide-empty,
.pa-guide-overview {
  margin-top: 1rem;
  color: var(--pa-muted);
}
.pa-guide-overview dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  font-size: 0.85rem;
}
.pa-guide-overview dd {
  margin: 0;
  color: var(--pa-text);
  overflow-wrap: anywhere;
}
.pa-guide-footer-spacer {
  flex: 1;
}
.pa-guide-content {
  margin-top: 0.65rem;
  color: var(--pa-muted);
}
.pa-guide-content pre {
  margin: 0.5rem 0;
  color: var(--pa-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
@container (max-width: 520px) {
  .pa-guide-progress > span {
    font-size: 0.7rem;
  }
  .pa-guide-footer-spacer {
    display: none;
  }
}
</style>
