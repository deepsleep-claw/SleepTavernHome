import { klona } from 'klona';
import type { ModelMessage } from 'ai';
import type { ContentAddressedSnapshotStore } from '../history/snapshot-store';
import { HistoryTimeline } from '../history/timeline';
import { materializeCardWorkspace, projectCardWorkspace } from '../mapping/card-workspace-mapper';
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
import type { WorkspaceFile } from '../workspace/types';
import { defaultPresetValues } from './prompt';
import { globalAgentTaskLock, type GlobalAgentTaskLock } from './task-lock';
import type {
  PendingCandidate,
  PersistedSessionRuntime,
  SessionLifecycleStatus,
  SessionMode,
  SessionSnapshotPayload,
  SessionUiItem,
  SessionView,
  SkillChange,
} from './types';

type SessionServiceOptions = {
  adapter: CardStateAdapter;
  contextWindow?: number;
  executor: ModelStepExecutor;
  lock?: GlobalAgentTaskLock;
  mode?: SessionMode;
  now?: () => number;
  onPersist?: (runtime: PersistedSessionRuntime, files: WorkspaceFile[]) => Promise<void>;
  onUpdate?: (view: SessionView) => void;
  preset?: StructuredPreset;
  readOnly?: boolean;
  requestToolApproval?: (request: ToolConfirmation) => Promise<boolean>;
  sessionId?: string;
  skills?: AgentSkill[];
  snapshots: ContentAddressedSnapshotStore;
  title?: string;
};

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

function diffSkills(before: AgentSkill[], after: AgentSkill[]): SkillChange[] {
  const beforeById = new Map(before.map(skill => [skill.id, skill]));
  const afterById = new Map(after.map(skill => [skill.id, skill]));
  const result: SkillChange[] = [];
  for (const skill of before) {
    const next = afterById.get(skill.id);
    if (!next) {
      result.push({ before: klona(skill), highRisk: true, kind: 'delete', label: `删除Skill“${skill.name}”`, path: `/skills/user/${skill.id}` });
    } else if (!canonicalEqual(skill, next)) {
      result.push({ after: klona(next), before: klona(skill), highRisk: true, kind: 'modify', label: `修改Skill“${next.name}”`, path: `/skills/user/${skill.id}` });
    }
  }
  for (const skill of after) {
    if (!beforeById.has(skill.id)) {
      result.push({ after: klona(skill), highRisk: false, kind: 'create', label: `新增Skill“${skill.name}”`, path: `/skills/user/${skill.id}` });
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

export class CardAgentSessionService {
  readonly bindingId: string;
  readonly characterName: string;
  readonly createdAt: number;
  readonly sessionId: string;
  private activeBase?: CardWorkspaceState;
  private activeCheckpointId?: string;
  private readonly adapter: CardStateAdapter;
  private compiledPreset: CompiledPreset;
  private readonly contextWindow: number;
  private readonly executor: ModelStepExecutor;
  private readonly lock: GlobalAgentTaskLock;
  private readonly now: () => number;
  private readonly onPersist?: SessionServiceOptions['onPersist'];
  private readonly onUpdate?: SessionServiceOptions['onUpdate'];
  private readonly requestToolApproval?: SessionServiceOptions['requestToolApproval'];
  private readonly readOnly: boolean;
  private readonly snapshots: ContentAddressedSnapshotStore;
  private timeline: HistoryTimeline;
  private events: RunnerEvent[] = [];
  private headerMessageCount: number;
  private lastError?: string;
  private mode: SessionMode;
  private modelMessages: ModelMessage[];
  private pending?: PendingCandidate;
  private preset: StructuredPreset;
  private repository?: MemoryWorkspaceRepository;
  private runner?: AgentRunner;
  private skills: AgentSkill[];
  private status: SessionLifecycleStatus = 'idle';
  private readonly title: string;
  private ui: SessionUiItem[] = [];
  private warnings: string[] = [];

  private constructor(
    options: SessionServiceOptions,
    initial: CardWorkspaceState,
    compiled: CompiledPreset,
    restored?: { files: WorkspaceFile[]; runtime: PersistedSessionRuntime },
  ) {
    this.adapter = options.adapter;
    this.bindingId = initial.character.bindingId;
    this.characterName = initial.character.name;
    this.compiledPreset = restored?.runtime.compiledPreset ?? compiled;
    this.contextWindow = options.contextWindow ?? 128_000;
    this.createdAt = restored?.runtime.createdAt ?? (options.now ?? Date.now)();
    this.executor = options.executor;
    this.headerMessageCount = restored?.runtime.headerMessageCount ?? compiled.messages.length;
    this.lock = options.lock ?? globalAgentTaskLock;
    this.mode = restored?.runtime.mode ?? options.mode ?? 'normal';
    this.modelMessages = klona(restored?.runtime.modelMessages ?? compiled.messages);
    this.now = options.now ?? Date.now;
    this.onPersist = options.onPersist;
    this.onUpdate = options.onUpdate;
    this.preset = klona(restored?.runtime.preset ?? options.preset ?? DEFAULT_PRESET);
    this.requestToolApproval = options.requestToolApproval;
    this.readOnly = options.readOnly ?? false;
    this.sessionId = restored?.runtime.sessionId ?? options.sessionId ?? crypto.randomUUID();
    this.skills = klona(restored?.runtime.skills ?? options.skills ?? []);
    this.snapshots = options.snapshots;
    this.timeline = new HistoryTimeline({
      checkpoints: restored?.runtime.history.checkpoints,
      now: this.now,
      position: restored?.runtime.history.position,
    });
    this.title = restored?.runtime.title ?? (options.title?.trim() || '新的创作会话');
    this.activeBase = restored?.runtime.activeBase;
    this.activeCheckpointId = restored?.runtime.activeCheckpointId;
    this.events = klona(restored?.runtime.events ?? []);
    this.pending = klona(restored?.runtime.pending);
    this.status = restored?.runtime.status ?? 'idle';
    this.ui = klona(restored?.runtime.ui ?? []);
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
    if (!service.readOnly && (runtime.status === 'running' || runtime.status === 'waiting-approval' || runtime.status === 'abnormal')) {
      service.status = 'abnormal';
      service.lastError = '上次页面在任务完成前关闭，已恢复到最后一个成功步骤。';
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
      approval,
      bindingId: this.bindingId,
      characterName: this.characterName,
      contextUsage: measureContext(this.modelMessages, this.contextWindow),
      error: this.lastError,
      events: klona(this.events),
      mode: this.mode,
      preset: klona(this.preset),
      readOnly: this.readOnly,
      sessionId: this.sessionId,
      skills: klona(this.skills),
      status: this.status,
      title: this.title,
      ui: klona(this.ui.filter(item => !item.hidden)),
      warnings: [...this.warnings],
      workingChanges: this.repository?.changes() ?? [],
      workingFiles: this.repository?.snapshot() ?? [],
    };
  }

  setMode(mode: SessionMode): void {
    this.assertWritable();
    this.mode = mode;
    this.notify();
    void this.persist();
  }

  async save(): Promise<void> {
    await this.persist();
  }

  async applyPreset(preset: StructuredPreset): Promise<void> {
    this.assertWritable();
    if (this.runner && ['running', 'waiting-approval'].includes(this.runner.state.status)) {
      throw new Error('Agent运行期间不能替换预设头部。');
    }
    this.preset = klona(preset);
    await this.refreshCompiledHeader();
    await this.persist();
  }

  async send(message: string, userMessageId: string = crypto.randomUUID()): Promise<SessionView> {
    this.assertWritable();
    const text = message.trim();
    if (!text) throw new Error('请输入要交给Agent的要求。');
    if (this.pending) throw new Error('请先处理当前待批准的修改。');
    if (this.runner && ['running', 'waiting-approval'].includes(this.runner.state.status)) throw new Error('Agent已经在运行。');
    this.lock.acquire(this.sessionId);
    try {
      const base = await this.adapter.read();
      this.assertBinding(base);
      this.activeBase = klona(base);
      const beforeSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
        card: base,
        events: this.events,
        modelMessages: this.modelMessages,
        skills: this.skills,
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
      this.repository = this.createRepository(base);
      await this.refreshCompiledHeader();
      this.buildRunner();
      const state = await this.runner!.start(text);
      this.modelMessages = klona(state.messages);
      this.status = state.status;
      this.lastError = state.failure;
      if (state.status === 'completed' || state.status === 'stopped') await this.freezeCandidate(base, state.status === 'stopped');
      await this.persist();
      return this.view();
    } finally {
      this.lock.release(this.sessionId);
    }
  }

  async resume(): Promise<SessionView> {
    this.assertWritable();
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
    this.assertWritable();
    if (!this.runner || this.runner.state.status !== 'running') throw new Error('当前没有正在运行的Agent步骤。');
    this.runner.enqueueGuidance(message);
  }

  async approve(decisions: Record<string, ApprovalDecision>): Promise<SessionView> {
    this.assertWritable();
    if (!this.pending) throw new Error('当前没有待批准的修改。');
    this.lock.acquire(this.sessionId);
    try {
      const current = await this.adapter.read();
      this.assertBinding(current);
      const latest = prepareThreeWayMerge(this.pending.base, this.pending.state, current);
      if (conflictsChanged(this.pending, latest)) {
        this.pending.preparation = latest;
        this.status = 'awaiting-approval';
        this.warnings = ['批准期间酒馆数据再次变化，请重新检查冲突。'];
        await this.persist();
        return this.view();
      }
      this.status = 'committing';
      await this.persist();
      const result = await commitWorkingCopy({ adapter: this.adapter, base: this.pending.base, decisions, working: this.pending.state });
      if (result.status === 'rolled-back') {
        this.status = 'failed';
        this.lastError = result.rollbackError
          ? `${result.error.message}；回滚也失败：${result.rollbackError.message}`
          : result.error.message;
        await this.persist();
        return this.view();
      }
      this.skills = applySkillDecisions(this.skills, this.pending.skillChanges, decisions);
      const afterSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
        card: result.state,
        events: this.events,
        modelMessages: this.modelMessages,
        skills: this.skills,
      });
      this.timeline.completeTurn(this.pending.checkpointId, {
        afterAgentCursor: this.modelMessages.length,
        afterSnapshot,
        stopped: this.pending.stopped,
      });
      this.pending = undefined;
      this.activeCheckpointId = undefined;
      this.activeBase = undefined;
      this.status = 'completed';
      this.lastError = undefined;
      this.repository = this.createRepository(result.state);
      await this.persist();
      return this.view();
    } finally {
      this.lock.release(this.sessionId);
    }
  }

  async undo(): Promise<SessionView> {
    return this.restore('undo');
  }

  async undoToUserMessage(messageId: string): Promise<SessionView> {
    this.assertWritable();
    const restore = this.timeline.undoToUserMessage(messageId);
    if (!restore) throw new Error('该消息当前不能回退。');
    return this.restoreSnapshot(restore, 'undo');
  }

  async redo(): Promise<SessionView> {
    return this.restore('redo');
  }

  async writeWorkingFile(path: string, content: string): Promise<SessionView> {
    this.assertWritable();
    if (['running', 'waiting-approval', 'committing'].includes(this.status)) {
      throw new Error('Agent运行或工具确认期间不能手动编辑Working Copy。');
    }
    let base = this.pending?.base;
    if (!base) {
      base = await this.adapter.read();
      this.assertBinding(base);
      const beforeSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
        card: base,
        events: this.events,
        modelMessages: this.modelMessages,
        skills: this.skills,
      });
      const messageId = `manual:${crypto.randomUUID()}`;
      const checkpoint = this.timeline.beginTurn({
        beforeAgentCursor: this.modelMessages.length,
        beforeSnapshot,
        userMessageId: messageId,
      });
      this.activeBase = klona(base);
      this.activeCheckpointId = checkpoint.id;
      this.repository = this.createRepository(base);
      this.ui.push({ at: this.now(), checkpointId: checkpoint.id, content: `手动编辑 ${path}`, id: messageId, kind: 'user' });
    }
    if (!this.repository) throw new Error('Working Copy不存在。');
    await this.repository.write(path, content, `manual:${crypto.randomUUID()}`);
    await this.freezeCandidate(base, false);
    await this.persist();
    return this.view();
  }

  editUserMessage(messageId: string, content: string): void {
    this.assertWritable();
    const item = this.ui.find(message => message.id === messageId && message.kind === 'user');
    if (!item) throw new Error(`用户消息不存在：${messageId}`);
    item.content = content;
    this.notify();
    void this.persist();
  }

  async resend(messageId: string): Promise<SessionView> {
    this.assertWritable();
    const item = this.ui.find(message => message.id === messageId && message.kind === 'user');
    if (!item) throw new Error(`用户消息不存在：${messageId}`);
    return this.send(item.content, messageId);
  }

  private createRepository(state: CardWorkspaceState): MemoryWorkspaceRepository {
    return new MemoryWorkspaceRepository({
      files: [...projectCardWorkspace(state), ...projectSkills(this.skills)],
      readonlyRoots: ['/context', '/worldbooks-global-readonly', '/skills/builtin'],
    });
  }

  private createRestoredRepository(state: CardWorkspaceState, currentFiles: WorkspaceFile[]): MemoryWorkspaceRepository {
    return new MemoryWorkspaceRepository({
      completedToolCallIds: this.events
        .filter(event => event.type === 'tool-completed')
        .map(event => event.call.toolCallId),
      currentFiles,
      files: [...projectCardWorkspace(state), ...projectSkills(this.skills)],
      readonlyRoots: ['/context', '/worldbooks-global-readonly', '/skills/builtin'],
    });
  }

  private buildRunner(initialStatus: RunnerStatus = 'idle', initialPending?: PendingRunnerStep): void {
    if (!this.repository) throw new Error('Working Copy不存在。');
    const journal = new PersistentRunnerJournal(this.events, async events => {
      this.events = events;
      this.consumeLatestEvent(events.at(-1)!);
      this.modelMessages = klona(this.runner?.state.messages ?? this.modelMessages);
      await this.persist();
    });
    this.runner = new AgentRunner({
      contextWindow: this.contextWindow,
      executor: this.executor,
      initialMessages: this.modelMessages,
      initialPending,
      initialStatus,
      journal,
      onTextDelta: delta => this.appendStreamingText(delta),
      requestApproval: this.requestToolApproval,
      tools: createWorkspaceRunnerTools(this.repository, this.skills.map(skill => skill.id)),
    });
  }

  private async refreshCompiledHeader(): Promise<void> {
    const next = await compilePreset(this.preset, defaultPresetValues(this.skills));
    this.modelMessages.splice(0, this.headerMessageCount, ...klona(next.messages));
    this.headerMessageCount = next.messages.length;
    this.compiledPreset = next;
  }

  private async freezeCandidate(base: CardWorkspaceState, stopped: boolean): Promise<void> {
    if (!this.repository || !this.activeCheckpointId) throw new Error('Working Copy或检查点不存在。');
    const materialized = materializeCardWorkspace(base, this.repository.snapshot());
    const candidateSkills = materializeUserSkills(this.repository.snapshot());
    const current = await this.adapter.read();
    const preparation = prepareThreeWayMerge(base, materialized.state, current);
    const skillChanges = diffSkills(this.skills, candidateSkills);
    const candidateSnapshot = await this.snapshots.put<SessionSnapshotPayload>({
      card: materialized.state,
      events: this.events,
      modelMessages: this.modelMessages,
      skills: candidateSkills,
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
      await this.approve({});
      return;
    }
    const decisions = defaultApprovals(preparation, this.mode);
    if (this.mode === 'yolo') {
      preparation.redundantPaths.forEach(path => {
        decisions[path] = 'current';
      });
      skillChanges.filter(change => !change.highRisk).forEach(change => {
        decisions[change.path] = 'agent';
      });
      const unresolvedState = effectiveStateChanges.some(change => decisions[change.path] === undefined);
      const unresolvedSkills = skillChanges.some(change => decisions[change.path] === undefined);
      if (!unresolvedState && !unresolvedSkills) {
        await this.approve(decisions);
        return;
      }
    }
    this.status = 'awaiting-approval';
    this.warnings = materialized.warnings;
  }

  private async restore(direction: 'redo' | 'undo'): Promise<SessionView> {
    this.assertWritable();
    if (this.pending || ['running', 'waiting-approval', 'committing'].includes(this.status)) {
      throw new Error('运行或审批期间不能回退历史。');
    }
    const restore = direction === 'undo' ? this.timeline.undo() : this.timeline.redo();
    if (!restore) throw new Error(direction === 'undo' ? '没有可回退的修改。' : '没有可重做的修改。');
    return this.restoreSnapshot(restore, direction);
  }

  private async restoreSnapshot(
    restore: { checkpointId: string; snapshot: string },
    direction: 'redo' | 'undo',
  ): Promise<SessionView> {
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
      this.skills = payload.skills;
      this.modelMessages = payload.modelMessages;
      this.events = payload.events;
      this.repository = this.createRepository(result.state);
      const checkpoint = this.timeline.export().checkpoints.find(item => item.id === restore.checkpointId);
      if (checkpoint) {
        this.ui.forEach(item => {
          if (item.checkpointId === checkpoint.id && item.kind !== 'user') item.hidden = direction === 'undo';
        });
      }
      this.status = 'completed';
      this.lastError = undefined;
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

  private assertWritable(): void {
    if (this.readOnly) throw new Error('当前页面未持有会话租约，只能查看。请先手动接管。');
  }

  private appendStreamingText(delta: string): void {
    const id = `stream:${this.activeCheckpointId}`;
    let item = this.ui.find(message => message.id === id);
    if (!item) {
      item = { at: this.now(), checkpointId: this.activeCheckpointId, content: '', id, kind: 'assistant', status: 'running' };
      this.ui.push(item);
    }
    item.content += delta;
    this.notify();
  }

  private consumeLatestEvent(event: RunnerEvent): void {
    if (event.type === 'model-completed') {
      const text = assistantText(event.messages);
      const stream = this.ui.find(item => item.id === `stream:${this.activeCheckpointId}`);
      if (stream) {
        if (!stream.content) stream.content = text;
        stream.status = 'completed';
      } else if (text) {
        this.ui.push({ at: event.at, checkpointId: this.activeCheckpointId, content: text, id: crypto.randomUUID(), kind: 'assistant', status: 'completed' });
      }
    } else if (event.type === 'tool-started') {
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
      this.ui.push({ at: event.at, checkpointId: this.activeCheckpointId, content: event.message, id: crypto.randomUUID(), kind: 'guidance' });
    } else if (event.type === 'status') {
      this.status = event.status;
    }
  }

  private exportRuntime(): PersistedSessionRuntime {
    return {
      activeBase: this.activeBase ? klona(this.activeBase) : undefined,
      activeCheckpointId: this.activeCheckpointId,
      compiledPreset: klona(this.compiledPreset),
      createdAt: this.createdAt,
      events: klona(this.events),
      headerMessageCount: this.headerMessageCount,
      history: this.timeline.export(),
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
    };
  }

  private async persist(): Promise<void> {
    await this.onPersist?.(this.exportRuntime(), this.repository?.snapshot() ?? []);
    this.notify();
  }

  private notify(): void {
    this.onUpdate?.(this.view());
  }
}
