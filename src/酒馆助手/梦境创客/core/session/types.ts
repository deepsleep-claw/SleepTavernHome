import type { ModelMessage } from 'ai';
import type { HistoryCheckpoint } from '../history/timeline';
import type { CardWorkspaceState } from '../mapping/types';
import type { CompiledPreset, StructuredPreset } from '../preset/compiler';
import type { RunnerEvent, RunnerStatus } from '../runner/agent-runner';
import type { ContextUsage } from '../runner/context';
import type { AgentSkill } from '../skills/types';
import type { MergeConflict, MergePreparation } from '../transaction/merge';
import type { StateOperation } from '../transaction/state-diff';
import type { WorkspaceChange, WorkspaceFile } from '../workspace/types';

export type SessionMode = 'normal' | 'yolo';

export type SessionLifecycleStatus =
  | RunnerStatus
  | 'abnormal'
  | 'awaiting-approval'
  | 'committing';

export type SessionUiItem = {
  at: number;
  checkpointId?: string;
  content: string;
  hidden?: boolean;
  id: string;
  kind: 'assistant' | 'guidance' | 'status' | 'tool' | 'user';
  status?: 'completed' | 'failed' | 'running';
  toolCallId?: string;
  toolName?: string;
};

export type SkillChange = {
  after?: AgentSkill;
  before?: AgentSkill;
  highRisk: boolean;
  kind: 'create' | 'delete' | 'modify';
  label: string;
  path: string;
};

export type SessionApproval = {
  candidateSnapshot: string;
  conflicts: MergeConflict[];
  skillChanges: SkillChange[];
  stateChanges: StateOperation[];
  warnings: string[];
};

export type SessionSnapshotPayload = {
  card: CardWorkspaceState;
  events: RunnerEvent[];
  modelMessages: ModelMessage[];
  skills: AgentSkill[];
};

export type PersistedSessionRuntime = {
  activeBase?: CardWorkspaceState;
  activeCheckpointId?: string;
  compiledPreset: CompiledPreset;
  createdAt: number;
  events: RunnerEvent[];
  headerMessageCount: number;
  history: { checkpoints: HistoryCheckpoint[]; position: number };
  mode: SessionMode;
  modelMessages: ModelMessage[];
  pending?: PendingCandidate;
  preset: StructuredPreset;
  sessionId: string;
  skills: AgentSkill[];
  status: SessionLifecycleStatus;
  title: string;
  ui: SessionUiItem[];
  updatedAt: number;
  version: 1;
};

export type SessionView = {
  approval?: SessionApproval;
  bindingId: string;
  characterName: string;
  contextUsage: ContextUsage;
  error?: string;
  events: RunnerEvent[];
  mode: SessionMode;
  preset: StructuredPreset;
  readOnly: boolean;
  sessionId: string;
  skills: AgentSkill[];
  status: SessionLifecycleStatus;
  title: string;
  ui: SessionUiItem[];
  warnings: string[];
  workingChanges: WorkspaceChange[];
  workingFiles: WorkspaceFile[];
};

export type PendingCandidate = {
  base: CardWorkspaceState;
  candidateSnapshot: string;
  checkpointId: string;
  preparation: MergePreparation;
  skillChanges: SkillChange[];
  skills: AgentSkill[];
  state: CardWorkspaceState;
  stopped: boolean;
  warnings: string[];
};
