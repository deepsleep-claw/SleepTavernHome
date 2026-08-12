import { describe, expect, it } from 'vitest';
import type { WorkspaceFile } from '../workspace/types';
import { applyUnifiedPatch } from '../workspace/unified-patch';
import { createWorkspaceOperationRecord } from './file-operation';
import { WorkspaceOperationLog } from './operation-log';

function file(content: string, path = '/character/description.md'): WorkspaceFile {
  return { content, mediaType: 'text/markdown', path, readonly: false, resourceId: 'description' };
}

describe('WorkspaceOperationLog', () => {
  it('为修改记录标准正反向补丁和内容指纹', async () => {
    const before = file('旧内容\n');
    const after = file('新内容\n第二行\n');
    const record = await createWorkspaceOperationRecord({
      actor: 'agent',
      approvalMode: 'manual',
      change: { after, before, kind: 'modify', path: after.path },
      executedAt: 100,
      operationId: 'op-1',
      toolCallId: 'tool-1',
      turnId: 'turn-1',
    });
    expect(record).toMatchObject({ operationId: 'op-1', state: 'applied', undoable: true });
    expect(record.before?.sha256).not.toBe(record.after?.sha256);
    if (record.forward.kind !== 'modify' || record.inverse.kind !== 'modify') throw new Error('expected modify');
    expect(applyUnifiedPatch(before.content, record.forward.forwardPatch, before.path)).toBe(after.content);
    expect(applyUnifiedPatch(after.content, record.inverse.forwardPatch, after.path)).toBe(before.content);
  });

  it('按轮维护Undo/Redo子集并可无损恢复', async () => {
    const record = await createWorkspaceOperationRecord({
      actor: 'user',
      approvalMode: 'full',
      change: { after: file('新建', '/files/note.md'), kind: 'create', path: '/files/note.md' },
      operationId: 'op-create',
      toolCallId: 'manual-1',
      turnId: 'turn-1',
    });
    const log = new WorkspaceOperationLog();
    log.append(record);
    log.append(record);
    log.markUndone('turn-1', ['op-create']);
    expect(log.recordsForTurn('turn-1')).toMatchObject([{ state: 'undone' }]);
    expect(log.latestTurn()?.redoOperationIds).toEqual(['op-create']);
    const restored = new WorkspaceOperationLog(log.export());
    restored.markRedone('turn-1', ['op-create']);
    expect(restored.recordsForTurn('turn-1')).toMatchObject([{ state: 'applied' }]);
  });
});
