import { klona } from 'klona';
import { normalizeWorkspacePath } from './path';
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
    return super.read(path);
  }

  async write(
    path: string,
    content: string,
    toolCallId: string,
    options: WorkspaceWriteOptions = {},
  ): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.write(path, content, localToolCallId, options));
  }

  async patch(path: string, patch: string, toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.patch(path, patch, localToolCallId));
  }

  async move(from: string, to: string, toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.move(from, to, localToolCallId));
  }

  async copy(from: string, to: string, toolCallId: string, options: WorkspaceWriteOptions = {}): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.copy(from, to, localToolCallId, options));
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
    await this.mutate(toolCallId, localToolCallId => super.remove(path, localToolCallId));
  }

  async stageFiles(inputs: WorkspaceFile[], toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, localToolCallId => super.stageFiles(inputs, localToolCallId));
  }

  override replaceProjection(root: string, inputs: WorkspaceFile[]): void {
    const normalized = normalizeWorkspacePath(root);
    this.transientProjections.set(normalized, klona(inputs));
    super.replaceProjection(normalized, inputs);
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
      this.outcomes.set(toolCallId, { changes: [], idempotent: true, status: 'success' });
      return;
    }
    await this.refresh();
    await mutation(`${toolCallId}:intent`);
    const requested = this.changes();
    const applied = await this.source.apply({ changes: requested, toolCallId });
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
