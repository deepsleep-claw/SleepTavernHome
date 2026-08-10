<template>
  <section class="dca-section-stack">
    <header class="dca-section-header dca-resource-toolbar">
      <div>
        <h3>Skill</h3>
        <p>full 正文进入静态头，on-demand 由 Agent 按需读取。</p>
      </div>
      <div class="dca-row-actions">
        <button type="button" @click="skillEditorRequest = { deleting: false }">
          <i class="fa-solid fa-plus" aria-hidden="true"></i> 新建
        </button>
        <button type="button" @click="openSkillImport">导入</button>
        <input
          ref="skillImportInput"
          class="dca-hidden-input"
          type="file"
          accept="text/markdown,text/plain,.md"
          @change="importSkill"
        />
      </div>
    </header>
    <article class="dca-skill-card builtin">
      <header>
        <strong>角色卡与世界书文件读写</strong>
        <span>内置 · full · 只读</span>
      </header>
      <p>教 Agent 安全探索、编辑并校验 Card Workspace。</p>
    </article>
    <article v-for="skill in state.skills" :key="skill.id" class="dca-skill-card">
      <header>
        <div>
          <strong>{{ skill.name }}</strong>
          <span>{{ skill.loading }} · 由Agent配置决定是否挂载</span>
        </div>
        <div class="dca-row-actions">
          <button type="button" @click="skillEditorRequest = { deleting: false, skill }">编辑</button>
          <button type="button" @click="exportSkill(skill)">导出</button>
          <button class="dca-btn-danger" type="button" @click="skillEditorRequest = { deleting: true, skill }">
            删除
          </button>
        </div>
      </header>
      <p>{{ skill.description }}</p>
      <code>/skills/user/{{ skill.id }}/SKILL.md</code>
    </article>
    <div v-if="state.skills.length === 0" class="dca-empty">还没有用户 Skill，可以直接在这里新建。</div>
    <button v-if="state.active" class="dca-skill-open-folder" type="button" @click="openSkillFolder">
      在当前会话文件树中查看挂载版本
    </button>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { parseFrontmatter, serializeFrontmatter } from '../../../core/mapping/serde';
import { createSkillTemplate } from '../../../core/skills/skill-registry';
import type { AgentSkill } from '../../../core/skills/types';
import { downloadText } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';

const { runtime, sidebarFocus, skillEditorRequest, state, workspaceView } = useDreamCardAgent();

const skillImportInput = ref<HTMLInputElement>();

function openSkillImport() {
  skillImportInput.value?.click();
}

async function importSkill(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const { body, metadata } = parseFrontmatter(await file.text(), file.name);
    const loading = metadata.loading;
    if (loading !== 'full' && loading !== 'on-demand') throw new Error('Skill loading必须是full或on-demand。');
    if (typeof metadata.name !== 'string' || typeof metadata.description !== 'string') {
      throw new Error('Skill缺少name或description。');
    }
    const template = createSkillTemplate(metadata.name, metadata.description, loading);
    const skill: AgentSkill = {
      ...template,
      body: body.trim(),
      id: `${template.id}-${crypto.randomUUID().slice(0, 8)}`,
    };
    await runtime.saveGlobalSkill(skill);
    toastr.success(`已导入全局Skill“${skill.name}”。`, '梦境创客');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), 'Skill导入失败');
  }
}

function exportSkill(skill: AgentSkill) {
  downloadText(
    `${skill.name.replace(/[\\/:*?"<>|]/gu, '-') || '梦境创客Skill'}.md`,
    serializeFrontmatter(
      {
        description: skill.description,
        loading: skill.loading,
        name: skill.name,
      },
      skill.body,
    ),
    'text/markdown',
  );
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
  border-color: rgb(157 124 255 / 40%);
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

.dca-skill-card > header span {
  color: var(--dca-text-muted);
  font-size: 0.78rem;
}

.dca-skill-card p {
  margin: 0.35rem 0;
  color: var(--dca-text-secondary);
}

.dca-skill-card code {
  color: var(--dca-text-muted);
  font-family: var(--dca-font-mono);
  font-size: 0.76rem;
  overflow-wrap: anywhere;
}

.dca-skill-open-folder {
  align-self: flex-start;
}
</style>
