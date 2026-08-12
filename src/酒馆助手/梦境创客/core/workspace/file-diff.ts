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

/**
 * 从写后真实投影中只提取本次工具明确触及的资源。
 *
 * 酒馆保存世界书时可能顺带规范化整本书的默认字段与序列化格式；这些变化虽然出现在
 * 写后投影里，却不是当前工具的文件意图。resourceId 是首选关联键，路径仅用于兼容
 * 新建资源或宿主在写入时重新分配身份的情况。
 */
export function diffRequestedWorkspaceFiles(
  requested: WorkspaceChange[],
  before: WorkspaceFile[],
  after: WorkspaceFile[],
): WorkspaceChange[] {
  const resourceIds = new Set<string>();
  const paths = new Set<string>();
  for (const change of requested) {
    paths.add(change.path);
    if (change.kind === 'move') paths.add(change.from);
    if ('before' in change) resourceIds.add(change.before.resourceId);
    if ('after' in change) resourceIds.add(change.after.resourceId);
  }
  return diffWorkspaceFiles(before, after).filter(change => {
    if (paths.has(change.path) || (change.kind === 'move' && paths.has(change.from))) return true;
    if ('before' in change && resourceIds.has(change.before.resourceId)) return true;
    return 'after' in change && resourceIds.has(change.after.resourceId);
  });
}
