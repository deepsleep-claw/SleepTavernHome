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
import type { SessionAttachmentSummary, StoredSessionAttachment } from './attachments';

export type SessionMode = 'normal' | 'yolo';

export type SessionModelControls = {
  reasoningEffort: 'auto' | 'off' | string;
  webSearch: boolean;
};

export type SessionAgentConfiguration = {
  id: string;
  name: string;
  presetId: string;
  skillIds: string[];
};

export type SessionLifecycleStatus = RunnerStatus | 'abnormal' | 'awaiting-approval' | 'committing';

export type SessionUiItem = {
  attachments?: SessionAttachmentSummary[];
  at: number;
  checkpointId?: string;
  content: string;
  durationMs?: number;
  hidden?: boolean;
  id: string;
  kind: 'assistant' | 'guidance' | 'manual' | 'reasoning' | 'status' | 'tool' | 'user';
  manualStatus?: 'active' | 'failed' | 'undone';
  runStatus?: 'abnormal' | 'completed' | 'context-exhausted' | 'failed' | 'stopped';
  status?: 'completed' | 'failed' | 'running';
  toolCallId?: string;
  toolInput?: string;
  toolName?: string;
  providerTool?: boolean;
};

export type ManualWorkspaceFileChange = {
  after?: string;
  before?: string;
  error?: string;
  kind: 'delete' | 'write';
  path: string;
};

export type ManualEditGroup = {
  attachedToAgent: boolean;
  beforeSnapshot?: string;
  checkpointId: string;
  completed: boolean;
  files: Record<string, ManualWorkspaceFileChange>;
  modelMessageIndex?: number;
  uiItemId: string;
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
  /** @deprecated 旧快照兼容字段；全局Skill不参与角色卡Undo/Redo。 */
  skills?: AgentSkill[];
};

export type PersistedSessionRuntime = {
  activeBase?: CardWorkspaceState;
  activeCheckpointId?: string;
  agentConfiguration?: SessionAgentConfiguration;
  attachments?: Record<string, StoredSessionAttachment>;
  compiledPreset: CompiledPreset;
  createdAt: number;
  events: RunnerEvent[];
  headerMessageCount: number;
  history: { checkpoints: HistoryCheckpoint[]; position: number };
  lastError?: string;
  manualEditGroup?: ManualEditGroup;
  mode: SessionMode;
  modelControls?: SessionModelControls;
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
  warnings?: string[];
};

export type SessionView = {
  agentConfiguration: SessionAgentConfiguration;
  approval?: SessionApproval;
  bindingId: string;
  characterName: string;
  contextUsage: ContextUsage;
  error?: string;
  events: RunnerEvent[];
  mode: SessionMode;
  modelControls: SessionModelControls;
  preset: StructuredPreset;
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
