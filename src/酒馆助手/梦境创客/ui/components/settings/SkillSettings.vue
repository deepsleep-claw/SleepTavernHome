<template>
  <section class="dca-section-stack">
    <header class="dca-section-header dca-resource-toolbar">
      <div>
        <h3>Skill</h3>
        <p>全局复用；full 进入固定头部，on-demand 由 Agent 通过 /skills/index.md 按需探索。</p>
      </div>
      <div class="dca-row-actions">
        <button type="button" @click="skillEditorRequest = { deleting: false }">
          <i class="fa-solid fa-plus" aria-hidden="true"></i> 新建
        </button>
        <button type="button" @click="openSkillImport">导入 MD / ZIP</button>
        <input
          ref="skillImportInput"
          class="dca-hidden-input"
          type="file"
          accept="application/zip,text/markdown,text/plain,.md,.zip"
          @change="importSkill"
        />
      </div>
    </header>

    <article class="dca-skill-card builtin">
      <header>
        <div>
          <strong>{{ builtinSkill.name }}</strong>
          <span>内置 · full · 随脚本更新 · 只读</span>
        </div>
        <div class="dca-row-actions">
          <button type="button" @click="skillEditorRequest = { builtin: true, deleting: false, skill: builtinSkill }">
            查看 / 另存
          </button>
          <ExportControl :skill="builtinSkill" />
        </div>
      </header>
      <p>{{ builtinSkill.description }}</p>
      <code>/skills/builtin/{{ builtinSkill.id }}/SKILL.md</code>
    </article>

    <article v-for="currentSkill in state.skills" :key="currentSkill.id" class="dca-skill-card">
      <header>
        <div>
          <strong>{{ currentSkill.name }}</strong>
          <span>
            {{ currentSkill.loading }} · {{ currentSkill.locked ? '已锁定 · ' : '' }}{{ Object.keys(currentSkill.resources ?? {}).length }} 个资源 ·
            {{ formatBytes(skillResourceBytes(currentSkill)) }}
          </span>
        </div>
        <div class="dca-row-actions">
          <button type="button" @click="skillEditorRequest = { deleting: false, skill: currentSkill }">编辑</button>
          <ExportControl :skill="currentSkill" />
          <button
            class="dca-btn-danger"
            type="button"
            @click="skillEditorRequest = { deleting: true, skill: currentSkill }"
          >
            删除
          </button>
        </div>
      </header>
      <p>{{ currentSkill.description }}</p>
      <code>/skills/user/{{ currentSkill.id }}/SKILL.md</code>
    </article>
    <div v-if="state.skills.length === 0" class="dca-empty">还没有用户 Skill，可以新建或导入。</div>
    <button v-if="state.active" class="dca-skill-open-folder" type="button" @click="openSkillFolder">
      在当前会话文件树中查看挂载版本
    </button>
  </section>
</template>

<script setup lang="ts">
import { defineComponent, h, ref } from 'vue';
import { BUILTIN_CARD_WORKSPACE_SKILL } from '../../../core/skills/builtin-card-workspace';
import { exportSkillZip, importSkillMarkdown, importSkillZip, skillMarkdownSource } from '../../../core/skills/skill-package';
import type { AgentSkill } from '../../../core/skills/types';
import { downloadBytes, downloadText, formatBytes } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';

const { runtime, sidebarFocus, skillEditorRequest, state, workspaceView } = useDreamCardAgent();
const builtinSkill = BUILTIN_CARD_WORKSPACE_SKILL;
const skillImportInput = ref<HTMLInputElement>();
const exportFormats = ref<Record<string, 'md' | 'zip'>>({});

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/gu, '-') || '梦境创客Skill';
}

function skillResourceBytes(skill: AgentSkill): number {
  return Object.values(skill.resources ?? {}).reduce((sum, resource) => sum + resource.size, 0);
}

async function exportSkill(skill: AgentSkill): Promise<void> {
  const format = exportFormats.value[skill.id] ?? 'md';
  try {
    if (format === 'md') {
      downloadText(`${safeName(skill.name)}.md`, skillMarkdownSource(skill), 'text/markdown');
      return;
    }
    const loaded = skill.builtin ? skill : await runtime.loadGlobalSkill(skill.id);
    downloadBytes(`${safeName(skill.name)}.zip`, exportSkillZip(loaded), 'application/zip');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), 'Skill导出失败');
  }
}

const ExportControl = defineComponent({
  props: { skill: { required: true, type: Object as () => AgentSkill } },
  setup(props) {
    return () =>
      h('span', { class: 'dca-skill-export' }, [
        h(
          'select',
          {
            'aria-label': `${props.skill.name}导出格式`,
            value: exportFormats.value[props.skill.id] ?? 'md',
            onChange: (event: Event) => {
              exportFormats.value = {
                ...exportFormats.value,
                [props.skill.id]: (event.target as HTMLSelectElement).value as 'md' | 'zip',
              };
            },
          },
          [h('option', { value: 'md' }, 'MD'), h('option', { value: 'zip' }, 'ZIP')],
        ),
        h('button', { type: 'button', onClick: () => void exportSkill(props.skill) }, '导出'),
      ]);
  },
});

function openSkillImport() {
  skillImportInput.value?.click();
}

async function importSkill(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const skill = file.name.toLocaleLowerCase().endsWith('.zip')
      ? importSkillZip(new Uint8Array(await file.arrayBuffer()), file.name)
      : importSkillMarkdown(await file.text(), file.name);
    await runtime.saveGlobalSkill(skill);
    toastr.success(`已作为新的全局Skill导入“${skill.name}”。`, '梦境创客');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), 'Skill导入失败');
  }
}

function openSkillFolder() {
  workspaceView.value = 'session';
  sidebarFocus.value = {
    filePath:
      state.value.active?.workingFiles.find(file => file.path.includes('/skills/user/'))?.path ?? '/skills/index.md',
    tab: 'files',
  };
}
</script>

<style lang="scss">
.dca-skill-card {
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.65rem 0.75rem;
  background: var(--dca-surface);
}

.dca-skill-card.builtin {
  border-color: color-mix(in srgb, var(--dca-accent) 40%, transparent);
  background: var(--dca-accent-soft);
}

.dca-skill-card > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.65rem;
}

.dca-skill-card > header > div:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.1rem;
}

.dca-skill-card > header span,
.dca-skill-card p {
  color: var(--dca-text-muted);
}

.dca-skill-card p {
  margin: 0.35rem 0;
}

.dca-skill-card code {
  color: var(--dca-text-muted);
  font-family: var(--dca-font-mono);
  font-size: 0.76rem;
  overflow-wrap: anywhere;
}

.dca-skill-export {
  display: inline-flex;
}

.dca-skill-export select {
  width: 4.4rem;
  border-radius: var(--dca-radius-sm) 0 0 var(--dca-radius-sm);
}

.dca-skill-export button {
  border-radius: 0 var(--dca-radius-sm) var(--dca-radius-sm) 0;
}

.dca-skill-open-folder {
  align-self: flex-start;
}
</style>
