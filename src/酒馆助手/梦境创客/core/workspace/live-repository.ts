import { klona } from 'klona';
import { normalizeWorkspacePath, parentWorkspacePath } from './path';
import { MemoryWorkspaceRepository } from './memory-repository';
import { isBinaryWorkspaceFile } from './types';
import type {
  SearchQuery,
  SearchResult,
  WorkspaceChange,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceMutationResult,
  WorkspaceRepository,
  WorkspaceWriteOptions,
} from './types';
import type { FileOperationPayload } from '../operations/types';

export type LiveWorkspaceApplyInput = {
  changes: WorkspaceChange[];
  toolCallId: string;
};

export type LiveWorkspaceApplyResult = WorkspaceMutationResult & {
  /** 写后回读所得的最新完整投影。 */
  files: WorkspaceFile[];
};

export interface LiveWorkspaceSource {
  apply(input: LiveWorkspaceApplyInput): Promise<LiveWorkspaceApplyResult>;
  load(): Promise<WorkspaceFile[]>;
}

export type LiveWorkspaceRepositoryOptions = {
  completedToolCallIds?: string[];
  onCommitted?: (result: WorkspaceMutationResult, toolCallId: string) => Promise<void> | void;
  readonlyRoots?: string[];
  source: LiveWorkspaceSource;
};

type LocalMutation = (localToolCallId: string) => Promise<void>;

/**
 * 直接面向实时资源的VFS门面。
 *
 * 每次读操作都会重新获取宿主投影；写操作在最新投影上构造文件级意图，交给Source写入真实资源，
 * 再用写后回读结果更新缓存。它不保留Working Copy，也不等待轮末统一提交。
 */
export class LiveWorkspaceRepository extends MemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly committedToolCalls = new Set<string>();
  private readonly onCommitted?: LiveWorkspaceRepositoryOptions['onCommitted'];
  private readonly outcomes = new Map<string, WorkspaceMutationResult>();
  private readonly source: LiveWorkspaceSource;
  private readonly transientProjections = new Map<string, WorkspaceFile[]>();
  private readonly entryAliases = new Map<string, string>();

  constructor(options: LiveWorkspaceRepositoryOptions) {
    super({ readonlyRoots: options.readonlyRoots });
    this.source = options.source;
    this.onCommitted = options.onCommitted;
    options.completedToolCallIds?.forEach(id => this.committedToolCalls.add(id));
  }

  async initialize(): Promise<void> {
    this.rebase(await this.source.load());
  }

  async reload(): Promise<void> {
    await this.refresh();
  }

  async list(path: string): Promise<WorkspaceEntry[]> {
    await this.refresh();
    return super.list(path);
  }

  async read(path: string): Promise<WorkspaceFile> {
    await this.refresh();
    return super.read(this.resolveEntryPath(path));
  }

  async write(
    path: string,
    content: string,
    toolCallId: string,
    options: WorkspaceWriteOptions = {},
  ): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.write(this.resolveEntryPath(path), content, localToolCallId, options));
  }

  async patch(path: string, patch: string, toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.patch(this.resolveEntryPath(path), patch, localToolCallId));
  }

  async move(from: string, to: string, toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.move(this.resolveEntryPath(from), to, localToolCallId));
  }

  async copy(from: string, to: string, toolCallId: string, options: WorkspaceWriteOptions = {}): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.copy(this.resolveEntryPath(from), to, localToolCallId, options));
  }

  /** 玩家上传二进制文件专用；文件正文通过external惰性引用，写入仍走实时Source与操作日志。 */
  async stageFile(file: WorkspaceFile, toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.stageFiles([file], localToolCallId));
  }

  /** set_avatar专用：目标虚拟头像节点保持只读，只有显式头像工具可以替换其二进制来源。 */
  async replaceReadonlyBinary(targetPath: string, sourcePath: string, toolCallId: string): Promise<void> {
    if (!toolCallId) throw new Error('工具调用必须包含稳定的toolCallId。');
    if (this.committedToolCalls.has(toolCallId)) {
      this.outcomes.set(toolCallId, { changes: [], idempotent: true, status: 'success' });
      return;
    }
    await this.refresh();
    const [before, source] = await Promise.all([super.read(targetPath), super.read(sourcePath)]);
    if (!isBinaryWorkspaceFile(source)) throw new Error(`头像来源必须是二进制图片：${sourcePath}`);
    if (!source.mediaType.startsWith('image/')) throw new Error(`头像来源必须是图片：${sourcePath}`);
    const after: WorkspaceFile = {
      ...klona(before),
      // 目标投影的稳定文本指纹不随头像二进制变化；真实新图片仍由external/virtualBinary提供。
      content: before.content,
      external: source.external ? klona(source.external) : undefined,
      mediaType: source.mediaType,
      skillResource: source.skillResource ? klona(source.skillResource) : undefined,
      virtualBinary: source.virtualBinary ? klona(source.virtualBinary) : undefined,
    };
    const applied = await this.source.apply({ changes: [{ after, before, kind: 'modify', path: before.path }], toolCallId });
    this.rebase(applied.files);
    this.restoreTransientProjections();
    const outcome: WorkspaceMutationResult = {
      changes: klona(applied.changes),
      status: applied.status,
      warning: applied.warning,
    };
    this.outcomes.set(toolCallId, outcome);
    this.committedToolCalls.add(toolCallId);
    await this.onCommitted?.(klona(outcome), toolCallId);
  }

  async remove(path: string, toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.remove(this.resolveEntryPath(path), localToolCallId));
  }

  async stageFiles(inputs: WorkspaceFile[], toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.stageFiles(inputs, localToolCallId));
  }

  override replaceProjection(root: string, inputs: WorkspaceFile[]): void {
    const normalized = normalizeWorkspacePath(root);
    // 可编辑世界书由实时Source回读；静态覆盖只用于卸载遮罩及聊天等外部投影。
    if (/^\/worldbooks\/[^/]+$/u.test(normalized) && inputs.length > 0) this.transientProjections.delete(normalized);
    else this.transientProjections.set(normalized, klona(inputs));
    super.replaceProjection(normalized, inputs);
  }

  override rebase(inputs: WorkspaceFile[]): void {
    const resourceKey = (file: WorkspaceFile) => `${parentWorkspacePath(file.path)}\0${file.resourceId}`;
    const byResource = new Map(inputs.map(file => [resourceKey(file), file]));
    for (const previous of this.snapshot()) {
      if (!/^\/worldbooks\/[^/]+\/entries\/[^/]+\.md$/u.test(previous.path)) continue;
      const current = byResource.get(resourceKey(previous));
      if (current && current.path !== previous.path) {
        this.entryAliases.set(previous.path, previous.resourceId);
      }
    }
    super.rebase(inputs);
  }

  private resolveEntryPath(input: string): string {
    const path = normalizeWorkspacePath(input);
    const files = this.snapshot();
    if (files.some(file => file.path === path)) return path;
    const resourceId = this.entryAliases.get(path);
    return files.find(file => file.resourceId === resourceId && parentWorkspacePath(file.path) === parentWorkspacePath(path))?.path ?? path;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    await this.refresh();
    return super.search(query);
  }

  mutationResult(toolCallId: string): WorkspaceMutationResult | undefined {
    const result = this.outcomes.get(toolCallId);
    return result ? klona(result) : undefined;
  }

  /**
   * Undo/Redo专用入口。仍然经过实时Source和写后回读，但调用方可以用独立toolCallId
   * 把它与原始模型工具调用区分开。冲突检查由operation-replayer在调用前完成。
   */
  async replay(payload: FileOperationPayload, toolCallId: string): Promise<void> {
    if (payload.kind === 'modify' && isBinaryWorkspaceFile(payload.after)) {
      await this.applyDirect([{ after: payload.after, before: payload.before, kind: 'modify', path: payload.path }], toolCallId);
      return;
    }
    await this.mutate(toolCallId, async localToolCallId => {
      if (payload.kind === 'create') {
        await super.stageFiles([{ ...klona(payload.file), path: payload.path }], localToolCallId);
      } else if (payload.kind === 'delete') {
        await super.remove(payload.path, localToolCallId);
      } else if (payload.kind === 'modify') {
        await super.patch(payload.path, payload.forwardPatch, localToolCallId);
      } else {
        await super.move(payload.from, payload.path, localToolCallId);
      }
    });
  }

  private async applyDirect(changes: WorkspaceChange[], toolCallId: string): Promise<void> {
    await this.refresh();
    const applied = await this.source.apply({ changes: klona(changes), toolCallId });
    this.rebase(applied.files);
    this.restoreTransientProjections();
    const outcome = { changes: klona(applied.changes), status: applied.status, warning: applied.warning };
    this.outcomes.set(toolCallId, outcome);
    this.committedToolCalls.add(toolCallId);
    await this.onCommitted?.(klona(outcome), toolCallId);
  }

  private async refresh(): Promise<void> {
    this.rebase(await this.source.load());
    this.restoreTransientProjections();
  }

  private async mutate(toolCallId: string, mutation: LocalMutation): Promise<void> {
    if (!toolCallId) throw new Error('工具调用必须包含稳定的toolCallId。');
    if (this.committedToolCalls.has(toolCallId)) {
      this.outcomes.set(toolCallId, { changes: [], status: 'success', ...this.outcomes.get(toolCallId), idempotent: true });
      return;
    }
    await this.refresh();
    let applied: LiveWorkspaceApplyResult;
    try {
      await mutation(`${toolCallId}:intent:${crypto.randomUUID()}`);
      applied = await this.source.apply({ changes: this.changes(), toolCallId });
    } catch (error) {
      // 丢弃失败意图；即使宿主回读失败，也不能让未提交的文件污染后续查询。
      this.rebase([]);
      await this.refresh().catch(() => undefined);
      throw error;
    }
    this.rebase(applied.files);
    this.restoreTransientProjections();
    const outcome: WorkspaceMutationResult = {
      changes: klona(applied.changes),
      status: applied.status,
      warning: applied.warning,
    };
    this.outcomes.set(toolCallId, outcome);
    this.committedToolCalls.add(toolCallId);
    await this.onCommitted?.(klona(outcome), toolCallId);
  }

  private restoreTransientProjections(): void {
    for (const [root, files] of this.transientProjections) super.replaceProjection(root, files);
  }
}
