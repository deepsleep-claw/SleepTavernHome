<template>
  <section class="dca-section-stack" @click="exportMenuTarget = undefined">
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
        <div class="dca-row-actions dca-skill-actions">
          <button type="button" @click="viewSkill(builtinSkill)">查看</button>
          <button type="button" @click="copySkill(builtinSkill)">另存为</button>
          <ExportMenu :menu-key="`builtin:${builtinSkill.id}`" @export="format => exportSkill(builtinSkill, format)" />
        </div>
      </header>
      <p>{{ builtinSkill.description }}</p>
      <code>/skills/builtin/{{ builtinSkill.id }}/SKILL.md</code>
    </article>

    <article
      v-for="remoteSkill in state.builtinSkillResources"
      :key="remoteSkill.id"
      class="dca-skill-card builtin remote"
    >
      <header>
        <div>
          <strong>{{ remoteSkill.name }}</strong>
          <span>内置 · on-demand · {{ remoteStatusLabel(remoteSkill.state) }} · {{ formatBytes(remoteSkill.size) }}</span>
        </div>
        <div class="dca-row-actions dca-skill-actions">
          <template v-if="remoteSkill.cached">
            <button type="button" @click="inspectRemoteSkill(remoteSkill.id)">查看</button>
            <button type="button" @click="copyRemoteSkill(remoteSkill.id)">另存为</button>
            <ExportMenu :menu-key="`remote:${remoteSkill.id}`" @export="format => exportRemoteSkill(remoteSkill.id, format)" />
          </template>
          <button
            v-else
            type="button"
            :disabled="remoteSkill.state === 'downloading'"
            @click="downloadRemoteSkill(remoteSkill.id)"
          >
            {{ remoteSkill.state === 'downloading' ? '下载中' : '下载' }}
          </button>
        </div>
      </header>
      <p>{{ remoteSkill.description }}</p>
      <code>/skills/builtin/{{ remoteSkill.id }}/SKILL.md</code>
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
        <div class="dca-row-actions dca-skill-actions">
          <button type="button" @click="skillEditorRequest = { deleting: false, skill: currentSkill }">编辑</button>
          <button type="button" @click="copySkill(currentSkill, true)">另存为</button>
          <ExportMenu :menu-key="`user:${currentSkill.id}`" @export="format => exportSkill(currentSkill, format, true)" />
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
const exportMenuTarget = ref<string>();

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/gu, '-') || '梦境创客Skill';
}

function skillResourceBytes(skill: AgentSkill): number {
  return Object.values(skill.resources ?? {}).reduce((sum, resource) => sum + resource.size, 0);
}

async function hydratedSkill(skill: AgentSkill, loadFull = false): Promise<AgentSkill> {
  return loadFull ? runtime.loadGlobalSkill(skill.id) : structuredClone(skill);
}

async function exportSkill(skill: AgentSkill, format: 'md' | 'zip', loadFull = false): Promise<void> {
  exportMenuTarget.value = undefined;
  try {
    const loaded = await hydratedSkill(skill, loadFull || format === 'zip' && !skill.builtin);
    if (format === 'md') downloadText(`${safeName(loaded.name)}.md`, skillMarkdownSource(loaded), 'text/markdown');
    else downloadBytes(`${safeName(loaded.name)}.zip`, exportSkillZip(loaded), 'application/zip');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), 'Skill导出失败');
  }
}

async function exportRemoteSkill(id: string, format: 'md' | 'zip'): Promise<void> {
  exportMenuTarget.value = undefined;
  try {
    const skill = await runtime.loadGlobalSkill(id);
    await exportSkill(skill, format);
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), 'Skill导出失败');
  }
}

const ExportMenu = defineComponent({
  props: { menuKey: { required: true, type: String } },
  emits: { export: (_format: 'md' | 'zip') => true },
  setup(props, { emit }) {
    return () => h('span', { class: 'dca-skill-export-menu', onClick: (event: Event) => event.stopPropagation() }, [
      h('button', {
        'aria-expanded': exportMenuTarget.value === props.menuKey,
        type: 'button',
        onClick: () => { exportMenuTarget.value = exportMenuTarget.value === props.menuKey ? undefined : props.menuKey; },
      }, ['导出', h('i', { 'aria-hidden': 'true', class: 'fa-solid fa-chevron-down' })]),
      exportMenuTarget.value === props.menuKey
        ? h('div', { class: 'dca-skill-export-options', role: 'menu' }, [
            h('button', { role: 'menuitem', type: 'button', onClick: () => emit('export', 'md') }, [
              h('i', { 'aria-hidden': 'true', class: 'fa-brands fa-markdown' }),
              h('span', [h('strong', '仅导出 MD'), h('small', '只包含主 SKILL.md')]),
            ]),
            h('button', { role: 'menuitem', type: 'button', onClick: () => emit('export', 'zip') }, [
              h('i', { 'aria-hidden': 'true', class: 'fa-regular fa-file-zipper' }),
              h('span', [h('strong', '导出 ZIP'), h('small', '包含全部资源文件')]),
            ]),
          ])
        : null,
    ]);
  },
});

function viewSkill(skill: AgentSkill) {
  skillEditorRequest.value = { builtin: true, deleting: false, skill };
}

async function copySkill(skill: AgentSkill, loadFull = false) {
  try {
    const source = await hydratedSkill(skill, loadFull);
    const copy: AgentSkill = {
      ...structuredClone(source),
      builtin: false,
      id: `${source.id.replace(/[^a-zA-Z\d_-]/gu, '_')}-copy-${crypto.randomUUID().slice(0, 8)}`,
      locked: false,
      name: `${source.name} 副本`,
    };
    await runtime.saveGlobalSkill(copy);
    toastr.success(`已另存为“${copy.name}”。`, '梦境创客');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), 'Skill另存失败');
  }
}

async function copyRemoteSkill(id: string) {
  try {
    await copySkill(await runtime.loadGlobalSkill(id));
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), 'Skill另存失败');
  }
}

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

function remoteStatusLabel(value: string): string {
  return ({ available: '可用', downloading: '下载中', error: '下载失败', missing: '未下载', outdated: '待更新' } as Record<string, string>)[value] ?? value;
}

async function downloadRemoteSkill(id: string) {
  try {
    await runtime.downloadBuiltinSkillResource(id, false);
    toastr.success('内置Skill资源已经下载。', '梦境创客');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '内置Skill下载失败');
  }
}

async function inspectRemoteSkill(id: string) {
  try {
    const skill = await runtime.loadGlobalSkill(id);
    viewSkill(skill);
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '内置Skill不可用');
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

.dca-skill-actions {
  position: relative;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.dca-skill-export-menu {
  position: relative;
  display: inline-flex;
}

.dca-skill-export-menu > button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.dca-skill-export-options {
  position: absolute;
  z-index: 30;
  top: calc(100% + 0.35rem);
  right: 0;
  display: grid;
  width: 14rem;
  padding: 0.3rem;
  border: 1px solid var(--dca-border-strong);
  border-radius: var(--dca-radius-md);
  background: var(--dca-raised);
  box-shadow: var(--dca-shadow-2);
}

.dca-app .dca-skill-export-options button {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem;
  border: 0;
  background: transparent;
  text-align: left;
}

.dca-app .dca-skill-export-options button:hover {
  background: var(--dca-accent-soft);
}

.dca-skill-export-options span {
  display: flex;
  flex-direction: column;
  color: var(--dca-text);
}

.dca-skill-export-options small {
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}

.dca-skill-open-folder {
  align-self: flex-start;
}

@media (max-width: 640px) {
  .dca-skill-card > header {
    flex-direction: column;
  }

  .dca-skill-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .dca-skill-export-options {
    right: auto;
    left: 0;
  }
}
</style>
