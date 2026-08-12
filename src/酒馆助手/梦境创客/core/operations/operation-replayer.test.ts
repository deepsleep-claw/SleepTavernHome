import { describe, expect, it } from 'vitest';
import { LiveWorkspaceRepository, type LiveWorkspaceApplyInput, type LiveWorkspaceSource } from '../workspace/live-repository';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import type { WorkspaceFile } from '../workspace/types';
import { createWorkspaceOperationRecord } from './file-operation';
import { executeOperationReplay, planOperationReplay } from './operation-replayer';

function file(content: string, path = '/character/description.md'): WorkspaceFile {
  return { content, mediaType: 'text/markdown', path, readonly: false, resourceId: path };
}

class Source implements LiveWorkspaceSource {
  constructor(public files: WorkspaceFile[]) {}
  async load() { return structuredClone(this.files); }
  async apply(input: LiveWorkspaceApplyInput) {
    const repository = new MemoryWorkspaceRepository({ files: this.files });
    for (const [index, change] of input.changes.entries()) {
      const id = `${input.toolCallId}:${index}`;
      if (change.kind === 'create') await repository.stageFiles([change.after], id);
      else if (change.kind === 'delete') await repository.remove(change.path, id);
      else if (change.kind === 'move') await repository.move(change.from, change.path, id);
      else await repository.write(change.path, change.after.content, id, { overwrite: true });
    }
    this.files = repository.snapshot();
    return { changes: repository.changes(), files: structuredClone(this.files), status: 'success' as const };
  }
}

describe('operation replayer', () => {
  it('按逆序Undo并可顺序Redo标准补丁', async () => {
    const source = new Source([file('第二版\n')]);
    const repository = new LiveWorkspaceRepository({ source });
    await repository.initialize();
    const record = await createWorkspaceOperationRecord({
      actor: 'agent', approvalMode: 'manual',
      change: { before: file('第一版\n'), after: file('第二版\n'), kind: 'modify', path: '/character/description.md' },
      operationId: 'op', toolCallId: 'tool', turnId: 'turn',
    });
    expect((await planOperationReplay(repository, [record], 'undo')).conflicts).toEqual([]);
    expect(await executeOperationReplay({ direction: 'undo', records: [record], repository })).toMatchObject({
      appliedOperationIds: ['op'], failed: [],
    });
    expect((await repository.read('/character/description.md')).content).toBe('第一版\n');
    await executeOperationReplay({ direction: 'redo', records: [record], repository });
    expect((await repository.read('/character/description.md')).content).toBe('第二版\n');
  });

  it('模拟阶段识别外部修改，跳过冲突仍可处理其他操作', async () => {
    const source = new Source([file('外部编辑\n')]);
    const repository = new LiveWorkspaceRepository({ source });
    await repository.initialize();
    const record = await createWorkspaceOperationRecord({
      actor: 'agent', approvalMode: 'manual',
      change: { before: file('旧\n'), after: file('新\n'), kind: 'modify', path: '/character/description.md' },
      operationId: 'op', toolCallId: 'tool', turnId: 'turn',
    });
    expect((await planOperationReplay(repository, [record], 'undo')).conflicts).toMatchObject([
      { operationId: 'op', reason: '文件在原操作之后又发生了变化。' },
    ]);
    expect(await executeOperationReplay({ direction: 'undo', records: [record], repository, skipOperationIds: ['op'] }))
      .toEqual({ appliedOperationIds: [], failed: [] });
  });
});
