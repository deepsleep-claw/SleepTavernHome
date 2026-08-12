import { sha256 } from '../transaction/canonical';
import type { LiveWorkspaceRepository } from '../workspace/live-repository';
import type { WorkspaceFile } from '../workspace/types';
import type { FileOperationPayload, WorkspaceOperationRecord } from './types';

export type OperationReplayDirection = 'redo' | 'undo';

export type OperationReplayConflict = {
  actual?: { path: string; sha256: string };
  expected: 'absent' | { path: string; sha256: string };
  operationId: string;
  path: string;
  reason: string;
};

export type OperationReplayPlan = {
  conflicts: OperationReplayConflict[];
  direction: OperationReplayDirection;
  operationIds: string[];
};

async function fileHash(file: WorkspaceFile): Promise<string> {
  return sha256(new TextEncoder().encode(file.content));
}

async function tryRead(repository: LiveWorkspaceRepository, path: string): Promise<WorkspaceFile | undefined> {
  try {
    return await repository.read(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return undefined;
    throw error;
  }
}

function payloadFor(record: WorkspaceOperationRecord, direction: OperationReplayDirection): FileOperationPayload {
  return direction === 'undo' ? record.inverse : record.forward;
}

async function inspectPayload(
  repository: LiveWorkspaceRepository,
  record: WorkspaceOperationRecord,
  payload: FileOperationPayload,
): Promise<OperationReplayConflict | undefined> {
  const sourcePath = payload.kind === 'move' ? payload.from : payload.path;
  const current = await tryRead(repository, sourcePath);
  if (payload.kind === 'create') {
    if (!current) return undefined;
    return {
      actual: { path: sourcePath, sha256: await fileHash(current) },
      expected: 'absent',
      operationId: record.operationId,
      path: sourcePath,
      reason: '目标路径已经存在，不能安全恢复被删除或移动的文件。',
    };
  }
  if (!current) {
    return {
      expected: { path: sourcePath, sha256: await fileHash(payload.kind === 'delete' ? payload.file : payload.before) },
      operationId: record.operationId,
      path: sourcePath,
      reason: '预期文件已经不存在。',
    };
  }
  const expectedFile = payload.kind === 'delete' ? payload.file : payload.before;
  const [actualHash, expectedHash] = await Promise.all([fileHash(current), fileHash(expectedFile)]);
  if (actualHash !== expectedHash) {
    return {
      actual: { path: sourcePath, sha256: actualHash },
      expected: { path: sourcePath, sha256: expectedHash },
      operationId: record.operationId,
      path: sourcePath,
      reason: '文件在原操作之后又发生了变化。',
    };
  }
  if (payload.kind === 'move') {
    const target = await tryRead(repository, payload.path);
    if (target) {
      return {
        actual: { path: payload.path, sha256: await fileHash(target) },
        expected: 'absent',
        operationId: record.operationId,
        path: payload.path,
        reason: '移动目标已经存在。',
      };
    }
  }
  return undefined;
}

export async function planOperationReplay(
  repository: LiveWorkspaceRepository,
  records: WorkspaceOperationRecord[],
  direction: OperationReplayDirection,
): Promise<OperationReplayPlan> {
  const ordered = direction === 'undo' ? [...records].reverse() : [...records];
  const conflicts: OperationReplayConflict[] = [];
  for (const record of ordered) {
    if (!record.undoable || record.state === 'uncertain') {
      conflicts.push({
        expected: 'absent',
        operationId: record.operationId,
        path: record.forward.path,
        reason: record.warning || '该操作没有可靠的恢复记录。',
      });
      continue;
    }
    const conflict = await inspectPayload(repository, record, payloadFor(record, direction));
    if (conflict) conflicts.push(conflict);
  }
  return { conflicts, direction, operationIds: ordered.map(record => record.operationId) };
}

export async function executeOperationReplay(input: {
  direction: OperationReplayDirection;
  repository: LiveWorkspaceRepository;
  records: WorkspaceOperationRecord[];
  skipOperationIds?: string[];
}): Promise<{ appliedOperationIds: string[]; failed: OperationReplayConflict[] }> {
  const ordered = input.direction === 'undo' ? [...input.records].reverse() : [...input.records];
  const skipped = new Set(input.skipOperationIds ?? []);
  const appliedOperationIds: string[] = [];
  const failed: OperationReplayConflict[] = [];
  for (const record of ordered) {
    if (skipped.has(record.operationId)) continue;
    const payload = payloadFor(record, input.direction);
    const conflict = await inspectPayload(input.repository, record, payload);
    if (conflict) {
      failed.push(conflict);
      continue;
    }
    try {
      await input.repository.replay(payload, `${input.direction}:${record.operationId}:${crypto.randomUUID()}`);
      appliedOperationIds.push(record.operationId);
    } catch (error) {
      failed.push({
        expected: 'absent',
        operationId: record.operationId,
        path: payload.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { appliedOperationIds, failed };
}
