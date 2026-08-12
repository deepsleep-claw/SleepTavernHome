import { klona } from 'klona';
import { sha256 } from '../transaction/canonical';
import { createUnifiedPatch } from '../workspace/unified-patch';
import type { WorkspaceChange, WorkspaceFile } from '../workspace/types';
import type {
  FileOperationPayload,
  WorkspaceFileFingerprint,
  WorkspaceOperationActor,
  WorkspaceOperationRecord,
} from './types';

async function fingerprint(file: WorkspaceFile): Promise<WorkspaceFileFingerprint> {
  const bytes = new TextEncoder().encode(file.content);
  return {
    mediaType: file.mediaType,
    path: file.path,
    resourceId: file.resourceId,
    sha256: await sha256(bytes),
    size: file.external?.size ?? file.skillResource?.size ?? bytes.byteLength,
  };
}

function forwardAndInverse(change: WorkspaceChange): { forward: FileOperationPayload; inverse: FileOperationPayload } {
  if (change.kind === 'create') {
    return {
      forward: { file: klona(change.after), kind: 'create', path: change.path },
      inverse: { file: klona(change.after), kind: 'delete', path: change.path },
    };
  }
  if (change.kind === 'delete') {
    return {
      forward: { file: klona(change.before), kind: 'delete', path: change.path },
      inverse: { file: klona(change.before), kind: 'create', path: change.path },
    };
  }
  if (change.kind === 'move') {
    return {
      forward: {
        after: klona(change.after),
        before: klona(change.before),
        from: change.from,
        kind: 'move',
        path: change.path,
      },
      inverse: {
        after: klona(change.before),
        before: klona(change.after),
        from: change.path,
        kind: 'move',
        path: change.from,
      },
    };
  }
  return {
    forward: {
      after: klona(change.after),
      before: klona(change.before),
      forwardPatch: createUnifiedPatch(change.path, change.before.content, change.after.content),
      inversePatch: createUnifiedPatch(change.path, change.after.content, change.before.content),
      kind: 'modify',
      path: change.path,
    },
    inverse: {
      after: klona(change.before),
      before: klona(change.after),
      forwardPatch: createUnifiedPatch(change.path, change.after.content, change.before.content),
      inversePatch: createUnifiedPatch(change.path, change.before.content, change.after.content),
      kind: 'modify',
      path: change.path,
    },
  };
}

export async function createWorkspaceOperationRecord(input: {
  actor: WorkspaceOperationActor;
  approvalMode: WorkspaceOperationRecord['approvalMode'];
  change: WorkspaceChange;
  executedAt?: number;
  operationId?: string;
  toolCallId: string;
  turnId: string;
  undoable?: boolean;
  warning?: string;
}): Promise<WorkspaceOperationRecord> {
  const { forward, inverse } = forwardAndInverse(input.change);
  const before = 'before' in input.change ? await fingerprint(input.change.before) : undefined;
  const after = 'after' in input.change ? await fingerprint(input.change.after) : undefined;
  return {
    actor: input.actor,
    after,
    approvalMode: input.approvalMode,
    before,
    executedAt: input.executedAt ?? Date.now(),
    forward,
    inverse,
    operationId: input.operationId ?? crypto.randomUUID(),
    state: input.undoable === false ? 'uncertain' : 'applied',
    toolCallId: input.toolCallId,
    turnId: input.turnId,
    undoable: input.undoable ?? true,
    warning: input.warning,
  };
}
