import { klona } from 'klona';
import { MemoryBinaryBlobStore } from '../core/history/blob-store';
import { ContentAddressedSnapshotStore } from '../core/history/snapshot-store';
import { HistoryTimeline } from '../core/history/timeline';
import { materializeCardWorkspace, projectCardWorkspace } from '../core/mapping/card-workspace-mapper';
import type { CardWorkspaceState } from '../core/mapping/types';
import { GlobalTavernFileClient, type TavernFileClient } from '../core/persistence/file-client';
import {
  DreamCreatorWorkspaceFileStore,
  type CharacterFileStorageSummary,
} from '../core/persistence/workspace-file-store';
import { CharacterMetadataStore } from '../core/persistence/character-store';
import { PageDebugLog, type DebugLogEntry } from '../core/persistence/debug-log';
import { FileRegistryGarbageCollector } from '../core/persistence/garbage-collector';
import { SessionPersistenceCoordinator } from '../core/persistence/session-persistence';
import { SessionRevisionStore } from '../core/persistence/session-store';
import {
  DEFAULT_AGENT_CONFIGURATION_ID,
  TavernAgentSettingsStore,
  type AgentConfiguration,
  type AgentSettingsStore,
  type CharacterStoreReference,
  type FloatingButtonAnchor,
  type FloatingButtonOffset,
  type SessionIndexEntry,
} from '../core/persistence/settings';
import { cloneStructuredPreset, compilePreset, DEFAULT_PRESET, type StructuredPreset } from '../core/preset/compiler';
import { DEFAULT_CONTEXT_WINDOW } from '../core/provider/model-catalog';
import {
  ApiProfileRegistry,
  createApiProfile,
  listApiModels,
  normalizeProviderFailure,
  updateApiProfile,
  type ApiProfile,
  type ApiProfileInput,
} from '../core/provider/profiles';
import { ProfileModelStepExecutor, type ModelStepExecutor } from '../core/runner/step-executor';
import { measureContext } from '../core/runner/context';
import type { ToolConfirmation } from '../core/runner/tools';
import { CardAgentSessionService } from '../core/session/session-service';
import { defaultPresetValues } from '../core/session/prompt';
import { GlobalAgentTaskLock } from '../core/session/task-lock';
import type {
  PersistedSessionRuntime,
  SessionLifecycleStatus,
  SessionMode,
  SessionModelControls,
  SessionView,
} from '../core/session/types';
import { isImageAttachment, type SessionAttachmentInput } from '../core/session/attachments';
import { ExternalSessionAttachmentStore } from '../core/session/attachment-store';
import { GlobalSkillStore } from '../core/skills/global-skill-store';
import type { AgentSkill } from '../core/skills/types';
import { createGlobalTavernBridge, type TavernBridge } from '../core/tavern/bridge';
import { createGlobalTavernChatBridge, type TavernChatBridge } from '../core/tavern/chat-bridge';
import { ProductionCardStateAdapter } from '../core/tavern/production-adapter';
import type { CardStateAdapter } from '../core/transaction/adapter';
import { commitWorkingCopy } from '../core/transaction/commit';
import type { WorkspaceFile } from '../core/workspace/types';

export type DreamCardAgentRuntimeState = {
  active?: SessionView;
  activeSessionAccess: 'live' | 'readonly-history';
  activeAgentConfigurationId: string;
  activeProfileId?: string;
  activePresetId: string;
  agentConfigurations: AgentConfiguration[];
  busy: boolean;
  compressImages: boolean;
  characterGroups: CharacterSessionGroup[];
  currentCharacter?: { avatarId: string; bindingId: string; name: string };
  debugLogs: DebugLogEntry[];
  developerMode: boolean;
  dangerousNonCharacterResourceWrites: boolean;
  error?: string;
  floatingButton: boolean;
  floatingButtonAnchor: FloatingButtonAnchor;
  floatingButtonOffset: FloatingButtonOffset;
  loadedSessionIds: string[];
  onboardingDone: boolean;
  profiles: ApiProfile[];
  presetProfiles: StructuredPreset[];
  sendWithCtrlEnter: boolean;
  skills: AgentSkill[];
  storage: {
    characters: CharacterFileStorageSummary[];
    currentCharacterBytes: number;
    globalSkillBytes: number;
  };
  sessions: SessionIndexEntry[];
  sessionStatuses: Record<string, SessionLifecycleStatus>;
  toolConfirmation?: ToolConfirmation;
  warnings: string[];
};

export type CharacterSessionGroup = {
  available: boolean;
  avatarId?: string;
  bindingId: string;
  characterName: string;
  current: boolean;
  error?: string;
  sessions: SessionIndexEntry[];
  updatedAt: number;
};

type RuntimeOptions = {
  adapterFactory?: () => CardStateAdapter;
  bridge?: TavernBridge;
  chatBridge?: TavernChatBridge;
  executorFactory?: (profile: ApiProfile) => ModelStepExecutor;
  fileClient?: TavernFileClient;
  now?: () => number;
  settingsStore?: AgentSettingsStore;
};

type Subscriber = (state: DreamCardAgentRuntimeState) => void;

type DeferredSessionSave = {
  dirty: boolean;
  saving?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
};

const SESSION_OPTION_SAVE_DELAY_MS = 350;

function isSessionOperationActive(status: SessionLifecycleStatus): boolean {
  return ['awaiting-approval', 'committing', 'running', 'waiting-approval'].includes(status);
}

function retainedSnapshotBlobs(
  runtime: PersistedSessionRuntime,
  blobs: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  const retained = new Set(
    runtime.history.checkpoints
      .flatMap(checkpoint => [checkpoint.beforeSnapshot, checkpoint.afterSnapshot])
      .filter((hash): hash is string => Boolean(hash)),
  );
  if (runtime.pending?.candidateSnapshot) retained.add(runtime.pending.candidateSnapshot);
  return Object.fromEntries(Object.entries(blobs).filter(([hash]) => retained.has(hash)));
}

export class DreamCardAgentRuntime {
  private activeService?: CardAgentSessionService;
  private readonly adapterFactory: () => CardStateAdapter;
  private readonly bridge: TavernBridge;
  private readonly chatBridge?: TavernChatBridge;
  private readonly characterStore: CharacterMetadataStore;
  private readonly executorFactory: (profile: ApiProfile) => ModelStepExecutor;
  private readonly fileClient: TavernFileClient;
  private readonly workspaceFileStore: DreamCreatorWorkspaceFileStore;
  private readonly globalSkillStore: GlobalSkillStore;
  private readonly lock = new GlobalAgentTaskLock();
  private readonly log: PageDebugLog;
  private readonly now: () => number;
  private readonly settingsStore: AgentSettingsStore;
  private readonly services = new Map<string, CardAgentSessionService>();
  private readonly historyViews = new Map<string, SessionView>();
  private readonly settingsUnsubscribe?: () => void;
  private readonly subscribers = new Set<Subscriber>();
  private readonly deferredSessionSaves = new Map<string, DeferredSessionSave>();
  private toolConfirmationResolve?: (approved: boolean) => void;
  private busyCount = 0;
  private localDeferredSaveDepth = 0;
  private skillIndexSignature = '';
  private skillLoadPromise?: Promise<void>;
  private state: DreamCardAgentRuntimeState;

  constructor(options: RuntimeOptions = {}) {
    const bridge = options.bridge ?? createGlobalTavernBridge();
    this.bridge = bridge;
    const hasTavernChatGlobals =
      typeof SillyTavern !== 'undefined' &&
      typeof getChatMessages === 'function' &&
      typeof createChatMessages === 'function';
    this.chatBridge =
      options.chatBridge ?? (!options.bridge && hasTavernChatGlobals ? createGlobalTavernChatBridge() : undefined);
    this.adapterFactory = options.adapterFactory ?? (() => new ProductionCardStateAdapter(bridge));
    this.executorFactory = options.executorFactory ?? (profile => new ProfileModelStepExecutor(profile));
    this.fileClient = options.fileClient ?? new GlobalTavernFileClient();
    this.now = options.now ?? Date.now;
    this.log = new PageDebugLog(this.now);
    this.settingsStore = options.settingsStore ?? new TavernAgentSettingsStore();
    this.workspaceFileStore = new DreamCreatorWorkspaceFileStore(this.fileClient, this.settingsStore, this.now);
    this.characterStore = new CharacterMetadataStore(this.fileClient, this.settingsStore, this.now);
    this.globalSkillStore = new GlobalSkillStore(this.fileClient, this.settingsStore, this.now);
    const settings = this.settingsStore.load();
    this.state = {
      activeSessionAccess: 'live',
      activeAgentConfigurationId: settings.activeAgentConfigurationId,
      activeProfileId: settings.activeProfileId,
      activePresetId: settings.activePresetId,
      agentConfigurations: settings.agentConfigurations,
      busy: false,
      compressImages: settings.compressImages,
      characterGroups: [],
      debugLogs: [],
      developerMode: settings.developerMode,
      dangerousNonCharacterResourceWrites: settings.dangerousNonCharacterResourceWrites,
      floatingButton: settings.floatingButton,
      floatingButtonAnchor: settings.floatingButtonAnchor,
      floatingButtonOffset: settings.floatingButtonOffset,
      loadedSessionIds: [],
      onboardingDone: settings.onboardingDone,
      profiles: settings.profiles,
      presetProfiles: settings.presetProfiles,
      sendWithCtrlEnter: settings.sendWithCtrlEnter,
      skills: [],
      storage: { characters: this.workspaceFileStore.summaries(), currentCharacterBytes: 0, globalSkillBytes: 0 },
      sessions: [],
      sessionStatuses: {},
      warnings: [],
    };
    this.settingsUnsubscribe = this.settingsStore.subscribe?.(() => {
      this.reloadSettingsState();
      // 本页延迟保存模型选项时，角色索引内容已经由当前Runtime掌握；
      // 不再为了更新时间和文件大小重新下载索引。其它页面的广播仍走完整刷新。
      if (this.localDeferredSaveDepth > 0) return;
      void this.reloadCharacterSessions();
      void this.reloadCharacterGroups();
      void this.reloadSkills();
    });
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
      await this.activeService?.finalizeManualEdits();
      await this.reloadSkills();
      let current: CardWorkspaceState;
      try {
        current = await this.adapterFactory().read();
      } catch (error) {
        if (this.bridge.getCurrentCharacterId() && !this.bridge.getGroupId()) throw error;
        this.state.currentCharacter = undefined;
        this.state.sessions = [];
        await this.reloadCharacterGroups();
        return;
      }
      if (
        this.state.currentCharacter?.bindingId !== current.character.bindingId &&
        this.state.activeSessionAccess === 'live'
      ) {
        this.activeService = undefined;
        this.state.active = undefined;
      }
      this.state.currentCharacter = {
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        name: current.character.name,
      };
      await this.refreshSessionIndex(current);
      await this.reloadCharacterGroups();
    });
  }

  async switchCharacter(bindingId: string): Promise<void> {
    await this.run(async () => {
      await this.switchCharacterInternal(bindingId);
      await this.reloadCharacterGroups();
    });
  }

  async switchCharacterAndOpenSession(bindingId: string, sessionId: string): Promise<SessionView> {
    await this.switchCharacter(bindingId);
    this.historyViews.delete(sessionId);
    this.updateLoadedSessionIds();
    return this.openSession(sessionId);
  }

  async switchCharacterAndCreateSession(bindingId: string): Promise<SessionView> {
    await this.switchCharacter(bindingId);
    return this.createSession();
  }

  async openHistorySession(bindingId: string, sessionId: string): Promise<SessionView> {
    let result!: SessionView;
    await this.run(async () => {
      const group = this.state.characterGroups.find(item => item.bindingId === bindingId);
      if (group?.available) throw new Error('该角色卡仍然可用，请切换角色卡后打开会话。');
      const revision = await new SessionRevisionStore(this.fileClient, this.settingsStore, this.now).load(
        bindingId,
        sessionId,
      );
      result = this.createHistoryView(revision.entry, revision.runtime, revision.workingCopy);
      this.historyViews.set(sessionId, result);
      this.activeService = undefined;
      this.state.active = result;
      this.state.activeSessionAccess = 'readonly-history';
      this.updateLoadedSessionIds();
      this.emit();
    });
    return result;
  }

  async createSession(input: { mode?: SessionMode; profileId?: string; title?: string } = {}): Promise<SessionView> {
    await this.run(async () => {
      await this.activeService?.finalizeManualEdits();
      await this.reloadSkills();
      const profile = this.requireProfile(input.profileId);
      const agentConfiguration = this.selectedAgentConfiguration();
      const mountedSkills = this.skillsForConfiguration(agentConfiguration);
      const adapter = this.adapterFactory();
      const current = await this.ensureStableBinding(adapter);
      const revisionStore = new SessionRevisionStore(this.fileClient, this.settingsStore, this.now);
      const persistence = new SessionPersistenceCoordinator({
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        characterName: current.character.name,
        store: revisionStore,
      });
      const snapshotBlobs = new MemoryBinaryBlobStore();
      const sessionId = crypto.randomUUID();
      const attachmentStore = new ExternalSessionAttachmentStore(
        current.character.bindingId,
        this.workspaceFileStore,
        this.settingsStore,
      );
      const service = await CardAgentSessionService.create({
        adapter,
        attachmentStore,
        agentConfiguration,
        executor: this.executorFactory(profile),
        contextWindow: this.profileContextWindow(profile),
        lock: this.lock,
        mode: input.mode,
        canWriteNonCharacterResources: () => this.canWriteNonCharacterResources(),
        now: this.now,
        onPersist: async (runtime, files) => {
          await persistence.persist(runtime, files, retainedSnapshotBlobs(runtime, snapshotBlobs.dump()));
        },
        onSkillsCommit: (skills, mountedIds) => this.commitMountedSkills(skills, mountedIds),
        onUpdate: view => this.updateService(view),
        requestToolApproval: request => this.requestToolConfirmation(request),
        preset: this.selectedPreset(agentConfiguration.presetId),
        snapshots: new ContentAddressedSnapshotStore(snapshotBlobs),
        tavernBridge: this.bridge,
        tavernChatBridge: this.chatBridge,
        sessionId,
        skills: mountedSkills,
        title: input.title,
        workspaceFiles: await this.workspaceFileStore.project(current.character.bindingId, sessionId),
        workspaceStore: this.workspaceFileStore,
      });
      await service.save();
      this.services.set(service.sessionId, service);
      this.historyViews.delete(service.sessionId);
      this.activeService = service;
      this.state.activeSessionAccess = 'live';
      this.updateService(service.view());
      this.state.currentCharacter = {
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        name: current.character.name,
      };
      this.reloadSettingsState();
      await this.reloadCharacterSessions();
    });
    return this.requireService().view();
  }

  async openSession(sessionId: string): Promise<SessionView> {
    const historyView = this.historyViews.get(sessionId);
    if (historyView && historyView.bindingId !== this.state.currentCharacter?.bindingId) {
      this.activeService = undefined;
      this.state.active = historyView;
      this.state.activeSessionAccess = 'readonly-history';
      this.emit();
      return klona(historyView);
    }
    if (historyView) this.historyViews.delete(sessionId);
    await this.run(async () => {
      if (this.activeService?.sessionId !== sessionId) await this.activeService?.finalizeManualEdits();
      const loaded = this.services.get(sessionId);
      if (loaded) {
        if (loaded.view().bindingId !== this.state.currentCharacter?.bindingId) {
          throw new Error('该会话不属于当前打开的角色卡。');
        }
        this.activeService = loaded;
        this.state.activeSessionAccess = 'live';
        this.updateService(loaded.view());
        return;
      }
      const profile = this.requireProfile();
      const adapter = this.adapterFactory();
      const current = await adapter.read();
      const metadata = await this.characterStore.load(current.character.bindingId, {
        avatarId: current.character.avatarId,
        characterName: current.character.name,
      });
      const index = metadata.sessions[sessionId];
      if (!index) throw new Error(`会话不存在：${sessionId}`);
      if (index.bindingId !== current.character.bindingId) throw new Error('该会话不属于当前打开的角色卡。');
      const revisionStore = new SessionRevisionStore(this.fileClient, this.settingsStore, this.now);
      const persistence = new SessionPersistenceCoordinator({
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        characterName: current.character.name,
        store: revisionStore,
      });
      const revision = await persistence.load(sessionId);
      const snapshotBlobs = new MemoryBinaryBlobStore(revision.snapshotBlobs);
      const attachmentStore = new ExternalSessionAttachmentStore(
        current.character.bindingId,
        this.workspaceFileStore,
        this.settingsStore,
      );
      const service = await CardAgentSessionService.restore(
        {
          adapter,
          attachmentStore,
          executor: this.executorFactory(profile),
          contextWindow: this.profileContextWindow(profile),
          lock: this.lock,
          now: this.now,
          canWriteNonCharacterResources: () => this.canWriteNonCharacterResources(),
          onPersist: async (runtime, files) => {
            await persistence.persist(runtime, files, retainedSnapshotBlobs(runtime, snapshotBlobs.dump()));
          },
          onSkillsCommit: (skills, mountedIds) => this.commitMountedSkills(skills, mountedIds),
          onUpdate: view => this.updateService(view),
          requestToolApproval: request => this.requestToolConfirmation(request),
          snapshots: new ContentAddressedSnapshotStore(snapshotBlobs),
          tavernBridge: this.bridge,
          tavernChatBridge: this.chatBridge,
          workspaceFiles: await this.workspaceFileStore.project(current.character.bindingId, sessionId),
          workspaceStore: this.workspaceFileStore,
        },
        revision.runtime,
        revision.workingCopy,
      );
      this.services.set(service.sessionId, service);
      this.activeService = service;
      this.state.activeSessionAccess = 'live';
      this.state.currentCharacter = {
        avatarId: current.character.avatarId,
        bindingId: current.character.bindingId,
        name: current.character.name,
      };
      this.updateService(service.view());
      await this.reloadCharacterSessions();
    });
    return this.requireService().view();
  }

  /** 关闭页签只卸载前端运行实例，持久化的会话与快照仍保留，可从历史重新打开。 */
  async closeSession(sessionId: string): Promise<void> {
    if (this.historyViews.delete(sessionId)) {
      if (this.state.active?.sessionId === sessionId) {
        this.state.active = undefined;
        this.state.activeSessionAccess = 'live';
      }
      this.updateLoadedSessionIds();
      this.emit();
      return;
    }
    const loaded = this.services.get(sessionId);
    if (!loaded) return;
    if (isSessionOperationActive(loaded.view().status)) {
      throw new Error('运行中或等待处理的会话不能关闭，请先停止或完成当前操作。');
    }
    await this.flushDeferredSessionSave(loaded);
    await loaded.finalizeManualEdits();
    this.services.delete(sessionId);
    delete this.state.sessionStatuses[sessionId];
    if (this.activeService?.sessionId === sessionId) {
      this.activeService = undefined;
      this.state.active = undefined;
    }
    this.updateLoadedSessionIds();
    this.emit();
  }

  async send(message: string, attachments: SessionAttachmentInput[] = []): Promise<SessionView> {
    return this.runActiveView(async service => {
      const profile = this.requireProfile();
      if (attachments.some(isImageAttachment) && profile.modelSettings.capabilities.vision === 'disabled') {
        throw new Error('当前API Profile明确标记为不支持视觉，无法发送图片附件。');
      }
      await this.reloadSkills();
      const sessionConfiguration = this.settingsStore
        .load()
        .agentConfigurations.find(configuration => configuration.id === service.view().agentConfiguration.id);
      if (sessionConfiguration) {
        await service.syncAgentConfiguration(
          klona(sessionConfiguration),
          this.selectedPreset(sessionConfiguration.presetId),
          this.state.skills,
        );
      } else {
        await service.setSkills(this.state.skills);
      }
      return service.send(message, undefined, attachments);
    });
  }

  async resume(): Promise<SessionView> {
    return this.runActiveView(service => service.resume());
  }

  async setModelControls(controls: Partial<SessionModelControls>): Promise<SessionView> {
    const service = this.requireService();
    if (service.updateModelControls(controls)) this.scheduleDeferredSessionSave(service);
    return service.view();
  }

  async approve(decisions: Record<string, 'agent' | 'current'>): Promise<SessionView> {
    return this.runActiveView(service => service.approve(decisions));
  }

  async undo(): Promise<SessionView> {
    return this.runActiveView(service => service.undo());
  }

  async undoToUserMessage(messageId: string): Promise<SessionView> {
    return this.runActiveView(service => service.undoToUserMessage(messageId));
  }

  async redo(): Promise<SessionView> {
    return this.runActiveView(service => service.redo());
  }

  async resend(messageId: string): Promise<SessionView> {
    return this.runActiveView(service => service.resend(messageId));
  }

  async writeWorkingFile(path: string, content: string, overwriteConflict = false): Promise<SessionView> {
    return this.runActiveView(service => service.writeWorkingFile(path, content, overwriteConflict));
  }

  async useCurrentWorkingFile(path: string): Promise<SessionView> {
    return this.runActiveView(service => service.useCurrentWorkingFile(path));
  }

  async deleteWorkingPath(path: string): Promise<SessionView> {
    return this.runActiveView(service => service.deleteWorkingPath(path));
  }

  async deleteSession(sessionId: string): Promise<void> {
    const character = this.state.currentCharacter;
    if (!character) throw new Error('请先打开角色卡。');
    await this.deleteCharacterSession(character.bindingId, sessionId);
  }

  async deleteCharacterSession(bindingId: string, sessionId: string): Promise<void> {
    await this.run(async () => {
      const loaded = this.services.get(sessionId);
      if (loaded && isSessionOperationActive(loaded.view().status)) {
        throw new Error('运行中的会话不能删除，请先停止任务。');
      }
      if (loaded) await this.discardDeferredSessionSave(loaded);
      const removed = await this.characterStore.removeSession(bindingId, sessionId);
      if (!removed) throw new Error(`会话不存在：${sessionId}`);
      await this.workspaceFileStore.releaseSession(bindingId, sessionId);
      this.services.delete(sessionId);
      this.historyViews.delete(sessionId);
      delete this.state.sessionStatuses[sessionId];
      if (this.activeService?.sessionId === sessionId || this.state.active?.sessionId === sessionId) {
        this.activeService = undefined;
        this.state.active = undefined;
        this.state.activeSessionAccess = 'live';
      }
      this.updateLoadedSessionIds();
      if (bindingId === this.state.currentCharacter?.bindingId) await this.reloadCharacterSessions();
      await this.reloadCharacterGroups();
    });
  }

  async clearCurrentCharacterSessions(): Promise<void> {
    await this.run(async () => {
      const character = this.state.currentCharacter;
      if (!character) throw new Error('请先打开角色卡。');
      const running = [...this.services.values()].some(
        service => service.view().bindingId === character.bindingId && isSessionOperationActive(service.view().status),
      );
      if (running) throw new Error('当前角色仍有运行中的会话，请先停止任务。');
      await Promise.all(
        [...this.services.values()]
          .filter(service => service.view().bindingId === character.bindingId)
          .map(service => this.discardDeferredSessionSave(service)),
      );
      await this.characterStore.removeCharacter(character.bindingId);
      await this.workspaceFileStore.resetCharacter(character.bindingId);
      for (const [id, service] of this.services) {
        if (service.view().bindingId === character.bindingId) this.services.delete(id);
      }
      if (this.activeService?.view().bindingId === character.bindingId) {
        this.activeService = undefined;
        this.state.active = undefined;
      }
      this.state.sessions = [];
      this.state.storage.currentCharacterBytes = 0;
      this.emit();
    });
  }

  async cleanupCurrentCharacterStorage(): Promise<{ cleanedSessions: number; removedFiles: number }> {
    let cleanedSessions = 0;
    let removedFiles = 0;
    await this.run(async () => {
      const character = this.state.currentCharacter;
      if (!character) throw new Error('请先打开角色卡。');
      const metadata = await this.characterStore.load(character.bindingId, {
        avatarId: character.avatarId,
        characterName: character.name,
      });
      const store = new SessionRevisionStore(this.fileClient, this.settingsStore, this.now);
      for (const entry of Object.values(metadata.sessions)) {
        const revision = await store.load(character.bindingId, entry.sessionId);
        const timeline = new HistoryTimeline({
          checkpoints: revision.runtime.history.checkpoints,
          now: this.now,
          position: revision.runtime.history.position,
        });
        const removedCheckpoints = timeline.cleanupAbandoned();
        revision.runtime.history = timeline.export();
        const blobs = retainedSnapshotBlobs(revision.runtime, revision.snapshotBlobs);
        if (
          removedCheckpoints.length === 0 &&
          Object.keys(blobs).length === Object.keys(revision.snapshotBlobs).length
        ) {
          continue;
        }
        await store.commit({
          avatarId: character.avatarId,
          bindingId: character.bindingId,
          characterName: character.name,
          runtime: revision.runtime,
          snapshotBlobs: blobs,
          status: entry.status,
          workingCopy: revision.workingCopy,
        });
        cleanedSessions += 1;
      }
      removedFiles = await this.workspaceFileStore.clearCache(character.bindingId);
      removedFiles += (
        await new FileRegistryGarbageCollector(this.fileClient, this.settingsStore, this.now).collect([], 0)
      ).length;
      await this.reloadCharacterSessions();
    });
    return { cleanedSessions, removedFiles };
  }

  storageOverview(): CharacterFileStorageSummary[] {
    return this.workspaceFileStore.summaries();
  }

  async clearCharacterCache(bindingId: string): Promise<number> {
    return this.runStorageAction([bindingId], async () => this.workspaceFileStore.clearCache(bindingId));
  }

  async clearAllCache(): Promise<number> {
    return this.runStorageAction(undefined, async () => this.workspaceFileStore.clearCache());
  }

  async clearCharacterAttachments(bindingId: string): Promise<number> {
    return this.runStorageAction([bindingId], async () => this.workspaceFileStore.clearAttachments(bindingId));
  }

  async clearAllAttachments(): Promise<number> {
    return this.runStorageAction(undefined, async () => this.workspaceFileStore.clearAttachments());
  }

  async removeManagedFile(fileId: string): Promise<void> {
    const file = this.workspaceFileStore.getReference(fileId);
    if (!file) return;
    await this.runStorageAction([file.bindingId], async () => {
      await this.workspaceFileStore.removeImmediately(fileId);
    });
  }

  async resetCharacterData(bindingId: string): Promise<void> {
    await this.runStorageAction([bindingId], async () => {
      await this.characterStore.removeCharacter(bindingId).catch(() => []);
      await this.workspaceFileStore.resetCharacter(bindingId);
      const settings = this.settingsStore.load();
      const legacy = Object.entries(settings.files).filter(([, file]) => file.bindingId === bindingId);
      legacy.forEach(([key]) => delete settings.files[key]);
      await this.settingsStore.save(settings);
      for (const [, file] of legacy) await this.fileClient.delete(file.url).catch(() => undefined);
      await this.unloadCharacterServices(bindingId);
    });
  }

  async resetAllData(): Promise<void> {
    const settings = this.settingsStore.load();
    const bindings = [
      ...new Set([
        ...Object.keys(settings.characterStores),
        ...this.workspaceFileStore.listReferences().map(file => file.bindingId),
      ]),
    ];
    await this.runStorageAction(undefined, async () => {
      for (const bindingId of bindings) {
        await this.characterStore.removeCharacter(bindingId).catch(() => []);
        await this.workspaceFileStore.resetCharacter(bindingId);
        await this.unloadCharacterServices(bindingId);
      }
      const latest = this.settingsStore.load();
      const legacy = Object.entries(latest.files).filter(([, file]) => file.bindingId !== 'global');
      legacy.forEach(([key]) => delete latest.files[key]);
      await this.settingsStore.save(latest);
      for (const [, file] of legacy) await this.fileClient.delete(file.url).catch(() => undefined);
      this.state.sessions = [];
      this.state.storage.currentCharacterBytes = 0;
    });
  }

  async saveGlobalSkill(skill: AgentSkill): Promise<AgentSkill> {
    let saved!: AgentSkill;
    await this.run(async () => {
      saved = await this.globalSkillStore.save(skill);
      this.skillIndexSignature = '';
      await this.reloadSkills(true);
    });
    return saved;
  }

  async loadGlobalSkill(id: string): Promise<AgentSkill> {
    return this.globalSkillStore.load(id);
  }

  async removeGlobalSkill(id: string): Promise<void> {
    await this.run(async () => {
      await this.globalSkillStore.remove(id);
      const settings = this.settingsStore.load();
      settings.agentConfigurations = settings.agentConfigurations.map(configuration => ({
        ...configuration,
        skillIds: configuration.skillIds.filter(skillId => skillId !== id),
      }));
      await this.settingsStore.save(settings);
      this.skillIndexSignature = '';
      await this.reloadSkills(true);
    });
  }

  async saveAgentConfiguration(input: AgentConfiguration): Promise<AgentConfiguration> {
    if (input.id === DEFAULT_AGENT_CONFIGURATION_ID) {
      throw new Error('内置Agent不可编辑，请先另存为新的Agent配置。');
    }
    const settings = this.settingsStore.load();
    const name = input.name.trim();
    if (!name) throw new Error('Agent配置名称不能为空。');
    if (!settings.presetProfiles.some(preset => preset.id === input.presetId)) {
      throw new Error(`Agent配置引用的预设不存在：${input.presetId}`);
    }
    const knownSkillIds = new Set(Object.keys(settings.globalSkills));
    const configuration: AgentConfiguration = {
      id: input.id || `agent:${crypto.randomUUID()}`,
      name,
      presetId: input.presetId,
      skillIds: [...new Set(input.skillIds.filter(id => knownSkillIds.has(id)))],
    };
    const index = settings.agentConfigurations.findIndex(item => item.id === configuration.id);
    if (index >= 0) settings.agentConfigurations[index] = configuration;
    else settings.agentConfigurations.push(configuration);
    settings.activeAgentConfigurationId = configuration.id;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
    return klona(configuration);
  }

  async selectAgentConfiguration(id: string): Promise<void> {
    const settings = this.settingsStore.load();
    if (!settings.agentConfigurations.some(configuration => configuration.id === id)) {
      throw new Error(`Agent配置不存在：${id}`);
    }
    settings.activeAgentConfigurationId = id;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  async removeAgentConfiguration(id: string): Promise<void> {
    if (id === DEFAULT_AGENT_CONFIGURATION_ID) throw new Error('内置Agent不可删除。');
    const settings = this.settingsStore.load();
    if (settings.agentConfigurations.length <= 1) throw new Error('至少需要保留一套Agent配置。');
    const next = settings.agentConfigurations.filter(configuration => configuration.id !== id);
    if (next.length === settings.agentConfigurations.length) throw new Error(`Agent配置不存在：${id}`);
    settings.agentConfigurations = next;
    if (settings.activeAgentConfigurationId === id) settings.activeAgentConfigurationId = next[0].id;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  async applyAgentConfiguration(id: string): Promise<void> {
    await this.reloadSkills();
    const settings = this.settingsStore.load();
    const configuration = settings.agentConfigurations.find(item => item.id === id);
    if (!configuration) throw new Error(`Agent配置不存在：${id}`);
    await this.requireService().applyAgentConfiguration(
      klona(configuration),
      this.selectedPreset(configuration.presetId),
      this.state.skills,
    );
  }

  async renameSession(title: string): Promise<SessionView> {
    return this.runActiveView(service => service.rename(title));
  }

  async setMode(mode: SessionMode): Promise<void> {
    this.requireService().setMode(mode);
  }

  async applyPreset(preset: StructuredPreset): Promise<void> {
    await this.requireService().applyPreset(preset);
  }

  async savePresetProfile(input: StructuredPreset): Promise<StructuredPreset> {
    if (input.id === DEFAULT_PRESET.id) throw new Error('内置预设不可编辑，请先另存为新的Profile。');
    const name = input.name.trim();
    if (!name) throw new Error('预设名称不能为空。');
    if (input.nodes.length === 0) throw new Error('预设至少需要一个节点。');
    const invalidNode = input.nodes.find(
      node =>
        !node ||
        typeof node.id !== 'string' ||
        node.id.trim() === '' ||
        typeof node.title !== 'string' ||
        typeof node.content !== 'string' ||
        typeof node.enabled !== 'boolean' ||
        !['assistant', 'system', 'user'].includes(node.role) ||
        !Number.isFinite(node.order),
    );
    if (invalidNode) throw new Error('预设节点缺少合法的ID、标题、角色、顺序、启用状态或正文。');
    const duplicateNode = input.nodes.find(
      (node, index) => input.nodes.findIndex(item => item.id === node.id) !== index,
    );
    if (duplicateNode) throw new Error(`预设节点ID重复：${duplicateNode.id}`);
    const settings = this.settingsStore.load();
    const existing = settings.presetProfiles.find(item => item.id === input.id);
    const preset = cloneStructuredPreset({
      ...input,
      id: input.id || `preset:${crypto.randomUUID()}`,
      name,
      version: existing ? Math.max(existing.version + 1, input.version) : Math.max(1, input.version),
    });
    const activeConfiguration = settings.agentConfigurations.find(
      configuration => configuration.id === settings.activeAgentConfigurationId,
    );
    await compilePreset(
      preset,
      defaultPresetValues(
        activeConfiguration ? this.skillsForConfiguration(activeConfiguration) : this.state.skills,
      ),
    );
    const index = settings.presetProfiles.findIndex(item => item.id === preset.id);
    if (index >= 0) settings.presetProfiles[index] = preset;
    else settings.presetProfiles.push(preset);
    settings.activePresetId = preset.id;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
    return cloneStructuredPreset(preset);
  }

  async selectPresetProfile(id: string): Promise<void> {
    const settings = this.settingsStore.load();
    if (!settings.presetProfiles.some(preset => preset.id === id)) throw new Error(`预设Profile不存在：${id}`);
    settings.activePresetId = id;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  async removePresetProfile(id: string): Promise<void> {
    if (id === DEFAULT_PRESET.id) throw new Error('内置预设不可删除。');
    const settings = this.settingsStore.load();
    const usedBy = settings.agentConfigurations.filter(configuration => configuration.presetId === id);
    if (usedBy.length) {
      throw new Error(`该预设正被Agent配置“${usedBy.map(item => item.name).join('、')}”使用，请先调整配置。`);
    }
    if (settings.presetProfiles.length <= 1) throw new Error('至少需要保留一个预设Profile。');
    const next = settings.presetProfiles.filter(preset => preset.id !== id);
    if (next.length === settings.presetProfiles.length) throw new Error(`预设Profile不存在：${id}`);
    settings.presetProfiles = next;
    if (settings.activePresetId === id) settings.activePresetId = next[0].id;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
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
    this.assertProfileSwitchAllowed();
    const name = input.name.trim().normalize('NFC');
    if (!name) throw new Error('API Profile名称不能为空。');
    const registry = new ApiProfileRegistry(this.settingsStore.load().profiles);
    const source = input.id ? registry.get(input.id) : undefined;
    const sameName = registry.getByName(name);
    let profile: ApiProfile;
    if (sameName) {
      profile = await updateApiProfile(sameName, { ...input, id: sameName.id, name });
    } else if (source) {
      profile = { ...(await updateApiProfile(source, { ...input, name })), id: crypto.randomUUID() };
    } else {
      profile = await createApiProfile({ ...input, id: undefined, name });
    }
    registry.save(profile);
    const settings = this.settingsStore.load();
    settings.profiles = registry.list();
    settings.activeProfileId = profile.id;
    await this.settingsStore.save(settings);
    await this.updateActiveExecutor(profile);
    this.reloadSettingsState();
    return profile;
  }

  async listModels(input: ApiProfileInput): Promise<string[]> {
    let models: string[] = [];
    await this.run(async () => {
      const existing = input.id ? new ApiProfileRegistry(this.settingsStore.load().profiles).get(input.id) : undefined;
      const profile = existing ? await updateApiProfile(existing, input) : await createApiProfile(input);
      try {
        models = await listApiModels(profile);
      } catch (error) {
        throw new Error(normalizeProviderFailure(error).message, { cause: error });
      }
    });
    return models;
  }

  async removeProfile(id: string): Promise<void> {
    this.assertProfileSwitchAllowed();
    const settings = this.settingsStore.load();
    settings.profiles = settings.profiles.filter(profile => profile.id !== id);
    if (settings.activeProfileId === id) settings.activeProfileId = settings.profiles[0]?.id;
    await this.settingsStore.save(settings);
    const next = settings.profiles.find(profile => profile.id === settings.activeProfileId);
    if (next) await this.updateActiveExecutor(next);
    this.reloadSettingsState();
  }

  async selectProfile(id: string): Promise<void> {
    const settings = this.settingsStore.load();
    if (!settings.profiles.some(profile => profile.id === id)) throw new Error(`API Profile不存在：${id}`);
    this.assertProfileSwitchAllowed();
    settings.activeProfileId = id;
    await this.settingsStore.save(settings);
    await this.updateActiveExecutor(settings.profiles.find(profile => profile.id === id)!);
    this.reloadSettingsState();
  }

  async updateSettings(input: {
    compressImages?: boolean;
    dangerousNonCharacterResourceWrites?: boolean;
    developerMode?: boolean;
    floatingButton?: boolean;
    floatingButtonAnchor?: FloatingButtonAnchor;
    floatingButtonOffset?: FloatingButtonOffset;
    onboardingDone?: boolean;
    sendWithCtrlEnter?: boolean;
  }): Promise<void> {
    const settings = this.settingsStore.load();
    if (input.compressImages !== undefined) settings.compressImages = input.compressImages;
    if (input.dangerousNonCharacterResourceWrites !== undefined) {
      if (!settings.developerMode && input.dangerousNonCharacterResourceWrites) {
        throw new Error('请先开启开发者模式，再启用非角色正则与脚本写入权限。');
      }
      settings.dangerousNonCharacterResourceWrites = input.dangerousNonCharacterResourceWrites;
    }
    if (input.developerMode !== undefined) settings.developerMode = input.developerMode;
    if (input.floatingButton !== undefined) settings.floatingButton = input.floatingButton;
    if (input.floatingButtonAnchor !== undefined) settings.floatingButtonAnchor = input.floatingButtonAnchor;
    if (input.floatingButtonOffset !== undefined) settings.floatingButtonOffset = input.floatingButtonOffset;
    if (input.onboardingDone !== undefined) settings.onboardingDone = input.onboardingDone;
    if (input.sendWithCtrlEnter !== undefined) settings.sendWithCtrlEnter = input.sendWithCtrlEnter;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  destroy(): void {
    this.resolveToolConfirmation(false);
    for (const service of this.services.values()) {
      const pending = this.deferredSessionSaves.get(service.sessionId);
      if (!pending) continue;
      if (pending.timer) {
        clearTimeout(pending.timer);
        pending.timer = undefined;
      }
      // 页面卸载无法保证异步请求完成，但仍立即发起一次尽力保存，而不是主动丢弃。
      void this.flushDeferredSessionSave(service).catch(() => undefined);
    }
    this.subscribers.clear();
    this.settingsUnsubscribe?.();
    this.settingsStore.destroy?.();
  }

  diagnosticBundle(): DebugLogEntry[] {
    return this.log.diagnosticBundle();
  }

  private async ensureStableBinding(adapter: CardStateAdapter): Promise<CardWorkspaceState> {
    const current = await adapter.read();
    const settings = this.settingsStore.load();
    const storedCharacter = settings.characterStores[current.character.bindingId];
    const collision = Boolean(storedCharacter?.avatarId && storedCharacter.avatarId !== current.character.avatarId);
    const target = klona(current);
    if (collision) target.character.bindingId = `binding:${crypto.randomUUID()}`;
    const materialized = materializeCardWorkspace(target, projectCardWorkspace(target)).state;
    const result = await commitWorkingCopy({
      adapter,
      base: current,
      decisions: {},
      metadataBindingId: materialized.character.bindingId,
      working: materialized,
    });
    if (result.status === 'rolled-back') throw result.error;
    return result.state;
  }

  private async switchCharacterInternal(bindingId: string): Promise<void> {
    if (this.state.currentCharacter?.bindingId === bindingId) return;
    if (
      this.state.toolConfirmation ||
      [...this.services.values()].some(service => isSessionOperationActive(service.view().status))
    ) {
      throw new Error('仍有会话正在运行或等待处理，暂时不能切换角色卡。');
    }
    await this.activeService?.finalizeManualEdits();
    const reference = this.settingsStore.load().characterStores[bindingId];
    if (!reference?.avatarId) throw new Error('角色卡已不可用，只能查看其历史记录。');
    const target = this.bridge.listCharacters().find(character => character.avatarId === reference.avatarId);
    if (!target) throw new Error('角色卡已不可用，只能查看其历史记录。');
    await this.bridge.selectCharacterById(target.index);
    const current = await this.adapterFactory().read();
    if (current.character.bindingId !== bindingId) {
      throw new Error('角色卡切换后的绑定校验失败，已停止打开会话。');
    }
    this.state.currentCharacter = {
      avatarId: current.character.avatarId,
      bindingId: current.character.bindingId,
      name: current.character.name,
    };
    this.activeService = undefined;
    this.state.active = undefined;
    this.state.activeSessionAccess = 'live';
    await this.refreshSessionIndex(current);
  }

  private createHistoryView(
    entry: SessionIndexEntry,
    runtime: PersistedSessionRuntime,
    workingFiles: WorkspaceFile[],
  ): SessionView {
    const configuration = runtime.agentConfiguration ?? this.selectedAgentConfiguration();
    const pending = runtime.pending;
    return {
      agentConfiguration: klona(configuration),
      approval: pending
        ? {
            candidateSnapshot: pending.candidateSnapshot,
            conflicts: klona(pending.preparation.conflicts),
            fileChanges: klona(pending.fileChanges ?? []),
            midRun: pending.midRun === true,
            skillChanges: klona(pending.skillChanges ?? []),
            stateChanges: klona(
              pending.preparation.agentChanges.filter(
                change => !pending.preparation.redundantPaths.includes(change.path),
              ),
            ),
            warnings: [...pending.warnings],
          }
        : undefined,
      bindingId: entry.bindingId,
      characterName: entry.characterName,
      contextUsage: measureContext(runtime.modelMessages, DEFAULT_CONTEXT_WINDOW),
      error: runtime.lastError,
      events: klona(runtime.events),
      mode: runtime.mode,
      modelControls: klona(runtime.modelControls ?? { reasoningEffort: 'auto', webSearch: false }),
      preset: cloneStructuredPreset(runtime.preset),
      sessionId: runtime.sessionId,
      skills: klona(runtime.skills),
      status: runtime.status,
      title: runtime.title,
      ui: klona(runtime.ui.filter(item => !item.hidden)),
      warnings: [...(runtime.warnings ?? [])],
      workingChanges: [],
      workingFiles: workingFiles.map(file => ({ ...klona(file), readonly: true })),
    };
  }

  private async refreshSessionIndex(current: CardWorkspaceState): Promise<void> {
    const metadata = await this.characterStore.load(current.character.bindingId, {
      avatarId: current.character.avatarId,
      characterName: current.character.name,
    });
    let changed =
      metadata.revision > 0 &&
      (metadata.characterName !== current.character.name || metadata.avatarId !== current.character.avatarId);
    metadata.avatarId = current.character.avatarId;
    metadata.characterName = current.character.name;
    for (const session of Object.values(metadata.sessions)) {
      if (session.characterName !== current.character.name || session.avatarId !== current.character.avatarId)
        changed = true;
      session.characterName = current.character.name;
      session.avatarId = current.character.avatarId;
    }
    if (changed) await this.characterStore.save(metadata);
    this.state.sessions = Object.values(metadata.sessions).sort((left, right) => right.updatedAt - left.updatedAt);
    const reference = this.settingsStore.load().characterStores[current.character.bindingId];
    const workspaceBytes = this.workspaceFileStore
      .listReferences(current.character.bindingId)
      .reduce((total, file) => total + file.size, 0);
    this.state.storage.currentCharacterBytes =
      (reference?.size ?? 0) + this.state.sessions.reduce((total, session) => total + session.size, 0) + workspaceBytes;
    this.reloadSettingsState();
  }

  private async reloadCharacterSessions(): Promise<void> {
    const character = this.state.currentCharacter;
    if (!character) {
      this.state.sessions = [];
      return;
    }
    try {
      const metadata = await this.characterStore.load(character.bindingId, {
        avatarId: character.avatarId,
        characterName: character.name,
      });
      this.state.sessions = Object.values(metadata.sessions).sort((left, right) => right.updatedAt - left.updatedAt);
      const reference = this.settingsStore.load().characterStores[character.bindingId];
      const workspaceBytes = this.workspaceFileStore
        .listReferences(character.bindingId)
        .reduce((total, file) => total + file.size, 0);
      this.state.storage.currentCharacterBytes =
        (reference?.size ?? 0) +
        this.state.sessions.reduce((total, session) => total + session.size, 0) +
        workspaceBytes;
      this.emit();
    } catch (error) {
      this.addDebug('warn', '读取角色会话索引失败', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async reloadCharacterGroups(): Promise<void> {
    const settings = this.settingsStore.load();
    const availableByAvatar = new Map(this.bridge.listCharacters().map(character => [character.avatarId, character]));
    const current = this.state.currentCharacter;
    const references = new Map<string, CharacterStoreReference>(
      Object.values(settings.characterStores).map(reference => [reference.bindingId, reference]),
    );
    if (current && !references.has(current.bindingId)) {
      references.set(current.bindingId, {
        avatarId: current.avatarId,
        bindingId: current.bindingId,
        characterName: current.name,
        revision: 0,
        sha256: '',
        size: 0,
        updatedAt: this.now(),
        url: '',
      });
    }
    const groups = await Promise.all(
      [...references.values()].map(async reference => {
        try {
          const metadata = reference.url
            ? await this.characterStore.load(reference.bindingId)
            : {
                avatarId: reference.avatarId,
                bindingId: reference.bindingId,
                characterName: reference.characterName,
                sessions: {},
                updatedAt: reference.updatedAt,
              };
          const sessions = Object.values(metadata.sessions).sort((left, right) => right.updatedAt - left.updatedAt);
          const isCurrent = current?.bindingId === reference.bindingId;
          return {
            available: Boolean(isCurrent || (reference.avatarId && availableByAvatar.has(reference.avatarId))),
            avatarId: current && isCurrent ? current.avatarId : reference.avatarId,
            bindingId: reference.bindingId,
            characterName: current && isCurrent ? current.name : metadata.characterName || reference.characterName,
            current: isCurrent,
            sessions,
            updatedAt: sessions[0]?.updatedAt ?? metadata.updatedAt ?? reference.updatedAt,
          } satisfies CharacterSessionGroup;
        } catch (error) {
          return {
            available: false,
            avatarId: reference.avatarId,
            bindingId: reference.bindingId,
            characterName: reference.characterName,
            current: current?.bindingId === reference.bindingId,
            error: error instanceof Error ? error.message : String(error),
            sessions: [],
            updatedAt: reference.updatedAt,
          } satisfies CharacterSessionGroup;
        }
      }),
    );
    this.state.characterGroups = groups
      .filter(group => group.current || group.sessions.length > 0)
      .sort((left, right) => {
        if (left.current !== right.current) return left.current ? -1 : 1;
        if (left.available !== right.available) return left.available ? -1 : 1;
        return right.updatedAt - left.updatedAt;
      });
    this.emit();
  }

  private requireProfile(id = this.settingsStore.load().activeProfileId): ApiProfile {
    if (!id) throw new Error('请先保存并选择一套API设置。');
    const profile = this.settingsStore.load().profiles.find(item => item.id === id);
    if (!profile) throw new Error(`API Profile不存在：${id}`);
    return profile;
  }

  private selectedAgentConfiguration(): AgentConfiguration {
    const settings = this.settingsStore.load();
    const configuration =
      settings.agentConfigurations.find(item => item.id === settings.activeAgentConfigurationId) ??
      settings.agentConfigurations[0];
    if (!configuration) throw new Error('请先创建一套Agent配置。');
    return klona(configuration);
  }

  private selectedPreset(id = this.settingsStore.load().activePresetId): StructuredPreset {
    const settings = this.settingsStore.load();
    const preset = settings.presetProfiles.find(item => item.id === id) ?? settings.presetProfiles[0];
    if (!preset) throw new Error('请先创建一套结构化预设。');
    return cloneStructuredPreset(preset);
  }

  private skillsForConfiguration(configuration: AgentConfiguration): AgentSkill[] {
    const enabled = new Set(configuration.skillIds);
    return this.state.skills.filter(skill => enabled.has(skill.id));
  }

  private async commitMountedSkills(skills: AgentSkill[], previouslyMountedSkillIds: string[]): Promise<AgentSkill[]> {
    const mounted = new Set(previouslyMountedSkillIds);
    const combined = [
      ...new Map(
        [...this.state.skills.filter(skill => !mounted.has(skill.id)), ...skills].map(skill => [skill.id, skill]),
      ).values(),
    ];
    const saved = await this.globalSkillStore.replace(combined);
    this.state.skills = saved;
    this.skillIndexSignature = this.currentSkillIndexSignature();
    this.emit();
    const activeIds = new Set(skills.map(skill => skill.id));
    return saved.filter(skill => activeIds.has(skill.id));
  }

  private currentSkillIndexSignature(): string {
    return JSON.stringify(
      Object.values(this.settingsStore.load().globalSkills)
        .map(skill => [
          skill.id,
          skill.revision,
          skill.url,
          Object.values(skill.files ?? {})
            .map(file => [file.path, file.sha256, file.url])
            .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
        ])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );
  }

  private async reloadSkills(force = false): Promise<void> {
    const signature = this.currentSkillIndexSignature();
    if (!force && signature === this.skillIndexSignature) return;
    if (this.skillLoadPromise) return this.skillLoadPromise;
    this.skillLoadPromise = (async () => {
      this.state.skills = await this.globalSkillStore.list();
      this.skillIndexSignature = this.currentSkillIndexSignature();
      this.emit();
    })();
    try {
      await this.skillLoadPromise;
    } finally {
      this.skillLoadPromise = undefined;
    }
  }

  private async runStorageAction<T>(bindingIds: string[] | undefined, action: () => Promise<T>): Promise<T> {
    let result!: T;
    await this.run(async () => {
      const affected = bindingIds ? new Set(bindingIds) : undefined;
      const running = [...this.services.values()].some(service => {
        const view = service.view();
        return (!affected || affected.has(view.bindingId)) && isSessionOperationActive(view.status);
      });
      if (running) throw new Error('受影响的角色仍有运行中的会话，请先停止Agent。');
      result = await action();
      for (const service of this.services.values()) {
        if (!affected || affected.has(service.view().bindingId)) await service.refreshManagedFiles();
      }
      this.reloadSettingsState();
      await this.reloadCharacterSessions();
      this.emit();
    });
    return result;
  }

  private async unloadCharacterServices(bindingId: string): Promise<void> {
    for (const [sessionId, service] of this.services) {
      if (service.view().bindingId !== bindingId) continue;
      await this.discardDeferredSessionSave(service);
      this.services.delete(sessionId);
      delete this.state.sessionStatuses[sessionId];
    }
    if (this.activeService?.view().bindingId === bindingId) {
      this.activeService = undefined;
      this.state.active = undefined;
    }
    this.updateLoadedSessionIds();
  }

  private assertProfileSwitchAllowed(): void {
    if ([...this.services.values()].some(service => ['running', 'waiting-approval'].includes(service.view().status))) {
      throw new Error('Agent运行期间不能切换API Profile。');
    }
  }

  private async updateActiveExecutor(profile: ApiProfile): Promise<void> {
    for (const service of this.services.values()) {
      await this.flushDeferredSessionSave(service);
      const effort = service.view().modelControls.reasoningEffort;
      if (
        effort !== 'auto' &&
        effort !== 'off' &&
        !profile.modelSettings.reasoningEfforts.some(item => item.id === effort)
      ) {
        await service.setModelControls({ reasoningEffort: 'auto' });
      }
      await service.setExecutor(this.executorFactory(profile), this.profileContextWindow(profile));
    }
  }

  private profileContextWindow(profile: ApiProfile): number {
    return profile.modelSettings.contextWindow || DEFAULT_CONTEXT_WINDOW;
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

  private updateService(view: SessionView): void {
    this.state.sessionStatuses[view.sessionId] = view.status;
    this.updateLoadedSessionIds();
    if (this.activeService?.sessionId === view.sessionId) {
      this.state.active = view;
      this.state.activeSessionAccess = 'live';
    }
    this.emit();
  }

  private updateLoadedSessionIds(): void {
    this.state.loadedSessionIds = [...new Set([...this.services.keys(), ...this.historyViews.keys()])];
  }

  private reloadSettingsState(): void {
    const settings = this.settingsStore.load();
    this.state.activeAgentConfigurationId = settings.activeAgentConfigurationId;
    this.state.activeProfileId = settings.activeProfileId;
    this.state.activePresetId = settings.activePresetId;
    this.state.agentConfigurations = settings.agentConfigurations;
    this.state.compressImages = settings.compressImages;
    this.state.developerMode = settings.developerMode;
    this.state.dangerousNonCharacterResourceWrites = settings.dangerousNonCharacterResourceWrites;
    this.state.floatingButton = settings.floatingButton;
    this.state.floatingButtonAnchor = settings.floatingButtonAnchor;
    this.state.floatingButtonOffset = settings.floatingButtonOffset;
    this.state.onboardingDone = settings.onboardingDone;
    this.state.profiles = settings.profiles;
    this.state.presetProfiles = settings.presetProfiles;
    this.state.sendWithCtrlEnter = settings.sendWithCtrlEnter;
    this.state.storage.globalSkillBytes = Object.values(settings.files)
      .filter(file => file.bindingId === 'global')
      .reduce((total, file) => total + file.size, 0);
    this.state.storage.characters = this.workspaceFileStore.summaries();
    this.emit();
  }

  private canWriteNonCharacterResources(): boolean {
    return this.state.developerMode && this.state.dangerousNonCharacterResourceWrites;
  }

  private async run(action: () => Promise<void>): Promise<DreamCardAgentRuntimeState> {
    this.busyCount += 1;
    this.state.busy = true;
    this.state.error = undefined;
    this.emit();
    this.addDebug('debug', '开始运行时操作');
    try {
      await action();
      this.addDebug('debug', '运行时操作完成');
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
      this.addDebug('error', this.state.error, {
        name: error instanceof Error ? error.name : typeof error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    } finally {
      this.busyCount = Math.max(0, this.busyCount - 1);
      this.state.busy = this.busyCount > 0;
      this.emit();
    }
    return this.snapshot();
  }

  private runActiveView(action: (service: CardAgentSessionService) => Promise<SessionView>): Promise<SessionView> {
    const service = this.requireService();
    return this.runView(async () => {
      await this.flushDeferredSessionSave(service);
      return action(service);
    });
  }

  private scheduleDeferredSessionSave(service: CardAgentSessionService): void {
    const sessionId = service.sessionId;
    const pending = this.deferredSessionSaves.get(sessionId) ?? { dirty: false };
    pending.dirty = true;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      pending.timer = undefined;
      void this.flushDeferredSessionSave(service).catch(error => {
        this.state.error = `会话选项保存失败：${error instanceof Error ? error.message : String(error)}`;
        this.addDebug('error', this.state.error, { sessionId });
        this.emit();
      });
    }, SESSION_OPTION_SAVE_DELAY_MS);
    this.deferredSessionSaves.set(sessionId, pending);
  }

  private async flushDeferredSessionSave(service: CardAgentSessionService): Promise<void> {
    const sessionId = service.sessionId;
    const pending = this.deferredSessionSaves.get(sessionId);
    if (!pending) return;
    while (pending.dirty || pending.saving) {
      if (pending.timer) {
        clearTimeout(pending.timer);
        pending.timer = undefined;
      }
      if (pending.saving) {
        await pending.saving;
        continue;
      }
      pending.dirty = false;
      this.localDeferredSaveDepth += 1;
      const saving = service.save();
      pending.saving = saving;
      try {
        await saving;
      } catch (error) {
        pending.dirty = true;
        throw error;
      } finally {
        pending.saving = undefined;
        this.localDeferredSaveDepth = Math.max(0, this.localDeferredSaveDepth - 1);
      }
    }
    if (this.deferredSessionSaves.get(sessionId) === pending) this.deferredSessionSaves.delete(sessionId);
  }

  private async discardDeferredSessionSave(service: CardAgentSessionService): Promise<void> {
    const pending = this.deferredSessionSaves.get(service.sessionId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = undefined;
    pending.dirty = false;
    await pending.saving?.catch(() => undefined);
    pending.dirty = false;
    if (this.deferredSessionSaves.get(service.sessionId) === pending) {
      this.deferredSessionSaves.delete(service.sessionId);
    }
  }

  private async runView(action: () => Promise<SessionView>): Promise<SessionView> {
    let result!: SessionView;
    await this.run(async () => {
      result = await action();
      this.updateService(result);
      this.reloadSettingsState();
      await this.reloadCharacterSessions();
    });
    return result;
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.subscribers.forEach(subscriber => subscriber(snapshot));
  }

  private addDebug(level: DebugLogEntry['level'], message: string, data?: unknown): void {
    if (!this.state.developerMode) return;
    this.log.add(level, message, data);
    this.state.debugLogs = this.log.list();
  }
}

let globalRuntime: DreamCardAgentRuntime | undefined;

export function getDreamCardAgentRuntime(): DreamCardAgentRuntime {
  globalRuntime ??= new DreamCardAgentRuntime();
  return globalRuntime;
}
