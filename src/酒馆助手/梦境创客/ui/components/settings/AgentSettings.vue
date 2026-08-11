<template>
  <section class="dca-section-stack">
    <header class="dca-section-header">
      <div>
        <h3>Agent配置</h3>
        <p>把一套结构化预设与一组Skill开关组合起来，新会话使用当前配置。</p>
      </div>
    </header>

    <div class="dca-resource-toolbar">
      <label class="dca-field">
        <span>当前 Agent</span>
        <DcaSelect
          aria-label="当前 Agent"
          :model-value="state.activeAgentConfigurationId"
          :options="configurationOptions"
          @update:model-value="selectConfiguration"
        />
      </label>
      <div class="dca-row-actions">
        <button type="button" @click="newConfiguration">新建</button>
        <button type="button" :disabled="!draft" @click="copyConfiguration">复制</button>
        <button
          class="dca-btn-danger"
          type="button"
          :disabled="state.agentConfigurations.length <= 1"
          @click="removeConfiguration"
        >
          删除配置
        </button>
      </div>
    </div>

    <template v-if="draft">
      <div class="dca-form-grid">
        <label class="dca-field">
          <span>配置名称</span>
          <input v-model="draft.name" type="text" maxlength="80" />
        </label>
        <label class="dca-field">
          <span>结构化预设</span>
          <DcaSelect v-model="draft.presetId" aria-label="结构化预设" :options="presetOptions" />
        </label>
      </div>

      <section class="dca-agent-skill-panel">
        <header>
          <div>
            <strong>Skill开关</strong>
            <small>只有此处开启的Skill才会出现在该Agent的索引或静态头部中。</small>
          </div>
          <span>{{ draft.skillIds.length }} / {{ state.skills.length }} 已开启</span>
        </header>
        <div class="dca-agent-skill-row builtin">
          <span>
            <strong>角色卡与世界书文件读写</strong>
            <small>内置 · full · 始终开启</small>
          </span>
          <DcaSwitch model-value disabled label="角色卡与世界书文件读写始终开启" />
        </div>
        <div v-for="skill in state.skills" :key="skill.id" class="dca-agent-skill-row">
          <span>
            <strong>{{ skill.name }}</strong>
            <small>{{ skill.loading }} · {{ skill.description }}</small>
          </span>
          <DcaSwitch
            :label="`${skill.name} Skill`"
            :model-value="draft.skillIds.includes(skill.id)"
            @update:model-value="toggleSkill(skill.id, $event)"
          />
        </div>
        <div v-if="state.skills.length === 0" class="dca-empty">还没有用户Skill，可先到Skill页面创建。</div>
      </section>

      <div class="dca-resource-savebar">
        <span>保存后用于之后创建的新会话；不会暗中改写已有会话。</span>
        <button type="button" @click="saveConfiguration">保存配置</button>
        <button class="dca-btn-primary" type="button" :disabled="!state.active" @click="saveAndApply">
          保存并应用到当前会话
        </button>
      </div>
      <p v-if="state.active" class="dca-muted-note">
        当前会话固定使用“{{ state.active.agentConfiguration?.name ?? '旧版会话配置' }}”，挂载
        {{ state.active.agentConfiguration?.skillIds.length ?? state.active.skills.length }} 个用户Skill。
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';
import type { AgentConfiguration } from '../../../core/persistence/settings';
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSelect from '../DcaSelect.vue';
import DcaSwitch from '../DcaSwitch.vue';

const { action, runtime, state } = useDreamCardAgent();
const draft = ref<AgentConfiguration>();
const configurationOptions = computed(() =>
  state.value.agentConfigurations.map(configuration => ({ label: configuration.name, value: configuration.id })),
);
const presetOptions = computed(() =>
  state.value.presetProfiles.map(preset => ({
    label: `${preset.name} · v${preset.version}`,
    value: preset.id,
  })),
);

watch(
  () =>
    `${state.value.activeAgentConfigurationId}:${state.value.agentConfigurations
      .map(
        configuration =>
          `${configuration.id}:${configuration.name}:${configuration.presetId}:${configuration.skillIds.join(',')}`,
      )
      .join('|')}`,
  () => {
    const selected =
      state.value.agentConfigurations.find(
        configuration => configuration.id === state.value.activeAgentConfigurationId,
      ) ?? state.value.agentConfigurations[0];
    draft.value = selected ? structuredClone(toRaw(selected)) : undefined;
  },
  { immediate: true },
);

async function selectConfiguration(id: string) {
  if (id) await action(() => runtime.selectAgentConfiguration(id));
}

function newConfiguration() {
  draft.value = {
    id: `agent:${crypto.randomUUID()}`,
    name: '新 Agent',
    presetId: state.value.activePresetId,
    skillIds: [],
  };
}

function copyConfiguration() {
  if (!draft.value) return;
  draft.value = {
    ...structuredClone(toRaw(draft.value)),
    id: `agent:${crypto.randomUUID()}`,
    name: `${draft.value.name} 副本`,
  };
}

function toggleSkill(id: string, enabled: boolean) {
  if (!draft.value) return;
  draft.value.skillIds = enabled
    ? [...new Set([...draft.value.skillIds, id])]
    : draft.value.skillIds.filter(skillId => skillId !== id);
}

async function saveConfiguration(): Promise<AgentConfiguration | undefined> {
  if (!draft.value) return undefined;
  let saved: AgentConfiguration | undefined;
  const succeeded = await action(async () => {
    saved = await runtime.saveAgentConfiguration(structuredClone(toRaw(draft.value!)));
  });
  if (succeeded && saved) draft.value = structuredClone(saved);
  return saved;
}

async function saveAndApply() {
  const saved = await saveConfiguration();
  if (saved && state.value.active && (await action(() => runtime.applyAgentConfiguration(saved!.id)))) {
    toastr.success('Agent配置已保存，并应用到当前会话。', '梦境创客');
  }
}

async function removeConfiguration() {
  if (!draft.value) return;
  await action(() => runtime.removeAgentConfiguration(draft.value!.id));
}
</script>

<style lang="scss">
.dca-agent-skill-panel {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.65rem;
  background: var(--dca-surface);
}

.dca-agent-skill-panel > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.1rem 0.2rem 0.45rem;
}

.dca-agent-skill-panel > header > div,
.dca-agent-skill-row > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dca-agent-skill-panel > header small,
.dca-agent-skill-panel > header > span,
.dca-agent-skill-row small {
  color: var(--dca-text-muted);
  font-size: 0.78rem;
}

.dca-agent-skill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  border-radius: var(--dca-radius-sm);
  padding: 0.55rem 0.6rem;
  background: var(--dca-raised);
  cursor: pointer;
}

.dca-agent-skill-row:hover {
  background: var(--dca-accent-soft);
}

.dca-agent-skill-row.builtin {
  border: 1px solid rgb(157 124 255 / 35%);
  cursor: default;
}
</style>
