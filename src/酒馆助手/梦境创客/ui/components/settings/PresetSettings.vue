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
        <select :value="state.activePresetId" @change="selectPresetProfile">
          <option v-for="preset in state.presetProfiles" :key="preset.id" :value="preset.id">
            {{ preset.name }} · v{{ preset.version }}
          </option>
        </select>
      </label>
      <div class="dca-row-actions">
        <button type="button" @click="newPresetProfile">新建</button>
        <button type="button" :disabled="!presetDraft" @click="copyPresetProfile">复制</button>
        <button type="button" @click="openPresetImport">导入</button>
        <button type="button" :disabled="!presetDraft" @click="exportPresetProfile">导出</button>
        <button
          class="dca-btn-danger"
          type="button"
          :disabled="state.presetProfiles.length <= 1"
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
      <label class="dca-field"><span>预设名称</span><input v-model="presetDraft.name" type="text" /></label>
      <article
        v-for="node in sortedPresetNodes"
        :key="node.id"
        class="dca-preset-node"
        :class="{ dragging: draggedPresetNodeId === node.id }"
        draggable="true"
        @dragstart="startPresetNodeDrag(node.id)"
        @dragend="draggedPresetNodeId = ''"
        @dragover.prevent
        @drop="dropPresetNode(node.id)"
      >
        <header>
          <i class="fa-solid fa-grip-vertical dca-drag-handle" aria-hidden="true"></i>
          <input v-model="node.enabled" type="checkbox" title="启用节点" />
          <input v-model="node.title" type="text" />
          <select v-model="node.role">
            <option value="system">system</option>
            <option value="user">user</option>
            <option value="assistant">assistant</option>
          </select>
          <button class="dca-icon-btn" type="button" title="删除节点" @click="removePresetNode(node.id)">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        </header>
        <textarea v-model="node.content" rows="5" spellcheck="false"></textarea>
      </article>
      <div class="dca-resource-savebar">
        <button type="button" @click="addPresetNode">添加节点</button>
        <button type="button" @click="savePresetProfile">保存 Profile</button>
        <button class="dca-btn-primary" type="button" :disabled="!state.active" @click="saveAndApplyPreset">
          保存并应用到当前会话
        </button>
      </div>
      <p v-if="state.active" class="dca-muted-note">
        当前会话固定使用“{{ state.active.preset.name }}”v{{ state.active.preset.version }}。
      </p>
      <details class="dca-preset-macros">
        <summary>可用位置宏</summary>
        <code>{{ presetMacros.join(' · ') }}</code>
      </details>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { parseYamlObject, serializeYaml } from '../../../core/mapping/serde';
import { cloneStructuredPreset, PRESET_MACROS, type StructuredPreset } from '../../../core/preset/compiler';
import { downloadText } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';

const { action, runtime, state } = useDreamCardAgent();

const presetDraft = ref<StructuredPreset>();
const draggedPresetNodeId = ref('');
const presetImportInput = ref<HTMLInputElement>();

const presetMacros = PRESET_MACROS.map(item => `{{${item}}}`);
const sortedPresetNodes = computed(() =>
  [...(presetDraft.value?.nodes ?? [])].sort((left, right) => left.order - right.order),
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

function addPresetNode() {
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
  if (presetDraft.value) presetDraft.value.nodes = presetDraft.value.nodes.filter(node => node.id !== id);
}

function startPresetNodeDrag(id: string) {
  draggedPresetNodeId.value = id;
}

function dropPresetNode(targetId: string) {
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

async function selectPresetProfile(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  if (id) await action(() => runtime.selectPresetProfile(id));
}

function newPresetProfile() {
  presetDraft.value = {
    id: `preset:${crypto.randomUUID()}`,
    name: '新预设',
    nodes: [],
    version: 1,
  };
  addPresetNode();
}

function copyPresetProfile() {
  if (!presetDraft.value) return;
  presetDraft.value = {
    ...cloneStructuredPreset(presetDraft.value),
    id: `preset:${crypto.randomUUID()}`,
    name: `${presetDraft.value.name} 副本`,
    version: 1,
  };
}

async function savePresetProfile(): Promise<StructuredPreset | undefined> {
  if (!presetDraft.value) return undefined;
  let saved: StructuredPreset | undefined;
  const succeeded = await action(async () => {
    saved = await runtime.savePresetProfile(cloneStructuredPreset(presetDraft.value!));
  });
  if (succeeded && saved) presetDraft.value = cloneStructuredPreset(saved);
  return saved;
}

async function saveAndApplyPreset() {
  const saved = await savePresetProfile();
  if (saved && state.value.active && (await action(() => runtime.applyPreset(saved!)))) {
    toastr.success('预设Profile已保存，并应用到当前会话。', '梦境创客');
  }
}

async function removePresetProfile() {
  if (!presetDraft.value) return;
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
  grid-template-columns: auto auto minmax(8rem, 1fr) 7rem auto;
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

.dca-preset-macros code {
  color: var(--dca-text-muted);
  font-family: var(--dca-font-mono);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .dca-preset-node > header {
    grid-template-columns: auto auto 1fr 6rem;
  }

  .dca-preset-node > header button {
    grid-row: 2;
  }
}
</style>
