import type { ModelMessage } from 'ai';
import type { OperationReplayConflict, OperationReplayDirection } from '../operations/operation-replayer';
import type { PersistedOperationLog } from '../operations/types';
import type { CompiledPreset, StructuredPreset } from '../preset/compiler';
import type { RunnerEvent, RunnerStatus } from '../runner/agent-runner';
import type { ContextUsage } from '../runner/context';
import type { AgentSkill } from '../skills/types';
import type { WorkspaceFile } from '../workspace/types';
import type { TavernChatWorkspaceRuntime } from '../tavern/chat-workspace';
import type { SessionAttachmentSummary, StoredSessionAttachment } from './attachments';

export type SessionMode = 'full' | 'normal' | 'yolo';

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

export type SessionLifecycleStatus = RunnerStatus | 'abnormal';

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
  toolPhase?: 'executing' | 'generating' | 'ready';
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
  checkpointId: string;
  files: Record<string, ManualWorkspaceFileChange>;
  modelMessageIndex?: number;
  uiItemId: string;
};

export type PersistedSessionRuntime = {
  activeCheckpointId?: string;
  agentConfiguration?: SessionAgentConfiguration;
  attachments?: Record<string, StoredSessionAttachment>;
  compiledPreset: CompiledPreset;
  createdAt: number;
  events: RunnerEvent[];
  headerMessageCount: number;
  lastError?: string;
  manualEditGroup?: ManualEditGroup;
  mode: SessionMode;
  modelControls?: SessionModelControls;
  modelMessages: ModelMessage[];
  operationLog?: PersistedOperationLog;
  preset: StructuredPreset;
  sessionId: string;
  skills: AgentSkill[];
  status: SessionLifecycleStatus;
  tavernChats?: TavernChatWorkspaceRuntime;
  title: string;
  ui: SessionUiItem[];
  updatedAt: number;
  version: 2;
  warnings?: string[];
};

export type SessionView = {
  agentConfiguration: SessionAgentConfiguration;
  bindingId: string;
  characterName: string;
  contextUsage: ContextUsage;
  error?: string;
  events: RunnerEvent[];
  mode: SessionMode;
  modelControls: SessionModelControls;
  operationLog: PersistedOperationLog;
  operationReplay?: {
    conflicts: OperationReplayConflict[];
    direction: OperationReplayDirection;
    turnId: string;
  };
  preset: StructuredPreset;
  sessionId: string;
  skills: AgentSkill[];
  status: SessionLifecycleStatus;
  tavernChats?: TavernChatWorkspaceRuntime;
  title: string;
  ui: SessionUiItem[];
  warnings: string[];
  workingFiles: WorkspaceFile[];
};
