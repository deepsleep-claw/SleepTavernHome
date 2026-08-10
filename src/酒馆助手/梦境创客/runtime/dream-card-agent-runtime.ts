import { klona } from 'klona';
import { MemoryBinaryBlobStore } from '../core/history/blob-store';
import { ContentAddressedSnapshotStore } from '../core/history/snapshot-store';
import { HistoryTimeline } from '../core/history/timeline';
import { materializeCardWorkspace, projectCardWorkspace } from '../core/mapping/card-workspace-mapper';
import type { CardWorkspaceState } from '../core/mapping/types';
import { GlobalTavernFileClient, type TavernFileClient } from '../core/persistence/file-client';
import { CharacterMetadataStore } from '../core/persistence/character-store';
import { PageDebugLog, type DebugLogEntry } from '../core/persistence/debug-log';
import { FileRegistryGarbageCollector } from '../core/persistence/garbage-collector';
import { SessionPersistenceCoordinator } from '../core/persistence/session-persistence';
import { SessionRevisionStore } from '../core/persistence/session-store';
import {
  TavernAgentSettingsStore,
  type AgentConfiguration,
  type AgentSettingsStore,
  type FloatingButtonAnchor,
  type FloatingButtonOffset,
  type SessionIndexEntry,
} from '../core/persistence/settings';
import { cloneStructuredPreset, compilePreset, type StructuredPreset } from '../core/preset/compiler';
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
import { GlobalSkillStore } from '../core/skills/global-skill-store';
import type { AgentSkill } from '../core/skills/types';
import { createGlobalTavernBridge, type TavernBridge } from '../core/tavern/bridge';
import { ProductionCardStateAdapter } from '../core/tavern/production-adapter';
import type { CardStateAdapter } from '../core/transaction/adapter';
import { commitWorkingCopy } from '../core/transaction/commit';
import { diffCardStates } from '../core/transaction/state-diff';

export type DreamCardAgentRuntimeState = {
  active?: SessionView;
  activeAgentConfigurationId: string;
  activeProfileId?: string;
  activePresetId: string;
  agentConfigurations: AgentConfiguration[];
  busy: boolean;
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
  skills: AgentSkill[];
  storage: { currentCharacterBytes: number; globalSkillBytes: number };
  sessions: SessionIndexEntry[];
  sessionStatuses: Record<string, SessionLifecycleStatus>;
  toolConfirmation?: ToolConfirmation;
  warnings: string[];
};

type RuntimeOptions = {
  adapterFactory?: () => CardStateAdapter;
  bridge?: TavernBridge;
  executorFactory?: (profile: ApiProfile) => ModelStepExecutor;
  fileClient?: TavernFileClient;
  now?: () => number;
  settingsStore?: AgentSettingsStore;
};

type Subscriber = (state: DreamCardAgentRuntimeState) => void;

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
  private readonly characterStore: CharacterMetadataStore;
  private readonly executorFactory: (profile: ApiProfile) => ModelStepExecutor;
  private readonly fileClient: TavernFileClient;
  private readonly globalSkillStore: GlobalSkillStore;
  private readonly lock = new GlobalAgentTaskLock();
  private readonly log: PageDebugLog;
  private readonly now: () => number;
  private readonly settingsStore: AgentSettingsStore;
  private readonly services = new Map<string, CardAgentSessionService>();
  private readonly settingsUnsubscribe?: () => void;
  private readonly subscribers = new Set<Subscriber>();
  private toolConfirmationResolve?: (approved: boolean) => void;
  private busyCount = 0;
  private skillIndexSignature = '';
  private skillLoadPromise?: Promise<void>;
  private state: DreamCardAgentRuntimeState;

  constructor(options: RuntimeOptions = {}) {
    const bridge = options.bridge ?? createGlobalTavernBridge();
    this.adapterFactory = options.adapterFactory ?? (() => new ProductionCardStateAdapter(bridge));
    this.executorFactory = options.executorFactory ?? (profile => new ProfileModelStepExecutor(profile));
    this.fileClient = options.fileClient ?? new GlobalTavernFileClient();
    this.now = options.now ?? Date.now;
    this.log = new PageDebugLog(this.now);
    this.settingsStore = options.settingsStore ?? new TavernAgentSettingsStore();
    this.characterStore = new CharacterMetadataStore(this.fileClient, this.settingsStore, this.now);
    this.globalSkillStore = new GlobalSkillStore(this.fileClient, this.settingsStore, this.now);
    const settings = this.settingsStore.load();
    this.state = {
      activeAgentConfigurationId: settings.activeAgentConfigurationId,
      activeProfileId: settings.activeProfileId,
      activePresetId: settings.activePresetId,
      agentConfigurations: settings.agentConfigurations,
      busy: false,
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
      skills: [],
      storage: { currentCharacterBytes: 0, globalSkillBytes: 0 },
      sessions: [],
      sessionStatuses: {},
      warnings: [],
    };
    this.settingsUnsubscribe = this.settingsStore.subscribe?.(() => {
      this.reloadSettingsState();
      void this.reloadCharacterSessions();
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
      const service = await CardAgentSessionService.create({
        adapter,
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
        skills: mountedSkills,
        title: input.title,
      });
      await service.save();
      this.services.set(service.sessionId, service);
      this.activeService = service;
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
    await this.run(async () => {
      if (this.activeService?.sessionId !== sessionId) await this.activeService?.finalizeManualEdits();
      const loaded = this.services.get(sessionId);
      if (loaded) {
        this.activeService = loaded;
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
      const service = await CardAgentSessionService.restore(
        {
          adapter,
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
        },
        revision.runtime,
        revision.workingCopy,
      );
      this.services.set(service.sessionId, service);
      this.activeService = service;
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
    const loaded = this.services.get(sessionId);
    if (!loaded) return;
    if (isSessionOperationActive(loaded.view().status)) {
      throw new Error('运行中或等待处理的会话不能关闭，请先停止或完成当前操作。');
    }
    await loaded.finalizeManualEdits();
    this.services.delete(sessionId);
    delete this.state.sessionStatuses[sessionId];
    if (this.activeService?.sessionId === sessionId) {
      this.activeService = undefined;
      this.state.active = undefined;
    }
    this.state.loadedSessionIds = [...this.services.keys()];
    this.emit();
  }

  async send(message: string): Promise<SessionView> {
    return this.runActiveView(async service => {
      await this.reloadSkills();
      await service.setSkills(this.state.skills);
      return service.send(message);
    });
  }

  async resume(): Promise<SessionView> {
    return this.runActiveView(service => service.resume());
  }

  async setModelControls(controls: Partial<SessionModelControls>): Promise<SessionView> {
    return this.runActiveView(async service => {
      await service.setModelControls(controls);
      return service.view();
    });
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
    await this.run(async () => {
      const character = this.state.currentCharacter;
      if (!character) throw new Error('请先打开角色卡。');
      const loaded = this.services.get(sessionId);
      if (loaded && isSessionOperationActive(loaded.view().status)) {
        throw new Error('运行中的会话不能删除，请先停止任务。');
      }
      const removed = await this.characterStore.removeSession(character.bindingId, sessionId);
      if (!removed) throw new Error(`会话不存在：${sessionId}`);
      this.services.delete(sessionId);
      delete this.state.sessionStatuses[sessionId];
      if (this.activeService?.sessionId === sessionId) {
        this.activeService = undefined;
        this.state.active = undefined;
      }
      await this.reloadCharacterSessions();
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
      await this.characterStore.removeCharacter(character.bindingId);
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
        if (removedCheckpoints.length === 0 && Object.keys(blobs).length === Object.keys(revision.snapshotBlobs).length) {
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
      removedFiles = (
        await new FileRegistryGarbageCollector(this.fileClient, this.settingsStore, this.now).collect([], 0)
      ).length;
      await this.reloadCharacterSessions();
    });
    return { cleanedSessions, removedFiles };
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
    await compilePreset(preset, defaultPresetValues(this.state.skills));
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
    const registry = new ApiProfileRegistry(this.settingsStore.load().profiles);
    const existing = input.id ? registry.get(input.id) : undefined;
    const profile = existing ? await updateApiProfile(existing, input) : await createApiProfile(input);
    registry.save(profile);
    this.assertProfileSwitchAllowed();
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
    dangerousNonCharacterResourceWrites?: boolean;
    developerMode?: boolean;
    floatingButton?: boolean;
    floatingButtonAnchor?: FloatingButtonAnchor;
    floatingButtonOffset?: FloatingButtonOffset;
    onboardingDone?: boolean;
  }): Promise<void> {
    const settings = this.settingsStore.load();
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
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  destroy(): void {
    this.resolveToolConfirmation(false);
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
    const collision = Boolean(
      storedCharacter?.avatarId && storedCharacter.avatarId !== current.character.avatarId,
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
    const metadata = await this.characterStore.load(current.character.bindingId, {
      avatarId: current.character.avatarId,
      characterName: current.character.name,
    });
    let changed = metadata.revision > 0 &&
      (metadata.characterName !== current.character.name || metadata.avatarId !== current.character.avatarId);
    metadata.avatarId = current.character.avatarId;
    metadata.characterName = current.character.name;
    for (const session of Object.values(metadata.sessions)) {
      if (session.characterName !== current.character.name || session.avatarId !== current.character.avatarId) changed = true;
      session.characterName = current.character.name;
      session.avatarId = current.character.avatarId;
    }
    if (changed) await this.characterStore.save(metadata);
    this.state.sessions = Object.values(metadata.sessions).sort((left, right) => right.updatedAt - left.updatedAt);
    const reference = this.settingsStore.load().characterStores[current.character.bindingId];
    this.state.storage.currentCharacterBytes =
      (reference?.size ?? 0) + this.state.sessions.reduce((total, session) => total + session.size, 0);
    this.reloadSettingsState();
  }

  private async reloadCharacterSessions(): Promise<void> {
    const character = this.state.currentCharacter;
    if (!character) return;
    try {
      const metadata = await this.characterStore.load(character.bindingId, {
        avatarId: character.avatarId,
        characterName: character.name,
      });
      this.state.sessions = Object.values(metadata.sessions).sort((left, right) => right.updatedAt - left.updatedAt);
      const reference = this.settingsStore.load().characterStores[character.bindingId];
      this.state.storage.currentCharacterBytes =
        (reference?.size ?? 0) + this.state.sessions.reduce((total, session) => total + session.size, 0);
      this.emit();
    } catch (error) {
      this.addDebug('warn', '读取角色会话索引失败', { error: error instanceof Error ? error.message : String(error) });
    }
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
        .map(skill => [skill.id, skill.revision, skill.url])
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

  private assertProfileSwitchAllowed(): void {
    if ([...this.services.values()].some(service => ['running', 'waiting-approval'].includes(service.view().status))) {
      throw new Error('Agent运行期间不能切换API Profile。');
    }
  }

  private async updateActiveExecutor(profile: ApiProfile): Promise<void> {
    for (const service of this.services.values()) {
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
    this.state.loadedSessionIds = [...this.services.keys()];
    if (!this.activeService || this.activeService.sessionId === view.sessionId) this.state.active = view;
    this.emit();
  }

  private reloadSettingsState(): void {
    const settings = this.settingsStore.load();
    this.state.activeAgentConfigurationId = settings.activeAgentConfigurationId;
    this.state.activeProfileId = settings.activeProfileId;
    this.state.activePresetId = settings.activePresetId;
    this.state.agentConfigurations = settings.agentConfigurations;
    this.state.developerMode = settings.developerMode;
    this.state.dangerousNonCharacterResourceWrites = settings.dangerousNonCharacterResourceWrites;
    this.state.floatingButton = settings.floatingButton;
    this.state.floatingButtonAnchor = settings.floatingButtonAnchor;
    this.state.floatingButtonOffset = settings.floatingButtonOffset;
    this.state.onboardingDone = settings.onboardingDone;
    this.state.profiles = settings.profiles;
    this.state.presetProfiles = settings.presetProfiles;
    this.state.storage.globalSkillBytes = Object.values(settings.files)
      .filter(file => file.bindingId === 'global')
      .reduce((total, file) => total + file.size, 0);
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
    return this.runView(() => action(service));
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
