import { canonicalEqual } from '../transaction/canonical';
import type { WorkspaceChange, WorkspaceFile } from './types';

function equalFile(left: WorkspaceFile, right: WorkspaceFile): boolean {
  return canonicalEqual(
    { ...left, path: undefined, readonly: undefined },
    { ...right, path: undefined, readonly: undefined },
  );
}

/** 比较两次真实投影；稳定resourceId可让目录移动仍显示为move。 */
export function diffWorkspaceFiles(before: WorkspaceFile[], after: WorkspaceFile[]): WorkspaceChange[] {
  const afterByPath = new Map(after.map(file => [file.path, file]));
  const afterByResource = new Map(after.map(file => [file.resourceId, file]));
  const consumed = new Set<string>();
  const changes: WorkspaceChange[] = [];
  for (const previous of before) {
    const samePath = afterByPath.get(previous.path);
    if (samePath && samePath.resourceId === previous.resourceId) {
      consumed.add(samePath.path);
      if (!equalFile(previous, samePath)) {
        changes.push({ after: samePath, before: previous, kind: 'modify', path: samePath.path });
      }
      continue;
    }
    const moved = afterByResource.get(previous.resourceId);
    if (moved && !consumed.has(moved.path)) {
      consumed.add(moved.path);
      changes.push({ after: moved, before: previous, from: previous.path, kind: 'move', path: moved.path });
      continue;
    }
    changes.push({ before: previous, kind: 'delete', path: previous.path });
  }
  for (const current of after) {
    if (!consumed.has(current.path)) changes.push({ after: current, kind: 'create', path: current.path });
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}
