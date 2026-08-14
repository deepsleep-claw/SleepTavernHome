<template>
  <section class="dca-section-stack dca-agent-settings">
    <header class="dca-section-header">
      <div>
        <h3>Agent 配置</h3>
        <p>组合 Agent 预设、Skill 与工具。保存后，同一配置会实时应用到尚未运行的会话。</p>
      </div>
    </header>

    <div class="dca-resource-toolbar dca-agent-toolbar">
      <label class="dca-field">
        <span>默认 Agent</span>
        <DcaSelect
          aria-label="默认 Agent"
          :model-value="state.activeAgentConfigurationId"
          :options="configurationOptions"
          @update:model-value="selectConfiguration"
        />
      </label>
      <div class="dca-row-actions">
        <button type="button" @click="newConfiguration"><i class="fa-solid fa-plus"></i> 新建</button>
        <button type="button" :disabled="!draft" @click="copyConfiguration">
          <i class="fa-regular fa-copy"></i> {{ isBuiltinConfiguration ? '另存为' : '复制' }}
        </button>
        <button
          class="dca-btn-danger"
          type="button"
          :disabled="isBuiltinConfiguration || state.agentConfigurations.length <= 1"
          @click="removeConfiguration"
        >
          <i class="fa-regular fa-trash-can"></i> 删除
        </button>
      </div>
    </div>

    <template v-if="draft">
      <nav class="dca-agent-tabs" aria-label="Agent 配置内容">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <i :class="tab.icon" aria-hidden="true"></i><span>{{ tab.label }}</span>
          <small v-if="tab.id === 'skills'">{{ enabledSkillCount }}</small>
          <small v-else-if="tab.id === 'tools'">{{ draft.toolIds.length }}</small>
        </button>
      </nav>

      <section v-if="activeTab === 'main'" class="dca-agent-tab-panel">
        <div class="dca-form-grid">
          <label class="dca-field">
            <span>配置名称 <small v-if="isBuiltinConfiguration">内置 · 随脚本更新 · 只读</small></span>
            <input v-model="draft.name" type="text" maxlength="80" :disabled="isBuiltinConfiguration" />
          </label>
          <label class="dca-field">
            <span>Agent 预设</span>
            <DcaSelect
              v-model="draft.presetId"
              aria-label="Agent 预设"
              :disabled="isBuiltinConfiguration"
              :options="presetOptions"
            />
          </label>
        </div>
        <div class="dca-agent-info-card">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          <div>
            <strong>已有会话如何更新</strong>
            <span>保存后，使用这套配置且不在运行的会话会立即刷新 Skill 与工具；静态头部会在首次发送或压缩时重新编译。</span>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'skills'" class="dca-agent-tab-panel">
        <header class="dca-agent-panel-heading">
          <div>
            <strong>Skill</strong>
            <span>开关决定 Agent 能否看到；加载方式可以覆盖 Skill 自己的默认设置。</span>
          </div>
          <span>{{ enabledSkillCount }} / {{ allSkills.length }} 已启用</span>
        </header>
        <div class="dca-agent-skill-list">
          <article v-for="skill in allSkills" :key="skill.id" class="dca-agent-skill-row">
            <div class="dca-agent-skill-copy">
              <strong>{{ skill.name }}</strong>
              <span>{{ skill.description }}</span>
              <small>
                {{ skill.kind }} · 默认 {{ loadingLabel(skill.defaultLoading) }}
                <template v-if="skill.remoteState && skill.remoteState !== 'available'"> · {{ remoteStateLabel(skill.remoteState) }}</template>
              </small>
            </div>
            <div class="dca-agent-skill-controls">
              <DcaSelect
                :model-value="skillSetting(skill.id).loading"
                :aria-label="`${skill.name} 加载方式`"
                :disabled="isBuiltinConfiguration || !skillSetting(skill.id).enabled"
                :options="loadingOptions"
                @update:model-value="setSkillLoading(skill.id, $event)"
              />
              <DcaSwitch
                :label="`${skill.name} Skill`"
                :model-value="skillSetting(skill.id).enabled"
                :disabled="isBuiltinConfiguration"
                @update:model-value="setSkillEnabled(skill.id, $event)"
              />
            </div>
          </article>
        </div>
      </section>

      <section v-else class="dca-agent-tab-panel">
        <header class="dca-agent-panel-heading">
          <div>
            <strong>工具</strong>
            <span>关闭后工具 Schema 不会发送给模型。全局专属工具不会出现在角色会话中。</span>
          </div>
          <span>{{ draft.toolIds.length }} / {{ allToolCount }} 已启用</span>
        </header>
        <div class="dca-agent-tool-groups">
          <article v-for="group in toolGroups" :key="group.id" class="dca-agent-tool-group">
            <header>
              <div>
                <strong>{{ group.label }}</strong>
                <span>{{ group.description }}</span>
                <small v-if="'globalOnly' in group && group.globalOnly">仅全局会话</small>
              </div>
              <DcaSwitch
                :label="`${group.label}整组工具`"
                :model-value="isToolGroupEnabled(group)"
                :disabled="isBuiltinConfiguration"
                @update:model-value="setToolGroup(group, $event)"
              />
            </header>
            <div class="dca-agent-tool-list">
              <label v-for="tool in group.tools" :key="tool.id">
                <span>
                  <strong>{{ tool.label }}</strong>
                  <small>{{ tool.readonly ? '只读' : '可能改变数据' }}</small>
                </span>
                <DcaSwitch
                  :label="`${tool.label}工具`"
                  :model-value="draft.toolIds.includes(tool.id)"
                  :disabled="isBuiltinConfiguration"
                  @update:model-value="setToolEnabled(tool.id, $event)"
                />
              </label>
            </div>
          </article>
        </div>
      </section>

      <div class="dca-resource-savebar">
        <span v-if="isBuiltinConfiguration">内置 Agent 始终使用随脚本更新的定义；请另存为后再调整。</span>
        <span v-else>保存会更新默认选择，也会同步所有使用本配置的空闲会话。</span>
        <button v-if="!isBuiltinConfiguration" class="dca-btn-primary" type="button" @click="saveConfiguration">
          保存 Agent
        </button>
        <button v-else class="dca-btn-primary" type="button" @click="copyConfiguration">另存为自定义 Agent</button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';
import {
  DEFAULT_AGENT_CONFIGURATION_ID,
  type AgentConfiguration,
} from '../../../core/persistence/settings';
import type { AgentSkillSetting } from '../../../core/persistence/builtin-agent';
import {
  AGENT_TOOL_GROUPS,
  ALL_AGENT_TOOL_IDS,
  type AgentToolGroup,
  type AgentToolId,
} from '../../../core/runner/tool-catalog';
import { BUILTIN_CARD_WORKSPACE_SKILL } from '../../../core/skills/builtin-card-workspace';
import { REMOTE_BUILTIN_SKILLS } from '../../../core/skills/remote-builtin-catalog';
import type { SkillLoadingMode } from '../../../core/skills/types';
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSelect from '../DcaSelect.vue';
import DcaSwitch from '../DcaSwitch.vue';

type AgentTab = 'main' | 'skills' | 'tools';
const tabs = [
  { id: 'main' as const, icon: 'fa-solid fa-sliders', label: '主要' },
  { id: 'skills' as const, icon: 'fa-solid fa-book-open', label: 'Skill' },
  { id: 'tools' as const, icon: 'fa-solid fa-screwdriver-wrench', label: '工具' },
];
const loadingOptions = [
  { label: '全量加载', value: 'full' },
  { label: '按需加载', value: 'on-demand' },
];

const { action, runtime, state } = useDreamCardAgent();
const activeTab = ref<AgentTab>('main');
const draft = ref<AgentConfiguration>();
const isBuiltinConfiguration = computed(() => draft.value?.id === DEFAULT_AGENT_CONFIGURATION_ID);
const toolGroups = AGENT_TOOL_GROUPS;
const allToolCount = ALL_AGENT_TOOL_IDS.length;
const enabledSkillCount = computed(() => draft.value?.skills?.filter(skill => skill.enabled).length ?? 0);
const configurationOptions = computed(() =>
  state.value.agentConfigurations.map(configuration => ({
    label: `${configuration.name}${configuration.id === DEFAULT_AGENT_CONFIGURATION_ID ? ' · 内置' : ''}`,
    value: configuration.id,
  })),
);
const presetOptions = computed(() =>
  state.value.presetProfiles.map(preset => ({ label: `${preset.name} · v${preset.version}`, value: preset.id })),
);
const allSkills = computed(() => {
  const remoteStatuses = new Map((state.value.builtinSkillResources ?? []).map(skill => [skill.id, skill]));
  const skills = [
    {
      defaultLoading: BUILTIN_CARD_WORKSPACE_SKILL.loading,
      description: BUILTIN_CARD_WORKSPACE_SKILL.description,
      id: BUILTIN_CARD_WORKSPACE_SKILL.id,
      kind: '内置规则',
      name: '内置文件读写规则',
    },
    ...REMOTE_BUILTIN_SKILLS.map(skill => ({
      defaultLoading: 'on-demand' as const,
      description: skill.description,
      id: skill.id,
      kind: '内置能力',
      name: skill.name,
      remoteState: remoteStatuses.get(skill.id)?.state,
    })),
    ...(state.value.skills ?? []).map(skill => ({
      defaultLoading: skill.loading,
      description: skill.description,
      id: skill.id,
      kind: skill.locked ? '已锁定用户 Skill' : '用户 Skill',
      name: skill.name,
    })),
  ];
  return [...new Map(skills.map(skill => [skill.id, skill])).values()];
});

watch(
  () =>
    `${state.value.activeAgentConfigurationId}:${state.value.agentConfigurations
      .map(configuration => JSON.stringify(configuration))
      .join('|')}`,
  () => {
    const selected =
      state.value.agentConfigurations.find(item => item.id === state.value.activeAgentConfigurationId) ??
      state.value.agentConfigurations[0];
    draft.value = selected
      ? {
          ...structuredClone(toRaw(selected)),
          skills: structuredClone(toRaw(selected.skills ?? [])),
          toolIds: [...(selected.toolIds ?? ALL_AGENT_TOOL_IDS)],
        }
      : undefined;
  },
  { immediate: true },
);

async function selectConfiguration(id: string) {
  if (id) await action(() => runtime.selectAgentConfiguration(id));
}

function uniqueConfigurationName(base: string): string {
  const names = new Set(state.value.agentConfigurations.map(item => item.name));
  if (!names.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!names.has(candidate)) return candidate;
  }
}

async function persistNewConfiguration(candidate: AgentConfiguration, successMessage: string) {
  let saved: AgentConfiguration | undefined;
  const succeeded = await action(async () => {
    saved = await runtime.saveAgentConfiguration(structuredClone(toRaw(candidate)));
  });
  if (!succeeded || !saved) return;
  draft.value = structuredClone(saved);
  activeTab.value = 'main';
  toastr.success(successMessage, '梦境创客');
}

async function newConfiguration() {
  const defaults = new Map(allSkills.value.map(skill => [skill.id, skill.defaultLoading]));
  await persistNewConfiguration({
    id: `agent:${crypto.randomUUID()}`,
    name: uniqueConfigurationName('新 Agent'),
    presetId: draft.value?.presetId ?? state.value.activePresetId,
    skills: [...defaults].map(([id, loading]) => ({ enabled: true, id, loading })),
    toolIds: [...ALL_AGENT_TOOL_IDS],
  }, '新 Agent 已创建并切换。');
}

async function copyConfiguration() {
  if (!draft.value) return;
  const source = structuredClone(toRaw(draft.value));
  await persistNewConfiguration({
    ...structuredClone(toRaw(draft.value)),
    id: `agent:${crypto.randomUUID()}`,
    name: uniqueConfigurationName(`${source.name} 副本`),
  }, 'Agent 副本已创建并切换。');
}

function skillSetting(id: string): AgentSkillSetting {
  const existing = draft.value?.skills?.find(skill => skill.id === id);
  const source = allSkills.value.find(skill => skill.id === id);
  return existing ?? { enabled: false, id, loading: source?.defaultLoading ?? 'on-demand' };
}

function updateSkill(id: string, update: Partial<AgentSkillSetting>) {
  if (!draft.value || isBuiltinConfiguration.value) return;
  const next = { ...skillSetting(id), ...update, id };
  const index = draft.value.skills.findIndex(skill => skill.id === id);
  if (index >= 0) draft.value.skills.splice(index, 1, next);
  else draft.value.skills.push(next);
}

function setSkillEnabled(id: string, enabled: boolean) {
  updateSkill(id, { enabled });
}

function setSkillLoading(id: string, loading: string) {
  if (loading === 'full' || loading === 'on-demand') updateSkill(id, { loading: loading as SkillLoadingMode });
}

function isToolGroupEnabled(group: AgentToolGroup): boolean {
  return Boolean(draft.value && group.tools.every(tool => draft.value!.toolIds.includes(tool.id)));
}

function setToolGroup(group: AgentToolGroup, enabled: boolean) {
  if (!draft.value || isBuiltinConfiguration.value) return;
  const ids = new Set<AgentToolId>(draft.value.toolIds);
  for (const tool of group.tools) {
    if (enabled) ids.add(tool.id);
    else ids.delete(tool.id);
  }
  draft.value.toolIds = [...ids];
}

function setToolEnabled(id: AgentToolId, enabled: boolean) {
  if (!draft.value || isBuiltinConfiguration.value) return;
  draft.value.toolIds = enabled
    ? [...new Set([...draft.value.toolIds, id])]
    : draft.value.toolIds.filter(toolId => toolId !== id);
}

async function saveConfiguration() {
  if (!draft.value) return;
  let saved: AgentConfiguration | undefined;
  const succeeded = await action(async () => {
    saved = await runtime.saveAgentConfiguration(structuredClone(toRaw(draft.value!)));
  });
  if (succeeded && saved) {
    draft.value = structuredClone(saved);
    toastr.success('Agent 配置已保存。', '梦境创客');
  }
}

async function removeConfiguration() {
  if (!draft.value) return;
  const removed = draft.value.name;
  if (await action(() => runtime.removeAgentConfiguration(draft.value!.id))) {
    toastr.success(`已删除 Agent“${removed}”。`, '梦境创客');
  }
}

function loadingLabel(value: SkillLoadingMode): string {
  return value === 'full' ? '全量加载' : '按需加载';
}

function remoteStateLabel(value: string): string {
  return ({ available: '已下载', downloading: '下载中', error: '下载失败', missing: '未下载', outdated: '需要更新' } as Record<string, string>)[value] ?? value;
}
</script>

<style lang="scss">
.dca-agent-settings { min-width: 0; }
.dca-agent-toolbar { position: sticky; z-index: 5; top: 0; }
.dca-agent-tabs { display: flex; gap: .25rem; border-bottom: 1px solid var(--dca-border); }
.dca-agent-tabs > button { display: flex; align-items: center; gap: .42rem; border: 0; border-radius: var(--dca-radius-sm) var(--dca-radius-sm) 0 0; padding: .58rem .9rem; background: transparent; color: var(--dca-text-muted); }
.dca-agent-tabs > button.active { background: var(--dca-raised); color: var(--dca-text); box-shadow: inset 0 -2px 0 var(--dca-accent); }
.dca-agent-tabs small { min-width: 1.2rem; border-radius: 999px; padding: .05rem .3rem; background: var(--dca-highlight); font-size: .68rem; }
.dca-agent-tab-panel { display: flex; min-width: 0; flex-direction: column; gap: .7rem; }
.dca-agent-info-card { display: flex; gap: .65rem; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-md); padding: .75rem; background: var(--dca-raised); }
.dca-agent-info-card > i { color: var(--dca-info); }
.dca-agent-info-card > div { display: grid; gap: .18rem; }
.dca-agent-info-card span, .dca-agent-panel-heading span { color: var(--dca-text-muted); font-size: .78rem; }
.dca-agent-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.dca-agent-panel-heading > div { display: grid; gap: .15rem; }
.dca-agent-skill-list, .dca-agent-tool-groups { display: grid; gap: .5rem; }
.dca-agent-skill-row { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: .8rem; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-md); padding: .65rem .75rem; background: var(--dca-surface); }
.dca-agent-skill-copy { display: grid; min-width: 0; flex: 1; gap: .1rem; }
.dca-agent-skill-copy > span, .dca-agent-skill-copy > small { color: var(--dca-text-muted); font-size: .75rem; }
.dca-agent-skill-controls { display: flex; flex: 0 0 auto; align-items: center; gap: .7rem; }
.dca-agent-skill-controls .dca-select { min-width: 8.2rem; }
.dca-agent-tool-group { overflow: hidden; border: 1px solid var(--dca-border); border-radius: var(--dca-radius-md); background: var(--dca-surface); }
.dca-agent-tool-group > header { display: flex; align-items: center; justify-content: space-between; gap: .8rem; padding: .7rem .8rem; background: var(--dca-raised); }
.dca-agent-tool-group > header > div { display: grid; gap: .1rem; }
.dca-agent-tool-group > header span, .dca-agent-tool-group > header small { color: var(--dca-text-muted); font-size: .74rem; }
.dca-agent-tool-group > header small { color: var(--dca-accent-strong); }
.dca-agent-tool-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--dca-border); }
.dca-agent-tool-list > label { display: flex; align-items: center; justify-content: space-between; gap: .55rem; padding: .55rem .75rem; background: var(--dca-surface); }
.dca-agent-tool-list > label > span { display: grid; gap: .05rem; }
.dca-agent-tool-list small { color: var(--dca-text-muted); font-size: .7rem; }
@media (max-width: 720px) {
  .dca-agent-toolbar { position: static; }
  .dca-agent-tabs > button { flex: 1; justify-content: center; padding-inline: .4rem; }
  .dca-agent-skill-row { align-items: flex-start; flex-direction: column; }
  .dca-agent-skill-controls { width: 100%; justify-content: space-between; }
  .dca-agent-skill-controls .dca-select { flex: 1; }
  .dca-agent-tool-list { grid-template-columns: 1fr; }
  .dca-agent-panel-heading { flex-direction: column; gap: .3rem; }
}
</style>
