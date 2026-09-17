<template>
  <Field label="条目提取规则">
    <p class="TR-rules-hint">从下往上匹配，越下面优先级越高。相同提取词的内容会统一排序并合并。</p>
    <details
      v-for="(rule, index) in rules"
      :key="rule.id"
      ref="rule_elements"
      :data-rule-id="rule.id"
      class="TR-worldbook-rule"
    >
      <summary>
        <input v-model="rule.enabled" type="checkbox" :aria-label="`启用${rule.name}`" @click.stop />
        <span class="TR-rule-title">{{ rule.name || '世界书提取规则' }}</span>
        <span class="TR-rule-badge"
          >{{
            rule.provider === 'worldbook'
              ? trigger_labels[rule.trigger] + ' · ' + content_labels[rule.content]
              : (WorldbookProviderLabels[rule.provider] ?? rule.provider)
          }}{{ rule.action === 'keep' ? ' · 保留原位' : '' }}</span
        >
      </summary>
      <div class="TR-rule-body">
        <label>规则名称<input v-model="rule.name" class="text_pole" /></label>
        <label
          >规则类型<Select
            :model-value="rule.provider"
            :options="provider_options"
            @update:model-value="setProvider(rule, $event)"
        /></label>
        <p v-if="rule.provider === 'ruby'" class="TR-rules-hint">
          自动匹配当前聊天绑定世界书与 RUBY 生效方案的输出关键词。
        </p>
        <p v-else-if="rule.provider.startsWith('baibai_')" class="TR-rules-hint">
          匹配柏宝书对应的专属注入槽，使用本次请求中的实际内容。
        </p>
        <fieldset v-if="rule.provider === 'worldbook'" class="TR-rule-sources">
          <legend>来源</legend>
          <label v-for="source in WorldbookSources" :key="source">
            <input v-model="rule.sources" type="checkbox" :value="source" />{{ source_labels[source] }}
          </label>
        </fieldset>
        <div v-if="rule.provider === 'worldbook'" class="TR-rule-grid">
          <label
            >匹配对象
            <Select v-model="rule.target" :options="target_options" />
          </label>
          <label
            >匹配表达式
            <input
              v-model="rule.pattern"
              class="text_pole"
              placeholder="留空表示不限，例如 /^剧情摘要-/i"
              :aria-invalid="!!regexError(rule.pattern)"
            />
          </label>
          <label>触发方式<Select v-model="rule.trigger" :options="trigger_options" /></label>
          <label>内容特征<Select v-model="rule.content" :options="content_options" /></label>
        </div>
        <p v-if="rule.provider === 'worldbook' && regexError(rule.pattern)" class="TR-rule-error" role="alert">
          {{ regexError(rule.pattern) }}
        </p>
        <label>处理方式<Select v-model="rule.action" :options="action_options" /></label>
        <label v-if="rule.action === 'extract'"
          >提取词
          <input
            :value="getExtractionKeyword(rule.placeholder)"
            class="text_pole"
            placeholder="例如 lora_key 或 sp_memory"
            @input="setKeyword(rule, $event)"
          />
        </label>
        <p v-if="rule.action === 'extract' && rule.placeholder" class="TR-rule-placeholder">
          {{ getPlaceholderAliases(rule.placeholder).join(' / ') }}
        </p>
        <template v-if="rule.provider === 'worldbook' && rule.action === 'extract'">
          <Checkbox v-model="rule.aggressive_green_cache"><span>优先固定绿灯缓存</span></Checkbox>
          <p class="TR-rules-hint">本组捕获的非动态绿灯优先固定到首次触发楼层；其余内容合并到提取词位置。</p>
        </template>
        <p v-if="rule.action === 'keep'" class="TR-rules-hint">匹配后保留原位置，不再应用上方规则。</p>
        <div class="TR-rule-actions">
          <button type="button" class="menu_button" :disabled="index === 0" @click="moveRule(index, -1)">上移</button>
          <button type="button" class="menu_button" :disabled="index === rules.length - 1" @click="moveRule(index, 1)">
            下移
          </button>
          <button type="button" class="menu_button" @click="rules.splice(index, 1)">删除</button>
        </div>
      </div>
    </details>
    <div class="TR-rule-actions">
      <button type="button" class="menu_button TR-rule-add" @click="openBuiltinPicker">添加内置规则</button>
      <button type="button" class="menu_button TR-rule-add" @click="addRule(createWorldbookRule())">添加规则</button>
    </div>
    <dialog
      ref="builtin_dialog"
      class="TR-builtin-dialog"
      aria-labelledby="TR-builtin-title"
      @cancel.prevent="closeBuiltinPicker"
      @keydown.stop
    >
      <h3 id="TR-builtin-title">添加内置规则</h3>
      <fieldset class="TR-builtin-list">
        <legend>选择一条规则</legend>
        <label v-for="builtin in BuiltinWorldbookRules" :key="builtin.id" class="TR-builtin-option">
          <input v-model="selected_builtin" type="radio" name="TR-builtin-choice" :value="builtin.id" />
          <span
            ><span class="TR-builtin-name">{{ builtin.name }}</span
            ><span class="TR-builtin-description">{{ builtin.description }}</span></span
          >
        </label>
      </fieldset>
      <div class="TR-rule-actions">
        <button type="button" class="menu_button" @click="closeBuiltinPicker">取消</button>
        <button type="button" class="menu_button" :disabled="!selected_builtin" @click="addBuiltinRule">
          添加所选规则
        </button>
      </div>
    </dialog>
  </Field>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useSettingsStore } from '../store';
import { parseWorldbookRegex } from '../worldbook_rules';
import {
  createWorldbookRule,
  createBuiltinWorldbookRule,
  BuiltinWorldbookRules,
  WorldbookProviderLabels,
  getExtractionKeyword,
  getPlaceholderAliases,
  makeExtractionPlaceholder,
  WorldbookSources,
  type WorldbookRule,
  type WorldbookSource,
} from '../worldbook_settings';
import Checkbox from './component/Checkbox.vue';
import Field from './component/Field.vue';
import Select from './component/Select.vue';

const store = useSettingsStore();
const rules = computed(() => store.settings.entry_processing.worldbook.rules);
const builtin_dialog = ref<HTMLDialogElement>();
const selected_builtin = ref(BuiltinWorldbookRules[0].id);
const rule_elements = ref<HTMLDetailsElement[]>([]);
const provider_options = Object.entries(WorldbookProviderLabels).map(([value, label]) => ({ value, label }));
const action_options = [
  { value: 'extract', label: '提取到提取词' },
  { value: 'keep', label: '保留原位' },
];
const source_labels: Record<WorldbookSource, string> = {
  character: '角色世界书',
  character_additional: '角色可选世界书',
  chat: '聊天世界书',
  persona: '用户世界书',
  global: '全局世界书',
};
const trigger_labels = { all: '全部', constant: '常驻', selective: '关键词' };
const content_labels = { all: '全部内容', static: '仅静态', dynamic: '仅动态' };
const trigger_options = Object.entries(trigger_labels).map(([value, label]) => ({ value, label }));
const content_options = Object.entries(content_labels).map(([value, label]) => ({ value, label }));
const target_options = [
  { value: 'worldbook_name', label: '世界书名称' },
  { value: 'entry_name', label: '条目标题' },
  { value: 'content', label: '条目正文' },
];

function regexError(pattern: string): string {
  return pattern.trim() && !parseWorldbookRegex(pattern.trim()) ? '正则表达式无效，此规则暂不参与匹配。' : '';
}
function setKeyword(rule: WorldbookRule, event: Event) {
  rule.placeholder = makeExtractionPlaceholder((event.target as HTMLInputElement).value);
}
function moveRule(index: number, offset: -1 | 1) {
  const target = index + offset;
  if (target < 0 || target >= rules.value.length) return;
  [rules.value[index], rules.value[target]] = [rules.value[target], rules.value[index]];
}
function setProvider(rule: WorldbookRule, provider: string) {
  rule.provider = provider;
  rule.sources = provider === 'ruby' ? ['chat'] : [...WorldbookSources];
  rule.trigger = 'all';
  rule.content = 'all';
  rule.pattern = '';
  rule.aggressive_green_cache = false;
}
function openBuiltinPicker() {
  builtin_dialog.value?.showModal();
}
function closeBuiltinPicker() {
  builtin_dialog.value?.close();
}
async function addRule(rule: WorldbookRule) {
  rules.value.push(rule);
  await nextTick();
  const element = rule_elements.value.find(element => element.dataset.ruleId === rule.id);
  if (element) element.open = true;
}
function addBuiltinRule() {
  if (!BuiltinWorldbookRules.some(value => value.id === selected_builtin.value)) return;
  void addRule(createBuiltinWorldbookRule(selected_builtin.value));
  closeBuiltinPicker();
}
</script>

<style scoped>
.TR-rules-hint {
  margin: 0.3rem 0;
  color: var(--SmartThemeQuoteColor);
  font-size: 0.9em;
}
.TR-worldbook-rule {
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 6px;
  margin: 0.4rem 0;
}
.TR-worldbook-rule summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  padding: 0.5rem;
}
.TR-rule-title {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.TR-rule-badge {
  font-size: 0.85em;
  color: var(--SmartThemeQuoteColor);
}
.TR-rule-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0.5rem 0.5rem;
}
.TR-rule-body label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.TR-rule-body .text_pole {
  width: 100%;
  margin: 0;
}
.TR-rule-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.5rem;
}
.TR-rule-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.7rem;
  border: 1px solid var(--SmartThemeBorderColor);
}
.TR-rule-sources label {
  flex-direction: row;
  align-items: center;
}
.TR-rule-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.TR-rule-actions .menu_button,
.TR-rule-add {
  width: auto;
  margin: 0;
}
.TR-rule-placeholder {
  overflow-wrap: anywhere;
  font-size: 0.85em;
  margin: 0;
}
.TR-rule-error {
  color: var(--warning, #ff7676);
  margin: 0;
}
.TR-builtin-dialog {
  width: min(34rem, calc(100% - 2rem));
  max-height: calc(100% - 3rem);
  padding: 1rem;
  color: var(--SmartThemeBodyColor, #eee);
  background: var(--SmartThemeBlurTintColor, #20222a);
  border: 1px solid var(--SmartThemeBorderColor, #777);
  border-radius: 10px;
}
.TR-builtin-dialog[open] {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
.TR-builtin-dialog::backdrop {
  background: rgb(0 0 0 / 55%);
}
.TR-builtin-dialog h3 {
  margin: 0;
  font-size: 1.1rem;
}
.TR-builtin-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow: auto;
  min-height: 0;
  border: 0;
  padding: 0;
}
.TR-builtin-list legend {
  margin-bottom: 0.5rem;
}
.TR-builtin-option {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.55rem;
  border: 1px solid var(--SmartThemeBorderColor, #777);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}
.TR-builtin-option:has(input:checked) {
  border-color: var(--SmartThemeQuoteColor, #9b9);
  background: rgb(128 128 128 / 12%);
}
.TR-builtin-name,
.TR-builtin-description {
  display: block;
  overflow-wrap: anywhere;
}
.TR-builtin-description {
  margin-top: 0.2rem;
  opacity: 0.75;
  font-size: 0.85em;
}
@media (max-width: 600px) {
  .TR-rule-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .TR-worldbook-rule summary {
    flex-wrap: wrap;
  }
}
</style>
