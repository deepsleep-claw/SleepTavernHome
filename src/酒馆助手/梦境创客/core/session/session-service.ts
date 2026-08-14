import { klona } from 'klona';
import type { ModelMessage } from 'ai';
import { projectCardWorkspace } from '../mapping/card-workspace-mapper';
import { encodeWorkspaceSegment } from '../mapping/serde';
import type { CardWorkspaceState } from '../mapping/types';
import { compilePreset, DEFAULT_PRESET, type CompiledPreset, type StructuredPreset } from '../preset/compiler';
import { PersistentRunnerJournal } from '../persistence/journal';
import { DreamCreatorWorkspaceFileStore } from '../persistence/workspace-file-store';
import { AgentRunner, type PendingRunnerStep, type RunnerEvent, type RunnerStatus } from '../runner/agent-runner';
import { measureContext } from '../runner/context';
import { recoverPendingRunnerStep } from '../runner/recovery';
import type {
  ModelStepExecutor,
  RunnerToolCall,
  RunnerToolInputDelta,
  RunnerToolInputStart,
} from '../runner/step-executor';
import { createWorkspaceRunnerTools, type ToolConfirmation } from '../runner/tools';
import { createTavernChatRunnerTools } from '../runner/tavern-chat-tools';
import { createWorldbookRunnerTools } from '../runner/worldbook-tools';
import { createProjectRunnerTools } from '../runner/project-tools';
import { createPlaygroundRunnerTools, type PreparedRender } from '../runner/playground-tools';
import { isAgentToolId } from '../runner/tool-catalog';
import { createCharacterRunnerTools } from '../runner/character-tools';
import { createPresetRunnerTools } from '../runner/preset-tools';
import { createAvatarRunnerTools } from '../runner/avatar-tools';
import { createWorkspaceOperationRecord } from '../operations/file-operation';
import { WorkspaceOperationLog } from '../operations/operation-log';
import {
  executeOperationReplay,
  planOperationReplay,
  type OperationReplayConflict,
  type OperationReplayDirection,
} from '../operations/operation-replayer';
import { OperationRecoveryCoordinator, type OperationRecoveryStore } from '../operations/recovery-store';
import type { AgentSkill } from '../skills/types';
import type { AgentConfiguration } from '../persistence/builtin-agent';
import type { CardStateAdapter } from '../transaction/adapter';
import type { TavernBridge } from '../tavern/bridge';
import type { TavernChatBridge } from '../tavern/chat-bridge';
import { TavernChatWorkspace } from '../tavern/chat-workspace';
import { canonicalEqual, canonicalStringify } from '../transaction/canonical';
import { CardWorkspaceLiveSource } from '../workspace/card-live-source';
import { LiveWorkspaceRepository } from '../workspace/live-repository';
import { SessionWorkspaceLiveSource } from '../workspace/session-live-source';
import { TavernWorkspaceLiveSource } from '../workspace/tavern-workspace-source';
import { maskSecretsForModel } from '../workspace/secret-protection';
import type { WorkspaceFile } from '../workspace/types';
import type { SessionAttachmentStore } from './attachment-store';
import {
  attachmentSummary,
  storeSessionAttachments,
  userContentWithAttachments,
  type SessionAttachmentInput,
  type StoredSessionAttachment,
} from './attachments';
import { defaultPresetValues } from './prompt';
import { globalAgentTaskLock, type GlobalAgentTaskLock } from './task-lock';
import type {
  PersistedSessionRuntime,
  ManualEditGroup,
  SessionAgentConfiguration,
  SessionLifecycleStatus,
  SessionModelControls,
  SessionMode,
  SessionScope,
  SessionUiItem,
  SessionView,
} from './types';
import type { ModelSelection } from '../provider/provider-config';

type SessionServiceOptions = {
  adapter: CardStateAdapter;
  canWriteNonCharacterResources?: () => boolean;
  agentConfiguration?: SessionAgentConfiguration;
  contextWindow?: number;
  executor: ModelStepExecutor;
  lock?: GlobalAgentTaskLock;
  mode?: SessionMode;
  modelSelection?: ModelSelection;
  mountedWorldbooks?: Set<string>;
  mountedPresets?: Set<string>;
  now?: () => number;
  onPersist?: (runtime: PersistedSessionRuntime) => Promise<void>;
  onSkillsCommit?: (skills: AgentSkill[], previouslyMountedSkillIds: string[]) => Promise<AgentSkill[]>;
  onUpdate?: (view: SessionView) => void;
  operationRecoveryStore?: OperationRecoveryStore;
  preset?: StructuredPreset;
  requestToolApproval?: (request: ToolConfirmation) => Promise<boolean>;
  resourceBaseUrl?: string;
  scheduleStreamingUpdate?: (callback: () => void) => () => void;
  sessionId?: string;
  scope?: SessionScope;
  skills?: AgentSkill[];
  tavernBridge?: TavernBridge;
  tavernChatBridge?: TavernChatBridge;
  attachmentStore?: SessionAttachmentStore;
  title?: string;
  workspaceFiles?: WorkspaceFile[];
  workspaceStore?: DreamCreatorWorkspaceFileStore;
  storageBindingId?: () => string;
  onCharacterChanged?: () => Promise<void>;
};

const DEFAULT_SESSION_TITLE = '新的创作会话';

const RUN_SCOPED_UI_KINDS = new Set<SessionUiItem['kind']>(['assistant', 'guidance', 'reasoning', 'tool']);

/**
 * 主动停止曾会过早清除 activeCheckpointId，随后恢复生成的过程项因此失去轮次归属。
 * 这些项仍然严格位于对应用户消息之后，可以在载入时无歧义地补回最近用户轮次的 checkpointId。
 */
function repairMissingRunCheckpointIds(items: SessionUiItem[]): SessionUiItem[] {
  const repaired = klona(items);
  let currentCheckpointId: string | undefined;
  for (const item of repaired) {
    if (item.kind === 'user') {
      currentCheckpointId = item.checkpointId;
      continue;
    }
    if (!item.checkpointId && currentCheckpointId && RUN_SCOPED_UI_KINDS.has(item.kind)) {
      item.checkpointId = currentCheckpointId;
    }
  }
  return repaired;
}
const STREAMING_UPDATE_INTERVAL_MS = 80;

function isNonCharacterResourcePath(path: string): boolean {
  return /^\/(?:regexes|scripts)\/(?:global|preset-current)(?:\/|$)/u.test(path);
}

function isStoragePath(path: string): boolean {
  return /^\/(?:files|temp)(?:\/|$)|^\/character\/(?:files|temp)(?:\/|$)/u.test(path);
}

function sessionTitleFromMessage(message: string): string {
  const normalized = message.trim().replace(/\s+/gu, ' ');
  return Array.from(normalized).slice(0, 10).join('') || DEFAULT_SESSION_TITLE;
}

function assistantText(messages: ModelMessage[]): string {
  return messages
    .filter(message => message.role === 'assistant')
    .flatMap(message =>
      typeof message.content === 'string'
        ? [message.content]
        : message.content.flatMap(part => (part.type === 'text' ? [part.text] : [])),
    )
    .join('');
}

function assistantReasoning(messages: ModelMessage[]): string {
  return messages
    .filter(message => message.role === 'assistant')
    .flatMap(message =>
      typeof message.content === 'string'
        ? []
        : message.content.flatMap(part => (part.type === 'reasoning' ? [part.text] : [])),
    )
    .join('');
}

function mountConfiguredSkills(configuration: AgentConfiguration, availableSkills: AgentSkill[]): AgentSkill[] {
  const settings = new Map(configuration.skills.filter(item => item.enabled).map(item => [item.id, item]));
  return availableSkills.flatMap(skill => {
    const configured = settings.get(skill.id);
    return configured ? [{ ...klona(skill), loading: configured.loading }] : [];
  });
}

export class CardAgentSessionService {
  readonly bindingId: string;
  readonly characterName: string;
  readonly createdAt: number;
  readonly sessionId: string;
  readonly scope: SessionScope;
  private activeCheckpointId?: string;
  private agentConfiguration: SessionAgentConfiguration;
  private attachments: Record<string, StoredSessionAttachment>;
  private readonly adapter: CardStateAdapter;
  private readonly attachmentStore?: SessionAttachmentStore;
  private readonly canWriteNonCharacterResources: () => boolean;
  private compiledPreset: CompiledPreset;
  private contextWindow: number;
  private executor: ModelStepExecutor;
  private readonly lock: GlobalAgentTaskLock;
  private readonly now: () => number;
  private readonly onPersist?: SessionServiceOptions['onPersist'];
  private readonly onSkillsCommit?: SessionServiceOptions['onSkillsCommit'];
  private readonly onUpdate?: SessionServiceOptions['onUpdate'];
  private readonly requestToolApproval?: SessionServiceOptions['requestToolApproval'];
  private readonly resourceBaseUrl?: string;
  private readonly scheduleStreamingUpdate: (callback: () => void) => () => void;
  private readonly tavernBridge?: TavernBridge;
  private readonly tavernChatWorkspace?: TavernChatWorkspace;
  private storageFiles: WorkspaceFile[] = [];
  private readonly storageBindingId: () => string;
  private readonly onCharacterChanged?: () => Promise<void>;
  private readonly workspaceStore?: DreamCreatorWorkspaceFileStore;
  private events: RunnerEvent[] = [];
  private headerMessageCount: number;
  private hasStreamedReasoningInCurrentStep = false;
  private hasStreamedTextInCurrentStep = false;
  private lastError?: string;
  private manualEditGroup?: ManualEditGroup;
  private mode: SessionMode;
  private modelMessages: ModelMessage[];
  private modelControls: SessionModelControls;
  private modelSelection?: ModelSelection;
  private modelVisionEnabled = true;
  private readonly mountedWorldbooks: Set<string>;
  private readonly mountedPresets: Set<string>;
  private runModelSelection?: ModelSelection;
  private mutationActor: 'agent' | 'user' = 'agent';
  private preset: StructuredPreset;
  private readonly operationLog: WorkspaceOperationLog;
  private readonly operationRecovery: OperationRecoveryCoordinator;
  private pendingOperationReplay?: {
    after?: { kind: 'undo-message'; messageId: string };
    conflicts: OperationReplayConflict[];
    direction: OperationReplayDirection;
    turnId: string;
  };
  private replayingOperations = false;
  private renderPreviews: Record<string, PreparedRender> = {};
  private repository?: LiveWorkspaceRepository;
  private runner?: AgentRunner;
  private skills: AgentSkill[];
  private status: SessionLifecycleStatus = 'idle';
  private title: string;
  private ui: SessionUiItem[] = [];
  private warnings: string[] = [];
  private cancelStreamingUpdate?: () => void;

  private constructor(
    options: SessionServiceOptions,
    initial: CardWorkspaceState,
    compiled: CompiledPreset,
    restored?: { runtime: PersistedSessionRuntime },
  ) {
    this.adapter = options.adapter;
    this.attachmentStore = options.attachmentStore;
    this.canWriteNonCharacterResources = options.canWriteNonCharacterResources ?? (() => false);
    const configuration = restored?.runtime.agentConfiguration ?? options.agentConfiguration;
    if (!configuration) throw new Error('会话缺少Agent配置；旧版会话不再受支持。');
    if (restored && restored.runtime.version !== 3) throw new Error('旧版会话不再受支持。');
    this.agentConfiguration = klona(configuration);
    this.attachments = klona(restored?.runtime.attachments ?? {});
    this.bindingId = initial.character.bindingId;
    this.characterName = (restored?.runtime.scope ?? options.scope) === 'global' ? '全局会话' : initial.character.name;
    this.compiledPreset = restored?.runtime.compiledPreset ?? compiled;
    this.contextWindow = options.contextWindow ?? 128_000;
    this.createdAt = restored?.runtime.createdAt ?? (options.now ?? Date.now)();
    this.executor = options.executor;
    this.headerMessageCount = restored?.runtime.headerMessageCount ?? compiled.messages.length;
    this.lock = options.lock ?? globalAgentTaskLock;
    this.manualEditGroup = restored?.runtime.manualEditGroup ? klona(restored.runtime.manualEditGroup) : undefined;
    this.operationLog = new WorkspaceOperationLog(restored?.runtime.operationLog);
    this.operationRecovery = new OperationRecoveryCoordinator(options.operationRecoveryStore);
    this.mode = restored?.runtime.mode ?? options.mode ?? 'normal';
    this.modelMessages = klona(restored?.runtime.modelMessages ?? compiled.messages);
    this.modelControls = klona(restored?.runtime.modelControls ?? { reasoningEffort: 'auto', webSearch: false });
    this.modelSelection = klona(restored?.runtime.modelSelection ?? options.modelSelection);
    this.mountedWorldbooks = options.mountedWorldbooks ?? new Set(restored?.runtime.mountedWorldbooks ?? []);
    this.mountedPresets = options.mountedPresets ?? new Set(restored?.runtime.mountedPresets ?? []);
    this.runModelSelection = klona(restored?.runtime.runModelSelection);
    this.now = options.now ?? Date.now;
    this.onPersist = options.onPersist;
    this.onSkillsCommit = options.onSkillsCommit;
    this.onUpdate = options.onUpdate;
    this.preset = klona(restored?.runtime.preset ?? options.preset ?? DEFAULT_PRESET);
    this.requestToolApproval = options.requestToolApproval;
    this.resourceBaseUrl = options.resourceBaseUrl;
    this.renderPreviews = klona(restored?.runtime.renderPreviews ?? {});
    this.scheduleStreamingUpdate =
      options.scheduleStreamingUpdate ??
      (callback => {
        const timer = setTimeout(callback, STREAMING_UPDATE_INTERVAL_MS);
        return () => clearTimeout(timer);
      });
    this.sessionId = restored?.runtime.sessionId ?? options.sessionId ?? crypto.randomUUID();
    this.scope = restored?.runtime.scope ?? options.scope ?? 'character';
    this.skills = klona(restored?.runtime.skills ?? options.skills ?? []);
    this.tavernBridge = options.tavernBridge;
    this.tavernChatWorkspace = options.tavernChatBridge
      ? new TavernChatWorkspace(options.tavernChatBridge, restored?.runtime.tavernChats)
      : undefined;
    this.workspaceStore = options.workspaceStore;
    this.storageBindingId = options.storageBindingId ?? (() => this.bindingId);
    this.onCharacterChanged = options.onCharacterChanged;
    this.storageFiles = klona(options.workspaceFiles ?? []);
    this.title = restored?.runtime.title ?? (options.title?.trim() || DEFAULT_SESSION_TITLE);
    this.activeCheckpointId = restored?.runtime.activeCheckpointId;
    this.events = klona(restored?.runtime.events ?? []);
    this.lastError = restored?.runtime.lastError;
    this.status = restored?.runtime.status ?? 'idle';
    this.ui = repairMissingRunCheckpointIds(restored?.runtime.ui ?? []);
    this.warnings = [...(restored?.runtime.warnings ?? [])];
    this.repository = undefined;
  }

  static async create(options: SessionServiceOptions): Promise<CardAgentSessionService> {
    const initial = await options.adapter.read();
    const preset = options.preset ?? DEFAULT_PRESET;
    if (!options.agentConfiguration) throw new Error('创建会话必须指定Agent配置。');
    const mountedSkills = mountConfiguredSkills(options.agentConfiguration, options.skills ?? []);
    const compiled = await compilePreset(
      preset,
      defaultPresetValues(mountedSkills, options.agentConfiguration.toolIds, options.scope ?? 'character'),
    );
    const service = new CardAgentSessionService(options, initial, compiled);
    service.repository = await service.createRepository();
    await service.refreshTavernChatWorkspace();
    return service;
  }

  static async restore(
    options: SessionServiceOptions,
    runtime: PersistedSessionRuntime,
  ): Promise<CardAgentSessionService> {
    const initial = await options.adapter.read();
    const service = new CardAgentSessionService(options, initial, runtime.compiledPreset, { runtime });
    service.repository = await service.createRepository();
    await service.refreshTavernChatWorkspace();
    if (runtime.status === 'running' || runtime.status === 'waiting-approval' || runtime.status === 'abnormal') {
      service.status = 'abnormal';
      service.lastError = '上次页面在任务完成前关闭，已恢复到最后一个成功步骤。';
      service.completeRunUi('abnormal', service.now());
      service.buildRunner('failed', recoverPendingRunnerStep(service.modelMessages, service.events));
      service.ui.push({
        at: service.now(),
        checkpointId: service.activeCheckpointId,
        content: service.lastError,
        id: crypto.randomUUID(),
        kind: 'status',
        status: 'failed',
      });
      await service.persist();
    } else if (runtime.status === 'failed' || runtime.status === 'stopped' || runtime.status === 'context-exhausted') {
      service.lastError ??=
        runtime.status === 'failed' ? '上次模型步骤失败，可从中断处继续或回退本轮消息。' : undefined;
      service.buildRunner(runtime.status, recoverPendingRunnerStep(service.modelMessages, service.events));
    }
    return service;
  }

  view(): SessionView {
    const canWriteNonCharacterResources = this.canWriteNonCharacterResources();
    return {
      agentConfiguration: klona(this.agentConfiguration),
      bindingId: this.bindingId,
      characterName: this.characterName,
      contextUsage: this.runner?.state.contextUsage ?? measureContext(this.modelMessages, this.contextWindow),
      error: this.lastError,
      events: klona(this.events),
      mode: this.mode,
      modelControls: klona(this.modelControls),
      modelSelection: this.modelSelection ? klona(this.modelSelection) : undefined,
      runModelSelection: this.runModelSelection ? klona(this.runModelSelection) : undefined,
      operationLog: this.operationLog.export(),
      operationReplay: this.pendingOperationReplay
        ? {
            conflicts: klona(this.pendingOperationReplay.conflicts),
            direction: this.pendingOperationReplay.direction,
            turnId: this.pendingOperationReplay.turnId,
          }
        : undefined,
      preset: klona(this.preset),
      renderPreviews: klona(this.renderPreviews),
      scope: this.scope,
      sessionId: this.sessionId,
      skills: klona(this.skills),
      status: this.status,
      tavernChats: this.tavernChatWorkspace?.exportRuntime(),
      title: this.title,
      ui: klona(this.ui.filter(item => !item.hidden)).map(item => ({
        ...item,
        attachments: item.attachments?.map(attachment => ({
          ...attachment,
          missing: Boolean(attachment.fileId && this.workspaceStore && !this.workspaceStore.getReference(attachment.fileId)),
        })),
      })),
      warnings: [...this.warnings],
      workingFiles: (this.repository?.snapshot() ?? []).map(file => ({
        ...file,
        readonly: file.readonly || (!canWriteNonCharacterResources && isNonCharacterResourcePath(file.path)),
      })),
    };
  }

  setMode(mode: SessionMode): void {
    this.mode = mode;
    this.notify();
  }

  async setModelControls(controls: Partial<SessionModelControls>): Promise<void> {
    if (!this.updateModelControls(controls)) return;
    await this.persist();
  }

  /** 只更新内存视图；由Runtime合并短时间内的连续切换并负责持久化。 */
  updateModelControls(controls: Partial<SessionModelControls>): boolean {
    const next = {
      reasoningEffort: controls.reasoningEffort ?? this.modelControls.reasoningEffort,
      webSearch: controls.webSearch ?? this.modelControls.webSearch,
    };
    if (canonicalEqual(next, this.modelControls)) return false;
    this.modelControls = next;
    this.notify();
    return true;
  }

  updateModelSelection(selection?: ModelSelection): boolean {
    const next = selection ? klona(selection) : undefined;
    if (canonicalEqual(next, this.modelSelection)) return false;
    this.modelSelection = next;
    this.notify();
    return true;
  }

  updateRunModelSelection(selection?: ModelSelection): void {
    this.runModelSelection = selection ? klona(selection) : undefined;
  }

  async save(): Promise<void> {
    await this.persist();
  }

  async refreshManagedFiles(): Promise<SessionView> {
    if (this.activeCheckpointId || !['completed', 'idle'].includes(this.status)) return this.view();
    const current = await this.adapter.read();
    this.assertBinding(current);
    await this.reloadStorageFiles();
    this.repository = await this.createRepository(current);
    this.notify();
    return this.view();
  }

  async rename(title: string): Promise<SessionView> {
    const normalized = title.trim().replace(/\s+/gu, ' ');
    if (!normalized) throw new Error('会话名称不能为空。');
    this.title = Array.from(normalized).slice(0, 80).join('');
    await this.persist();
    return this.view();
  }

  async applyPreset(preset: StructuredPreset): Promise<void> {
    if (this.runner && ['running', 'waiting-approval'].includes(this.runner.state.status)) {
      throw new Error('Agent运行期间不能替换预设头部。');
    }
    await this.finalizeManualEdits();
    this.preset = klona(preset);
    this.agentConfiguration.presetId = preset.id;
    await this.refreshCompiledHeader();
    await this.persist();
  }

  async applyAgentConfiguration(
    configuration: SessionAgentConfiguration,
    preset: StructuredPreset,
    availableSkills: AgentSkill[],
  ): Promise<void> {
    if (
      this.activeCheckpointId ||
      ['running', 'waiting-approval'].includes(this.status)
    ) {
      throw new Error('当前轮次结束前不能替换Agent配置。');
    }
    await this.finalizeManualEdits();
    const current = await this.adapter.read();
    this.assertBinding(current);
    this.agentConfiguration = klona(configuration);
    this.preset = klona(preset);
    this.skills = mountConfiguredSkills(configuration, availableSkills);
    this.repository = await this.createRepository(current);
    await this.refreshCompiledHeader();
    await this.persist();
  }

  /** 同步当前会话绑定配置的最新版；下一次模型调用直接使用新头部、Skill与工具。 */
  async syncAgentConfiguration(
    configuration: SessionAgentConfiguration,
    preset: StructuredPreset,
    availableSkills: AgentSkill[],
  ): Promise<void> {
    if (
      this.activeCheckpointId ||
      ['running', 'waiting-approval'].includes(this.status)
    ) {
      throw new Error('当前轮次结束前不能同步Agent配置。');
    }
    await this.finalizeManualEdits();
    const mounted = mountConfiguredSkills(configuration, availableSkills);
    const resourcesChanged = !canonicalEqual(this.skills, mounted);
    const configurationChanged = !canonicalEqual(this.agentConfiguration, configuration);
    const presetChanged = !canonicalEqual(this.preset, preset);
    if (!resourcesChanged && !configurationChanged && !presetChanged) return;
    const previousSkillIds = new Set(this.agentConfiguration.skills.filter(skill => skill.enabled).map(skill => skill.id));
    const nextSkillIds = new Set(configuration.skills.filter(skill => skill.enabled).map(skill => skill.id));
    const skillChanges = new Set(
      [...previousSkillIds].filter(id => !nextSkillIds.has(id)).concat(
        [...nextSkillIds].filter(id => !previousSkillIds.has(id)),
      ),
    ).size;
    const previousTools = new Set(this.agentConfiguration.toolIds);
    const nextTools = new Set(configuration.toolIds);
    const toolChanges = new Set(
      [...previousTools].filter(id => !nextTools.has(id)).concat([...nextTools].filter(id => !previousTools.has(id))),
    ).size;
    this.agentConfiguration = klona(configuration);
    this.preset = klona(preset);
    this.skills = klona(mounted);
    if (resourcesChanged) {
      const current = await this.adapter.read();
      this.assertBinding(current);
      this.repository = await this.createRepository(current);
    }
    await this.refreshCompiledHeader();
    if (this.runner) this.buildRunner(this.runner.state.status, this.runner.state.pending);
    if (this.hasConversationMessages()) {
      const details = [
        presetChanged ? '预设' : '',
        skillChanges > 0 ? `${skillChanges}个Skill` : '',
        toolChanges > 0 ? `${toolChanges}个工具` : '',
      ].filter(Boolean);
      this.ui.push({
        at: this.now(),
        content: `Agent配置已更新${details.length ? ` · ${details.join('、')}发生变化` : ''}`,
        id: `agent-configuration:${crypto.randomUUID()}`,
        kind: 'status',
        status: 'completed',
      });
    }
    await this.persist();
  }

  async setExecutor(
    executor: ModelStepExecutor,
    contextWindow = this.contextWindow,
    visionEnabled = this.modelVisionEnabled,
  ): Promise<void> {
    if (this.runner && ['running', 'waiting-approval'].includes(this.runner.state.status)) {
      throw new Error('Agent运行期间不能切换API Profile。');
    }
    this.executor = executor;
    this.contextWindow = contextWindow;
    this.modelVisionEnabled = visionEnabled;
    if (this.runner && ['failed', 'stopped', 'context-exhausted'].includes(this.runner.state.status)) {
      this.buildRunner(this.runner.state.status, this.runner.state.pending);
    }
    await this.persist();
  }

  setModelVisionEnabled(enabled: boolean): void {
    this.modelVisionEnabled = enabled;
  }

  async setSkills(skills: AgentSkill[]): Promise<void> {
    if (
      this.activeCheckpointId ||
      ['running', 'waiting-approval'].includes(this.status)
    ) {
      throw new Error('当前轮次结束前不能更新全局Skill挂载。');
    }
    await this.finalizeManualEdits();
    const mounted = mountConfiguredSkills(this.agentConfiguration, skills);
    if (canonicalEqual(this.skills, mounted)) return;
    const current = await this.adapter.read();
    this.assertBinding(current);
    this.skills = klona(mounted);
    this.repository = await this.createRepository(current);
    await this.refreshCompiledHeader();
    if (this.runner) this.buildRunner(this.runner.state.status, this.runner.state.pending);
    await this.persist();
  }

  async uploadWorkspaceFiles(targetDirectory: string, inputs: SessionAttachmentInput[]): Promise<SessionView> {
    if (!this.workspaceStore || !this.repository) throw new Error('当前环境没有可用的梦境创客文件存储。');
    if (!/^\/(?:files|character\/files)(?:\/|$)/u.test(targetDirectory)) {
      throw new Error('玩家上传只能保存到/files或/character/files。');
    }
    await this.finalizeManualEdits();
    this.mutationActor = 'user';
    try {
      for (const input of inputs) {
        const staging = await this.workspaceStore.putTemp({
          bindingId: this.storageBindingId(),
          bytes: Uint8Array.from(atob(input.data), character => character.charCodeAt(0)),
          global: this.scope === 'global',
          logicalPath: `_staging/${crypto.randomUUID()}/${input.filename}`,
          mediaType: input.mediaType,
          sessionId: this.sessionId,
        });
        const path = `${targetDirectory.replace(/\/$/u, '')}/${input.filename}`;
        await this.repository.stageFile({
          content: '',
          external: {
            fileId: staging.fileId,
            mediaType: staging.mediaType,
            scope: staging.scope,
            sha256: staging.sha256,
            size: staging.size,
          },
          mediaType: input.mediaType,
          path,
          readonly: false,
          resourceId: crypto.randomUUID(),
        }, `player-upload:${crypto.randomUUID()}`);
      }
    } finally {
      this.mutationActor = 'agent';
    }
    this.status = 'completed';
    await this.persist();
    return this.view();
  }

  async setWorkspaceAvatar(sourcePath: string, target: 'character' | { userName: string }): Promise<SessionView> {
    if (!this.repository) throw new Error('工作区尚未初始化。');
    const targetPath = target === 'character'
      ? '/character/avatar.png'
      : `/users/${encodeWorkspaceSegment(target.userName)}.avatar.png`;
    this.mutationActor = 'user';
    try {
      await this.repository.replaceReadonlyBinary(targetPath, sourcePath, `player-avatar:${crypto.randomUUID()}`);
    } finally {
      this.mutationActor = 'agent';
    }
    this.status = 'completed';
    await this.persist();
    return this.view();
  }

  async send(
    message: string,
    userMessageId: string = crypto.randomUUID(),
    attachmentInputs: SessionAttachmentInput[] = [],
  ): Promise<SessionView> {
    const text = message.trim();
    if (!text && attachmentInputs.length === 0) throw new Error('请输入要交给Agent的要求，或添加附件。');
    if (this.runner && ['running', 'waiting-approval'].includes(this.runner.state.status))
      throw new Error('Agent已经在运行。');
    if (this.activeCheckpointId) {
      throw new Error('当前轮次尚未结束，请从中断处继续，或回退这条用户消息后再发送新要求。');
    }
    await this.reloadStorageFiles();
    const attachments = this.attachmentStore
      ? await this.attachmentStore.save(this.sessionId, attachmentInputs)
      : storeSessionAttachments(attachmentInputs);
    await this.finalizeManualEdits();
    this.lock.acquire(this.sessionId);
    try {
      if (this.title === DEFAULT_SESSION_TITLE && !this.ui.some(item => item.kind === 'user')) {
        this.title = sessionTitleFromMessage(text || attachments[0]?.filename || '');
      }
      const base = await this.adapter.read();
      this.assertBinding(base);
      const turnId = crypto.randomUUID();
      this.activeCheckpointId = turnId;
      this.operationLog.beginTurn(turnId, {
        eventStart: this.events.length,
        modelMessageStart: this.modelMessages.length,
        userMessageId,
      });
      attachments.forEach(attachment => {
        this.attachments[attachment.id] = attachment;
      });
      const attachmentSummaries = attachments.map(attachmentSummary);
      const existing = this.ui.find(item => item.id === userMessageId && item.kind === 'user');
      if (existing) {
        existing.at = this.now();
        existing.content = text;
        existing.attachments = attachmentSummaries;
        existing.checkpointId = turnId;
        existing.hidden = false;
        delete existing.durationMs;
        delete existing.runStatus;
      } else {
        this.ui.push({
          at: this.now(),
          attachments: attachmentSummaries,
          checkpointId: turnId,
          content: text,
          id: userMessageId,
          kind: 'user',
        });
      }
      if (attachments.length > 0) {
        this.ui.push({
          at: this.now(),
          checkpointId: turnId,
          content: JSON.stringify({
            changes: attachments.map(attachment => ({
              after: `<${attachment.mediaType}，${attachment.size} bytes>`,
              kind: 'write',
              path: attachment.logicalPath ?? `/files/${attachment.filename}`,
            })),
          }),
          id: `attachment:${crypto.randomUUID()}`,
          kind: 'manual',
          manualStatus: 'active',
          status: 'completed',
          toolName: '玩家添加文件',
        });
      }
      this.syncUiVisibility();
      await this.reloadStorageFiles();
      this.repository = await this.createRepository(base);
      this.tavernChatWorkspace?.resetRunAuthorization();
      await this.refreshTavernChatWorkspace();
      this.buildRunner();
      const state = await this.runner!.start(userContentWithAttachments(text, attachments));
      this.modelMessages = klona(state.messages);
      this.status = state.status;
      this.lastError = state.failure;
      if (state.status === 'completed') {
        await this.completeRealtimeTurn();
      }
      await this.persist();
      return this.view();
    } finally {
      this.lock.release(this.sessionId);
    }
  }

  async resume(): Promise<SessionView> {
    if (!this.runner) throw new Error('当前会话没有可恢复的Runner。');
    this.lock.acquire(this.sessionId);
    try {
      this.tavernChatWorkspace?.resetRunAuthorization();
      await this.refreshTavernChatWorkspace();
      this.buildRunner(this.runner.state.status, this.runner.state.pending);
      const state = await this.runner.resume();
      this.modelMessages = klona(state.messages);
      this.status = state.status;
      this.lastError = state.failure;
      if (state.status === 'completed' && this.repository) {
        await this.completeRealtimeTurn();
      }
      await this.persist();
      return this.view();
    } finally {
      this.lock.release(this.sessionId);
    }
  }

  stop(): void {
    this.runner?.stop();
  }

  enqueueGuidance(message: string): void {
    if (!this.runner || !['running', 'waiting-approval'].includes(this.runner.state.status)) {
      throw new Error('当前没有正在运行的Agent步骤。');
    }
    this.runner.enqueueGuidance(message);
  }

  async undo(): Promise<SessionView> {
    this.assertHistoryRestoreAllowed();
    await this.finalizeManualEdits();
    return this.replayLatestOperations('undo');
  }

  async undoToUserMessage(messageId: string): Promise<SessionView> {
    this.assertHistoryRestoreAllowed();
    await this.finalizeManualEdits();
    const latestVisible = [...this.ui].reverse().find(item => !item.hidden);
    const user = this.ui.find(item => item.id === messageId && item.kind === 'user' && !item.hidden);
    if (!user?.checkpointId) throw new Error('该用户消息当前不能回退。');
    if (latestVisible?.checkpointId !== user.checkpointId) throw new Error('只能回退最新一轮消息。');
    const records = this.operationLog.recordsForTurn(user.checkpointId).filter(record => record.state === 'applied');
    if (!this.repository) throw new Error('实时文件工作区尚未初始化。');
    const plan = await planOperationReplay(this.repository, records, 'undo');
    if (plan.conflicts.length > 0) {
      this.pendingOperationReplay = {
        after: { kind: 'undo-message', messageId },
        conflicts: plan.conflicts,
        direction: 'undo',
        turnId: user.checkpointId,
      };
      this.notify();
      return this.view();
    }
    await this.replayTurn(user.checkpointId, 'undo', [], false);
    return this.finishMessageUndo(messageId, user.checkpointId);
  }

  async redo(): Promise<SessionView> {
    this.assertHistoryRestoreAllowed();
    await this.finalizeManualEdits();
    return this.replayLatestOperations('redo');
  }

  async confirmOperationReplay(continueWithoutConflicts: boolean): Promise<SessionView> {
    const pending = this.pendingOperationReplay;
    if (!pending) throw new Error('当前没有等待确认的撤销或重做。');
    if (!continueWithoutConflicts) {
      this.pendingOperationReplay = undefined;
      this.notify();
      return this.view();
    }
    await this.replayTurn(pending.turnId, pending.direction, pending.conflicts.map(item => item.operationId), false);
    if (pending.after?.kind === 'undo-message') return this.finishMessageUndo(pending.after.messageId, pending.turnId);
    await this.persist();
    return this.view();
  }

  async writeWorkingFile(
    path: string,
    content: string,
    overwriteConflict = false,
    expectedContent?: string,
  ): Promise<SessionView> {
    this.assertManualResourceWrite(path);
    return this.applyManualWorkspaceChange({ content, expectedContent, kind: 'write', overwriteConflict, path });
  }

  async useCurrentWorkingFile(path: string): Promise<SessionView> {
    const current = await this.adapter.read();
    this.assertBinding(current);
    if (isStoragePath(path)) {
      await this.reloadStorageFiles();
      if (!this.storageFiles.some(file => file.path === path)) throw new Error(`当前文件存储中不存在文件：${path}`);
      this.repository = await this.createRepository(current);
      this.notify();
      return this.view();
    }
    const file = projectCardWorkspace(current, 100, { allowNonCharacterWrites: true }).find(item => item.path === path);
    if (!file) throw new Error(`当前实际数据中不存在文件：${path}`);
    this.repository = await this.createRepository(current);
    this.notify();
    return this.view();
  }

  async deleteWorkingPath(path: string): Promise<SessionView> {
    this.assertManualResourceWrite(path);
    return this.applyManualWorkspaceChange({ kind: 'delete', path });
  }

  async finalizeManualEdits(): Promise<void> {
    if (!this.manualEditGroup) return;
    this.manualEditGroup = undefined;
    await this.persist();
  }

  private async applyManualWorkspaceChange(input: {
    content?: string;
    expectedContent?: string;
    kind: 'delete' | 'write';
    overwriteConflict?: boolean;
    path: string;
  }): Promise<SessionView> {
    if (['running', 'waiting-approval'].includes(this.status)) {
      throw new Error('Agent运行或工具确认期间不能手动编辑实时文件。');
    }
    if (!this.repository) this.repository = await this.createRepository();
    const currentFile = await this.repository.read(input.path).catch(() => undefined);
    if (
      input.kind === 'write' &&
      !input.overwriteConflict &&
      input.expectedContent !== undefined &&
      currentFile?.content !== input.expectedContent &&
      currentFile?.content !== input.content
    ) {
      throw new Error(
        `MANUAL_EDIT_CONFLICT：${input.path}\nBase：${input.expectedContent}\nCurrent：${currentFile?.content ?? '<不存在>'}\nPlayer：${input.content ?? ''}`,
      );
    }
    const group = await this.ensureManualEditGroup();
    const toolCallId = `manual:${crypto.randomUUID()}`;
    this.mutationActor = 'user';
    try {
      if (input.kind === 'write') {
        await this.repository.write(input.path, input.content ?? '', toolCallId, { overwrite: true });
      } else {
        await this.repository.remove(input.path, toolCallId);
      }
    } catch (error) {
      group.files[input.path] = {
        after: input.kind === 'write' ? input.content ?? '' : undefined,
        before: currentFile?.content,
        error: error instanceof Error ? error.message : String(error),
        kind: input.kind,
        path: input.path,
      };
      this.updateManualUi(group, 'failed');
      await this.persist();
      return this.view();
    } finally {
      this.mutationActor = 'agent';
    }
    const previous = group.files[input.path];
    group.files[input.path] = {
      after: input.kind === 'write' ? input.content ?? '' : undefined,
      before: previous?.before ?? currentFile?.content,
      kind: input.kind,
      path: input.path,
    };
    await this.updateManualModelMessage(group);
    this.updateManualUi(group, 'active');
    this.status = 'completed';
    await this.persist();
    return this.view();
  }

  editUserMessage(messageId: string, content: string): void {
    const item = this.ui.find(message => message.id === messageId && message.kind === 'user');
    if (!item) throw new Error(`用户消息不存在：${messageId}`);
    item.content = content;
    this.notify();
  }

  async resend(messageId: string): Promise<SessionView> {
    const item = this.ui.find(message => message.id === messageId && message.kind === 'user');
    if (!item) throw new Error(`用户消息不存在：${messageId}`);
    const attachments = await Promise.all((item.attachments ?? []).map(async summary => {
      const attachment = this.attachments[summary.id];
      if (!attachment) throw new Error(`附件内容已经丢失：${summary.filename}`);
      if (this.attachmentStore) return this.attachmentStore.loadInput(attachment);
      if (!attachment.data) throw new Error(`附件内容已经丢失：${summary.filename}`);
      return {
        data: attachment.data,
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        size: attachment.size,
      };
    }));
    return this.send(item.content, messageId, attachments);
  }

  private async createRepository(_state?: CardWorkspaceState): Promise<LiveWorkspaceRepository> {
    const source = new SessionWorkspaceLiveSource({
      bindingId: this.bindingId,
      cardSource: new CardWorkspaceLiveSource(this.adapter, {
        synchronizeMetadata: this.scope !== 'global',
      }),
      decorate: files => this.decorateWorkspace(files),
      getSkills: () => this.skills,
      getStorageBindingId: this.storageBindingId,
      getStorageFiles: () => this.storageFiles,
      onSkillsCommit: this.onSkillsCommit,
      sessionId: this.sessionId,
      setSkills: skills => {
        this.skills = klona(skills);
        const configured = new Set(this.agentConfiguration.skills.map(skill => skill.id));
        this.agentConfiguration.skills.push(
          ...skills
            .filter(skill => !configured.has(skill.id))
            .map(skill => ({ enabled: true, id: skill.id, loading: skill.loading })),
        );
      },
      setStorageFiles: files => {
        this.storageFiles = klona(files);
      },
      workspaceStore: this.workspaceStore,
      tavernSource: this.tavernBridge
          ? new TavernWorkspaceLiveSource({
            backupBinary: (file, toolCallId) => this.backupWorkspaceBinary(file, toolCallId),
            bridge: this.tavernBridge,
            mountedPresets: this.mountedPresets,
            readBinary: file => this.readWorkspaceBinary(file),
          })
        : undefined,
    });
    const repository = new LiveWorkspaceRepository({
      completedToolCallIds: this.operationLog
        .export()
        .records.filter(record => record.state === 'applied')
        .map(record => record.toolCallId),
      onCommitted: (result, toolCallId) => this.recordRealtimeMutation(result, toolCallId),
      readonlyRoots: ['/context', '/skills/builtin'],
      source,
    });
    await repository.initialize();
    this.tavernChatWorkspace?.projectCached(repository);
    return repository;
  }

  private decorateWorkspace(files: WorkspaceFile[]): WorkspaceFile[] {
    const hasCharacter = Boolean(this.tavernBridge?.getCurrentCharacterId() && !this.tavernBridge.getGroupId());
    const visible =
      this.scope === 'global' && !hasCharacter
        ? files.filter(file => !file.path.startsWith('/character/') && file.path !== '/worldbooks/bindings.yaml')
        : files;
    const mountedWorldbooks = visible
      .filter(file => /^\/worldbooks\/[^/]+\/book\.yaml$/u.test(file.path))
      .map(file => file.path.split('/')[2]);
    const environment = [
      '# 当前工作区环境',
      '',
      `- 会话类型：${this.scope === 'global' ? '全局会话' : '角色会话'}`,
      `- 当前角色：${hasCharacter ? this.tavernBridge?.getCurrentCharacterName() ?? '未知' : '未打开'}`,
      `- 当前User：${this.tavernBridge?.getCurrentPersonaName() ?? '未选择'}`,
      `- 当前User文件：${this.tavernBridge?.getCurrentPersonaName() ? `/users/${this.tavernBridge.getCurrentPersonaName()}.md` : '未挂载'}`,
      `- 角色目录：${hasCharacter ? '/character' : '未挂载'}`,
      `- 已挂载世界书：${mountedWorldbooks.length > 0 ? mountedWorldbooks.join('、') : '无'}`,
      '- 全局持久文件：/files',
      `- 角色持久文件：${hasCharacter ? '/character/files' : '未挂载'}`,
      '- 正则：/regexes/{character,preset-current,global}',
      '- 酒馆助手脚本：/scripts/{character,preset-current,global}',
      `- 当前酒馆预设：${this.tavernBridge?.getLoadedPresetName() || '未知'}（/presets/current）`,
      `- 额外挂载预设：${this.mountedPresets.size ? [...this.mountedPresets].join('、') : '无'}（/presets/library）`,
      '',
      '角色切换、聊天切换和世界书挂载会动态改变本文件；需要最新状态时请重新读取。',
    ].join('\n');
    return [
      ...visible.filter(file => file.path !== '/context/environment.md'),
      {
        content: environment,
        mediaType: 'text/markdown',
        path: '/context/environment.md',
        readonly: true,
        resourceId: 'context:environment',
      },
    ];
  }

  private async recordRealtimeMutation(
    result: NonNullable<ReturnType<LiveWorkspaceRepository['mutationResult']>>,
    toolCallId: string,
  ): Promise<void> {
    if (this.replayingOperations) return;
    const turnId = this.activeCheckpointId ?? `manual:${crypto.randomUUID()}`;
    this.operationLog.beginTurn(turnId);
    for (const change of result.changes) {
      if (
        change.path.startsWith('/temp/') ||
        change.path.startsWith('/character/temp/') ||
        change.path.startsWith('/character/chats/')
      )
        continue;
      this.operationLog.append(
        await createWorkspaceOperationRecord({
          actor: this.mutationActor,
          approvalMode: this.mode === 'full' ? 'full' : this.mode === 'yolo' ? 'yolo' : 'manual',
          change,
          toolCallId,
          turnId,
          undoable: result.status !== 'uncertain',
          warning: result.warning,
        }),
      );
    }
    const recoverySaved = await this.operationRecovery.persist(this.sessionId, turnId, this.operationLog.export());
    if (!recoverySaved) {
      this.operationLog.setRecoveryAvailable(turnId, false);
      this.warnings = [
        ...new Set([...this.warnings, '浏览器临时恢复记录写入失败：本轮后续不再重试，Undo/Redo可能不可用。']),
      ];
    }
    if (result.status !== 'success' && result.warning) {
      this.warnings = [...new Set([...this.warnings, result.warning])];
    }
  }

  private async replayLatestOperations(direction: OperationReplayDirection): Promise<SessionView> {
    const latest = this.operationLog.latestTurn();
    if (!latest || latest.operationIds.length === 0) {
      throw new Error(direction === 'undo' ? '最新一轮没有可撤销的文件修改。' : '最新一轮没有可重做的文件修改。');
    }
    const records = this.operationLog
      .recordsForTurn(latest.turnId)
      .filter(record =>
        direction === 'undo'
          ? record.state === 'applied'
          : record.state === 'undone' && latest.redoOperationIds.includes(record.operationId),
      );
    if (records.length === 0) {
      throw new Error(direction === 'undo' ? '最新一轮修改已经撤销。' : '最新一轮没有可重做的修改。');
    }
    if (!latest.recoveryAvailable) throw new Error('本轮恢复记录不可用，不能安全撤销或重做。');
    if (!this.repository) throw new Error('实时文件工作区尚未初始化。');
    const plan = await planOperationReplay(this.repository, records, direction);
    if (plan.conflicts.length > 0) {
      this.pendingOperationReplay = { conflicts: plan.conflicts, direction, turnId: latest.turnId };
      this.notify();
      return this.view();
    }
    return this.replayTurn(latest.turnId, direction, []);
  }

  private async replayTurn(
    turnId: string,
    direction: OperationReplayDirection,
    skipOperationIds: string[],
    persist = true,
  ): Promise<SessionView> {
    if (!this.repository) throw new Error('实时文件工作区尚未初始化。');
    const records = this.operationLog
      .recordsForTurn(turnId)
      .filter(record => (direction === 'undo' ? record.state === 'applied' : record.state === 'undone'));
    this.replayingOperations = true;
    try {
      const result = await executeOperationReplay({ direction, records, repository: this.repository, skipOperationIds });
      if (direction === 'undo') this.operationLog.markUndone(turnId, result.appliedOperationIds);
      else this.operationLog.markRedone(turnId, result.appliedOperationIds);
      this.pendingOperationReplay = undefined;
      if (result.failed.length > 0) {
        this.warnings = [
          ...new Set([...this.warnings, ...result.failed.map(item => `${item.path}：${item.reason}`)]),
        ];
      }
      const recoverySaved = await this.operationRecovery.persist(this.sessionId, turnId, this.operationLog.export());
      if (!recoverySaved) this.operationLog.setRecoveryAvailable(turnId, false);
      if (persist) await this.persist();
      this.notify();
      return this.view();
    } finally {
      this.replayingOperations = false;
    }
  }

  private async finishMessageUndo(messageId: string, turnId: string): Promise<SessionView> {
    const turn = this.operationLog.turn(turnId);
    if (!turn) throw new Error('消息对应的操作轮次已经丢失。');
    if (turn.modelMessageStart !== undefined) this.modelMessages = this.modelMessages.slice(0, turn.modelMessageStart);
    if (turn.eventStart !== undefined) this.events = this.events.slice(0, turn.eventStart);
    for (const item of this.ui) {
      if (item.checkpointId !== turnId) continue;
      if (item.id === messageId && item.kind === 'user') {
        item.hidden = false;
        delete item.durationMs;
        delete item.runStatus;
      } else {
        item.hidden = true;
      }
    }
    this.activeCheckpointId = undefined;
    this.runModelSelection = undefined;
    // 消息回退会移除该轮Agent上下文，不能只重做文件而留下缺失的Agent消息。
    this.operationLog.discardRedo(turnId);
    this.runner = undefined;
    this.status = 'completed';
    this.lastError = undefined;
    await this.persist();
    return this.view();
  }

  private buildRunner(initialStatus: RunnerStatus = 'idle', initialPending?: PendingRunnerStep): void {
    if (!this.repository) throw new Error('实时文件工作区尚未初始化。');
    const journal = new PersistentRunnerJournal(this.events, async events => {
      this.events = events;
      this.consumeLatestEvent(events.at(-1)!);
      this.modelMessages = klona(this.runner?.state.messages ?? this.modelMessages);
      this.notify();
    });
    this.runner = new AgentRunner({
      compactionEnabled: this.agentConfiguration.toolIds.includes('compact_context'),
      contextWindow: this.contextWindow,
      executor: this.executor,
      headerMessageCount: this.headerMessageCount,
      initialMessages: this.modelMessages,
      initialPending,
      initialStatus,
      journal,
      modelControls: klona(this.modelControls),
      now: this.now,
      onReasoningDelta: delta => this.appendStreamingReasoning(delta),
      onTextDelta: delta => this.appendStreamingText(delta),
      onToolInputDelta: update => this.appendStreamingToolInput(update),
      onToolInputReady: call => this.completeStreamingToolInput(call),
      onToolInputStarted: call => this.startStreamingToolInput(call),
      requestApproval: request =>
        this.requestToolApproval?.({ ...request, sessionId: this.sessionId }) ?? Promise.resolve(false),
      prepareMessages: this.attachmentStore
        ? messages => this.attachmentStore!.prepareMessages(this.sessionId, messages, {
            sendImages: this.modelVisionEnabled,
          })
          : undefined,
      refreshCompactionHeader: () => this.compileCompactionHeader(),
      tools: [
        ...createWorkspaceRunnerTools(
          this.repository,
          this.skills.map(skill => skill.id),
          {
            approvalMode: () => (this.mode === 'full' ? 'full' : this.mode === 'yolo' ? 'yolo' : 'manual'),
            canWriteNonCharacterResources: this.canWriteNonCharacterResources,
            chatWorkspace: this.tavernChatWorkspace,
            lockedSkillIds: this.skills.filter(skill => skill.locked).map(skill => skill.id),
            isYolo: () => this.mode === 'yolo',
          },
        ),
        ...(this.tavernBridge
          ? createWorldbookRunnerTools(this.repository, this.tavernBridge, {
              approvalMode: () => (this.mode === 'full' ? 'full' : this.mode === 'yolo' ? 'yolo' : 'manual'),
              getBaseState: () => this.adapter.read(),
              onMount: name => this.mountedWorldbooks.add(name),
              onUnmount: name => this.mountedWorldbooks.delete(name),
              chatBindingConfirmation: (input, toolCallId) => {
                const changesChatBinding = Boolean((input as { chat?: unknown } | undefined)?.chat);
                if (
                  !changesChatBinding ||
                  this.mode === 'yolo' ||
                  !this.tavernChatWorkspace?.needsAuthorization()
                ) {
                  return undefined;
                }
                return {
                  description: '本次运行将直接修改酒馆聊天绑定的世界书；聊天改动不能用梦境创客Undo。',
                  toolCallId,
                  toolName: 'set_worldbook_binding',
                };
              },
              setChatBinding: this.tavernChatWorkspace
                ? async (chatId, worldbook, toolCallId) => {
                    this.tavernChatWorkspace!.authorizeRun();
                    await this.tavernChatWorkspace!.executeOnce(toolCallId, () =>
                      this.tavernChatWorkspace!.setWorldbook(chatId, worldbook, this.repository!),
                    );
                  }
                : undefined,
            })
          : []),
        ...(this.tavernBridge
          ? [
              ...createPresetRunnerTools(this.repository, this.tavernBridge, {
                approvalMode: () => (this.mode === 'full' ? 'full' : this.mode === 'yolo' ? 'yolo' : 'manual'),
                mountedPresets: this.mountedPresets,
              }),
              ...createAvatarRunnerTools(
                this.repository,
                this.tavernBridge,
                () => (this.mode === 'full' ? 'full' : this.mode === 'yolo' ? 'yolo' : 'manual'),
              ),
            ]
          : []),
        ...(this.tavernChatWorkspace
          ? createTavernChatRunnerTools(this.repository, this.tavernChatWorkspace, {
              approvalMode: () => (this.mode === 'full' ? 'full' : this.mode === 'yolo' ? 'yolo' : 'manual'),
              beforeGeneration: async () => true,
              isYolo: () => this.mode === 'yolo',
              resolveFileUrl: fileId => this.workspaceStore?.getReference(fileId)?.url,
            })
          : []),
        ...(this.scope === 'global' && this.tavernBridge
          ? createCharacterRunnerTools(this.tavernBridge, {
              approvalMode: () => (this.mode === 'full' ? 'full' : this.mode === 'yolo' ? 'yolo' : 'manual'),
              beforeClose: async () => {
                const current = await this.adapter.read();
                [current.bindings.primary, ...current.bindings.additional, current.bindings.chat]
                  .filter((name): name is string => Boolean(name))
                  .forEach(name => this.mountedWorldbooks.delete(name));
              },
              onChanged: async () => {
                await this.onCharacterChanged?.();
                if (!this.repository) return;
                await this.reloadStorageFiles();
                if (this.tavernChatWorkspace && this.tavernBridge?.getCurrentCharacterId()) {
                  await this.tavernChatWorkspace.resetForCurrentCharacter(this.repository);
                } else {
                  this.repository.replaceProjection('/character/chats', []);
                }
                this.notify();
              },
            })
          : []),
        ...(this.resourceBaseUrl
          ? createProjectRunnerTools(this.repository, {
              approvalMode: () => (this.mode === 'full' ? 'full' : this.mode === 'yolo' ? 'yolo' : 'manual'),
              canWriteNonCharacterResources: this.canWriteNonCharacterResources,
              resourceBaseUrl: this.resourceBaseUrl,
            })
          : []),
        ...createPlaygroundRunnerTools(this.repository, {
          approvalMode: () => (this.mode === 'full' ? 'full' : this.mode === 'yolo' ? 'yolo' : 'manual'),
          prepareRender: render => {
            this.renderPreviews[render.renderId] = klona(render);
          },
        }),
      ].filter(tool => isAgentToolId(tool.name) && this.agentConfiguration.toolIds.includes(tool.name)),
    });
  }

  private assertManualResourceWrite(path: string): void {
    if (isNonCharacterResourcePath(path) && !this.canWriteNonCharacterResources()) {
      throw new Error('该路径属于全局或当前预设资源。请在常规设置中显式启用红色的危险写入权限后再修改。');
    }
  }

  private async ensureManualEditGroup(): Promise<ManualEditGroup> {
    if (this.manualEditGroup) return this.manualEditGroup;
    const checkpointId = this.activeCheckpointId ?? `manual:${crypto.randomUUID()}`;
    this.operationLog.beginTurn(checkpointId, {
      eventStart: this.events.length,
      modelMessageStart: this.modelMessages.length,
      userMessageId: checkpointId,
    });
    const uiItemId = `manual:${crypto.randomUUID()}`;
    this.manualEditGroup = {
      checkpointId,
      files: {},
      uiItemId,
    };
    this.ui.push({
      at: this.now(),
      checkpointId,
      content: '{}',
      id: uiItemId,
      kind: 'manual',
      manualStatus: 'active',
      status: 'completed',
      toolName: '玩家修改工作区',
    });
    return this.manualEditGroup;
  }

  private updateManualUi(group: ManualEditGroup, status: 'active' | 'failed' | 'undone'): void {
    const item = this.ui.find(candidate => candidate.id === group.uiItemId);
    if (!item) return;
    item.content = canonicalStringify({ changes: Object.values(group.files) });
    item.manualStatus = status;
    item.status = status === 'failed' ? 'failed' : 'completed';
  }

  private async updateManualModelMessage(group: ManualEditGroup): Promise<void> {
    const entries = await Promise.all(
      Object.values(group.files).map(async change => {
        const before = change.before === undefined ? undefined : (await maskSecretsForModel(change.before, change.path)).maskedContent;
        const after = change.after === undefined ? undefined : (await maskSecretsForModel(change.after, change.path)).maskedContent;
        return { after, before, kind: change.kind, path: change.path };
      }),
    );
    const unified = entries
      .map(change => {
        const before = change.before?.split(/\r\n|\n|\r/u) ?? [];
        const after = change.after?.split(/\r\n|\n|\r/u) ?? [];
        return [
          `--- a${change.path}`,
          `+++ b${change.path}`,
          `@@ -1,${before.length} +1,${after.length} @@`,
          ...before.map(line => `-${line}`),
          ...after.map(line => `+${line}`),
        ].join('\n');
      })
      .join('\n');
    const details = unified.length <= 6_000
      ? unified
      : `修改规模较大，请按需重新读取这些路径：\n${entries.map(change => `- ${change.kind} ${change.path}`).join('\n')}`;
    const content = [
      '<manual_workspace_changes>',
      '这是玩家对工作区的直接修改，不是新的创作目标。请把这些变化作为继续旧目标时的最新事实。',
      details,
      '</manual_workspace_changes>',
    ].join('\n');
    if (group.modelMessageIndex !== undefined && this.modelMessages[group.modelMessageIndex]?.role === 'user') {
      this.modelMessages[group.modelMessageIndex] = { content, role: 'user' };
    } else {
      group.modelMessageIndex = this.modelMessages.length;
      this.modelMessages.push({ content, role: 'user' });
    }
  }

  private async refreshCompiledHeader(): Promise<void> {
    const next = await compilePreset(
      this.preset,
      defaultPresetValues(this.skills, this.agentConfiguration.toolIds, this.scope),
    );
    this.modelMessages.splice(0, this.headerMessageCount, ...klona(next.messages));
    this.headerMessageCount = next.messages.length;
    this.compiledPreset = next;
  }

  private async compileCompactionHeader(): Promise<ModelMessage[]> {
    const next = await compilePreset(
      this.preset,
      defaultPresetValues(this.skills, this.agentConfiguration.toolIds, this.scope),
    );
    this.headerMessageCount = next.messages.length;
    this.compiledPreset = next;
    return klona(next.messages);
  }

  private hasConversationMessages(): boolean {
    return this.modelMessages.length > this.headerMessageCount;
  }

  private async completeRealtimeTurn(): Promise<void> {
    if (!this.activeCheckpointId) throw new Error('本轮完成时缺少操作边界。');
    const current = await this.adapter.read();
    this.assertBinding(current);
    this.activeCheckpointId = undefined;
    this.runModelSelection = undefined;
    this.status = 'completed';
    this.lastError = undefined;
    this.repository = await this.createRepository(current);
    this.manualEditGroup = undefined;
  }

  private assertHistoryRestoreAllowed(): void {
    const runnerActive = this.runner && ['running', 'waiting-approval'].includes(this.runner.state.status);
    if (runnerActive || ['running', 'waiting-approval'].includes(this.status)) {
      throw new Error('运行或审批期间不能回退历史。');
    }
  }

  private assertBinding(state: CardWorkspaceState): void {
    if (state.character.bindingId !== this.bindingId) {
      throw new Error(`当前角色卡与会话不匹配：需要 ${this.bindingId}，实际 ${state.character.bindingId}`);
    }
  }

  private appendStreamingText(delta: string): void {
    this.hasStreamedTextInCurrentStep = true;
    let item = [...this.ui]
      .reverse()
      .find(
        message =>
          message.checkpointId === this.activeCheckpointId &&
          message.kind === 'assistant' &&
          message.status === 'running',
      );
    if (!item) {
      item = {
        at: this.now(),
        checkpointId: this.activeCheckpointId,
        content: '',
        id: `stream:${this.activeCheckpointId}:${crypto.randomUUID()}`,
        kind: 'assistant',
        status: 'running',
      };
      this.ui.push(item);
    }
    item.content += delta;
    this.notifyStreaming();
  }

  private completeStreamingText(at: number, fallback = ''): void {
    const item = [...this.ui]
      .reverse()
      .find(
        message =>
          message.checkpointId === this.activeCheckpointId &&
          message.kind === 'assistant' &&
          message.status === 'running',
      );
    if (item) {
      if (!item.content) item.content = fallback;
      item.status = 'completed';
    } else if (fallback) {
      this.ui.push({
        at,
        checkpointId: this.activeCheckpointId,
        content: fallback,
        id: crypto.randomUUID(),
        kind: 'assistant',
        status: 'completed',
      });
    }
  }

  private appendStreamingReasoning(delta: string): void {
    this.hasStreamedReasoningInCurrentStep = true;
    let item = [...this.ui]
      .reverse()
      .find(
        message =>
          message.checkpointId === this.activeCheckpointId &&
          message.kind === 'reasoning' &&
          message.status === 'running',
      );
    if (!item) {
      item = {
        at: this.now(),
        checkpointId: this.activeCheckpointId,
        content: '',
        id: `reasoning:${this.activeCheckpointId}:${crypto.randomUUID()}`,
        kind: 'reasoning',
        status: 'running',
      };
      this.ui.push(item);
    }
    item.content += delta;
    this.notifyStreaming();
  }

  private completeStreamingReasoning(at: number, fallback = ''): void {
    const item = [...this.ui]
      .reverse()
      .find(
        message =>
          message.checkpointId === this.activeCheckpointId &&
          message.kind === 'reasoning' &&
          message.status === 'running',
      );
    if (item) {
      if (!item.content) item.content = fallback;
      item.durationMs = Math.max(0, at - item.at);
      item.status = 'completed';
    } else if (fallback) {
      this.ui.push({
        at,
        checkpointId: this.activeCheckpointId,
        content: fallback,
        durationMs: 0,
        id: `reasoning:${this.activeCheckpointId}:${crypto.randomUUID()}`,
        kind: 'reasoning',
        status: 'completed',
      });
    }
  }

  private startStreamingToolInput(call: RunnerToolInputStart): void {
    const at = this.now();
    // 一拿到稳定调用ID，工具卡就成为文本与思考之后的新时间线边界。
    this.completeStreamingReasoning(at);
    this.completeStreamingText(at);
    const id = `tool:${call.toolCallId}`;
    const existing = this.ui.find(message => message.id === id);
    if (existing) {
      existing.status = 'running';
      existing.toolName = call.toolName;
      existing.providerTool = call.providerExecuted === true;
      existing.toolPhase = 'generating';
      existing.toolInput = '';
      existing.content = '';
    } else {
      this.ui.push({
        at,
        checkpointId: this.activeCheckpointId,
        content: '',
        id,
        kind: 'tool',
        status: 'running',
        toolCallId: call.toolCallId,
        toolInput: '',
        toolName: call.toolName,
        toolPhase: 'generating',
        providerTool: call.providerExecuted === true,
      });
    }
    this.notifyStreaming();
  }

  private appendStreamingToolInput(update: RunnerToolInputDelta): void {
    const item = this.ui.find(message => message.id === `tool:${update.toolCallId}`);
    if (!item || item.kind !== 'tool' || item.status !== 'running') return;
    item.toolInput = `${item.toolInput ?? ''}${update.delta}`;
    item.toolPhase = 'generating';
    this.notifyStreaming();
  }

  private completeStreamingToolInput(call: RunnerToolCall): void {
    let item = this.ui.find(message => message.id === `tool:${call.toolCallId}`);
    if (!item) {
      this.startStreamingToolInput(call);
      item = this.ui.find(message => message.id === `tool:${call.toolCallId}`);
    }
    if (!item) return;
    item.status = 'running';
    item.toolInput = canonicalStringify(call.input);
    item.toolName = call.toolName;
    item.toolPhase = 'ready';
    item.providerTool = call.providerExecuted === true;
    this.notifyStreaming();
  }

  private consumeLatestEvent(event: RunnerEvent): void {
    if (event.type === 'model-completed') {
      const text = assistantText(event.messages);
      this.completeStreamingReasoning(
        event.at,
        this.hasStreamedReasoningInCurrentStep ? '' : assistantReasoning(event.messages),
      );
      this.hasStreamedReasoningInCurrentStep = false;
      this.completeStreamingText(event.at, this.hasStreamedTextInCurrentStep ? '' : text);
      this.hasStreamedTextInCurrentStep = false;
    } else if (event.type === 'tool-started') {
      // 工具调用是可见时间线的硬边界；它之后的新文本与思考必须创建新的过程片段。
      this.completeStreamingReasoning(event.at);
      this.completeStreamingText(event.at);
      const id = `tool:${event.call.toolCallId}`;
      const existing = this.ui.find(message => message.id === id);
      const input = canonicalStringify(event.call.input);
      if (existing) {
        existing.content = '';
        existing.status = 'running';
        existing.toolInput = input;
        existing.toolName = event.call.toolName;
        existing.toolPhase = event.call.providerExecuted === true ? 'executing' : 'ready';
        existing.providerTool = event.call.providerExecuted === true;
      } else {
        this.ui.push({
          at: event.at,
          checkpointId: this.activeCheckpointId,
          content: '',
          id,
          kind: 'tool',
          status: 'running',
          toolCallId: event.call.toolCallId,
          toolInput: input,
          toolName: event.call.toolName,
          toolPhase: event.call.providerExecuted === true ? 'executing' : 'ready',
          providerTool: event.call.providerExecuted === true,
        });
      }
    } else if (event.type === 'tool-executing') {
      const item = this.ui.find(message => message.id === `tool:${event.call.toolCallId}`);
      if (item) item.toolPhase = 'executing';
    } else if (event.type === 'tool-completed' || event.type === 'tool-failed') {
      const item = this.ui.find(message => message.id === `tool:${event.call.toolCallId}`);
      if (item) {
        item.status = event.type === 'tool-completed' ? 'completed' : 'failed';
        item.toolPhase = undefined;
        item.content = event.type === 'tool-completed' ? canonicalStringify(event.output) : event.error;
      }
    } else if (event.type === 'guidance-injected') {
      this.ui.push({
        at: event.at,
        checkpointId: this.activeCheckpointId,
        content: event.message,
        id: crypto.randomUUID(),
        kind: 'guidance',
      });
    } else if (event.type === 'status') {
      this.status = event.status;
      if (!['running', 'waiting-approval'].includes(event.status)) {
        this.completeStreamingReasoning(event.at);
        this.hasStreamedReasoningInCurrentStep = false;
        this.completeStreamingText(event.at);
        this.hasStreamedTextInCurrentStep = false;
        if (['completed', 'context-exhausted', 'failed', 'stopped'].includes(event.status)) {
          this.completeRunUi(event.status as 'completed' | 'context-exhausted' | 'failed' | 'stopped', event.at);
        }
      }
      if (event.failure) this.lastError = event.failure;
    }
  }

  private completeRunUi(
    status: NonNullable<SessionUiItem['runStatus']>,
    endedAt: number,
  ): void {
    const user = [...this.ui]
      .reverse()
      .find(item => item.checkpointId === this.activeCheckpointId && item.kind === 'user');
    if (!user) return;
    user.durationMs = Math.max(0, endedAt - user.at);
    user.runStatus = status;
  }

  private exportRuntime(): PersistedSessionRuntime {
    return {
      activeCheckpointId: this.activeCheckpointId,
      agentConfiguration: klona(this.agentConfiguration),
      attachments: klona(this.attachments),
      compiledPreset: klona(this.compiledPreset),
      createdAt: this.createdAt,
      events: klona(this.events),
      headerMessageCount: this.headerMessageCount,
      lastError: this.lastError,
      manualEditGroup: this.manualEditGroup ? klona(this.manualEditGroup) : undefined,
      mode: this.mode,
      modelControls: klona(this.modelControls),
      modelSelection: this.modelSelection ? klona(this.modelSelection) : undefined,
      mountedWorldbooks: [...this.mountedWorldbooks],
      mountedPresets: [...this.mountedPresets],
      runModelSelection: this.runModelSelection ? klona(this.runModelSelection) : undefined,
      modelMessages: klona(this.modelMessages),
      operationLog: this.operationLog.export(),
      preset: klona(this.preset),
      renderPreviews: klona(this.renderPreviews),
      scope: this.scope,
      sessionId: this.sessionId,
      skills: klona(this.skills),
      status: this.status,
      tavernChats: this.tavernChatWorkspace?.exportRuntime(),
      title: this.title,
      ui: klona(this.ui),
      updatedAt: this.now(),
      version: 3,
      warnings: [...this.warnings],
    };
  }

  private async persist(): Promise<void> {
    const referencedAttachments = new Set(this.ui.flatMap(item => item.attachments?.map(attachment => attachment.id) ?? []));
    Object.keys(this.attachments).forEach(id => {
      if (!referencedAttachments.has(id)) delete this.attachments[id];
    });
    await this.onPersist?.(this.exportRuntime());
    this.notify();
  }

  private async reloadStorageFiles(): Promise<void> {
    if (!this.workspaceStore) return;
    this.storageFiles = await this.workspaceStore.project(this.storageBindingId(), this.sessionId);
  }

  private async readWorkspaceBinary(file: WorkspaceFile): Promise<Uint8Array> {
    if (file.external?.fileId) {
      if (!this.workspaceStore) throw new Error('当前环境没有可用的梦境创客文件存储。');
      return this.workspaceStore.read(file.external.fileId);
    }
    if (file.virtualBinary?.url) {
      const response = await fetch(file.virtualBinary.url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`读取酒馆图片失败（HTTP ${response.status}）：${file.path}`);
      return new Uint8Array(await response.arrayBuffer());
    }
    throw new Error(`文件没有可读取的二进制来源：${file.path}`);
  }

  private async backupWorkspaceBinary(file: WorkspaceFile, toolCallId: string): Promise<WorkspaceFile> {
    if (!this.workspaceStore) throw new Error('当前环境没有可用的头像恢复存储。');
    const bytes = await this.readWorkspaceBinary(file);
    const safeToolCallId = toolCallId.replace(/[^a-zA-Z\d_-]/gu, '_').slice(0, 80) || crypto.randomUUID();
    const stored = await this.workspaceStore.putTemp({
      bindingId: this.storageBindingId(),
      bytes,
      global: this.scope === 'global',
      logicalPath: `_recovery/${safeToolCallId}/${crypto.randomUUID()}.bin`,
      mediaType: file.mediaType,
      sessionId: this.sessionId,
    });
    return {
      ...klona(file),
      external: {
        fileId: stored.fileId,
        mediaType: stored.mediaType,
        scope: stored.scope,
        sha256: stored.sha256,
        size: stored.size,
      },
      virtualBinary: undefined,
    };
  }

  private async refreshTavernChatWorkspace(): Promise<void> {
    if (!this.tavernChatWorkspace || !this.repository) return;
    if (this.scope === 'global' && !this.tavernBridge?.getCurrentCharacterId()) {
      this.repository.replaceProjection('/character/chats', []);
      return;
    }
    await this.tavernChatWorkspace.initialize(this.repository);
  }

  private notify(): void {
    this.cancelStreamingUpdate?.();
    this.cancelStreamingUpdate = undefined;
    this.onUpdate?.(this.view());
  }

  /**
   * 模型常把正文拆成大量极小delta。这里只合并界面发布；内存正文仍逐片追加，
   * 工具边界、结束、失败与持久化继续通过notify()立即刷新，不改变事件顺序。
   */
  private notifyStreaming(): void {
    if (this.cancelStreamingUpdate || !this.onUpdate) return;
    this.cancelStreamingUpdate = this.scheduleStreamingUpdate(() => {
      this.cancelStreamingUpdate = undefined;
      this.onUpdate?.(this.view());
    });
  }

  private syncUiVisibility(): void {
    for (const item of this.ui) {
      if (item.kind === 'manual' && !item.hidden) item.manualStatus = item.status === 'failed' ? 'failed' : 'active';
    }
  }
}
