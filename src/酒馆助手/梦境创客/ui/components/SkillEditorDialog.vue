<template>
  <div v-if="skillEditorRequest" class="dca-modal-backdrop">
    <section class="dca-modal dca-skill-editor" role="dialog" aria-modal="true" aria-labelledby="dca-skill-title">
      <header>
        <div>
          <h3 id="dca-skill-title">
            {{ skillDeletePending ? '删除 Skill' : builtinReadonly ? '查看内置 Skill' : skillDraft.id ? '编辑 Skill' : '新建 Skill' }}
          </h3>
          <p v-if="!skillDeletePending">
            Skill 在全局资源库中跨角色复用；文件可自由组织，根目录 SKILL.md 保留给主 Skill。
          </p>
        </div>
        <button class="dca-icon-btn" type="button" title="关闭" @click="closeSkillEditor">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </header>

      <div v-if="loading" class="dca-empty">正在载入 Skill 文件……</div>
      <div v-else-if="skillDeletePending" class="dca-alert dca-alert-warning">
        <span>
          确认从全局资源库删除“{{ skillDraft.name }}”？它会同时从所有 Agent 配置中移除，已有会话历史不受影响。
        </span>
      </div>
      <template v-else>
        <fieldset class="dca-skill-fields" :disabled="builtinReadonly">
          <div class="dca-form-grid">
            <label class="dca-field"><span>名称</span><input v-model="skillDraft.name" type="text" @input="markDirty" /></label>
            <label class="dca-field">
              <span>类型</span>
              <DcaSelect
                aria-label="Skill 加载类型"
                :disabled="builtinReadonly"
                :model-value="skillDraft.loading"
                :options="loadingOptions"
                @update:model-value="updateLoadingMode"
              />
            </label>
            <label class="dca-field wide">
              <span>摘要</span>
              <input v-model="skillDraft.description" type="text" maxlength="240" @input="markDirty" />
            </label>
            <label class="dca-field wide dca-skill-lock-field">
              <input v-model="skillDraft.locked" type="checkbox" @change="markDirty" />
              <span>锁定此 Skill（Agent仍可读取，但不能修改、移动或删除）</span>
            </label>
            <label class="dca-field wide">
              <span>SKILL.md</span>
              <textarea
                v-model="skillDraft.body"
                rows="12"
                spellcheck="false"
                placeholder="# 工作流程"
                @input="markDirty"
              ></textarea>
            </label>
          </div>
        </fieldset>

        <section class="dca-skill-files">
          <header>
            <div>
              <strong>资源文件</strong>
              <span>{{ resourceFileCount }} 个文件 · {{ formatBytes(resourceBytes) }}</span>
            </div>
            <div v-if="!builtinReadonly" class="dca-row-actions dca-skill-file-actions">
              <label class="dca-skill-folder-target">
                <span>当前目录</span>
                <input v-model="currentDirectory" type="text" placeholder="根目录" />
              </label>
              <button type="button" @click="createDirectory">新建文件夹</button>
              <button type="button" @click="createTextFile">新建文本</button>
              <button type="button" @click="resourceUploadInput?.click()">上传文件</button>
              <input ref="resourceUploadInput" class="dca-hidden-input" type="file" multiple @change="uploadResources" />
            </div>
          </header>

          <div class="dca-skill-file-layout">
            <div class="dca-skill-file-list">
              <button
                class="dca-skill-file-row reserved"
                :class="{ active: selectedPath === 'SKILL.md' }"
                type="button"
                @click="selectMainSkillFile"
              >
                <i class="fa-brands fa-markdown" aria-hidden="true"></i>
                <span>SKILL.md</span><small>主文件</small>
              </button>
              <div
                v-for="entry in visibleResourceEntries"
                :key="`${entry.kind}:${entry.path}`"
                class="dca-skill-file-row-wrap"
                :style="treeRowStyle(entry)"
                @contextmenu.prevent="openResourceMenu($event, entry)"
              >
                <button
                  class="dca-skill-file-row"
                  :class="{ active: entry.kind === 'file' && selectedPath === entry.path, directory: entry.kind === 'directory' }"
                  type="button"
                  @click="selectResource(entry)"
                >
                  <i
                    v-if="entry.kind === 'directory'"
                    :class="expandedDirectories.has(entry.path) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'"
                    aria-hidden="true"
                  ></i>
                  <i v-else class="fa-regular fa-file" aria-hidden="true"></i>
                  <span>{{ entry.name }}</span>
                  <small>{{ entry.kind === 'directory' ? '文件夹' : formatBytes(entry.size) }}</small>
                </button>
                <span class="dca-row-actions dca-skill-entry-actions">
                  <button class="dca-icon-btn" type="button" :title="entry.kind === 'directory' ? '导出文件夹 ZIP' : '导出文件'" @click.stop="downloadEntry(entry)">
                    <i class="fa-solid fa-download" aria-hidden="true"></i>
                  </button>
                  <button v-if="!builtinReadonly" class="dca-icon-btn" type="button" title="重命名" @click.stop="renameEntry(entry)">
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
                  </button>
                  <button v-if="!builtinReadonly" class="dca-icon-btn" type="button" title="删除" @click.stop="deleteEntry(entry)">
                    <i class="fa-solid fa-trash" aria-hidden="true"></i>
                  </button>
                </span>
              </div>
              <div v-if="allResourceEntries.length === 0" class="dca-empty">暂无额外资源，不会预创建任何目录。</div>
            </div>

            <div class="dca-skill-file-preview-layer" :class="{ open: mobileResourceOpen }" @click.self="closeMobileResource">
              <div class="dca-skill-file-preview">
                <button class="dca-icon-btn dca-skill-mobile-preview-close" type="button" title="关闭资源文件" @click="closeMobileResource">
                  <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
                <template v-if="selectedPath === 'SKILL.md'">
                  <strong>SKILL.md</strong>
                  <p>主 Skill 正文在上方编辑；这个文件名固定保留。</p>
                </template>
                <template v-else-if="selectedResource">
                  <header>
                    <div><strong>{{ selectedPath }}</strong><small>{{ selectedResource.mediaType }}</small></div>
                    <button type="button" @click="downloadResource(selectedPath, selectedResource)">
                      <i class="fa-solid fa-download" aria-hidden="true"></i>导出
                    </button>
                  </header>
                  <textarea
                    v-if="selectedResource.content !== undefined"
                    :disabled="builtinReadonly"
                    :value="selectedResource.content"
                    rows="15"
                    spellcheck="false"
                    @input="updateSelectedText"
                  ></textarea>
                  <div v-else class="dca-empty">
                    二进制资源不会作为文本展开。Agent 可以看到、移动或删除它，但 read_file 会返回不可读取提示。
                  </div>
                </template>
                <template v-else>
                  <strong>选择一个资源</strong>
                  <p>从左侧文件树选择文件进行查看或编辑。</p>
                </template>
              </div>
            </div>
          </div>

          <div
            v-if="resourceMenu"
            class="dca-file-context-menu dca-skill-resource-menu"
            :style="{ left: `${resourceMenu.x}px`, top: `${resourceMenu.y}px` }"
            @click.stop
            @pointerdown.stop
          >
            <button type="button" @click="downloadEntry(resourceMenu.entry)">
              <i class="fa-solid fa-download" aria-hidden="true"></i>
              导出{{ resourceMenu.entry.kind === 'directory' ? '文件夹 ZIP' : '文件' }}
            </button>
            <button v-if="!builtinReadonly" type="button" @click="renameEntry(resourceMenu.entry)">
              <i class="fa-solid fa-pen" aria-hidden="true"></i>重命名
            </button>
            <button v-if="!builtinReadonly" class="danger" type="button" @click="deleteEntry(resourceMenu.entry)">
              <i class="fa-regular fa-trash-can" aria-hidden="true"></i>删除
            </button>
          </div>
        </section>

        <div v-if="skillModifyPending" class="dca-alert dca-alert-warning">
          <span>修改会影响之后使用这个全局 Skill 的所有角色与会话，确认保存新版吗？</span>
          <button type="button" @click="commitSkillSave">确认保存</button>
        </div>
      </template>

      <div class="dca-skill-editor-footer">
        <button
          v-if="skillDraft.id && !skillDeletePending && !builtinReadonly"
          class="dca-btn-danger"
          type="button"
          @click="skillDeletePending = true"
        >
          删除
        </button>
        <button type="button" @click="closeSkillEditor">取消</button>
        <button v-if="skillDeletePending" class="dca-btn-danger" type="button" @click="deleteSkill">确认删除</button>
        <button
          v-else-if="!builtinReadonly"
          class="dca-btn-primary"
          type="button"
          :disabled="loading || !canSaveSkill"
          @click="saveSkill"
        >
          保存 Skill
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, toRaw, watch } from 'vue';
import { zipSync } from 'fflate';
import {
  inferSkillMediaType,
  MAX_SKILL_RESOURCE_BYTES,
  normalizeSkillDirectoryPath,
  normalizeSkillResourcePath,
  skillDirectories,
  skillResources,
} from '../../core/skills/resources';
import { createSkillTemplate } from '../../core/skills/skill-registry';
import type { AgentSkill, SkillLoadingMode, SkillResource } from '../../core/skills/types';
import { downloadBytes, downloadText, formatBytes } from '../composables/format';
import { useDreamCardAgent } from '../composables/runtime';
import DcaSelect from './DcaSelect.vue';

type ResourceEntry = { depth: number; kind: 'directory' | 'file'; name: string; path: string; size: number };

const { action, runtime, skillEditorRequest } = useDreamCardAgent();
const skillDeletePending = ref(false);
const skillModifyPending = ref(false);
const builtinReadonly = ref(false);
const dirty = ref(false);
const loading = ref(false);
const editingSkill = shallowRef<AgentSkill>();
const resourceDraft = shallowRef<Record<string, SkillResource>>({});
const directoryDraft = shallowRef<string[]>([]);
const resourceUploadInput = ref<HTMLInputElement>();
const currentDirectory = ref('');
const selectedPath = ref('SKILL.md');
const expandedDirectories = ref(new Set<string>());
const mobileResourceOpen = ref(false);
const resourceMenu = ref<{ entry: ResourceEntry; x: number; y: number }>();
let loadToken = 0;

const skillDraft = reactive({
  body: '',
  description: '',
  id: '',
  loading: 'on-demand' as SkillLoadingMode,
  locked: false,
  name: '',
});
const loadingOptions = [
  { description: '在首次请求及压缩后的新头部中注入', label: 'full · 全量加载', value: 'full' },
  { description: '由 Agent 通过 /skills/index.md 主动读取', label: 'on-demand · 按需读取', value: 'on-demand' },
];

const canSaveSkill = computed(
  () => skillDraft.name.trim() !== '' && skillDraft.description.trim() !== '' && skillDraft.body.trim() !== '',
);
const resourceFileCount = computed(() => Object.keys(resourceDraft.value).length);
const resourceBytes = computed(() => Object.values(resourceDraft.value).reduce((sum, resource) => sum + resource.size, 0));
const selectedResource = computed(() => resourceDraft.value[selectedPath.value]);
const allResourceEntries = computed<ResourceEntry[]>(() => {
  const directories = new Set(directoryDraft.value);
  for (const path of Object.keys(resourceDraft.value)) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join('/'));
  }
  const entries: ResourceEntry[] = [
    ...[...directories].map(path => ({
      depth: path.split('/').length - 1,
      kind: 'directory' as const,
      name: path.split('/').at(-1) ?? path,
      path,
      size: 0,
    })),
    ...Object.entries(resourceDraft.value).map(([path, resource]) => ({
      depth: path.split('/').length - 1,
      kind: 'file' as const,
      name: path.split('/').at(-1) ?? path,
      path,
      size: resource.size,
    })),
  ];
  return entries.sort((left, right) => {
    const leftParent = left.path.split('/').slice(0, -1).join('/');
    const rightParent = right.path.split('/').slice(0, -1).join('/');
    if (leftParent === rightParent && left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
});
const visibleResourceEntries = computed(() => allResourceEntries.value.filter(entry => {
  const parts = entry.path.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    if (!expandedDirectories.value.has(parts.slice(0, index).join('/'))) return false;
  }
  return true;
}));

watch(skillEditorRequest, request => {
  if (!request) return;
  const token = ++loadToken;
  skillDeletePending.value = request.deleting;
  skillModifyPending.value = false;
  builtinReadonly.value = request.builtin === true || request.skill?.builtin === true;
  selectedPath.value = 'SKILL.md';
  mobileResourceOpen.value = false;
  currentDirectory.value = '';
  if (request.deleting && request.skill) {
    assignSkill(request.skill);
    return;
  }
  if (request.skill && !request.skill.builtin) {
    assignSkill(request.skill);
    if (typeof runtime.loadGlobalSkill !== 'function') return;
    loading.value = true;
    void runtime
      .loadGlobalSkill(request.skill.id)
      .then(skill => {
        if (token === loadToken) assignSkill(skill);
      })
      .catch(error => toastr.error(error instanceof Error ? error.message : String(error), 'Skill载入失败'))
      .finally(() => {
        if (token === loadToken) loading.value = false;
      });
    return;
  }
  assignSkill(request.skill ?? createSkillTemplate('新 Skill', '说明这个Skill何时使用、能帮助Agent做什么。', 'on-demand'));
  if (!request.skill) {
    skillDraft.id = '';
    editingSkill.value = undefined;
  }
});

function assignSkill(input: AgentSkill) {
  const skill = structuredClone(toRaw(input));
  editingSkill.value = skill.builtin ? undefined : skill;
  Object.assign(skillDraft, skill);
  resourceDraft.value = structuredClone(skillResources(skill));
  directoryDraft.value = skillDirectories(skill);
  expandedDirectories.value = new Set(
    [...directoryDraft.value, ...Object.keys(resourceDraft.value).map(path => path.split('/')[0])]
      .filter(path => path && !path.includes('/')),
  );
  dirty.value = false;
  loading.value = false;
}

function markDirty() {
  if (!builtinReadonly.value) dirty.value = true;
}

function closeSkillEditor() {
  if (dirty.value && !builtinReadonly.value && !window.confirm('还有未保存的Skill修改，确定关闭吗？')) return;
  loadToken += 1;
  skillEditorRequest.value = undefined;
  skillDeletePending.value = false;
  skillModifyPending.value = false;
  builtinReadonly.value = false;
  editingSkill.value = undefined;
  resourceDraft.value = {};
  directoryDraft.value = [];
  expandedDirectories.value = new Set();
  mobileResourceOpen.value = false;
  resourceMenu.value = undefined;
  dirty.value = false;
}

function updateLoadingMode(value: string) {
  if (!builtinReadonly.value && (value === 'full' || value === 'on-demand')) {
    skillDraft.loading = value;
    markDirty();
  }
}

function skillFromDraft(): AgentSkill {
  const template = createSkillTemplate(skillDraft.name, skillDraft.description, skillDraft.loading);
  return {
    body: skillDraft.body.trim(),
    builtin: false,
    description: skillDraft.description.trim(),
    directories: [...directoryDraft.value],
    id: editingSkill.value?.id ?? `${template.id}-${crypto.randomUUID().slice(0, 8)}`,
    loading: skillDraft.loading,
    locked: skillDraft.locked,
    name: skillDraft.name.trim(),
    resources: structuredClone(resourceDraft.value),
  };
}

async function saveSkill() {
  if (editingSkill.value && !skillModifyPending.value) {
    skillModifyPending.value = true;
    return;
  }
  await commitSkillSave();
}

async function commitSkillSave() {
  const skill = skillFromDraft();
  if (await action(() => runtime.saveGlobalSkill(skill))) {
    dirty.value = false;
    closeSkillEditor();
    toastr.success(`全局Skill“${skill.name}”已保存；已发送的固定头部不会被自动改写。`, '梦境创客');
  }
}

async function deleteSkill() {
  if (!skillDraft.id) return;
  if (await action(() => runtime.removeGlobalSkill(skillDraft.id))) {
    const name = skillDraft.name;
    dirty.value = false;
    closeSkillEditor();
    toastr.success(`已删除全局Skill“${name}”。`, '梦境创客');
  }
}

function targetPath(name: string): string {
  const directory = currentDirectory.value.trim();
  return normalizeSkillResourcePath(directory ? `${directory}/${name}` : name);
}

async function uploadResources(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  const next = { ...resourceDraft.value };
  try {
    for (const file of files) {
      if (file.size > MAX_SKILL_RESOURCE_BYTES) throw new Error(`单个文件不能超过20MB：${file.name}`);
      const path = targetPath(file.name);
      if (next[path] && !window.confirm(`资源“${path}”已经存在，是否替换？`)) continue;
      const mediaType = file.type || inferSkillMediaType(path);
      next[path] = mediaType.startsWith('text/') || mediaType === 'application/json'
        ? { content: await file.text(), mediaType, size: file.size }
        : { data: new Uint8Array(await file.arrayBuffer()), mediaType, size: file.size };
    }
    resourceDraft.value = next;
    markDirty();
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '资源上传失败');
  }
}

function createDirectory() {
  const input = window.prompt('输入相对于Skill根目录的文件夹路径：', currentDirectory.value);
  if (!input) return;
  try {
    const path = normalizeSkillDirectoryPath(input);
    directoryDraft.value = [...new Set([...directoryDraft.value, path])].sort();
    currentDirectory.value = path;
    selectedPath.value = path;
    markDirty();
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '无法创建文件夹');
  }
}

function createTextFile() {
  const name = window.prompt('输入新文本文件名：', 'notes.md');
  if (!name) return;
  try {
    const path = targetPath(name);
    if (resourceDraft.value[path]) throw new Error(`文件已经存在：${path}`);
    resourceDraft.value = {
      ...resourceDraft.value,
      [path]: { content: '', mediaType: inferSkillMediaType(path), size: 0 },
    };
    selectedPath.value = path;
    markDirty();
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '无法新建文本文件');
  }
}

function selectMainSkillFile() {
  selectedPath.value = 'SKILL.md';
  mobileResourceOpen.value = true;
}

function selectResource(entry: ResourceEntry) {
  closeResourceMenu();
  if (entry.kind === 'directory') {
    toggleDirectory(entry.path);
    currentDirectory.value = entry.path;
    return;
  }
  selectedPath.value = entry.path;
  currentDirectory.value = entry.path.split('/').slice(0, -1).join('/');
  mobileResourceOpen.value = true;
}

function toggleDirectory(path: string) {
  const next = new Set(expandedDirectories.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expandedDirectories.value = next;
}

function treeRowStyle(entry: ResourceEntry) {
  return { paddingLeft: `${entry.depth * 0.9}rem` };
}

function closeMobileResource() {
  mobileResourceOpen.value = false;
}

function closeResourceMenu() {
  resourceMenu.value = undefined;
}

function openResourceMenu(event: MouseEvent, entry: ResourceEntry) {
  resourceMenu.value = {
    entry,
    x: Math.min(event.clientX, window.innerWidth - 220),
    y: Math.min(event.clientY, window.innerHeight - 150),
  };
}

function renameEntry(entry: ResourceEntry) {
  closeResourceMenu();
  const input = window.prompt('输入新的相对路径：', entry.path);
  if (!input || input === entry.path) return;
  try {
    const nextPath = entry.kind === 'directory' ? normalizeSkillDirectoryPath(input) : normalizeSkillResourcePath(input);
    if (entry.kind === 'file') {
      if (resourceDraft.value[nextPath]) throw new Error(`文件已经存在：${nextPath}`);
      const next = { ...resourceDraft.value };
      next[nextPath] = next[entry.path];
      delete next[entry.path];
      resourceDraft.value = next;
    } else {
      const prefix = `${entry.path}/`;
      const next = Object.fromEntries(
        Object.entries(resourceDraft.value).map(([path, resource]) => [
          path.startsWith(prefix) ? `${nextPath}/${path.slice(prefix.length)}` : path,
          resource,
        ]),
      );
      resourceDraft.value = next;
      directoryDraft.value = directoryDraft.value.map(path =>
        path === entry.path ? nextPath : path.startsWith(prefix) ? `${nextPath}/${path.slice(prefix.length)}` : path,
      );
    }
    selectedPath.value = nextPath;
    markDirty();
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '无法重命名');
  }
}

function deleteEntry(entry: ResourceEntry) {
  closeResourceMenu();
  if (!window.confirm(`确定删除${entry.kind === 'directory' ? '文件夹及其内容' : '文件'}“${entry.path}”吗？`)) return;
  if (entry.kind === 'file') {
    const next = { ...resourceDraft.value };
    delete next[entry.path];
    resourceDraft.value = next;
  } else {
    const prefix = `${entry.path}/`;
    resourceDraft.value = Object.fromEntries(
      Object.entries(resourceDraft.value).filter(([path]) => path !== entry.path && !path.startsWith(prefix)),
    );
    directoryDraft.value = directoryDraft.value.filter(path => path !== entry.path && !path.startsWith(prefix));
  }
  selectedPath.value = 'SKILL.md';
  markDirty();
}

function updateSelectedText(event: Event) {
  const resource = selectedResource.value;
  if (!resource || resource.content === undefined) return;
  const content = (event.target as HTMLTextAreaElement).value;
  resourceDraft.value = {
    ...resourceDraft.value,
    [selectedPath.value]: {
      content,
      mediaType: resource.mediaType,
      size: new TextEncoder().encode(content).byteLength,
    },
  };
  markDirty();
}

function downloadResource(path: string, resource: SkillResource) {
  const name = path.split('/').at(-1) ?? 'resource.bin';
  if (resource.data) downloadBytes(name, resource.data, resource.mediaType);
  else downloadText(name, resource.content ?? '', resource.mediaType);
}

function resourceDataBytes(resource: SkillResource): Uint8Array {
  return resource.data ?? new TextEncoder().encode(resource.content ?? '');
}

function downloadEntry(entry: ResourceEntry) {
  closeResourceMenu();
  if (entry.kind === 'file') {
    const resource = resourceDraft.value[entry.path];
    if (resource) downloadResource(entry.path, resource);
    return;
  }
  const prefix = `${entry.path}/`;
  const files = Object.entries(resourceDraft.value).filter(([path]) => path.startsWith(prefix));
  const archive = Object.fromEntries(files.map(([path, resource]) => [path.slice(prefix.length), resourceDataBytes(resource)]));
  downloadBytes(`${entry.name}.zip`, zipSync(archive, { level: 6 }), 'application/zip');
}

onMounted(() => window.addEventListener('pointerdown', closeResourceMenu));
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeResourceMenu));
</script>

<style lang="scss">
.dca-modal.dca-skill-editor {
  display: flex;
  width: min(76rem, calc(100vw - 2rem));
  max-height: min(62rem, calc(100vh - 2rem));
  flex-direction: column;
  gap: 0.75rem;
  overflow: auto;
}

.dca-skill-editor > header,
.dca-skill-files > header,
.dca-skill-file-preview > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.dca-skill-editor > header h3,
.dca-skill-editor > header p,
.dca-skill-file-preview p {
  margin: 0;
}

.dca-skill-editor > header p,
.dca-skill-files header span,
.dca-skill-file-preview p,
.dca-skill-file-preview small {
  color: var(--dca-text-muted);
  font-size: 0.82rem;
}

.dca-skill-fields {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.dca-skill-files {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--dca-border);
}

.dca-skill-files > header > div:first-child,
.dca-skill-file-preview header > div {
  display: flex;
  flex-direction: column;
}

.dca-skill-folder-target {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.dca-skill-folder-target input {
  width: 9rem;
}

.dca-skill-file-actions {
  flex-wrap: wrap;
  justify-content: flex-start;
}

.dca-skill-file-layout {
  display: grid;
  min-height: 18rem;
  grid-template-columns: minmax(15rem, 0.8fr) minmax(18rem, 1.2fr);
  gap: 0.6rem;
}

.dca-skill-file-list,
.dca-skill-file-preview {
  min-width: 0;
  padding: 0.5rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  background: var(--dca-surface);
}

.dca-skill-file-list {
  max-height: 24rem;
  overflow: auto;
  scrollbar-gutter: stable;
}

.dca-skill-file-preview-layer {
  min-width: 0;
}

.dca-skill-file-preview {
  height: 100%;
  overflow: auto;
  scrollbar-gutter: stable;
}

.dca-skill-file-row-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.25rem;
}

.dca-app .dca-skill-file-row {
  display: grid;
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
  justify-content: stretch;
  padding: 0.38rem 0.45rem;
  border: 0;
  background: transparent;
  text-align: left;
}

.dca-app .dca-skill-file-row.directory {
  color: var(--dca-text-secondary);
  font-weight: 600;
}

.dca-app .dca-skill-file-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-app .dca-skill-file-row small {
  color: var(--dca-text-muted);
}

.dca-app .dca-skill-file-row.active,
.dca-app .dca-skill-file-row:hover {
  background: var(--dca-accent-soft);
}

.dca-app .dca-skill-file-row.reserved {
  color: var(--dca-accent);
}

.dca-skill-entry-actions {
  align-items: center;
  justify-content: flex-start;
}

.dca-skill-entry-actions button {
  text-align: left;
}

.dca-skill-file-preview textarea {
  width: 100%;
  min-height: 14rem;
  margin-top: 0.55rem;
  font-family: var(--dca-font-mono);
}

.dca-skill-editor-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
}

.dca-skill-editor-footer .dca-btn-danger {
  margin-right: auto;
}

.dca-skill-mobile-preview-close {
  display: none;
}

.dca-app .dca-skill-resource-menu button {
  justify-content: flex-start;
  text-align: left;
}

@media (max-width: 720px) {
  .dca-modal.dca-skill-editor {
    width: calc(100vw - 1rem);
    max-height: calc(100dvh - 1rem);
  }

  .dca-skill-file-layout {
    grid-template-columns: 1fr;
  }

  .dca-skill-file-list {
    max-height: min(40dvh, 25rem);
  }

  .dca-skill-file-preview-layer {
    position: fixed;
    z-index: 120;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    background: var(--dca-scrim);
  }

  .dca-skill-file-preview-layer.open {
    display: flex;
  }

  .dca-skill-file-preview {
    position: relative;
    width: min(100%, 42rem);
    height: auto;
    max-height: calc(100dvh - 1rem);
    padding-top: 2.8rem;
    overflow: auto;
    background: var(--dca-raised);
    box-shadow: var(--dca-shadow-3);
  }

  .dca-skill-file-preview textarea {
    min-height: min(60dvh, 32rem);
  }

  .dca-skill-mobile-preview-close {
    position: absolute;
    top: 0.55rem;
    right: 0.55rem;
    display: inline-grid;
  }

  .dca-skill-file-row-wrap {
    grid-template-columns: minmax(0, 1fr);
  }

  .dca-skill-entry-actions {
    display: none;
  }
}
</style>
