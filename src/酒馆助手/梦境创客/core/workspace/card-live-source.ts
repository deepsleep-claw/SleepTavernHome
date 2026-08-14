import { materializeCardWorkspace, projectCardWorkspace, synchronizeCardAgentMetadata } from '../mapping/card-workspace-mapper';
import type { CardStateAdapter } from '../transaction/adapter';
import { applyRealtimeStateOperations } from '../transaction/realtime-apply';
import { diffCardStates } from '../transaction/state-diff';
import { diffRequestedWorkspaceFiles } from './file-diff';
import type { LiveWorkspaceApplyInput, LiveWorkspaceApplyResult, LiveWorkspaceSource } from './live-repository';
import { MemoryWorkspaceRepository } from './memory-repository';
import type { WorkspaceChange, WorkspaceFile } from './types';

function projected(state: Awaited<ReturnType<CardStateAdapter['read']>>): WorkspaceFile[] {
  return projectCardWorkspace(state, 100, { allowNonCharacterWrites: true });
}

async function applyFileIntent(repository: MemoryWorkspaceRepository, change: WorkspaceChange, id: string): Promise<void> {
  if (change.kind === 'create') await repository.stageFiles([change.after], id);
  else if (change.kind === 'modify') await repository.write(change.path, change.after.content, id, { overwrite: true });
  else if (change.kind === 'delete') await repository.remove(change.path, id);
  else await repository.move(change.from, change.path, id);
}

/** 把文件级实时写入映射为酒馆角色卡/世界书/资源的最小状态操作。 */
export class CardWorkspaceLiveSource implements LiveWorkspaceSource {
  constructor(
    private readonly adapter: CardStateAdapter,
    private readonly options: { synchronizeMetadata?: boolean } = {},
  ) {}

  async load(): Promise<WorkspaceFile[]> {
    return projected(await this.adapter.read());
  }

  async apply(input: LiveWorkspaceApplyInput): Promise<LiveWorkspaceApplyResult> {
    const beforeState = await this.adapter.read();
    const beforeFiles = projected(beforeState);
    const intent = new MemoryWorkspaceRepository({
      files: beforeFiles,
      readonlyRoots: ['/context', '/skills/builtin'],
    });
    for (const [index, change] of input.changes.entries()) {
      await applyFileIntent(intent, change, `${input.toolCallId}:file:${index}`);
    }
    const desired = materializeCardWorkspace(beforeState, intent.snapshot(), this.options).state;
    if (this.options.synchronizeMetadata !== false) synchronizeCardAgentMetadata(desired);
    const operations = diffCardStates(beforeState, desired);
    const result = await applyRealtimeStateOperations(this.adapter, operations);
    let afterFiles: WorkspaceFile[];
    try {
      afterFiles = projected(await this.adapter.read());
    } catch (error) {
      return {
        changes: input.changes,
        files: intent.snapshot(),
        status: 'uncertain',
        warning: `写入后无法重新读取真实资源：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const actualChanges = diffRequestedWorkspaceFiles(input.changes, beforeFiles, afterFiles);
    if (result.error) {
      if (actualChanges.length === 0) throw result.error;
      return {
        changes: actualChanges,
        files: afterFiles,
        status: 'partial_success',
        warning: `部分修改已写入；后续操作失败：${result.error.message}`,
      };
    }
    return { changes: actualChanges, files: afterFiles, status: 'success' };
  }
}
