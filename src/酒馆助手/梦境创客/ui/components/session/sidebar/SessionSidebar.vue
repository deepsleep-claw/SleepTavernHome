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
          @contextmenu.prevent="openFileMenu($event, row)"
        >
          <i
            v-if="row.kind === 'directory'"
            :class="expandedDirectories.has(row.path) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'"
            aria-hidden="true"
          ></i>
          <i v-else :class="fileTreeIcon(row)" aria-hidden="true"></i>
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
              <button type="button" title="导出文件" @click="exportSelectedFile">
                <i class="fa-solid fa-download" aria-hidden="true"></i><span>导出</span>
              </button>
              <button
                v-if="canPlayerDelete(selectedFile.path)"
                class="dca-btn-danger"
                type="button"
                title="删除文件"
                @click="deleteSelectedPath(selectedFile.path)"
              >
                <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
              </button>
              <template v-if="isProjectManifest">
                <select v-model="projectScope" aria-label="正则编译目标">
                  <option value="character">角色正则</option>
                  <option value="preset-current">当前预设正则</option>
                  <option value="global">全局正则</option>
                </select>
                <label class="dca-project-overwrite"><input v-model="projectOverwrite" type="checkbox" />覆盖末个同名</label>
                <button type="button" :disabled="projectBusy" @click="checkProject">{{ projectBusy ? '检查中' : '检查工程' }}</button>
                <button class="dca-btn-primary" type="button" :disabled="projectBusy" @click="compileProject">编译为正则</button>
              </template>
              <div v-if="isMarkdownFile" class="dca-editor-view-switch" aria-label="Markdown查看方式">
                <button type="button" :class="{ active: editorView === 'edit' }" @click="editorView = 'edit'">
                  编辑
                </button>
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
          <section v-if="isProjectManifest && projectCheck" class="dca-project-check-result">
            <header>
              <strong>{{ projectCheck.projectName }}</strong>
              <span>{{ projectErrorCount }} 错误 · {{ projectWarningCount }} 警告 · {{ formatBytes(projectCheck.outputBytes) }}</span>
            </header>
            <ul v-if="projectCheck.diagnostics.length">
              <li v-for="(item, index) in projectCheck.diagnostics" :key="`${item.file}:${item.line}:${index}`" :class="item.severity">
                <code>{{ item.file }}{{ item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : '' }}</code>
                {{ item.message }}
              </li>
            </ul>
            <p v-else>检查通过，可以编译。</p>
          </section>
          <div v-else-if="secretFindings.length" class="dca-secret-banner protected" role="status">
            <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
            <span>检测到 {{ secretFindings.length }} 处敏感内容；界面显示原文，Agent读取时自动遮罩。</span>
          </div>
          <div v-if="isBinaryFile" class="dca-binary-file-note">
            <i class="fa-regular fa-file" aria-hidden="true"></i>
            <strong>二进制文件</strong>
            <span>Agent可通过 read_file 读取；此处不提供文本编辑。</span>
          </div>
          <template v-else-if="editorView === 'preview' && isMarkdownFile">
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

    <section v-else-if="tab === 'diff'" class="dca-side-diff">
      <header class="dca-diff-toolbar">
        <div>
          <strong>文件修改记录</strong>
          <small v-if="diffSummary">
            {{ diffSummary.files }} 个文件 · <b>+{{ diffSummary.addedLines }}</b>
            <em>-{{ diffSummary.removedLines }}</em>
          </small>
        </div>
        <select v-model="diffScope" aria-label="Diff范围">
          <option value="latest">最新一轮</option>
          <option v-for="(turn, index) in operationTurns" :key="turn.turnId" :value="turn.turnId">
            第 {{ index + 1 }} 轮 · {{ turn.operationIds.length }} 项
          </option>
          <option value="all">整个会话</option>
        </select>
        <div v-if="state.activeSessionAccess === 'live'" class="dca-row-actions">
          <button type="button" :disabled="state.busy || !canUndoLatest" title="撤销最新一轮文件修改" @click="undo">
            撤销
          </button>
          <button type="button" :disabled="state.busy || !canRedoLatest" title="重做最新一轮文件修改" @click="redo">
            重做
          </button>
        </div>
      </header>
      <div v-if="diffFiles.length === 0" class="dca-empty">这个范围没有文件修改。</div>
      <div v-else class="dca-diff-workspace">
        <main ref="diffViewport" class="dca-diff-document">
          <label class="dca-diff-mobile-file">
            <span>定位文件</span>
            <select v-model="selectedDiffPath" @change="focusDiffFile(selectedDiffPath)">
              <option v-for="file in diffFiles" :key="file.id" :value="file.path">{{ file.path }}</option>
            </select>
          </label>
          <OperationDiffFile
            v-for="file in diffFiles"
            :key="file.id"
            :file="file"
            :openable="files.some(item => item.path === file.path)"
            @open-file="openFileFromDiff"
          />
        </main>
        <aside class="dca-diff-index">
          <label>
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input v-model="diffFilter" type="search" placeholder="筛选文件…" />
          </label>
          <div>
            <button
              v-for="file in filteredDiffFiles"
              :key="file.id"
              type="button"
              :class="{ active: selectedDiffPath === file.path }"
              :title="file.path"
              @click="focusDiffFile(file.path)"
            >
              <i :class="diffFileIcon(file.path)" aria-hidden="true"></i>
              <span>{{ file.path }}</span>
              <small><b>+{{ file.addedLines }}</b><em>-{{ file.removedLines }}</em></small>
            </button>
          </div>
        </aside>
      </div>
    </section>

    <section v-else class="dca-side-scroll">
      <header class="dca-side-heading">
        <div>
          <strong>上下文监视器</strong>
          <small>{{ contextSourceLabel }} · 70% 自动压缩，用户消息 80% 时暂停</small>
        </div>
      </header>
      <div class="dca-context-meter">
        <span :style="{ width: `${Math.min(100, (state.active?.contextUsage.ratio ?? 0) * 100)}%` }"></span>
        <i style="left: 70%"></i>
      </div>
      <div class="dca-metric-grid">
        <div>
          <strong>{{ state.active?.contextUsage.totalTokens }}</strong>
          <span>{{ state.active?.contextUsage.measurement === 'api' ? 'API 基准总 Token' : '估算总 Token' }}</span>
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
      <div v-if="state.active?.contextUsage.measurement === 'api'" class="dca-context-source-note">
        最近请求：输入 {{ state.active.contextUsage.apiInputTokens ?? 0 }} · 输出
        {{ state.active.contextUsage.apiOutputTokens ?? 0 }} · 请求后增量估算
        {{ state.active.contextUsage.estimatedDeltaTokens ?? 0 }}
      </div>
      <details>
        <summary>上下文事件</summary>
        <pre>{{ pretty(state.active?.events.filter(event => event.type === 'context-compacted') ?? []) }}</pre>
      </details>
    </section>

    <div
      v-if="fileMenu"
      class="dca-file-context-menu"
      :style="{ left: `${fileMenu.x}px`, top: `${fileMenu.y}px` }"
      @click.stop
      @pointerdown.stop
    >
      <button type="button" @click="exportTreeRow(fileMenu.row)">
        <i class="fa-solid fa-download" aria-hidden="true"></i>导出{{ fileMenu.row.kind === 'directory' ? '文件夹 ZIP' : '文件' }}
      </button>
      <button
        v-if="canPlayerDelete(fileMenu.row.path)"
        class="danger"
        type="button"
        @click="deleteSelectedPath(fileMenu.row.path)"
      >
        <i class="fa-regular fa-trash-can" aria-hidden="true"></i>删除
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { strToU8, zipSync } from 'fflate';
import { maskSecretsForModel } from '../../../../core/workspace/secret-protection';
import type { HtmlProjectCheck } from '../../../../core/projects/html-project';
import { downloadBytes, downloadText, formatBytes, pretty } from '../../../composables/format';
import {
  buildOperationDiffFiles,
  summarizeOperationDiffFiles,
  type OperationDiffFocus,
} from '../../../composables/operation-diff';
import { useDreamCardAgent, type SidebarTab } from '../../../composables/runtime';
import { renderMarkdown } from '../../../markdown';
import VfsTextEditor, { type VfsEditorMarker } from '../../../editor/VfsTextEditor.vue';
import OperationDiffFile from './OperationDiffFile.vue';

type FileTreeRow = {
  depth: number;
  kind: 'directory' | 'file';
  name: string;
  path: string;
  readonly: boolean;
};

const props = defineProps<{
  diffFocus?: OperationDiffFocus & { requestId: number };
  focusFilePath: string;
  tab: SidebarTab;
}>();
const emit = defineEmits<{ close: []; 'update:tab': [value: SidebarTab] }>();

const { action, runtime, state } = useDreamCardAgent();

const selectedFilePath = ref('');
const fileDraft = ref('');
const editorView = ref<'edit' | 'preview'>('edit');
const largePreviewApproved = ref(false);
const diffScope = ref('latest');
const diffFilter = ref('');
const selectedDiffPath = ref('');
const diffViewport = ref<HTMLElement>();
const secretFindings = ref<Awaited<ReturnType<typeof maskSecretsForModel>>['findings']>([]);
const secretWarning = ref('');
const projectCheck = ref<HtmlProjectCheck>();
const projectBusy = ref(false);
const projectOverwrite = ref(false);
const projectScope = ref<'character' | 'global' | 'preset-current'>('character');
const expandedDirectories = ref(
  new Set(['/character', '/files', '/greetings', '/skills', '/skills/user', '/temp', '/worldbooks']),
);
const fileMenu = ref<{ row: FileTreeRow; x: number; y: number }>();
let secretScanTimer: number | undefined;
let secretScanRevision = 0;

const tab = computed({
  get: () => props.tab,
  set: value => emit('update:tab', value),
});

const files = computed(() => state.value.active?.workingFiles ?? []);
const activeModel = computed(() => {
  const selection = state.value.active?.modelSelection;
  if (!selection) return undefined;
  return (state.value.providers ?? [])
    .find(provider => provider.id === selection.providerId)
    ?.models.find(model => model.id === selection.modelId);
});
const contextSourceLabel = computed(() => {
  const source = state.value.active?.contextUsage.measurement === 'api' ? 'API 用量 + 增量估算' : '本地估算';
  return activeModel.value?.modelSettings?.contextWindow ? source : `${source}（默认 128K）`;
});
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
const isBinaryFile = computed(() =>
  Boolean(selectedFile.value?.external && !selectedFile.value.mediaType.startsWith('text/')),
);
const isRunning = computed(() => ['running', 'waiting-approval'].includes(state.value.active?.status ?? ''));
const canEditFile = computed(() =>
  Boolean(
    selectedFile.value && !isBinaryFile.value && !selectedFile.value.readonly && state.value.active && !isRunning.value,
  ),
);
const isMarkdownFile = computed(() => /\.md$/iu.test(selectedFile.value?.path ?? ''));
const isProjectManifest = computed(() => /^\/regexes\/projects\/[^/]+\/project\.yaml$/u.test(selectedFile.value?.path ?? ''));
const projectErrorCount = computed(() => projectCheck.value?.diagnostics.filter(item => item.severity === 'error').length ?? 0);
const projectWarningCount = computed(() => projectCheck.value?.diagnostics.filter(item => item.severity === 'warning').length ?? 0);
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
const operationTurns = computed(() => state.value.active?.operationLog?.turns ?? []);
const selectedOperationRecords = computed(() => {
  const log = state.value.active?.operationLog;
  if (!log) return [];
  if (diffScope.value === 'all') return log.records;
  const turnId = diffScope.value === 'latest' ? log.turns.at(-1)?.turnId : diffScope.value;
  if (!turnId) return [];
  const ids = new Set(log.turns.find(turn => turn.turnId === turnId)?.operationIds ?? []);
  return log.records.filter(record => ids.has(record.operationId));
});
const diffFiles = computed(() => buildOperationDiffFiles(selectedOperationRecords.value));
const diffSummary = computed(() => (diffFiles.value.length ? summarizeOperationDiffFiles(diffFiles.value) : undefined));
const filteredDiffFiles = computed(() => {
  const query = diffFilter.value.trim().toLocaleLowerCase();
  return query ? diffFiles.value.filter(file => file.path.toLocaleLowerCase().includes(query)) : diffFiles.value;
});
const changeCount = computed(() => buildOperationDiffFiles(state.value.active?.operationLog?.records ?? []).length);
const latestTurn = computed(() => operationTurns.value.at(-1));
const latestTurnRecords = computed(() => {
  const ids = new Set(latestTurn.value?.operationIds ?? []);
  return state.value.active?.operationLog?.records.filter(record => ids.has(record.operationId)) ?? [];
});
const canUndoLatest = computed(() => latestTurnRecords.value.some(record => record.state === 'applied' && record.undoable));
const canRedoLatest = computed(() => {
  const redoIds = new Set(latestTurn.value?.redoOperationIds ?? []);
  return latestTurnRecords.value.some(record => redoIds.has(record.operationId) && record.state === 'undone' && record.undoable);
});

watch(selectedFile, file => {
  fileDraft.value = file?.content ?? '';
  editorView.value = 'edit';
  largePreviewApproved.value = false;
  projectCheck.value = undefined;
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
onMounted(() => window.addEventListener('pointerdown', closeFileMenu));
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeFileMenu));

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

watch(
  () => props.diffFocus,
  focus => {
    if (!focus) return;
    diffScope.value = operationTurns.value.some(turn => turn.turnId === focus.turnId) ? focus.turnId : 'latest';
    selectedDiffPath.value = focus.filePath ?? '';
    void nextTick(() => focusDiffFile(selectedDiffPath.value || diffFiles.value[0]?.path || ''));
  },
  { immediate: true },
);

watch(diffScope, () => {
  const requested = selectedDiffPath.value;
  const path = diffFiles.value.some(file => file.path === requested) ? requested : (diffFiles.value[0]?.path ?? '');
  selectedDiffPath.value = path;
  void nextTick(() => focusDiffFile(path));
});

function selectFile(path: string) {
  selectedFilePath.value = path;
}

function closeFileMenu() {
  fileMenu.value = undefined;
}

function openFileMenu(event: MouseEvent, row: FileTreeRow) {
  fileMenu.value = { row, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 120) };
}

function canPlayerDelete(path: string): boolean {
  return (
    /^\/(?:files|temp|regexes\/projects)(?:\/|$)/u.test(path) ||
    (/^\/skills\/user\//u.test(path) && !/\/SKILL\.md$/iu.test(path))
  );
}

async function bytesForFile(file: (typeof files.value)[number]): Promise<Uint8Array> {
  if (!file.external) return strToU8(file.content);
  const managed = state.value.storage.characters.flatMap(group => group.files).find(item => item.fileId === file.external?.fileId);
  if (!managed) throw new Error(`找不到托管文件：${file.path}`);
  return new Uint8Array(await (await fetch(managed.url)).arrayBuffer());
}

async function exportFile(file: (typeof files.value)[number]) {
  const name = file.path.split('/').at(-1) || 'download.txt';
  if (!file.external) downloadText(name, file.content, file.mediaType);
  else downloadBytes(name, await bytesForFile(file), file.mediaType);
}

async function exportSelectedFile() {
  if (!selectedFile.value) return;
  try { await exportFile(selectedFile.value); }
  catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '导出失败'); }
}

async function exportTreeRow(row: FileTreeRow) {
  closeFileMenu();
  if (row.kind === 'file') {
    const file = files.value.find(item => item.path === row.path);
    if (file) await exportFile(file);
    return;
  }
  try {
    const selected = files.value.filter(file => file.path.startsWith(`${row.path}/`));
    const prefix = `${row.path}/`;
    const entries: Record<string, Uint8Array> = {};
    for (const file of selected) entries[file.path.slice(prefix.length)] = await bytesForFile(file);
    downloadBytes(`${row.name}.zip`, zipSync(entries, { level: 6 }), 'application/zip');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '导出失败');
  }
}

async function deleteSelectedPath(path: string) {
  closeFileMenu();
  if (!canPlayerDelete(path)) return;
  if (!window.confirm(`确定删除 ${path}？此操作会进入当前会话的操作记录。`)) return;
  await action(() => runtime.deleteWorkingPath(path));
  if (selectedFilePath.value === path || selectedFilePath.value.startsWith(`${path}/`)) selectedFilePath.value = '';
}

function diffAnchorId(path: string): string {
  return `dca-diff-file-${encodeURIComponent(path).replace(/%/gu, '_')}`;
}

function focusDiffFile(path: string) {
  if (!path) return;
  selectedDiffPath.value = path;
  const target = diffViewport.value?.querySelector<HTMLElement>(`#${diffAnchorId(path)}`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openFileFromDiff(path: string) {
  if (!files.value.some(file => file.path === path)) return;
  selectedFilePath.value = path;
  tab.value = 'files';
}

function diffFileIcon(path: string): string {
  if (/\.ya?ml$/iu.test(path)) return 'fa-solid fa-code';
  if (/\.md$/iu.test(path)) return 'fa-brands fa-markdown';
  return 'fa-regular fa-file-lines';
}

function fileTreeIcon(row: FileTreeRow): string {
  if (row.path.endsWith('/project.yaml') && /^(?:\/files|\/character\/files)\//u.test(row.path)) {
    return 'fa-solid fa-diagram-project';
  }
  return row.readonly ? 'fa-solid fa-lock' : 'fa-regular fa-file-lines';
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
    await runtime.writeWorkingFile(file.path, fileDraft.value, false, file.content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('MANUAL_EDIT_CONFLICT')) {
      toastr.error(message, '梦境创客');
      return;
    }
    const usePlayer = window.confirm('这个文件在你编辑期间又被修改了。\n\n确定：保存你的版本\n取消：保留酒馆当前版本');
    if (usePlayer) await action(() => runtime.writeWorkingFile(file.path, fileDraft.value, true, file.content));
    else await action(() => runtime.useCurrentWorkingFile(file.path));
  }
}

async function checkProject() {
  if (!selectedFile.value) return;
  projectBusy.value = true;
  try {
    projectCheck.value = await runtime.checkHtmlProject(selectedFile.value.path);
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '工程检查失败');
  } finally {
    projectBusy.value = false;
  }
}

async function compileProject() {
  if (!selectedFile.value) return;
  projectBusy.value = true;
  try {
    await runtime.compileHtmlProject(selectedFile.value.path, { overwrite: projectOverwrite.value, scope: projectScope.value });
    projectCheck.value = await runtime.checkHtmlProject(selectedFile.value.path);
    toastr.success(`工程已编译到${projectScope.value === 'character' ? '角色' : projectScope.value === 'global' ? '全局' : '当前预设'}正则。`, '梦境创客');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '工程编译失败');
  } finally {
    projectBusy.value = false;
  }
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
  container-name: dca-session-sidebar;
  container-type: inline-size;
}

.dca-file-context-menu {
  position: fixed;
  z-index: 2147483646;
  display: grid;
  min-width: 12rem;
  gap: 0.2rem;
  border: 1px solid var(--dca-border-strong);
  border-radius: var(--dca-radius-sm);
  padding: 0.3rem;
  background: var(--dca-raised);
  box-shadow: var(--dca-shadow-3);
}
.dca-app .dca-file-context-menu > button {
  display: flex;
  width: 100%;
  justify-content: flex-start;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  text-align: left;
}
.dca-app .dca-file-context-menu > button:hover { background: var(--dca-sidebar-hover); }
.dca-app .dca-file-context-menu > button.danger { color: var(--dca-danger); }

.dca-session-sidebar > nav {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.15rem;
  border-bottom: 1px solid var(--dca-border);
  padding: 0.35rem;
}

.dca-project-overwrite {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--dca-text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

.dca-project-check-result {
  margin: 0.5rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-sm);
  padding: 0.55rem;
  background: var(--dca-raised);
}
.dca-project-check-result > header { display: flex; justify-content: space-between; gap: 0.5rem; }
.dca-project-check-result > header span { color: var(--dca-text-muted); font-size: 0.75rem; }
.dca-project-check-result ul { max-height: 12rem; margin: 0.45rem 0 0; overflow: auto; padding-left: 1.2rem; }
.dca-project-check-result li { margin: 0.2rem 0; font-size: 0.78rem; }
.dca-project-check-result li.error { color: var(--dca-danger); }
.dca-project-check-result li.warning { color: var(--dca-warning); }
.dca-project-check-result li code { color: inherit; }

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

.dca-session-sidebar > nav em {
  min-width: 1.2rem;
  border-radius: var(--dca-radius-sm);
  padding: 0 0.25rem;
  background: var(--dca-danger);
  color: var(--dca-on-accent);
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
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
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
  border-color: color-mix(in srgb, var(--dca-accent) 40%, transparent);
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
  overflow: hidden;
  padding: 0.55rem;
}

// 会话侧栏需要让文本编辑器吃满标题和提示之外的剩余高度。
// 限定在 .dca-editor 直属子级，避免影响 Skill 编辑弹窗自己的资源编辑布局。
.dca-editor > .dca-vfs-editor {
  display: flex;
  min-height: 8rem;
  flex: 1 1 0;
  overflow: hidden;
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
  border-color: color-mix(in srgb, var(--dca-warning) 40%, transparent);
  background: var(--dca-warning-soft);
  color: var(--dca-warning);
}

.dca-secret-banner.warning {
  border-color: color-mix(in srgb, var(--dca-danger) 45%, transparent);
  background: var(--dca-danger-soft);
  color: var(--dca-danger);
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

.dca-side-diff {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
}

.dca-side-diff > .dca-empty {
  margin: auto;
}

.dca-diff-toolbar {
  display: flex;
  min-height: 3rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.55rem;
  border-bottom: 1px solid var(--dca-border);
  padding: 0.42rem 0.55rem;
}

.dca-diff-toolbar > div:first-child {
  display: grid;
  min-width: 9rem;
  margin-right: auto;
  gap: 0.08rem;
}

.dca-diff-toolbar > div:first-child strong {
  color: var(--dca-text);
  font-size: 0.8rem;
}

.dca-diff-toolbar > div:first-child small {
  display: inline-flex;
  gap: 0.25rem;
  color: var(--dca-text-muted);
  font: 0.66rem/1 var(--dca-font-mono);
}

.dca-diff-toolbar b,
.dca-diff-index b { color: var(--dca-success); }
.dca-diff-toolbar em,
.dca-diff-index em { color: var(--dca-danger); font-style: normal; }

.dca-diff-toolbar > select {
  max-width: 10.5rem;
}

.dca-diff-workspace {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr) minmax(10rem, 27%);
}

.dca-diff-document {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 0.55rem;
  overflow: auto;
  padding: 0.55rem;
  scrollbar-color: color-mix(in srgb, var(--dca-text-muted) 45%, transparent) transparent;
}

.dca-diff-index {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-left: 1px solid var(--dca-border);
  background: color-mix(in srgb, var(--dca-surface) 90%, var(--dca-canvas));
}

.dca-diff-index > label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.4rem;
  margin: 0.5rem;
  border: 1px solid var(--dca-border);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  background: var(--dca-canvas);
  color: var(--dca-text-muted);
}

.dca-diff-index input {
  min-width: 0;
  min-height: 1.8rem;
  border: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
  color: var(--dca-text);
}

.dca-diff-index > div {
  min-height: 0;
  overflow: auto;
  padding: 0 0.3rem 0.4rem;
}

.dca-app .dca-diff-index button {
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 2rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.38rem;
  border-color: transparent;
  padding: 0.25rem 0.35rem;
  background: transparent;
  color: var(--dca-text-muted);
  text-align: left;
}

.dca-app .dca-diff-index button:hover,
.dca-app .dca-diff-index button.active {
  background: var(--dca-raised);
}

.dca-app .dca-diff-index button.active {
  box-shadow: inset 2px 0 0 var(--dca-accent);
}

.dca-diff-index button > i { color: var(--dca-info); }
.dca-diff-index button > span {
  overflow: hidden;
  font: 0.68rem/1.3 var(--dca-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-diff-index button > small {
  display: inline-flex;
  gap: 0.18rem;
  font: 0.62rem/1 var(--dca-font-mono);
}

.dca-diff-mobile-file {
  display: none;
  align-items: center;
  gap: 0.45rem;
}

.dca-diff-mobile-file > span {
  flex: 0 0 auto;
  color: var(--dca-text-muted);
  font-size: 0.7rem;
}

.dca-diff-mobile-file > select {
  min-width: 0;
  flex: 1 1 auto;
}

@container dca-session-sidebar (max-width: 620px) {
  .dca-diff-workspace { grid-template-columns: minmax(0, 1fr); }
  .dca-diff-index { display: none; }
  .dca-diff-mobile-file { display: flex; }
  .dca-diff-toolbar { flex-wrap: wrap; }
  .dca-diff-toolbar > div:first-child { flex: 1 1 auto; }
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
  background: color-mix(in srgb, var(--dca-text) 70%, transparent);
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

.dca-context-source-note {
  border-left: 3px solid var(--dca-accent);
  padding-left: 0.55rem;
  color: var(--dca-text-muted);
  font-size: 0.74rem;
}

@media (max-width: 720px) {
  .dca-session-sidebar {
    border-top: 1px solid var(--dca-border);
    border-left: 0;
  }
}
</style>
