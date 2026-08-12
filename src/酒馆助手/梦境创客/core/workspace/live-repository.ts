import { klona } from 'klona';
import { MemoryWorkspaceRepository } from './memory-repository';
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

type LocalMutation = (repository: MemoryWorkspaceRepository, localToolCallId: string) => Promise<void>;

/**
 * 直接面向实时资源的VFS门面。
 *
 * 每次读操作都会重新获取宿主投影；写操作在最新投影上构造文件级意图，交给Source写入真实资源，
 * 再用写后回读结果更新缓存。它不保留Working Copy，也不等待轮末统一提交。
 */
export class LiveWorkspaceRepository implements WorkspaceRepository {
  private readonly completedToolCalls = new Set<string>();
  private files: WorkspaceFile[] = [];
  private readonly onCommitted?: LiveWorkspaceRepositoryOptions['onCommitted'];
  private readonly outcomes = new Map<string, WorkspaceMutationResult>();
  private readonly readonlyRoots: string[];
  private readonly source: LiveWorkspaceSource;

  constructor(options: LiveWorkspaceRepositoryOptions) {
    this.source = options.source;
    this.onCommitted = options.onCommitted;
    this.readonlyRoots = options.readonlyRoots ?? [];
    options.completedToolCallIds?.forEach(id => this.completedToolCalls.add(id));
  }

  async initialize(): Promise<void> {
    this.files = klona(await this.source.load());
  }

  async list(path: string): Promise<WorkspaceEntry[]> {
    return (await this.fresh()).list(path);
  }

  async read(path: string): Promise<WorkspaceFile> {
    return (await this.fresh()).read(path);
  }

  async write(
    path: string,
    content: string,
    toolCallId: string,
    options: WorkspaceWriteOptions = {},
  ): Promise<void> {
    await this.mutate(toolCallId, (repository, localToolCallId) =>
      repository.write(path, content, localToolCallId, options),
    );
  }

  async patch(path: string, patch: string, toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, (repository, localToolCallId) => repository.patch(path, patch, localToolCallId));
  }

  async move(from: string, to: string, toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, (repository, localToolCallId) => repository.move(from, to, localToolCallId));
  }

  async remove(path: string, toolCallId: string): Promise<void> {
    await this.mutate(toolCallId, (repository, localToolCallId) => repository.remove(path, localToolCallId));
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    return (await this.fresh()).search(query);
  }

  mutationResult(toolCallId: string): WorkspaceMutationResult | undefined {
    const result = this.outcomes.get(toolCallId);
    return result ? klona(result) : undefined;
  }

  snapshot(): WorkspaceFile[] {
    return klona(this.files);
  }

  private async fresh(): Promise<MemoryWorkspaceRepository> {
    this.files = klona(await this.source.load());
    return new MemoryWorkspaceRepository({ files: this.files, readonlyRoots: this.readonlyRoots });
  }

  private async mutate(toolCallId: string, mutation: LocalMutation): Promise<void> {
    if (!toolCallId) throw new Error('工具调用必须包含稳定的toolCallId。');
    if (this.completedToolCalls.has(toolCallId)) {
      this.outcomes.set(toolCallId, { changes: [], idempotent: true, status: 'success' });
      return;
    }
    const repository = await this.fresh();
    await mutation(repository, `${toolCallId}:intent`);
    const requested = repository.changes();
    const applied = await this.source.apply({ changes: requested, toolCallId });
    this.files = klona(applied.files);
    const outcome: WorkspaceMutationResult = {
      changes: klona(applied.changes),
      status: applied.status,
      warning: applied.warning,
    };
    this.outcomes.set(toolCallId, outcome);
    this.completedToolCalls.add(toolCallId);
    await this.onCommitted?.(klona(outcome), toolCallId);
  }
}
