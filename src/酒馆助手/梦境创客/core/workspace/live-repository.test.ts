import { describe, expect, it } from 'vitest';
import { MemoryWorkspaceRepository } from './memory-repository';
import {
  LiveWorkspaceRepository,
  type LiveWorkspaceApplyInput,
  type LiveWorkspaceApplyResult,
  type LiveWorkspaceSource,
} from './live-repository';
import type { WorkspaceFile } from './types';

function file(content: string): WorkspaceFile {
  return {
    content,
    mediaType: 'text/markdown',
    path: '/character/description.md',
    readonly: false,
    resourceId: 'description',
  };
}

class MemoryLiveSource implements LiveWorkspaceSource {
  files: WorkspaceFile[];
  applies: LiveWorkspaceApplyInput[] = [];

  constructor(files: WorkspaceFile[]) {
    this.files = structuredClone(files);
  }

  async load(): Promise<WorkspaceFile[]> {
    return structuredClone(this.files);
  }

  async apply(input: LiveWorkspaceApplyInput): Promise<LiveWorkspaceApplyResult> {
    this.applies.push(structuredClone(input));
    const repository = new MemoryWorkspaceRepository({ files: this.files });
    for (const [index, change] of input.changes.entries()) {
      const id = `${input.toolCallId}:${index}`;
      if (change.kind === 'create') await repository.write(change.path, change.after.content, id);
      else if (change.kind === 'modify')
        await repository.write(change.path, change.after.content, id, { overwrite: true });
      else if (change.kind === 'delete') await repository.remove(change.path, id);
      else await repository.move(change.from, change.path, id);
    }
    this.files = repository.snapshot();
    return { changes: repository.changes(), files: structuredClone(this.files), status: 'success' };
  }
}

describe('LiveWorkspaceRepository', () => {
  it('每次Patch都读取最新真实内容，写后回读并通知操作日志', async () => {
    const source = new MemoryLiveSource([file('one\ntwo\n')]);
    const committed: string[] = [];
    const repository = new LiveWorkspaceRepository({
      onCommitted: (_result, toolCallId) => {
        committed.push(toolCallId);
      },
      source,
    });
    await repository.initialize();
    source.files = [file('external\none\ntwo\n')];
    await repository.patch(
      '/character/description.md',
      '@@ -1,2 +2,2 @@\n one\n-two\n+TWO\n',
      'patch-live',
    );
    expect((await repository.read('/character/description.md')).content).toBe('external\none\nTWO\n');
    expect(committed).toEqual(['patch-live']);
    expect(repository.mutationResult('patch-live')).toMatchObject({ status: 'success' });
  });

  it('同一个toolCallId保持幂等，write默认拒绝覆盖', async () => {
    const source = new MemoryLiveSource([file('old')]);
    const repository = new LiveWorkspaceRepository({ source });
    await repository.initialize();
    await expect(repository.write('/character/description.md', 'new', 'write')).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    await repository.write('/character/description.md', 'new', 'overwrite', { overwrite: true });
    await repository.write('/character/description.md', 'ignored', 'overwrite', { overwrite: true });
    expect(source.applies).toHaveLength(1);
    expect((await repository.read('/character/description.md')).content).toBe('new');
    expect(repository.mutationResult('overwrite')).toMatchObject({ idempotent: true });
  });
});
