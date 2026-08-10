<template>
  <aside class="dca-session-sidebar">
    <nav aria-label="会话辅助面板">
      <button type="button" :class="{ active: tab === 'files' }" @click="tab = 'files'">
        <i class="fa-solid fa-folder-tree" aria-hidden="true"></i><span>文件</span>
      </button>
      <button type="button" :class="{ active: tab === 'diff' }" @click="tab = 'diff'">
        <i class="fa-solid fa-code-compare" aria-hidden="true"></i><span>Diff</span>
        <em v-if="changeCount">{{ changeCount }}</em>
      </button>
      <button type="button" :class="{ active: tab === 'context' }" @click="tab = 'context'">
        <i class="fa-solid fa-gauge-high" aria-hidden="true"></i><span>上下文</span>
      </button>
      <button class="dca-icon-btn dca-close-sidebar" type="button" title="收起侧栏" @click="emit('close')">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
    </nav>

    <section v-if="tab === 'files'" class="dca-side-files">
      <div class="dca-file-list">
        <header>
          <strong>Card Workspace</strong>
          <small>{{ files.length }} 个文件</small>
        </header>
        <button
          v-for="row in visibleFileTreeRows"
          :key="row.path"
          type="button"
          class="dca-file-tree-row"
          :class="{
            active: row.kind === 'file' && selectedFilePath === row.path,
            directory: row.kind === 'directory',
          }"
          :style="treeRowStyle(row)"
          :title="row.path"
          @click="row.kind === 'directory' ? toggleDirectory(row.path) : selectFile(row.path)"
        >
          <i
            v-if="row.kind === 'directory'"
            :class="expandedDirectories.has(row.path) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'"
            aria-hidden="true"
          ></i>
          <i v-else :class="row.readonly ? 'fa-solid fa-lock' : 'fa-regular fa-file-lines'" aria-hidden="true"></i>
          <span>{{ row.name }}</span>
        </button>
      </div>
      <div class="dca-editor">
        <template v-if="selectedFile">
          <header>
            <div>
              <strong>{{ selectedFile.path }}</strong>
              <small>{{ selectedFile.mediaType }} · {{ selectedFile.resourceId }}</small>
            </div>
            <div class="dca-editor-actions">
              <div v-if="isMarkdownFile" class="dca-editor-view-switch" aria-label="Markdown查看方式">
                <button type="button" :class="{ active: editorView === 'edit' }" @click="editorView = 'edit'">编辑</button>
                <button type="button" :class="{ active: editorView === 'preview' }" @click="editorView = 'preview'">
                  预览
                </button>
              </div>
              <button type="button" :disabled="!canEditFile || fileDraft === selectedFile.content" @click="saveFile">
                保存
              </button>
            </div>
          </header>
          <div v-if="secretWarning" class="dca-secret-banner warning" role="status">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <span>{{ secretWarning }}</span>
          </div>
          <div v-else-if="secretFindings.length" class="dca-secret-banner protected" role="status">
            <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
            <span>检测到 {{ secretFindings.length }} 处敏感内容；界面显示原文，Agent读取时自动遮罩。</span>
          </div>
          <template v-if="editorView === 'preview' && isMarkdownFile">
            <div v-if="largeMarkdownFile && !largePreviewApproved" class="dca-large-preview">
              <i class="fa-regular fa-file-lines" aria-hidden="true"></i>
              <strong>这个Markdown文件超过1MB</strong>
              <span>为避免界面卡顿，预览只在你明确需要时渲染。</span>
              <button type="button" @click="largePreviewApproved = true">仍然加载预览</button>
            </div>
            <!-- eslint-disable vue/no-v-html -- 内容已由 ui/markdown.ts 的默认安全 Schema 清洗。 -->
            <div v-else class="dca-markdown dca-file-preview" v-html="renderMarkdown(fileDraft)"></div>
            <!-- eslint-enable vue/no-v-html -->
          </template>
          <VfsTextEditor
            v-else
            v-model="fileDraft"
            :markers="secretMarkers"
            :path="selectedFile.path"
            :readonly="!canEditFile"
          />
          <small v-if="!canEditFile" class="dca-editor-note">只读资源或 Agent 运行期间不能编辑。</small>
        </template>
        <div v-else class="dca-empty">选择文件查看或编辑。</div>
      </div>
    </section>

    <section v-else-if="tab === 'diff'" class="dca-side-scroll">
      <header class="dca-side-heading">
        <div>
          <strong>Working Diff</strong>
          <small>不重叠的酒馆手改会保留</small>
        </div>
        <div class="dca-row-actions">
          <button type="button" :disabled="state.busy" @click="undo">撤销</button>
          <button type="button" :disabled="state.busy" @click="redo">重做</button>
        </div>
      </header>
      <div v-if="!state.active?.approval" class="dca-empty">当前没有待批准修改。</div>
      <article
        v-for="change in approvalChanges"
        v-else
        :key="change.path"
        class="dca-diff-item"
        :class="{ danger: change.highRisk }"
      >
        <header>
          <div>
            <strong>{{ change.label }}</strong>
            <code>{{ change.path }}</code>
          </div>
          <span v-if="change.highRisk" class="dca-diff-risk">强制确认</span>
        </header>
        <div v-if="conflictByPath(change.path)" class="dca-conflict-stack">
          <details>
            <summary>Base</summary>
            <pre>{{ pretty(conflictByPath(change.path)?.base) }}</pre>
          </details>
          <details>
            <summary>酒馆当前</summary>
            <pre>{{ pretty(conflictByPath(change.path)?.current) }}</pre>
          </details>
          <details>
            <summary>Agent</summary>
            <pre>{{ pretty(conflictByPath(change.path)?.agent) }}</pre>
          </details>
        </div>
      </article>
    </section>

    <section v-else class="dca-side-scroll">
      <header class="dca-side-heading">
        <div>
          <strong>上下文监视器</strong>
          <small>70% 自动压缩，用户消息 80% 时暂停</small>
        </div>
      </header>
      <div class="dca-context-meter">
        <span :style="{ width: `${Math.min(100, (state.active?.contextUsage.ratio ?? 0) * 100)}%` }"></span>
        <i style="left: 70%"></i>
      </div>
      <div class="dca-metric-grid">
        <div>
          <strong>{{ state.active?.contextUsage.totalTokens }}</strong>
          <span>估算总 Token</span>
        </div>
        <div>
          <strong>{{ state.active?.contextUsage.remainingTokens }}</strong>
          <span>剩余空间</span>
        </div>
        <div>
          <strong>{{ state.active?.contextUsage.systemTokens }}</strong>
          <span>静态头部</span>
        </div>
        <div>
          <strong>{{ state.active?.contextUsage.userTokens }}</strong>
          <span>用户消息</span>
        </div>
        <div>
          <strong>{{ state.active?.contextUsage.assistantTokens }}</strong>
          <span>助手消息</span>
        </div>
        <div>
          <strong>{{ state.active?.contextUsage.toolTokens }}</strong>
          <span>工具链</span>
        </div>
      </div>
      <details>
        <summary>上下文事件</summary>
        <pre>{{ pretty(state.active?.events.filter(event => event.type === 'context-compacted') ?? []) }}</pre>
      </details>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { maskSecretsForModel } from '../../../../core/workspace/secret-protection';
import { pretty } from '../../../composables/format';
import { useDreamCardAgent, type SidebarTab } from '../../../composables/runtime';
import { renderMarkdown } from '../../../markdown';
import VfsTextEditor, { type VfsEditorMarker } from '../../../editor/VfsTextEditor.vue';

type FileTreeRow = {
  depth: number;
  kind: 'directory' | 'file';
  name: string;
  path: string;
  readonly: boolean;
};

const props = defineProps<{ focusFilePath: string; tab: SidebarTab }>();
const emit = defineEmits<{ close: []; 'update:tab': [value: SidebarTab] }>();

const { action, runtime, state } = useDreamCardAgent();

const selectedFilePath = ref('');
const fileDraft = ref('');
const editorView = ref<'edit' | 'preview'>('edit');
const largePreviewApproved = ref(false);
const secretFindings = ref<Awaited<ReturnType<typeof maskSecretsForModel>>['findings']>([]);
const secretWarning = ref('');
const expandedDirectories = ref(new Set(['/character', '/greetings', '/skills', '/skills/user', '/worldbooks']));
let secretScanTimer: number | undefined;
let secretScanRevision = 0;

const tab = computed({
  get: () => props.tab,
  set: value => emit('update:tab', value),
});

const files = computed(() => state.value.active?.workingFiles ?? []);
const visibleFileTreeRows = computed<FileTreeRow[]>(() => {
  const directories = new Set<string>();
  const children = new Map<string, FileTreeRow[]>();
  const addChild = (parent: string, row: FileTreeRow) => {
    const rows = children.get(parent) ?? [];
    if (!rows.some(item => item.path === row.path)) rows.push(row);
    children.set(parent, rows);
  };
  for (const file of files.value) {
    const segments = file.path.split('/').filter(Boolean);
    let parent = '/';
    for (let index = 0; index < segments.length - 1; index += 1) {
      const path = `${parent === '/' ? '' : parent}/${segments[index]}`;
      if (!directories.has(path)) {
        directories.add(path);
        addChild(parent, { depth: index, kind: 'directory', name: segments[index], path, readonly: false });
      }
      parent = path;
    }
    addChild(parent, {
      depth: segments.length - 1,
      kind: 'file',
      name: segments.at(-1) ?? file.path,
      path: file.path,
      readonly: file.readonly,
    });
  }
  const rows: FileTreeRow[] = [];
  const visit = (parent: string) => {
    const items = [...(children.get(parent) ?? [])].sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
    for (const item of items) {
      rows.push(item);
      if (item.kind === 'directory' && expandedDirectories.value.has(item.path)) visit(item.path);
    }
  };
  visit('/');
  return rows;
});
const selectedFile = computed(() => files.value.find(file => file.path === selectedFilePath.value));
const isRunning = computed(() => ['committing', 'running'].includes(state.value.active?.status ?? ''));
const canEditFile = computed(() =>
  Boolean(selectedFile.value && !selectedFile.value.readonly && state.value.active && !isRunning.value),
);
const isMarkdownFile = computed(() => /\.md$/iu.test(selectedFile.value?.path ?? ''));
const largeMarkdownFile = computed(() => new Blob([fileDraft.value]).size > 1024 * 1024);
const secretMarkers = computed<VfsEditorMarker[]>(() =>
  secretFindings.value.map(finding => ({
    endColumn: Math.max(0, finding.endColumn - 1),
    endLine: Math.max(0, finding.endLine - 1),
    label: `可能的敏感内容（${finding.ruleId}）`,
    startColumn: Math.max(0, finding.startColumn - 1),
    startLine: Math.max(0, finding.startLine - 1),
  })),
);
const approvalChanges = computed(() => [
  ...(state.value.active?.approval?.stateChanges ?? []),
  ...(state.value.active?.approval?.skillChanges ?? []),
]);
const changeCount = computed(() => approvalChanges.value.length);

watch(selectedFile, file => {
  fileDraft.value = file?.content ?? '';
  editorView.value = 'edit';
  largePreviewApproved.value = false;
});

watch(
  [() => selectedFile.value?.path, fileDraft],
  ([path]) => {
    if (secretScanTimer !== undefined) window.clearTimeout(secretScanTimer);
    const revision = ++secretScanRevision;
    secretFindings.value = [];
    secretWarning.value = '';
    if (!path?.endsWith('/data.yaml')) return;
    secretScanTimer = window.setTimeout(async () => {
      const result = await maskSecretsForModel(fileDraft.value, path);
      if (revision !== secretScanRevision) return;
      secretFindings.value = result.findings;
      secretWarning.value = result.warning ?? '';
    }, 250);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (secretScanTimer !== undefined) window.clearTimeout(secretScanTimer);
});

// 外部请求定位到某个文件（如 Skill 设置页的“查看挂载版本”）。
watch(
  () => props.focusFilePath,
  path => {
    if (!path) return;
    expandedDirectories.value = new Set([...expandedDirectories.value, '/skills', '/skills/user']);
    selectedFilePath.value = files.value.some(file => file.path === path) ? path : (files.value[0]?.path ?? '');
  },
  { immediate: true },
);

function selectFile(path: string) {
  selectedFilePath.value = path;
}

// 树形缩进：每级 0.95rem，并为每个父级深度画一条 1px 竖向引导线。
const TREE_INDENT_BASE = 0.3;
const TREE_INDENT_STEP = 0.95;
function treeRowStyle(row: FileTreeRow) {
  const guides: string[] = [];
  const positions: string[] = [];
  for (let level = 0; level < row.depth; level += 1) {
    guides.push('linear-gradient(var(--dca-border-strong), var(--dca-border-strong))');
    positions.push(`${TREE_INDENT_BASE + level * TREE_INDENT_STEP + 0.48}rem 0`);
  }
  return {
    backgroundImage: guides.length ? guides.join(', ') : 'none',
    backgroundPosition: positions.join(', '),
    backgroundRepeat: 'no-repeat',
    backgroundSize: '1px 100%',
    paddingLeft: `${TREE_INDENT_BASE + row.depth * TREE_INDENT_STEP}rem`,
  };
}

function toggleDirectory(path: string) {
  const next = new Set(expandedDirectories.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expandedDirectories.value = next;
}

async function saveFile() {
  const file = selectedFile.value;
  if (!file) return;
  try {
    await runtime.writeWorkingFile(file.path, fileDraft.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('MANUAL_EDIT_CONFLICT')) {
      toastr.error(message, '梦境创客');
      return;
    }
    const usePlayer = window.confirm(
      '这个文件在你编辑期间又被修改了。\n\n确定：保存你的版本\n取消：保留酒馆当前版本',
    );
    if (usePlayer) await action(() => runtime.writeWorkingFile(file.path, fileDraft.value, true));
    else await action(() => runtime.useCurrentWorkingFile(file.path));
  }
}

function conflictByPath(path: string) {
  return state.value.active?.approval?.conflicts.find(conflict => conflict.path === path);
}

async function undo() {
  await action(() => runtime.undo());
}

async function redo() {
  await action(() => runtime.redo());
}
</script>

<style lang="scss">
.dca-session-sidebar {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-left: 1px solid var(--dca-border);
  background: var(--dca-surface);
}

.dca-session-sidebar > nav {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.15rem;
  border-bottom: 1px solid var(--dca-border);
  padding: 0.35rem;
}

.dca-session-sidebar > nav button:not(.dca-close-sidebar) {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  border-color: transparent;
  background: transparent;
  color: var(--dca-text-muted);
  font-size: 0.84rem;
}

.dca-session-sidebar > nav button:not(.dca-close-sidebar):hover:not(:disabled) {
  background: var(--dca-accent-soft);
}

.dca-session-sidebar > nav button.active {
  background: var(--dca-accent-soft);
  color: var(--dca-text);
}

.dca-session-sidebar em {
  min-width: 1.2rem;
  border-radius: var(--dca-radius-sm);
  padding: 0 0.25rem;
  background: var(--dca-danger);
  color: #fff;
  font-size: 0.7rem;
  font-style: normal;
  text-align: center;
}

.dca-close-sidebar {
  flex: 0 0 auto;
}

.dca-side-files {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  grid-template-columns: minmax(10.5rem, 42%) minmax(0, 1fr);
}

.dca-file-list {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
  border-right: 1px solid var(--dca-border);
  padding: 0.3rem;
}

.dca-file-list header {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0.35rem 0.45rem;
  white-space: nowrap;
}

.dca-file-list header strong {
  overflow: hidden;
  font-size: 0.8rem;
  text-overflow: ellipsis;
}

.dca-file-list header small {
  flex: 0 0 auto;
  color: var(--dca-text-muted);
  font-size: 0.74rem;
}

.dca-app .dca-file-tree-row {
  display: flex;
  width: 100%;
  min-height: 1.9rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.35rem;
  justify-content: flex-start;
  overflow: hidden;
  border-color: transparent;
  border-radius: var(--dca-radius-sm);
  padding-top: 0.24rem;
  padding-right: 0.35rem;
  padding-bottom: 0.24rem;
  background-color: transparent;
  text-align: left;
}

.dca-app .dca-file-tree-row:hover:not(:disabled) {
  border-color: transparent;
  background-color: var(--dca-raised);
}

.dca-app .dca-file-tree-row.active {
  border-color: rgb(157 124 255 / 40%);
  background-color: var(--dca-accent-soft);
}

.dca-file-tree-row.directory {
  color: var(--dca-text);
  font-weight: 600;
}

.dca-file-tree-row > i {
  width: 1rem;
  flex: 0 0 1rem;
  color: var(--dca-text-muted);
  text-align: center;
}

.dca-file-tree-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-editor {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.55rem;
}

.dca-editor > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
}

.dca-editor-actions,
.dca-editor-view-switch {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.25rem;
}

.dca-editor-view-switch {
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-sm);
  padding: 0.1rem;
  background: var(--dca-canvas);
}

.dca-app .dca-editor-view-switch button {
  min-height: 1.65rem;
  border-color: transparent;
  padding: 0.15rem 0.45rem;
  background: transparent;
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}

.dca-app .dca-editor-view-switch button.active {
  background: var(--dca-accent-soft);
  color: var(--dca-text);
}

.dca-editor > header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dca-editor > header strong {
  overflow: hidden;
  font-size: 0.84rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-editor > header small,
.dca-editor-note {
  color: var(--dca-text-muted);
  font-size: 0.76rem;
}

.dca-secret-banner {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  gap: 0.4rem;
  border: 1px solid;
  border-radius: var(--dca-radius-sm);
  padding: 0.4rem 0.5rem;
  font-size: 0.74rem;
}

.dca-secret-banner.protected {
  border-color: rgb(239 189 85 / 40%);
  background: rgb(239 189 85 / 9%);
  color: #efd18a;
}

.dca-secret-banner.warning {
  border-color: rgb(224 108 130 / 45%);
  background: var(--dca-danger-soft);
  color: #f2a3b3;
}

.dca-file-preview {
  flex: 1 1 auto;
  overflow: auto;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-sm);
  padding: 0.75rem;
  background: var(--dca-canvas);
}

.dca-large-preview {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.45rem;
  border: 1px dashed var(--dca-border-strong);
  border-radius: var(--dca-radius-sm);
  padding: 1rem;
  color: var(--dca-text-muted);
  text-align: center;
}

.dca-large-preview > i {
  color: var(--dca-accent);
  font-size: 1.5rem;
}

.dca-large-preview > strong {
  color: var(--dca-text);
}

.dca-editor > .dca-empty {
  margin: auto;
}

.dca-side-scroll {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  gap: 0.55rem;
  overflow: auto;
  padding: 0.6rem;
}

.dca-side-scroll > .dca-empty {
  margin: auto;
}

.dca-side-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.dca-side-heading > div:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dca-side-heading small {
  color: var(--dca-text-muted);
  font-size: 0.76rem;
}

.dca-diff-item {
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.6rem;
  background: var(--dca-raised);
}

.dca-diff-item.danger {
  border-color: rgb(224 108 130 / 45%);
}

.dca-diff-item > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.dca-diff-item > header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dca-diff-item code {
  color: var(--dca-text-muted);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.dca-diff-risk {
  flex: 0 0 auto;
  border-radius: var(--dca-radius-sm);
  padding: 0.1rem 0.45rem;
  background: var(--dca-danger-soft);
  color: #f2a3b3;
  font-size: 0.72rem;
}

.dca-conflict-stack {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.45rem;
}

.dca-conflict-stack details {
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-sm);
  padding: 0.35rem;
}

.dca-context-meter {
  position: relative;
  height: 0.65rem;
  overflow: hidden;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-sm);
  background: var(--dca-canvas);
}

.dca-context-meter span {
  display: block;
  height: 100%;
  background: var(--dca-accent);
  transition: width var(--dca-motion-normal) ease;
}

.dca-context-meter i {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgb(255 255 255 / 70%);
}

.dca-metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.45rem;
}

.dca-metric-grid > div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.55rem 0.6rem;
  background: var(--dca-raised);
}

.dca-metric-grid strong {
  font-size: 1.05rem;
}

.dca-metric-grid span {
  color: var(--dca-text-muted);
  font-size: 0.76rem;
}

@media (max-width: 720px) {
  .dca-session-sidebar {
    border-top: 1px solid var(--dca-border);
    border-left: 0;
  }
}
</style>
