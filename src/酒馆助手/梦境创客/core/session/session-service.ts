import { klona } from 'klona';
import type { ModelMessage } from 'ai';
import type { ContentAddressedSnapshotStore } from '../history/snapshot-store';
import { HistoryTimeline } from '../history/timeline';
import { materializeCardWorkspace, projectCardWorkspace } from '../mapping/card-workspace-mapper';
import { serializeYaml } from '../mapping/serde';
import type { CardWorkspaceState } from '../mapping/types';
import { compilePreset, DEFAULT_PRESET, type CompiledPreset, type StructuredPreset } from '../preset/compiler';
import { PersistentRunnerJournal } from '../persistence/journal';
import { AgentRunner, type PendingRunnerStep, type RunnerEvent, type RunnerStatus } from '../runner/agent-runner';
import { measureContext } from '../runner/context';
import { recoverPendingRunnerStep } from '../runner/recovery';
import type { ModelStepExecutor } from '../runner/step-executor';
import { createWorkspaceRunnerTools, type ToolConfirmation } from '../runner/tools';
import { materializeUserSkills, projectSkills } from '../skills/skill-registry';
import type { AgentSkill } from '../skills/types';
import type { CardStateAdapter } from '../transaction/adapter';
import { canonicalEqual, canonicalStringify } from '../transaction/canonical';
import { commitWorkingCopy } from '../transaction/commit';
import { defaultApprovals, prepareThreeWayMerge, type ApprovalDecision } from '../transaction/merge';
import { diffCardStates } from '../transaction/state-diff';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { maskSecretsForModel, scanSecrets } from '../workspace/secret-protection';
import type { WorkspaceFile } from '../workspace/types';
import { defaultPresetValues } from './prompt';
import { globalAgentTaskLock, type GlobalAgentTaskLock } from './task-lock';
import type {
  PendingCandidate,
  PersistedSessionRuntime,
  ManualEditGroup,
  SessionAgentConfiguration,
  SessionLifecycleStatus,
  SessionMode,
  SessionSnapshotPayload,
  SessionUiItem,
  SessionView,
  SkillChange,
} from './types';

type SessionServiceOptions = {
  adapter: CardStateAdapter;
  canWriteNonCharacterResources?: () => boolean;
  agentConfiguration?: SessionAgentConfiguration;
  contextWindow?: number;
  executor: ModelStepExecutor;
  lock?: GlobalAgentTaskLock;
  mode?: SessionMode;
  now?: () => number;
  onPersist?: (runtime: PersistedSessionRuntime, files: WorkspaceFile[]) => Promise<void>;
  onSkillsCommit?: (skills: AgentSkill[], previouslyMountedSkillIds: string[]) => Promise<AgentSkill[]>;
  onUpdate?: (view: SessionView) => void;
  preset?: StructuredPreset;
  requestToolApproval?: (request: ToolConfirmation) => Promise<boolean>;
  sessionId?: string;
  skills?: AgentSkill[];
  snapshots: ContentAddressedSnapshotStore;
  title?: string;
};

const DEFAULT_SESSION_TITLE = '新的创作会话';

function isNonCharacterResourcePath(path: string): boolean {
  return /^\/(?:regexes|tavern-helper-scripts)\/(?:global|preset-current)(?:\/|$)/u.test(path);
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

function diffSkills(before: AgentSkill[], after: AgentSkill[]): SkillChange[] {
  const beforeById = new Map(before.map(skill => [skill.id, skill]));
  const afterById = new Map(after.map(skill => [skill.id, skill]));
  const result: SkillChange[] = [];
  for (const skill of before) {
    const next = afterById.get(skill.id);
    if (!next) {
      result.push({
        before: klona(skill),
        highRisk: true,
        kind: 'delete',
        label: `删除Skill“${skill.name}”`,
        path: `/skills/user/${skill.id}`,
      });
    } else if (!canonicalEqual(skill, next)) {
      result.push({
        after: klona(next),
        before: klona(skill),
        highRisk: true,
        kind: 'modify',
        label: `修改Skill“${next.name}”`,
        path: `/skills/user/${skill.id}`,
      });
    }
  }
  for (const skill of after) {
    if (!beforeById.has(skill.id)) {
      result.push({
        after: klona(skill),
        highRisk: false,
        kind: 'create',
        label: `新增Skill“${skill.name}”`,
        path: `/skills/user/${skill.id}`,
      });
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function applySkillDecisions(
  current: AgentSkill[],
  changes: SkillChange[],
  decisions: Record<string, ApprovalDecision>,
): AgentSkill[] {
  const result = new Map(current.map(skill => [skill.id, klona(skill)]));
  for (const change of changes) {
    if (decisions[change.path] !== 'agent') continue;
    const id = change.after?.id ?? change.before?.id;
    if (!id) continue;
    if (change.after) result.set(id, klona(change.after));
    else result.delete(id);
  }
  return [...result.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function conflictsChanged(previous: PendingCandidate, current: ReturnType<typeof prepareThreeWayMerge>): boolean {
  return canonicalStringify(previous.preparation.conflicts) !== canonicalStringify(current.conflicts);
}

async function markSecretRemovalRisks(preparation: ReturnType<typeof prepareThreeWayMerge>): Promise<void> {
  for (const change of preparation.agentChanges) {
    if (!change.path.startsWith('/resources/scripts/') || change.kind === 'create') continue;
    const dataPath = change.path.includes('/data/') || change.path.endsWith('/data');
    const beforeScript = change.before as { data?: Record<string, unknown> } | undefined;
    const afterScript = change.after as { data?: Record<string, unknown> } | undefined;
    const beforeValue = dataPath ? change.before : beforeScript?.data;
    const afterValue = dataPath ? change.after : afterScript?.data;
    if (beforeValue === undefined) continue;
    try {
      const beforeText = serializeYaml({ value: beforeValue });
      const afterText = serializeYaml({ value: afterValue ?? null });
      const checkPath = '/tavern-helper-scripts/character/scripts/check/data.yaml';
      const beforeFindings = await scanSecrets(beforeText, checkPath);
      const afterFindings = await scanSecrets(afterText, checkPath);
      const remaining = new Set(afterFindings.map(finding => afterText.slice(finding.start, finding.end)));
      if (beforeFindings.some(finding => !remaining.has(beforeText.slice(finding.start, finding.end)))) {
        change.highRisk = true;
        change.label = `${change.label}（移除敏感内容）`;
      }
    } catch {
      // 检测失败按 fail-open 策略继续，不阻断正常提交。
    }
  }
}

export class CardAgentSessionService {
  readonly bindingId: string;
  readonly characterName: string;
  readonly createdAt: number;
  readonly sessionId: string;
  private activeBase?: CardWorkspaceState;
  private activeCheckpointId?: string;
  private agentConfiguration: SessionAgentConfiguration;
  private readonly adapter: CardStateAdapter;
  private readonly canWriteNonCharacterResources: () => boolean;
  private compiledPreset: CompiledPreset;
  private readonly contextWindow: number;
  private executor: ModelStepExecutor;
  private readonly lock: GlobalAgentTaskLock;
  private readonly now: () => number;
  private readonly onPersist?: SessionServiceOptions['onPersist'];
  private readonly onSkillsCommit?: SessionServiceOptions['onSkillsCommit'];
  private readonly onUpdate?: SessionServiceOptions['onUpdate'];
  private readonly requestToolApproval?: SessionServiceOptions['requestToolApproval'];
  private readonly snapshots: ContentAddressedSnapshotStore;
  private timeline: HistoryTimeline;
  private events: RunnerEvent[] = [];
  private headerMessageCount: number;
  private lastError?: string;
  private manualEditGroup?: ManualEditGroup;
  private mode: SessionMode;
  private modelMessages: ModelMessage[];
  private pending?: PendingCandidate;
  private preset: StructuredPreset;
  private repository?: MemoryWorkspaceRepository;
  private runner?: AgentRunner;
  private skills: AgentSkill[];
  private status: SessionLifecycleStatus = 'idle';
  private title: string;
  private ui: SessionUiItem[] = [];
  private warnings: string[] = [];

  private constructor(
    options: SessionServiceOptions,
    initial: CardWorkspaceState,
    compiled: CompiledPreset,
    restored?: { files: WorkspaceFile[]; runtime: PersistedSessionRuntime },
  ) {
    this.adapter = options.adapter;
    this.canWriteNonCharacterResources = options.canWriteNonCharacterResources ?? (() => false);
    this.agentConfiguration = klona(
      restored?.runtime.agentConfiguration ??
        options.agentConfiguration ?? {
          id: 'agent:legacy',
          name: '旧版会话配置',
          presetId: (restored?.runtime.preset ?? options.preset ?? DEFAULT_PRESET).id,
          skillIds: (restored?.runtime.skills ?? options.skills ?? []).map(skill => skill.id),
        },
    );
    this.bindingId = initial.character.bindingId;
    this.characterName = initial.character.name;
    this.compiledPreset = restored?.runtime.compiledPreset ?? compiled;
    this.contextWindow = options.contextWindow ?? 128_000;
    this.createdAt = restored?.runtime.createdAt ?? (options.now ?? Date.now)();
    this.executor = options.executor;
    this.headerMessageCount = restored?.runtime.headerMessageCount ?? compiled.messages.length;
    this.lock = options.lock ?? globalAgentTaskLock;
    this.manualEditGroup = restored?.runtime.manualEditGroup ? klona(restored.runtime.manualEditGroup) : undefined;
    this.mode = restored?.runtime.mode ?? options.mode ?? 'normal';
    this.modelMessages = klona(restored?.runtime.modelMessages ?? compiled.messages);
    this.now = options.now ?? Date.now;
    this.onPersist = options.onPersist;
    this.onSkillsCommit = options.onSkillsCommit;
    this.onUpdate = options.onUpdate;
    this.preset = klona(restored?.runtime.preset ?? options.preset ?? DEFAULT_PRESET);
    this.requestToolApproval = options.requestToolApproval;
    this.sessionId = restored?.runtime.sessionId ?? options.sessionId ?? crypto.randomUUID();
    this.skills = klona(restored?.runtime.skills ?? options.skills ?? []);
    this.snapshots = options.snapshots;
    this.timeline = new HistoryTimeline({
      checkpoints: restored?.runtime.history.checkpoints,
      now: this.now,
      position: restored?.runtime.history.position,
    });
    this.title = restored?.runtime.title ?? (options.title?.trim() || DEFAULT_SESSION_TITLE);
    this.activeBase = restored?.runtime.activeBase;
    this.activeCheckpointId = restored?.runtime.activeCheckpointId;
    this.events = klona(restored?.runtime.events ?? []);
    this.lastError = restored?.runtime.lastError;
    this.pending = klona(restored?.runtime.pending);
    this.status = restored?.runtime.status ?? 'idle';
    this.ui = klona(restored?.runtime.ui ?? []);
    this.warnings = [...(restored?.runtime.warnings ?? [])];
    this.repository = restored
      ? this.createRestoredRepository(this.activeBase ?? initial, restored.files)
      : this.createRepository(initial);
  }

  static async create(options: SessionServiceOptions): Promise<CardAgentSessionService> {
    const initial = await options.adapter.read();
    const preset = options.preset ?? DEFAULT_PRESET;
    const compiled = await compilePreset(preset, defaultPresetValues(options.skills ?? []));
    return new CardAgentSessionService(options, initial, compiled);
  }

  static async restore(
    options: SessionServiceOptions,
    runtime: PersistedSessionRuntime,
    workingFiles: WorkspaceFile[],
  ): Promise<CardAgentSessionService> {
    const initial = await options.adapter.read();
    const service = new CardAgentSessionService(options, initial, runtime.compiledPreset, {
      files: workingFiles,
      runtime,
    });
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
    const approval = this.pending
      ? {
          candidateSnapshot: this.pending.candidateSnapshot,
          conflicts: klona(this.pending.preparation.conflicts),
          skillChanges: klona(this.pending.skillChanges),
          stateChanges: klona(
            this.pending.preparation.agentChanges.filter(
              change => !this.pending!.preparation.redundantPaths.includes(change.path),
            ),
          ),
          warnings: [...this.pending.warnings],
        }
      : undefined;
    return {
      agentConfiguration: klona(this.agentConfiguration),
      approval,
      bindingId: this.bindingId,
      characterName: this.characterName,
      contextUsage: measureContext(this.modelMessages, this.contextWindow),
      error: this.lastError,
      events: klona(this.events),
      mode: this.mode,
      preset: klona(this.preset),
      sessionId: this.sessionId,
      skills: klona(this.skills),
      status: this.status,
      title: this.title,
      ui: klona(this.ui.filter(item => !item.hidden)),
      warnings: [...this.warnings],
      workingChanges: this.repository?.changes() ?? [],
      workingFiles: (this.repository?.snapshot() ?? []).map(file => ({
        ...file,
        readonly: file.readonly || (!this.canWriteNonCharacterResources() && isNonCharacterResourcePath(file.path)),
      })),
    };
  }

  setMode(mode: SessionMode): void {
    this.mode = mode;
    this.notify();
    void this.persist();
  }

  async save(): Promise<void> {
    await this.persist();
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
      this.pending ||
      this.activeCheckpointId ||
      ['running', 'waiting-approval', 'committing'].includes(this.status)
    ) {
      throw new Error('当前轮次结束前不能替换Agent配置。');
    }
    await this.finalizeManualEdits();
    const current = await this.adapter.read();
    this.assertBinding(current);
    this.agentConfiguration = klona(configuration);
    this.preset = klona(preset);
    this.skills = klona(availableSkills.filter(skill => configuration.skillIds.includes(skill.id)));
    this.repository = this.createRepository(current);
    await this.refreshCompiledHeader();
    await this.persist();
  }

  async setExecutor(executor: ModelStepExecutor): Promise<void> {
    if (this.runner && ['running', 'waiting-approval'].includes(this.runner.state.status)) {
      throw new Error('Agent运行期间不能切换API Profile。');
    }
    this.executor = executor;
    if (this.runner && ['failed', 'stopped', 'context-exhausted'].includes(this.runner.state.status)) {
      this.buildRunner(this.runner.state.status, this.runner.state.pending);
    }
    await this.persist();
  }

  async setSkills(skills: AgentSkill[]): Promise<void> {
    if (
      this.pending ||
      this.activeCheckpointId ||
      ['running', 'waiting-approval', 'committing'].includes(this.status)
    ) {
      throw new Error('当前轮次结束前不能更新全局Skill挂载。');
    }
    await this.finalizeManualEdits();
    const mounted = skills.filter(skill => this.agentConfiguration.skillIds.includes(skill.id));
    if (canonicalEqual(this.skills, mounted)) return;
    const current = await this.adapter.read();
    this.assertBinding(current);
    this.skills = klona(mounted);
    this.repository = this.createRepository(current);
    await this.refreshCompiledHeader();
    this.notify();
  }

  async send(message: string, userMessageId: string = crypto.randomUUID()): Promise<SessionView> {
    const text = message.trim();
    if (!text) throw new Error('请输入要交给Agent的要求。');
    if (this.pending) throw new Error('请先处理当前待批准的修改。');
    if (this.runner && ['running', 'waiting-approval'].includes(this.runner.state.status))
      throw new Error('Agent已经在运行。');
    if (this.activeCheckpointId || this.activeBase) {
      throw new Error('当前轮次尚未结束，请从中断处继续，或回退这条用户消息后再发送新要求。');
    }
    await this.finalizeManualEdits();
    this.lock.acquire(this.sessionId);
    try {
      if (this.title === DEFAULT_SESSION_TITLE && !this.ui.some(item => item.kind === 'user')) {
        this.title = sessionTitleFromMessage(text);
      }
      const base = await this.adapter.read();
      this.assertBinding(base);
      this.activeBase = klona(base);
      const beforeSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
        card: base,
        events: this.events,
        modelMessages: this.modelMessages,
      });
      const checkpoint = this.timeline.beginTurn({
        beforeAgentCursor: this.modelMessages.length,
        beforeSnapshot,
        userMessageId,
      });
      this.activeCheckpointId = checkpoint.id;
      const existing = this.ui.find(item => item.id === userMessageId && item.kind === 'user');
      if (existing) {
        existing.content = text;
        existing.checkpointId = checkpoint.id;
        existing.hidden = false;
      } else {
        this.ui.push({ at: this.now(), checkpointId: checkpoint.id, content: text, id: userMessageId, kind: 'user' });
      }
      this.syncUiVisibility();
      this.repository = this.createRepository(base);
      await this.refreshCompiledHeader();
      this.buildRunner();
      const state = await this.runner!.start(text);
      this.modelMessages = klona(state.messages);
      this.status = state.status;
      this.lastError = state.failure;
      if (state.status === 'completed' || state.status === 'stopped')
        await this.freezeCandidate(base, state.status === 'stopped');
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
      const state = await this.runner.resume();
      this.modelMessages = klona(state.messages);
      this.status = state.status;
      this.lastError = state.failure;
      if ((state.status === 'completed' || state.status === 'stopped') && this.repository) {
        if (!this.activeBase) throw new Error('无法恢复：缺少本轮Base数据。');
        await this.freezeCandidate(this.activeBase, state.status === 'stopped');
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

  async approve(decisions: Record<string, ApprovalDecision>): Promise<SessionView> {
    if (!this.pending) throw new Error('当前没有待批准的修改。');
    this.lock.acquire(this.sessionId);
    try {
      await this.applyApproval(decisions);
      await this.persist();
      return this.view();
    } finally {
      this.lock.release(this.sessionId);
    }
  }

  async undo(): Promise<SessionView> {
    await this.finalizeManualEdits();
    return this.restore('undo');
  }

  async undoToUserMessage(messageId: string): Promise<SessionView> {
    await this.finalizeManualEdits();
    const restore = this.timeline.undoToUserMessage(messageId);
    if (!restore) throw new Error('该消息当前不能回退。');
    return this.restoreSnapshot(restore);
  }

  async redo(): Promise<SessionView> {
    await this.finalizeManualEdits();
    return this.restore('redo');
  }

  async writeWorkingFile(path: string, content: string, overwriteConflict = false): Promise<SessionView> {
    this.assertManualResourceWrite(path);
    return this.applyManualWorkspaceChange({ content, kind: 'write', overwriteConflict, path });
  }

  async useCurrentWorkingFile(path: string): Promise<SessionView> {
    const current = await this.adapter.read();
    this.assertBinding(current);
    const file = projectCardWorkspace(current, 100, { allowNonCharacterWrites: true }).find(item => item.path === path);
    if (!file) throw new Error(`当前实际数据中不存在文件：${path}`);
    this.repository = this.createRepository(current);
    this.notify();
    return this.view();
  }

  async deleteWorkingPath(path: string): Promise<SessionView> {
    this.assertManualResourceWrite(path);
    return this.applyManualWorkspaceChange({ kind: 'delete', path });
  }

  async finalizeManualEdits(): Promise<void> {
    if (!this.manualEditGroup) return;
    if (!this.manualEditGroup.attachedToAgent && !this.manualEditGroup.completed) {
      this.timeline.markAbnormal(this.manualEditGroup.checkpointId);
      this.syncUiVisibility();
    }
    this.manualEditGroup = undefined;
    await this.persist();
  }

  private async applyManualWorkspaceChange(input: {
    content?: string;
    kind: 'delete' | 'write';
    overwriteConflict?: boolean;
    path: string;
  }): Promise<SessionView> {
    if (['running', 'waiting-approval', 'committing'].includes(this.status)) {
      throw new Error('Agent运行或工具确认期间不能手动编辑Working Copy。');
    }
    const current = await this.adapter.read();
    this.assertBinding(current);
    const actualFiles = projectCardWorkspace(current, 100, { allowNonCharacterWrites: true });
    const actualFile = actualFiles.find(file => file.path === input.path);
    if (!input.overwriteConflict && !this.pending && input.kind === 'write' && this.repository) {
      const editorFile = await this.repository.read(input.path).catch(() => undefined);
      if (editorFile && actualFile && editorFile.content !== actualFile.content && input.content !== actualFile.content) {
        throw new Error(
          `MANUAL_EDIT_CONFLICT：${input.path}\nBase：${editorFile.content}\nCurrent：${actualFile.content}\nPlayer：${input.content ?? ''}`,
        );
      }
    }
    const manualRepository = new MemoryWorkspaceRepository({
      files: actualFiles,
      readonlyRoots: ['/context', '/worldbooks-global-readonly', '/skills/builtin'],
    });
    const toolCallId = `manual:${crypto.randomUUID()}`;
    if (input.kind === 'write') await manualRepository.write(input.path, input.content ?? '', toolCallId);
    else await manualRepository.remove(input.path, toolCallId);
    const materialized = materializeCardWorkspace(current, manualRepository.snapshot());
    const operations = diffCardStates(current, materialized.state);
    if (operations.length === 0) return this.view();
    const group = await this.ensureManualEditGroup(current);
    const previous = group.files[input.path];
    group.files[input.path] = {
      after: input.kind === 'write' ? input.content ?? '' : undefined,
      before: previous?.before ?? actualFile?.content,
      kind: input.kind,
      path: input.path,
    };
    this.updateManualUi(group, 'active');
    const result = await commitWorkingCopy({
      adapter: this.adapter,
      base: current,
      decisions: Object.fromEntries(operations.map(operation => [operation.path, 'agent' as const])),
      working: materialized.state,
    });
    if (result.status === 'rolled-back') {
      group.files[input.path].error = result.error.message;
      this.updateManualUi(group, 'failed');
      await this.persist();
      return this.view();
    }
    delete group.files[input.path].error;
    await this.updateManualModelMessage(group);
    if (group.attachedToAgent) {
      if (!this.repository || !this.pending) throw new Error('Agent候选修改已丢失。');
      if (input.kind === 'write') await this.repository.write(input.path, input.content ?? '', `manual-sync:${crypto.randomUUID()}`);
      else {
        await this.repository.remove(input.path, `manual-sync:${crypto.randomUUID()}`).catch(() => undefined);
      }
      await this.refreshPendingAfterManualChange();
    } else {
      const afterSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
        card: result.state,
        events: this.events,
        modelMessages: this.modelMessages,
      });
      if (group.completed) {
        this.timeline.updateCompletedTurn(group.checkpointId, {
          afterAgentCursor: this.modelMessages.length,
          afterSnapshot,
        });
      } else {
        this.timeline.completeTurn(group.checkpointId, {
          afterAgentCursor: this.modelMessages.length,
          afterSnapshot,
        });
        group.completed = true;
      }
      this.repository = this.createRepository(result.state);
      this.status = 'completed';
    }
    this.updateManualUi(group, 'active');
    this.syncUiVisibility();
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
    return this.send(item.content, messageId);
  }

  private createRepository(state: CardWorkspaceState): MemoryWorkspaceRepository {
    return new MemoryWorkspaceRepository({
      files: [...projectCardWorkspace(state, 100, { allowNonCharacterWrites: true }), ...projectSkills(this.skills)],
      readonlyRoots: ['/context', '/worldbooks-global-readonly', '/skills/builtin'],
    });
  }

  private createRestoredRepository(
    state: CardWorkspaceState,
    currentFiles: WorkspaceFile[],
  ): MemoryWorkspaceRepository {
    return new MemoryWorkspaceRepository({
      completedToolCallIds: this.events
        .filter(event => event.type === 'tool-completed')
        .map(event => event.call.toolCallId),
      currentFiles,
      files: [...projectCardWorkspace(state, 100, { allowNonCharacterWrites: true }), ...projectSkills(this.skills)],
      readonlyRoots: ['/context', '/worldbooks-global-readonly', '/skills/builtin'],
    });
  }

  private buildRunner(initialStatus: RunnerStatus = 'idle', initialPending?: PendingRunnerStep): void {
    if (!this.repository) throw new Error('Working Copy不存在。');
    const journal = new PersistentRunnerJournal(this.events, async events => {
      this.events = events;
      this.consumeLatestEvent(events.at(-1)!);
      this.modelMessages = klona(this.runner?.state.messages ?? this.modelMessages);
      this.notify();
    });
    this.runner = new AgentRunner({
      contextWindow: this.contextWindow,
      executor: this.executor,
      initialMessages: this.modelMessages,
      initialPending,
      initialStatus,
      journal,
      now: this.now,
      onReasoningDelta: delta => this.appendStreamingReasoning(delta),
      onTextDelta: delta => this.appendStreamingText(delta),
      requestApproval: this.requestToolApproval,
      tools: createWorkspaceRunnerTools(
        this.repository,
        this.skills.map(skill => skill.id),
        { canWriteNonCharacterResources: this.canWriteNonCharacterResources },
      ),
    });
  }

  private assertManualResourceWrite(path: string): void {
    if (isNonCharacterResourcePath(path) && !this.canWriteNonCharacterResources()) {
      throw new Error('该路径属于全局或当前预设资源。请在开发者模式中显式启用危险写入权限后再修改。');
    }
  }

  private async ensureManualEditGroup(current: CardWorkspaceState): Promise<ManualEditGroup> {
    if (this.manualEditGroup) return this.manualEditGroup;
    const attachedToAgent = Boolean(this.pending && this.activeCheckpointId);
    let checkpointId = this.activeCheckpointId;
    let beforeSnapshot: string | undefined;
    if (!attachedToAgent) {
      beforeSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
        card: current,
        events: this.events,
        modelMessages: this.modelMessages,
      });
      checkpointId = this.timeline.beginTurn({
        beforeAgentCursor: this.modelMessages.length,
        beforeSnapshot,
        userMessageId: `manual:${crypto.randomUUID()}`,
      }).id;
    }
    if (!checkpointId) throw new Error('无法为玩家修改建立检查点。');
    const uiItemId = `manual:${crypto.randomUUID()}`;
    this.manualEditGroup = {
      attachedToAgent,
      beforeSnapshot,
      checkpointId,
      completed: false,
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

  private async refreshPendingAfterManualChange(): Promise<void> {
    if (!this.pending || !this.repository) return;
    const previous = this.pending;
    const materialized = materializeCardWorkspace(previous.base, this.repository.snapshot());
    const candidateSkills = materializeUserSkills(this.repository.snapshot());
    const current = await this.adapter.read();
    const preparation = prepareThreeWayMerge(previous.base, materialized.state, current);
    await markSecretRemovalRisks(preparation);
    const skillChanges = diffSkills(this.skills, candidateSkills);
    const candidateSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
      card: materialized.state,
      events: this.events,
      modelMessages: this.modelMessages,
    });
    this.pending = {
      ...previous,
      candidateSnapshot,
      preparation,
      skillChanges,
      skills: candidateSkills,
      state: materialized.state,
      warnings: materialized.warnings,
    };
    const effective = preparation.agentChanges.filter(change => !preparation.redundantPaths.includes(change.path));
    if (effective.length === 0 && skillChanges.length === 0) {
      await this.applyApproval({});
      this.manualEditGroup = undefined;
    } else {
      this.status = 'awaiting-approval';
    }
  }

  private async refreshCompiledHeader(): Promise<void> {
    const next = await compilePreset(this.preset, defaultPresetValues(this.skills));
    this.modelMessages.splice(0, this.headerMessageCount, ...klona(next.messages));
    this.headerMessageCount = next.messages.length;
    this.compiledPreset = next;
  }

  private async applyApproval(decisions: Record<string, ApprovalDecision>): Promise<void> {
    const pending = this.pending;
    if (!pending) throw new Error('当前没有待批准的修改。');
    const current = await this.adapter.read();
    this.assertBinding(current);
    const latest = prepareThreeWayMerge(pending.base, pending.state, current);
    if (conflictsChanged(pending, latest)) {
      pending.preparation = latest;
      this.status = 'awaiting-approval';
      this.warnings = ['批准期间酒馆数据再次变化，请重新检查冲突。'];
      return;
    }
    this.status = 'committing';
    this.notify();
    const result = await commitWorkingCopy({
      adapter: this.adapter,
      base: pending.base,
      decisions,
      working: pending.state,
    });
    if (result.status === 'rolled-back') {
      this.status = 'failed';
      this.lastError = result.rollbackError
        ? `${result.error.message}；回滚也失败：${result.rollbackError.message}`
        : result.error.message;
      return;
    }
    const previouslyMountedSkillIds = this.skills.map(skill => skill.id);
    const approvedSkills = applySkillDecisions(this.skills, pending.skillChanges, decisions);
    const approvedIds = new Set(approvedSkills.map(skill => skill.id));
    this.agentConfiguration.skillIds = [
      ...new Set([
        ...this.agentConfiguration.skillIds.filter(
          id => !previouslyMountedSkillIds.includes(id) || approvedIds.has(id),
        ),
        ...approvedSkills.map(skill => skill.id),
      ]),
    ];
    this.skills = this.onSkillsCommit
      ? await this.onSkillsCommit(approvedSkills, previouslyMountedSkillIds)
      : approvedSkills;
    const afterSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
      card: result.state,
      events: this.events,
      modelMessages: this.modelMessages,
    });
    this.timeline.completeTurn(pending.checkpointId, {
      afterAgentCursor: this.modelMessages.length,
      afterSnapshot,
      stopped: pending.stopped,
    });
    this.syncUiVisibility();
    this.pending = undefined;
    this.activeCheckpointId = undefined;
    this.activeBase = undefined;
    this.status = 'completed';
    this.lastError = undefined;
    this.repository = this.createRepository(result.state);
    if (this.manualEditGroup?.attachedToAgent && this.manualEditGroup.checkpointId === pending.checkpointId) {
      this.manualEditGroup = undefined;
    }
  }

  private async freezeCandidate(base: CardWorkspaceState, stopped: boolean): Promise<void> {
    if (!this.repository || !this.activeCheckpointId) throw new Error('Working Copy或检查点不存在。');
    const materialized = materializeCardWorkspace(base, this.repository.snapshot());
    const candidateSkills = materializeUserSkills(this.repository.snapshot());
    const current = await this.adapter.read();
    const preparation = prepareThreeWayMerge(base, materialized.state, current);
    await markSecretRemovalRisks(preparation);
    const skillChanges = diffSkills(this.skills, candidateSkills);
    const candidateSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
      card: materialized.state,
      events: this.events,
      modelMessages: this.modelMessages,
    });
    this.pending = {
      base,
      candidateSnapshot,
      checkpointId: this.activeCheckpointId,
      preparation,
      skillChanges,
      skills: candidateSkills,
      state: materialized.state,
      stopped,
      warnings: materialized.warnings,
    };
    const effectiveStateChanges = preparation.agentChanges.filter(
      change => !preparation.redundantPaths.includes(change.path),
    );
    const hasChanges = effectiveStateChanges.length > 0 || skillChanges.length > 0;
    if (!hasChanges) {
      await this.applyApproval({});
      return;
    }
    const decisions = defaultApprovals(preparation, this.mode);
    if (this.mode === 'yolo') {
      preparation.redundantPaths.forEach(path => {
        decisions[path] = 'current';
      });
      skillChanges
        .filter(change => !change.highRisk)
        .forEach(change => {
          decisions[change.path] = 'agent';
        });
      const unresolvedState = effectiveStateChanges.some(change => decisions[change.path] === undefined);
      const unresolvedSkills = skillChanges.some(change => decisions[change.path] === undefined);
      if (!unresolvedState && !unresolvedSkills) {
        await this.applyApproval(decisions);
        return;
      }
    }
    this.status = 'awaiting-approval';
    this.warnings = materialized.warnings;
  }

  private async restore(direction: 'redo' | 'undo'): Promise<SessionView> {
    if (this.pending || ['running', 'waiting-approval', 'committing'].includes(this.status)) {
      throw new Error('运行或审批期间不能回退历史。');
    }
    const restore = direction === 'undo' ? this.timeline.undo() : this.timeline.redo();
    if (!restore) throw new Error(direction === 'undo' ? '没有可回退的修改。' : '没有可重做的修改。');
    return this.restoreSnapshot(restore);
  }

  private async restoreSnapshot(restore: { checkpointId: string; snapshot: string }): Promise<SessionView> {
    this.lock.acquire(this.sessionId);
    try {
      const payload = await this.snapshots.get<SessionSnapshotPayload>(restore.snapshot);
      const current = await this.adapter.read();
      this.assertBinding(current);
      const operations = diffCardStates(current, payload.card);
      const result = await commitWorkingCopy({
        adapter: this.adapter,
        base: current,
        decisions: Object.fromEntries(operations.map(operation => [operation.path, 'agent'])),
        working: payload.card,
      });
      if (result.status === 'rolled-back') throw result.error;
      this.modelMessages = payload.modelMessages;
      this.events = payload.events;
      this.repository = this.createRepository(result.state);
      this.syncUiVisibility();
      this.pending = undefined;
      this.activeCheckpointId = undefined;
      this.activeBase = undefined;
      this.runner = undefined;
      this.status = 'completed';
      this.lastError = undefined;
      this.warnings = [];
      await this.persist();
      return this.view();
    } finally {
      this.lock.release(this.sessionId);
    }
  }

  private assertBinding(state: CardWorkspaceState): void {
    if (state.character.bindingId !== this.bindingId) {
      throw new Error(`当前角色卡与会话不匹配：需要 ${this.bindingId}，实际 ${state.character.bindingId}`);
    }
  }

  private appendStreamingText(delta: string): void {
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
    this.notify();
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
    let item = [...this.ui].reverse().find(message => message.kind === 'reasoning' && message.status === 'running');
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
    this.notify();
  }

  private completeStreamingReasoning(at: number, fallback = ''): void {
    const item = [...this.ui].reverse().find(message => message.kind === 'reasoning' && message.status === 'running');
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

  private consumeLatestEvent(event: RunnerEvent): void {
    if (event.type === 'model-completed') {
      const text = assistantText(event.messages);
      this.completeStreamingReasoning(event.at, assistantReasoning(event.messages));
      this.completeStreamingText(event.at, text);
    } else if (event.type === 'tool-started') {
      // 工具调用是可见时间线的硬边界；它之后的新文本必须创建新的助手消息。
      this.completeStreamingText(event.at);
      this.ui.push({
        at: event.at,
        checkpointId: this.activeCheckpointId,
        content: canonicalStringify(event.call.input),
        id: `tool:${event.call.toolCallId}`,
        kind: 'tool',
        status: 'running',
        toolCallId: event.call.toolCallId,
        toolName: event.call.toolName,
      });
    } else if (event.type === 'tool-completed' || event.type === 'tool-failed') {
      const item = this.ui.find(message => message.id === `tool:${event.call.toolCallId}`);
      if (item) {
        item.status = event.type === 'tool-completed' ? 'completed' : 'failed';
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
        this.completeStreamingText(event.at);
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
      activeBase: this.activeBase ? klona(this.activeBase) : undefined,
      activeCheckpointId: this.activeCheckpointId,
      agentConfiguration: klona(this.agentConfiguration),
      compiledPreset: klona(this.compiledPreset),
      createdAt: this.createdAt,
      events: klona(this.events),
      headerMessageCount: this.headerMessageCount,
      history: this.timeline.export(),
      lastError: this.lastError,
      manualEditGroup: this.manualEditGroup ? klona(this.manualEditGroup) : undefined,
      mode: this.mode,
      modelMessages: klona(this.modelMessages),
      pending: this.pending ? klona(this.pending) : undefined,
      preset: klona(this.preset),
      sessionId: this.sessionId,
      skills: klona(this.skills),
      status: this.status,
      title: this.title,
      ui: klona(this.ui),
      updatedAt: this.now(),
      version: 1,
      warnings: [...this.warnings],
    };
  }

  private async persist(): Promise<void> {
    this.timeline.cleanupAbandoned();
    await this.onPersist?.(this.exportRuntime(), this.repository?.snapshot() ?? []);
    this.notify();
  }

  private notify(): void {
    this.onUpdate?.(this.view());
  }

  private syncUiVisibility(): void {
    const history = this.timeline.export();
    const active = history.checkpoints.filter(checkpoint => checkpoint.active);
    const positionById = new Map(active.map((checkpoint, index) => [checkpoint.id, index]));
    for (const item of this.ui) {
      if (!item.checkpointId) continue;
      const index = positionById.get(item.checkpointId);
      if (index === undefined) {
        item.hidden = true;
      } else if (index <= history.position) {
        item.hidden = false;
        if (item.kind === 'manual') item.manualStatus = item.status === 'failed' ? 'failed' : 'active';
      } else if (index === history.position + 1) {
        item.hidden = item.kind !== 'user' && item.kind !== 'manual';
        if (item.kind === 'manual') item.manualStatus = 'undone';
      } else {
        item.hidden = true;
      }
    }
  }
}
