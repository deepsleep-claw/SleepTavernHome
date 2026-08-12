import { describe, expect, it } from 'vitest';
import { createWorkspaceOperationRecord } from '../../core/operations/file-operation';
import type { WorkspaceChange, WorkspaceFile } from '../../core/workspace/types';
import { buildOperationDiffFiles, buildUnifiedDiffRows } from './operation-diff';

function file(path: string, content: string, resourceId = path, mediaType = 'text/markdown'): WorkspaceFile {
  return { content, mediaType, path, readonly: false, resourceId };
}

async function record(change: WorkspaceChange, operationId: string) {
  return createWorkspaceOperationRecord({
    actor: 'agent',
    approvalMode: 'yolo',
    change,
    operationId,
    toolCallId: `call:${operationId}`,
    turnId: 'turn:1',
  });
}

describe('operation diff presentation', () => {
  it('把同一文件的连续修改聚合为首尾净变化', async () => {
    const before = file('/character/a.md', 'one\ntwo\nthree\n');
    const middle = file('/character/a.md', 'one\nTWO\nthree\n');
    const after = file('/character/a.md', 'one\nTWO\nthree\nfour\n');
    const files = buildOperationDiffFiles([
      await record({ after: middle, before, kind: 'modify', path: before.path }, 'modify:1'),
      await record({ after, before: middle, kind: 'modify', path: before.path }, 'modify:2'),
    ]);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ addedLines: 2, kind: 'modify', removedLines: 1 });
    expect(files[0].operationIds).toEqual(['modify:1', 'modify:2']);
    expect(files[0].rows.some(row => row.kind === 'add' && row.content === 'four')).toBe(true);
  });

  it('把移动后的继续修改归并到新路径并保留旧路径', async () => {
    const before = file('/worldbooks/old.md', 'old\n', 'resource:move');
    const moved = file('/worldbooks/new.md', 'old\n', 'resource:move');
    const after = file('/worldbooks/new.md', 'new\n', 'resource:move');
    const files = buildOperationDiffFiles([
      await record({ after: moved, before, from: before.path, kind: 'move', path: moved.path }, 'move:1'),
      await record({ after, before: moved, kind: 'modify', path: moved.path }, 'modify:after-move'),
    ]);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      addedLines: 1,
      kind: 'move',
      originalPath: '/worldbooks/old.md',
      path: '/worldbooks/new.md',
      removedLines: 1,
    });
  });

  it('为大段未修改内容生成可展开的折叠行', () => {
    const before = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
    const after = before.replace('line 15', 'changed 15');
    const rows = buildUnifiedDiffRows(before, after, '/large.md');
    const folded = rows.filter(row => row.kind === 'fold');

    expect(folded.length).toBeGreaterThan(0);
    expect(folded.some(row => row.kind === 'fold' && row.hidden.length >= 10)).toBe(true);
  });
});
