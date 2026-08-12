import type { WorkspaceFile } from '../workspace/types';

export type WorkspaceOperationActor = 'agent' | 'user';
export type WorkspaceOperationState = 'applied' | 'undone' | 'uncertain';

export type WorkspaceFileFingerprint = {
  mediaType: string;
  path: string;
  resourceId: string;
  sha256: string;
  size: number;
};

export type FileOperationPayload =
  | {
      file: WorkspaceFile;
      kind: 'create';
      path: string;
    }
  | {
      file: WorkspaceFile;
      kind: 'delete';
      path: string;
    }
  | {
      after: WorkspaceFile;
      before: WorkspaceFile;
      forwardPatch: string;
      inversePatch: string;
      kind: 'modify';
      path: string;
    }
  | {
      after: WorkspaceFile;
      before: WorkspaceFile;
      from: string;
      kind: 'move';
      path: string;
    };

export type WorkspaceOperationRecord = {
  actor: WorkspaceOperationActor;
  after?: WorkspaceFileFingerprint;
  approvalMode: 'full' | 'manual' | 'yolo';
  before?: WorkspaceFileFingerprint;
  children?: WorkspaceOperationRecord[];
  executedAt: number;
  forward: FileOperationPayload;
  inverse: FileOperationPayload;
  operationId: string;
  state: WorkspaceOperationState;
  toolCallId: string;
  turnId: string;
  undoable: boolean;
  warning?: string;
};

export type TurnOperationSummary = {
  eventStart?: number;
  modelMessageStart?: number;
  operationIds: string[];
  recoveryAvailable: boolean;
  redoOperationIds: string[];
  turnId: string;
  userMessageId?: string;
};

export type PersistedOperationLog = {
  records: WorkspaceOperationRecord[];
  turns: TurnOperationSummary[];
  version: 1;
};
