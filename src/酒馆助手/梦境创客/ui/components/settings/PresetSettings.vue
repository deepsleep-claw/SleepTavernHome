<template>
  <section class="dca-section-stack">
    <header class="dca-section-header">
      <div>
        <h3>结构化预设</h3>
        <p>Profile 用于新会话；已有会话只有明确应用后才替换固定头部。</p>
      </div>
    </header>
    <div class="dca-resource-toolbar">
      <label class="dca-field">
        <span>当前 Profile</span>
        <DcaSelect
          aria-label="当前预设 Profile"
          :model-value="state.activePresetId"
          :options="presetOptions"
          @update:model-value="selectPresetProfile"
        />
      </label>
      <div class="dca-row-actions">
        <button type="button" @click="newPresetProfile">新建</button>
        <button type="button" :disabled="!presetDraft" @click="copyPresetProfile">另存为</button>
        <button type="button" @click="openPresetImport">导入</button>
        <button type="button" :disabled="!presetDraft" @click="exportPresetProfile">导出</button>
        <button
          class="dca-btn-danger"
          type="button"
          :disabled="builtinPreset || state.presetProfiles.length <= 1"
          @click="removePresetProfile"
        >
          删除 Profile
        </button>
      </div>
      <input
        ref="presetImportInput"
        class="dca-hidden-input"
        type="file"
        accept="application/yaml,text/yaml,.yaml,.yml"
        @change="importPresetProfile"
      />
    </div>
    <template v-if="presetDraft">
      <div v-if="builtinPreset" class="dca-alert dca-alert-info">
        <span>内置预设始终随脚本更新且不可编辑；需要调整时请先“另存为”。</span>
      </div>
      <label class="dca-field">
        <span>预设名称</span><input v-model="presetDraft.name" type="text" :disabled="builtinPreset" />
      </label>
      <article
        v-for="node in sortedPresetNodes"
        :key="node.id"
        class="dca-preset-node"
        :class="{ dragging: draggedPresetNodeId === node.id }"
        :draggable="!builtinPreset"
        @dragstart="startPresetNodeDrag(node.id)"
        @dragend="draggedPresetNodeId = ''"
        @dragover.prevent
        @drop="dropPresetNode(node.id)"
      >
        <header>
          <i class="fa-solid fa-grip-vertical dca-drag-handle" aria-hidden="true"></i>
          <DcaSwitch v-model="node.enabled" :disabled="builtinPreset" :label="`启用${node.title || '预设节点'}`" />
          <input v-model="node.title" type="text" :disabled="builtinPreset" />
          <DcaSelect
            :aria-label="`${node.title || '预设节点'}角色`"
            :disabled="builtinPreset"
            :model-value="node.role"
            :options="roleOptions"
            @update:model-value="updateNodeRole(node.id, $event)"
          />
          <button class="dca-icon-btn" type="button" title="删除节点" :disabled="builtinPreset" @click="removePresetNode(node.id)">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        </header>
        <textarea v-model="node.content" rows="5" spellcheck="false" :disabled="builtinPreset"></textarea>
      </article>
      <div class="dca-resource-savebar">
        <button v-if="!builtinPreset" type="button" @click="addPresetNode">添加节点</button>
        <button v-if="!builtinPreset" type="button" @click="savePresetProfile">保存 Profile</button>
        <button class="dca-btn-primary" type="button" :disabled="!state.active" @click="saveAndApplyPreset">
          {{ builtinPreset ? '应用到当前会话' : '保存并应用到当前会话' }}
        </button>
      </div>
      <p v-if="state.active" class="dca-muted-note">
        当前会话固定使用“{{ state.active.preset.name }}”v{{ state.active.preset.version }}。
      </p>
      <div v-if="!usesSkillInstructions" class="dca-alert dca-alert-warning">
        <span>这个预设没有使用 <code v-text="skillInstructionsMacro"></code>，内置与 full Skill 不会进入固定头部；仍可保存。</span>
      </div>
      <section class="dca-preset-macros">
        <header>
          <div><strong>位置宏实际内容</strong><span>按当前 Agent 配置计算，显示真正替换进预设的文本。</span></div>
        </header>
        <details v-for="macro in regularMacroPreviews" :key="macro.name">
          <summary><code v-text="macro.label"></code><button type="button" @click.prevent="copyText(macro.content, macro.name)">复制</button></summary>
          <pre>{{ macro.content || '（空）' }}</pre>
        </details>
        <article class="dca-skill-macro-preview">
          <header>
            <div><code v-text="skillInstructionsMacro"></code><span>full Skill 会在首次请求及下一次压缩后注入。</span></div>
            <button type="button" @click="copyText(macroValues.skill_instructions, '全部Skill')">复制全部</button>
          </header>
          <DcaSelect
            v-if="fullSkillEntries.length"
            aria-label="查看full Skill实际内容"
            :model-value="selectedSkillPreviewId"
            :options="fullSkillOptions"
            @update:model-value="selectedSkillPreviewId = $event"
          />
          <pre v-if="selectedFullSkill">{{ selectedFullSkill.content }}</pre>
          <div v-else class="dca-empty">当前没有可注入的 full Skill。</div>
          <details v-if="onDemandSkills.length">
            <summary>按需 Skill（不直接注入）</summary>
            <ul><li v-for="skill in onDemandSkills" :key="skill.id"><strong>{{ skill.name }}</strong>：{{ skill.description }}</li></ul>
          </details>
        </article>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { parseYamlObject, serializeYaml } from '../../../core/mapping/serde';
import {
  cloneStructuredPreset,
  DEFAULT_PRESET,
  PRESET_MACROS,
  type PresetMacro,
  type StructuredPreset,
} from '../../../core/preset/compiler';
import { defaultPresetValues } from '../../../core/session/prompt';
import { fullSkillInstructions } from '../../../core/skills/skill-registry';
import { downloadText } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSelect from '../DcaSelect.vue';
import DcaSwitch from '../DcaSwitch.vue';

const { action, runtime, state } = useDreamCardAgent();

const presetDraft = ref<StructuredPreset>();
const draggedPresetNodeId = ref('');
const presetImportInput = ref<HTMLInputElement>();

const roleOptions = [
  { label: 'system', value: 'system' },
  { label: 'user', value: 'user' },
  { label: 'assistant', value: 'assistant' },
];
const skillInstructionsMacro = '{{skill_instructions}}';
const sortedPresetNodes = computed(() =>
  [...(presetDraft.value?.nodes ?? [])].sort((left, right) => left.order - right.order),
);
const builtinPreset = computed(() => presetDraft.value?.id === DEFAULT_PRESET.id);
const activeAgentConfiguration = computed(
  () =>
    state.value.agentConfigurations.find(configuration => configuration.id === state.value.activeAgentConfigurationId) ??
    state.value.agentConfigurations[0],
);
const enabledSkills = computed(() => {
  const enabled = new Set(
    activeAgentConfiguration.value?.skills?.filter(skill => skill.enabled).map(skill => skill.id) ?? [],
  );
  return (state.value.skills ?? []).filter(skill => enabled.has(skill.id));
});
const macroValues = computed(() => defaultPresetValues(enabledSkills.value));
const regularMacroPreviews = computed(() =>
  PRESET_MACROS.filter(name => name !== 'skill_instructions').map(name => ({
    content: macroValues.value[name],
    label: `{{${name}}}`,
    name,
  })),
);
const fullSkillEntries = computed(() => fullSkillInstructions(enabledSkills.value));
const fullSkillOptions = computed(() => fullSkillEntries.value.map(skill => ({ label: skill.name, value: skill.id })));
const selectedSkillPreviewId = ref('');
const selectedFullSkill = computed(
  () => fullSkillEntries.value.find(skill => skill.id === selectedSkillPreviewId.value) ?? fullSkillEntries.value[0],
);
const onDemandSkills = computed(() => enabledSkills.value.filter(skill => skill.loading === 'on-demand'));
const usesSkillInstructions = computed(() =>
  Boolean(presetDraft.value?.nodes.some(node => node.content.includes('{{skill_instructions}}'))),
);
const presetOptions = computed(() =>
  state.value.presetProfiles.map(preset => ({
    label: `${preset.name} · v${preset.version}`,
    value: preset.id,
  })),
);

watch(
  () =>
    `${state.value.activePresetId}:${state.value.presetProfiles.map(preset => `${preset.id}@${preset.version}`).join('|')}`,
  () => {
    const preset = state.value.presetProfiles.find(item => item.id === state.value.activePresetId);
    presetDraft.value = preset ? cloneStructuredPreset(preset) : undefined;
  },
  { immediate: true },
);

watch(
  () => fullSkillEntries.value.map(skill => skill.id).join('|'),
  () => {
    if (!fullSkillEntries.value.some(skill => skill.id === selectedSkillPreviewId.value)) {
      selectedSkillPreviewId.value = fullSkillEntries.value[0]?.id ?? '';
    }
  },
  { immediate: true },
);

function addPresetNode() {
  if (builtinPreset.value) return;
  presetDraft.value?.nodes.push({
    content: '{{custom_instructions}}',
    enabled: true,
    id: crypto.randomUUID(),
    order: Math.max(0, ...presetDraft.value.nodes.map(node => node.order)) + 10,
    role: 'system',
    title: '新节点',
  });
}

function removePresetNode(id: string) {
  if (builtinPreset.value) return;
  if (presetDraft.value) presetDraft.value.nodes = presetDraft.value.nodes.filter(node => node.id !== id);
}

function startPresetNodeDrag(id: string) {
  if (builtinPreset.value) return;
  draggedPresetNodeId.value = id;
}

function dropPresetNode(targetId: string) {
  if (builtinPreset.value) return;
  if (!presetDraft.value || !draggedPresetNodeId.value || draggedPresetNodeId.value === targetId) return;
  const nodes = [...sortedPresetNodes.value];
  const from = nodes.findIndex(node => node.id === draggedPresetNodeId.value);
  const target = nodes.findIndex(node => node.id === targetId);
  if (from < 0 || target < 0) return;
  const [moved] = nodes.splice(from, 1);
  nodes.splice(target, 0, moved);
  nodes.forEach((node, index) => {
    node.order = (index + 1) * 10;
  });
  presetDraft.value.nodes = nodes;
  draggedPresetNodeId.value = '';
}

async function selectPresetProfile(id: string) {
  if (id) await action(() => runtime.selectPresetProfile(id));
}

function updateNodeRole(id: string, role: string) {
  if (builtinPreset.value) return;
  const node = presetDraft.value?.nodes.find(item => item.id === id);
  if (node && (role === 'system' || role === 'user' || role === 'assistant')) node.role = role;
}

function uniquePresetName(base: string): string {
  const names = new Set(state.value.presetProfiles.map(item => item.name));
  if (!names.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!names.has(candidate)) return candidate;
  }
}

async function persistNewPreset(candidate: StructuredPreset, message: string) {
  let saved: StructuredPreset | undefined;
  const succeeded = await action(async () => {
    saved = await runtime.savePresetProfile(cloneStructuredPreset(candidate));
  });
  if (!succeeded || !saved) return;
  presetDraft.value = cloneStructuredPreset(saved);
  toastr.success(message, '梦境创客');
}

async function newPresetProfile() {
  const candidate: StructuredPreset = {
    id: `preset:${crypto.randomUUID()}`,
    name: uniquePresetName('新预设'),
    nodes: [{
      content: '{{custom_instructions}}',
      enabled: true,
      id: crypto.randomUUID(),
      order: 10,
      role: 'system',
      title: '新节点',
    }],
    version: 1,
  };
  await persistNewPreset(candidate, '新预设已创建并切换。');
}

async function copyPresetProfile() {
  if (!presetDraft.value) return;
  const source = cloneStructuredPreset(presetDraft.value);
  await persistNewPreset({
    ...cloneStructuredPreset(presetDraft.value),
    id: `preset:${crypto.randomUUID()}`,
    name: uniquePresetName(`${source.name} 副本`),
    version: 1,
  }, '预设副本已创建并切换。');
}

async function savePresetProfile(): Promise<StructuredPreset | undefined> {
  if (!presetDraft.value || builtinPreset.value) return undefined;
  let saved: StructuredPreset | undefined;
  const succeeded = await action(async () => {
    saved = await runtime.savePresetProfile(cloneStructuredPreset(presetDraft.value!));
  });
  if (succeeded && saved) presetDraft.value = cloneStructuredPreset(saved);
  return saved;
}

async function saveAndApplyPreset() {
  if (builtinPreset.value) {
    if (presetDraft.value && state.value.active && (await action(() => runtime.applyPreset(presetDraft.value!)))) {
      toastr.success('内置预设已应用到当前会话。', '梦境创客');
    }
    return;
  }
  const saved = await savePresetProfile();
  if (saved && state.value.active && (await action(() => runtime.applyPreset(saved!)))) {
    toastr.success('预设Profile已保存，并应用到当前会话。', '梦境创客');
  }
}

async function removePresetProfile() {
  if (!presetDraft.value || builtinPreset.value) return;
  await action(() => runtime.removePresetProfile(presetDraft.value!.id));
}

function openPresetImport() {
  presetImportInput.value?.click();
}

async function importPresetProfile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = parseYamlObject(await file.text(), file.name) as unknown as StructuredPreset;
    if (!parsed || typeof parsed.name !== 'string' || !Array.isArray(parsed.nodes))
      throw new Error('文件不是结构化预设。');
    parsed.id = `preset:${crypto.randomUUID()}`;
    parsed.version = 1;
    const saved = await runtime.savePresetProfile(cloneStructuredPreset(parsed));
    presetDraft.value = cloneStructuredPreset(saved);
    toastr.success(`已导入“${saved.name}”。`, '梦境创客');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '预设导入失败');
  }
}

function exportPresetProfile() {
  if (!presetDraft.value) return;
  downloadText(
    `${presetDraft.value.name.replace(/[\\/:*?"<>|]/gu, '-') || '梦境创客预设'}.yaml`,
    serializeYaml(presetDraft.value),
    'application/yaml',
  );
}

async function copyText(content: string, label: PresetMacro | string) {
  try {
    await navigator.clipboard.writeText(content);
    toastr.success(`已复制${label}。`, '梦境创客');
  } catch {
    toastr.error('浏览器未允许写入剪贴板。', '复制失败');
  }
}
</script>

<style lang="scss">
.dca-preset-node {
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.6rem;
  background: var(--dca-surface);
}

.dca-preset-node > header {
  display: grid;
  grid-template-columns: auto auto minmax(8rem, 1fr) 8rem auto;
  align-items: center;
  gap: 0.45rem;
}

.dca-preset-node textarea {
  margin-top: 0.5rem;
  font-family: var(--dca-font-mono);
  font-size: 0.84rem;
}

.dca-preset-node.dragging {
  opacity: 0.45;
}

.dca-drag-handle {
  color: var(--dca-text-muted);
  cursor: grab;
}

.dca-preset-macros {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--dca-border);
}

.dca-preset-macros > header,
.dca-skill-macro-preview > header,
.dca-preset-macros summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.dca-preset-macros > header > div,
.dca-skill-macro-preview > header > div {
  display: flex;
  flex-direction: column;
}

.dca-preset-macros header span {
  color: var(--dca-text-muted);
  font-size: 0.78rem;
}

.dca-preset-macros details,
.dca-skill-macro-preview {
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.5rem 0.6rem;
  background: var(--dca-surface);
}

.dca-preset-macros summary {
  cursor: pointer;
}

.dca-preset-macros pre {
  max-height: 24rem;
  margin: 0.5rem 0 0;
  overflow: auto;
  border-radius: var(--dca-radius-sm);
  padding: 0.55rem;
  background: var(--dca-canvas);
  font-family: var(--dca-font-mono);
  font-size: 0.78rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dca-skill-macro-preview {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.dca-preset-macros code {
  color: var(--dca-text-muted);
  font-family: var(--dca-font-mono);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .dca-preset-node > header {
    grid-template-columns: auto auto 1fr 7rem;
  }

  .dca-preset-node > header button {
    grid-row: 2;
  }
}
</style>
