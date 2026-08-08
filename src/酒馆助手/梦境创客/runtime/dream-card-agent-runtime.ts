import { klona } from 'klona';
import { ContentAddressedSnapshotStore } from '../core/history/snapshot-store';
import { materializeCardWorkspace, projectCardWorkspace } from '../core/mapping/card-workspace-mapper';
import type { CardWorkspaceState } from '../core/mapping/types';
import { FileBackedBlobStore, GlobalTavernFileClient, type TavernFileClient } from '../core/persistence/file-client';
import { LeaseCoordinator, TavernLeaseRecordStore } from '../core/persistence/lease';
import { SessionPersistenceCoordinator } from '../core/persistence/session-persistence';
import { SessionRevisionStore } from '../core/persistence/session-store';
import {
  TavernAgentSettingsStore,
  type AgentSettingsStore,
  type SessionIndexEntry,
} from '../core/persistence/settings';
import {
  ApiProfileRegistry,
  createApiProfile,
  updateApiProfile,
  type ApiProfile,
  type ApiProfileInput,
} from '../core/provider/profiles';
import { ProfileModelStepExecutor, type ModelStepExecutor } from '../core/runner/step-executor';
import type { ToolConfirmation } from '../core/runner/tools';
import { CardAgentSessionService } from '../core/session/session-service';
import { GlobalAgentTaskLock } from '../core/session/task-lock';
import type { SessionMode, SessionView } from '../core/session/types';
import { createGlobalTavernBridge, type TavernBridge } from '../core/tavern/bridge';
import { ProductionCardStateAdapter } from '../core/tavern/production-adapter';
import type { CardStateAdapter } from '../core/transaction/adapter';
import { commitWorkingCopy } from '../core/transaction/commit';
import { diffCardStates } from '../core/transaction/state-diff';

export type DreamCardAgentRuntimeState = {
  active?: SessionView;
  activeProfileId?: string;
  busy: boolean;
  currentCharacter?: { avatarId: string; bindingId: string; name: string };
  developerMode: boolean;
  error?: string;
  floatingButton: boolean;
  leaseOwned: boolean;
  profiles: ApiProfile[];
  sessions: SessionIndexEntry[];
  toolConfirmation?: ToolConfirmation;
  warnings: string[];
};

type RuntimeOptions = {
  adapterFactory?: () => CardStateAdapter;
  bridge?: TavernBridge;
  executorFactory?: (profile: ApiProfile) => ModelStepExecutor;
  fileClient?: TavernFileClient;
  holderId?: string;
  now?: () => number;
  settingsStore?: AgentSettingsStore;
};

type Subscriber = (state: DreamCardAgentRuntimeState) => void;

export class DreamCardAgentRuntime {
  private activeLease?: LeaseCoordinator;
  private activeService?: CardAgentSessionService;
  private readonly adapterFactory: () => CardStateAdapter;
  private readonly executorFactory: (profile: ApiProfile) => ModelStepExecutor;
  private readonly fileClient: TavernFileClient;
  private readonly holderId?: string;
  private readonly lock = new GlobalAgentTaskLock();
  private readonly now: () => number;
  private readonly settingsStore: AgentSettingsStore;
  private readonly subscribers = new Set<Subscriber>();
  private toolConfirmationResolve?: (approved: boolean) => void;
  private state: DreamCardAgentRuntimeState;

  constructor(options: RuntimeOptions = {}) {
    const bridge = options.bridge ?? createGlobalTavernBridge();
    this.adapterFactory = options.adapterFactory ?? (() => new ProductionCardStateAdapter(bridge));
    this.executorFactory = options.executorFactory ?? (profile => new ProfileModelStepExecutor(profile));
    this.fileClient = options.fileClient ?? new GlobalTavernFileClient();
    this.holderId = options.holderId;
    this.now = options.now ?? Date.now;
    this.settingsStore = options.settingsStore ?? new TavernAgentSettingsStore();
    const settings = this.settingsStore.load();
    this.state = {
      activeProfileId: settings.activeProfileId,
      busy: false,
      developerMode: settings.developerMode,
      floatingButton: settings.floatingButton,
      leaseOwned: false,
      profiles: settings.profiles,
      sessions: Object.values(settings.sessions).sort((left, right) => right.updatedAt - left.updatedAt),
      warnings: [],
    };
  }

  snapshot(): DreamCardAgentRuntimeState {
    return klona(this.state);
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.snapshot());
    return () => this.subscribers.delete(subscriber);
  }

  async refreshCharacter(): Promise<DreamCardAgentRuntimeState> {
    return this.run(async () => {
      const current = await this.adapterFactory().read();
      this.state.currentCharacter = {
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        name: current.character.name,
      };
      await this.refreshSessionIndex(current);
    });
  }

  async createSession(input: { mode?: SessionMode; profileId?: string; title?: string } = {}): Promise<SessionView> {
    await this.run(async () => {
      const profile = this.requireProfile(input.profileId);
      const adapter = this.adapterFactory();
      const current = await this.ensureStableBinding(adapter);
      this.closeLease();
      const leaseRef: { current?: LeaseCoordinator } = {};
      const revisionStore = new SessionRevisionStore(this.fileClient, this.settingsStore, this.now);
      const persistence = new SessionPersistenceCoordinator({
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        characterName: current.character.name,
        lease: () => leaseRef.current,
        store: revisionStore,
      });
      const service = await CardAgentSessionService.create({
        adapter,
        executor: this.executorFactory(profile),
        lock: this.lock,
        mode: input.mode,
        now: this.now,
        onPersist: (runtime, files) => persistence.persist(runtime, files),
        onUpdate: view => this.updateActive(view),
        requestToolApproval: request => this.requestToolConfirmation(request),
        snapshots: new ContentAddressedSnapshotStore(
          new FileBackedBlobStore(current.character.bindingId, this.fileClient, this.settingsStore),
        ),
        title: input.title,
      });
      await service.save();
      const lease = this.createLease(service.sessionId, current.character.bindingId);
      leaseRef.current = lease;
      if (!(await lease.acquire())) throw new Error('新会话的写入租约被其他页面抢占。');
      this.activeLease = lease;
      this.activeService = service;
      this.state.leaseOwned = true;
      this.updateActive(service.view());
      this.state.currentCharacter = {
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        name: current.character.name,
      };
      this.reloadSettingsState();
    });
    return this.requireService().view();
  }

  async openSession(sessionId: string, forceTakeover = false): Promise<SessionView> {
    await this.run(async () => {
      const profile = this.requireProfile();
      const adapter = this.adapterFactory();
      const current = await adapter.read();
      const index = this.settingsStore.load().sessions[sessionId];
      if (!index) throw new Error(`会话不存在：${sessionId}`);
      if (index.bindingId !== current.character.bindingId) throw new Error('该会话不属于当前打开的角色卡。');
      this.closeLease();
      const lease = this.createLease(sessionId, current.character.bindingId);
      const owned = await lease.acquire(forceTakeover);
      const revisionStore = new SessionRevisionStore(this.fileClient, this.settingsStore, this.now);
      const persistence = new SessionPersistenceCoordinator({
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        characterName: current.character.name,
        lease: () => lease,
        store: revisionStore,
      });
      const revision = await persistence.load(sessionId);
      const service = await CardAgentSessionService.restore(
        {
          adapter,
          executor: this.executorFactory(profile),
          lock: this.lock,
          now: this.now,
          onPersist: (runtime, files) => persistence.persist(runtime, files),
          onUpdate: view => this.updateActive(view),
          readOnly: !owned,
          requestToolApproval: request => this.requestToolConfirmation(request),
          snapshots: new ContentAddressedSnapshotStore(
            new FileBackedBlobStore(current.character.bindingId, this.fileClient, this.settingsStore),
          ),
        },
        revision.runtime,
        revision.workingCopy,
      );
      this.activeLease = lease;
      this.activeService = service;
      this.state.leaseOwned = owned;
      this.state.currentCharacter = {
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        name: current.character.name,
      };
      this.updateActive(service.view());
    });
    return this.requireService().view();
  }

  async takeOverSession(): Promise<SessionView> {
    const sessionId = this.requireService().sessionId;
    return this.openSession(sessionId, true);
  }

  async send(message: string): Promise<SessionView> {
    return this.runView(() => this.requireService().send(message));
  }

  async resume(): Promise<SessionView> {
    return this.runView(() => this.requireService().resume());
  }

  async approve(decisions: Record<string, 'agent' | 'current'>): Promise<SessionView> {
    return this.runView(() => this.requireService().approve(decisions));
  }

  async undo(): Promise<SessionView> {
    return this.runView(() => this.requireService().undo());
  }

  async redo(): Promise<SessionView> {
    return this.runView(() => this.requireService().redo());
  }

  async resend(messageId: string): Promise<SessionView> {
    return this.runView(() => this.requireService().resend(messageId));
  }

  editUserMessage(messageId: string, content: string): void {
    this.requireService().editUserMessage(messageId, content);
  }

  enqueueGuidance(message: string): void {
    this.requireService().enqueueGuidance(message);
  }

  stop(): void {
    this.resolveToolConfirmation(false);
    this.activeService?.stop();
  }

  resolveToolConfirmation(approved: boolean): void {
    const resolve = this.toolConfirmationResolve;
    this.toolConfirmationResolve = undefined;
    this.state.toolConfirmation = undefined;
    resolve?.(approved);
    this.emit();
  }

  async saveProfile(input: ApiProfileInput): Promise<ApiProfile> {
    const registry = new ApiProfileRegistry(this.settingsStore.load().profiles);
    const existing = input.id ? registry.get(input.id) : undefined;
    const profile = existing ? await updateApiProfile(existing, input) : await createApiProfile(input);
    registry.save(profile);
    const settings = this.settingsStore.load();
    settings.profiles = registry.list();
    settings.activeProfileId = profile.id;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
    return profile;
  }

  async removeProfile(id: string): Promise<void> {
    const settings = this.settingsStore.load();
    settings.profiles = settings.profiles.filter(profile => profile.id !== id);
    if (settings.activeProfileId === id) settings.activeProfileId = settings.profiles[0]?.id;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  async selectProfile(id: string): Promise<void> {
    const settings = this.settingsStore.load();
    if (!settings.profiles.some(profile => profile.id === id)) throw new Error(`API Profile不存在：${id}`);
    settings.activeProfileId = id;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  async updateSettings(input: { developerMode?: boolean; floatingButton?: boolean }): Promise<void> {
    const settings = this.settingsStore.load();
    if (input.developerMode !== undefined) settings.developerMode = input.developerMode;
    if (input.floatingButton !== undefined) settings.floatingButton = input.floatingButton;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  destroy(): void {
    this.resolveToolConfirmation(false);
    this.closeLease();
    this.subscribers.clear();
  }

  private createLease(sessionId: string, bindingId: string): LeaseCoordinator {
    return new LeaseCoordinator({
      holderId: this.holderId,
      now: this.now,
      sessionId,
      store: new TavernLeaseRecordStore(this.fileClient, this.settingsStore, bindingId),
    });
  }

  private async ensureStableBinding(adapter: CardStateAdapter): Promise<CardWorkspaceState> {
    const current = await adapter.read();
    const settings = this.settingsStore.load();
    const collision = Object.values(settings.sessions).some(
      session =>
        session.bindingId === current.character.bindingId &&
        Boolean(session.avatarId) &&
        session.avatarId !== current.character.avatarId,
    );
    const target = klona(current);
    if (collision) target.character.bindingId = `binding:${crypto.randomUUID()}`;
    const materialized = materializeCardWorkspace(target, projectCardWorkspace(target)).state;
    const operations = diffCardStates(current, materialized);
    if (operations.length === 0) return current;
    const result = await commitWorkingCopy({
      adapter,
      base: current,
      decisions: Object.fromEntries(operations.map(operation => [operation.path, 'agent'])),
      working: materialized,
    });
    if (result.status === 'rolled-back') throw result.error;
    return result.state;
  }

  private async refreshSessionIndex(current: CardWorkspaceState): Promise<void> {
    const settings = this.settingsStore.load();
    let changed = false;
    for (const session of Object.values(settings.sessions)) {
      if (session.avatarId === current.character.avatarId && session.characterName !== current.character.name) {
        session.characterName = current.character.name;
        changed = true;
      }
    }
    if (changed) await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  private requireProfile(id = this.settingsStore.load().activeProfileId): ApiProfile {
    if (!id) throw new Error('请先保存并选择一套API设置。');
    const profile = this.settingsStore.load().profiles.find(item => item.id === id);
    if (!profile) throw new Error(`API Profile不存在：${id}`);
    return profile;
  }

  private requireService(): CardAgentSessionService {
    if (!this.activeService) throw new Error('请先创建或打开一个Agent会话。');
    return this.activeService;
  }

  private requestToolConfirmation(request: ToolConfirmation): Promise<boolean> {
    if (this.toolConfirmationResolve) throw new Error('已有高危工具正在等待确认。');
    this.state.toolConfirmation = request;
    this.emit();
    return new Promise(resolve => {
      this.toolConfirmationResolve = resolve;
    });
  }

  private updateActive(view: SessionView): void {
    this.state.active = view;
    this.emit();
  }

  private reloadSettingsState(): void {
    const settings = this.settingsStore.load();
    this.state.activeProfileId = settings.activeProfileId;
    this.state.developerMode = settings.developerMode;
    this.state.floatingButton = settings.floatingButton;
    this.state.profiles = settings.profiles;
    this.state.sessions = Object.values(settings.sessions).sort((left, right) => right.updatedAt - left.updatedAt);
    this.emit();
  }

  private closeLease(): void {
    this.activeLease?.close();
    this.activeLease = undefined;
    this.state.leaseOwned = false;
  }

  private async run(action: () => Promise<void>): Promise<DreamCardAgentRuntimeState> {
    this.state.busy = true;
    this.state.error = undefined;
    this.emit();
    try {
      await action();
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.state.busy = false;
      this.emit();
    }
    return this.snapshot();
  }

  private async runView(action: () => Promise<SessionView>): Promise<SessionView> {
    let result!: SessionView;
    await this.run(async () => {
      result = await action();
      this.updateActive(result);
      this.reloadSettingsState();
    });
    return result;
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.subscribers.forEach(subscriber => subscriber(snapshot));
  }
}

let globalRuntime: DreamCardAgentRuntime | undefined;

export function getDreamCardAgentRuntime(): DreamCardAgentRuntime {
  globalRuntime ??= new DreamCardAgentRuntime();
  return globalRuntime;
}
