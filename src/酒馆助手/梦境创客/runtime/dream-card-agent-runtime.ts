import { klona } from 'klona';
import { IndexedDbOperationRecoveryStore } from '../core/operations/recovery-store';
import { materializeCardWorkspace, projectCardWorkspace } from '../core/mapping/card-workspace-mapper';
import type { CardWorkspaceState } from '../core/mapping/types';
import { GlobalTavernFileClient, type TavernFileClient } from '../core/persistence/file-client';
import {
  DreamCreatorWorkspaceFileStore,
  GLOBAL_WORKSPACE_BINDING_ID,
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
  createApiModel,
  createApiProvider,
  exportApiProviderBundle,
  findSelectedModel,
  listProviderModels,
  parseApiProviderBundle,
  revealApiModel,
  revealApiProvider,
  updateApiModel,
  updateApiProvider,
  type ApiModel,
  type ApiModelInput,
  type ApiProvider,
  type ApiProviderInput,
  type ModelSelection,
} from '../core/provider/provider-config';
import { normalizeProviderFailure } from '../core/provider/provider-failure';
import {
  ProviderModelStepExecutor,
  UnavailableModelStepExecutor,
  type ModelStepExecutor,
} from '../core/runner/step-executor';
import { measureContext } from '../core/runner/context';
import { HtmlProjectCompiler, type HtmlProjectCheck } from '../core/projects/html-project';
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
import type { SessionAttachmentInput } from '../core/session/attachments';
import { ExternalSessionAttachmentStore } from '../core/session/attachment-store';
import { GlobalSkillStore } from '../core/skills/global-skill-store';
import {
  RemoteBuiltinSkillStore,
  type RemoteBuiltinSkillStatus,
} from '../core/skills/remote-builtin-store';
import { REMOTE_BUILTIN_SKILL_IDS } from '../core/skills/remote-builtin-catalog';
import type { AgentSkill } from '../core/skills/types';
import { BUILTIN_CARD_WORKSPACE_SKILL } from '../core/skills/builtin-card-workspace';
import { isAgentToolId } from '../core/runner/tool-catalog';
import { createGlobalTavernBridge, type TavernBridge } from '../core/tavern/bridge';
import { createGlobalTavernChatBridge, type TavernChatBridge } from '../core/tavern/chat-bridge';
import { ProductionCardStateAdapter } from '../core/tavern/production-adapter';
import {
  GLOBAL_SESSION_BINDING_ID,
  readCharacterTavernState,
  readGlobalTavernState,
} from '../core/tavern/global-state-reader';
import type { CardStateAdapter } from '../core/transaction/adapter';
import { applyRealtimeStateOperations } from '../core/transaction/realtime-apply';
import { diffCardStates } from '../core/transaction/state-diff';

export type DreamCardAgentRuntimeState = {
  approvalMode: SessionMode;
  active?: SessionView;
  activeSessionAccess: 'live' | 'readonly-history';
  activeThemeId: string;
  activeAgentConfigurationId: string;
  defaultModelSelection?: ModelSelection;
  activePresetId: string;
  agentConfigurations: AgentConfiguration[];
  availableCharacters: { avatarId: string; index: number; name: string }[];
  busy: boolean;
  builtinSkillResources: RemoteBuiltinSkillStatus[];
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
  globalSessions: SessionIndexEntry[];
  loadedSessionIds: string[];
  onboardingDone: boolean;
  providers: ApiProvider[];
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
  executorFactory?: (provider: ApiProvider, model: ApiModel) => ModelStepExecutor;
  fileClient?: TavernFileClient;
  now?: () => number;
  settingsStore?: AgentSettingsStore;
  resourceBaseUrl?: string;
};

type Subscriber = (state: DreamCardAgentRuntimeState) => void;

type DeferredSessionSave = {
  dirty: boolean;
  saving?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
};

const SESSION_OPTION_SAVE_DELAY_MS = 350;

function isSessionOperationActive(status: SessionLifecycleStatus): boolean {
  return ['running', 'waiting-approval'].includes(status);
}

export class DreamCardAgentRuntime {
  private activeService?: CardAgentSessionService;
  private readonly adapterFactory: () => CardStateAdapter;
  private readonly customAdapterFactory: boolean;
  private readonly bridge: TavernBridge;
  private readonly chatBridge?: TavernChatBridge;
  private readonly characterStore: CharacterMetadataStore;
  private readonly executorFactory: (provider: ApiProvider, model: ApiModel) => ModelStepExecutor;
  private readonly fileClient: TavernFileClient;
  private readonly workspaceFileStore: DreamCreatorWorkspaceFileStore;
  private readonly globalSkillStore: GlobalSkillStore;
  private readonly remoteBuiltinSkillStore?: RemoteBuiltinSkillStore;
  private readonly lock = new GlobalAgentTaskLock();
  private readonly operationRecoveryStore = new IndexedDbOperationRecoveryStore();
  private readonly log: PageDebugLog;
  private readonly now: () => number;
  private readonly resourceBaseUrl?: string;
  private readonly settingsStore: AgentSettingsStore;
  private readonly services = new Map<string, CardAgentSessionService>();
  private readonly serviceModelSelections = new Map<string, string>();
  private readonly historyViews = new Map<string, SessionView>();
  private readonly settingsUnsubscribe?: () => void;
  private readonly subscribers = new Set<Subscriber>();
  private readonly deferredSessionSaves = new Map<string, DeferredSessionSave>();
  private readonly pendingAgentSyncs = new Set<string>();
  private toolConfirmationResolve?: {
    resolve: (approved: boolean) => void;
    sessionId: string;
    toolCallId: string;
  };
  private busyCount = 0;
  private localDeferredSaveDepth = 0;
  private providerSettingsSignature = '';
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
    this.customAdapterFactory = Boolean(options.adapterFactory);
    this.executorFactory = options.executorFactory ?? ((provider, model) => new ProviderModelStepExecutor(provider, model));
    this.fileClient = options.fileClient ?? new GlobalTavernFileClient();
    this.now = options.now ?? Date.now;
    this.log = new PageDebugLog(this.now);
    this.settingsStore = options.settingsStore ?? new TavernAgentSettingsStore();
    this.workspaceFileStore = new DreamCreatorWorkspaceFileStore(this.fileClient, this.settingsStore, this.now);
    this.characterStore = new CharacterMetadataStore(this.fileClient, this.settingsStore, this.now);
    this.globalSkillStore = new GlobalSkillStore(this.fileClient, this.settingsStore, this.now);
    const resourceBaseUrl = options.resourceBaseUrl ?? configuredResourceBaseUrl;
    this.resourceBaseUrl = resourceBaseUrl;
    this.remoteBuiltinSkillStore = resourceBaseUrl
      ? new RemoteBuiltinSkillStore(resourceBaseUrl, this.fileClient, this.settingsStore, this.now)
      : undefined;
    const settings = this.settingsStore.load();
    this.state = {
      approvalMode: settings.approvalMode,
      activeSessionAccess: 'live',
      activeThemeId: settings.activeThemeId,
      activeAgentConfigurationId: settings.activeAgentConfigurationId,
      defaultModelSelection: settings.defaultModelSelection,
      activePresetId: settings.activePresetId,
      agentConfigurations: settings.agentConfigurations,
      availableCharacters: [],
      busy: false,
      builtinSkillResources: this.remoteBuiltinSkillStore?.statuses() ?? [],
      compressImages: settings.compressImages,
      characterGroups: [],
      debugLogs: [],
      developerMode: settings.developerMode,
      dangerousNonCharacterResourceWrites: settings.dangerousNonCharacterResourceWrites,
      floatingButton: settings.floatingButton,
      floatingButtonAnchor: settings.floatingButtonAnchor,
      floatingButtonOffset: settings.floatingButtonOffset,
      globalSessions: [],
      loadedSessionIds: [],
      onboardingDone: settings.onboardingDone,
      providers: settings.providers,
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
      void this.reloadGlobalSessions();
      void this.reloadCharacterGroups();
      void this.reloadSkills();
    });
    if (this.remoteBuiltinSkillStore) {
      void this.refreshBuiltinSkillResources(true).catch(error => {
        this.state.warnings = [...new Set([
          ...this.state.warnings,
          `内置Skill资源检查失败：${error instanceof Error ? error.message : String(error)}`,
        ])];
        this.emit();
      });
    }
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
      await this.reloadGlobalSessions();
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

  async selectCharacterAndCreateSession(avatarId: string): Promise<SessionView> {
    const target = this.bridge.listCharacters().find(character => character.avatarId === avatarId);
    if (!target) throw new Error('所选角色卡已经不可用。');
    if (
      this.state.toolConfirmation ||
      [...this.services.values()].some(service => isSessionOperationActive(service.view().status))
    ) {
      throw new Error('仍有会话正在运行或等待处理，暂时不能切换角色卡。');
    }
    await this.activeService?.finalizeManualEdits();
    await this.bridge.selectCharacterById(target.index);
    await this.refreshCharacter();
    return this.createSession({ scope: 'character' });
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
      result = this.createHistoryView(revision.entry, revision.runtime);
      this.historyViews.set(sessionId, result);
      this.activeService = undefined;
      this.state.active = result;
      this.state.activeSessionAccess = 'readonly-history';
      this.updateLoadedSessionIds();
      this.emit();
    });
    return result;
  }

  async createSession(
    input: { mode?: SessionMode; modelSelection?: ModelSelection; scope?: 'character' | 'global'; title?: string } = {},
  ): Promise<SessionView> {
    await this.run(async () => {
      await this.activeService?.finalizeManualEdits();
      await this.reloadSkills();
      const settings = this.settingsStore.load();
      const requestedSelection =
        input.modelSelection ??
        settings.defaultModelSelection;
      const resolvedModel = findSelectedModel(settings.providers, requestedSelection);
      const modelSelection = resolvedModel ? requestedSelection : undefined;
      const agentConfiguration = this.selectedAgentConfiguration();
      const mountedSkills = this.skillsForConfiguration(agentConfiguration);
      const scope = input.scope ?? 'character';
      const mountedWorldbooks = new Set<string>();
      const adapter =
        scope === 'global'
          ? new ProductionCardStateAdapter(this.bridge, bridge => readGlobalTavernState(bridge, mountedWorldbooks))
          : this.customAdapterFactory
            ? this.adapterFactory()
            : new ProductionCardStateAdapter(this.bridge, bridge =>
                readCharacterTavernState(bridge, mountedWorldbooks),
              );
      const current = scope === 'global' ? await adapter.read() : await this.ensureStableBinding(adapter);
      const bindingId = scope === 'global' ? GLOBAL_SESSION_BINDING_ID : current.character.bindingId;
      const characterName = scope === 'global' ? '全局会话' : current.character.name;
      const revisionStore = new SessionRevisionStore(this.fileClient, this.settingsStore, this.now);
      const persistence = new SessionPersistenceCoordinator({
        avatarId: scope === 'global' ? undefined : current.character.avatarId,
        bindingId,
        characterName,
        store: revisionStore,
      });
      const sessionId = crypto.randomUUID();
      const attachmentStore = new ExternalSessionAttachmentStore(
        bindingId,
        this.workspaceFileStore,
        this.settingsStore,
        undefined,
        scope,
      );
      const service = await CardAgentSessionService.create({
        adapter,
        attachmentStore,
        agentConfiguration,
        executor: resolvedModel
          ? this.executorFactory(resolvedModel.provider, resolvedModel.model)
          : new UnavailableModelStepExecutor(),
        contextWindow: resolvedModel ? this.modelContextWindow(resolvedModel.model) : DEFAULT_CONTEXT_WINDOW,
        lock: this.lock,
        mode: input.mode ?? this.state.approvalMode,
        modelSelection,
        mountedWorldbooks,
        onCharacterChanged:
          scope === 'global'
            ? async () => {
                if (this.bridge.getCurrentCharacterId()) {
                  await this.ensureStableBinding(new ProductionCardStateAdapter(this.bridge));
                }
              }
            : undefined,
        storageBindingId: scope === 'global' ? () => this.currentCharacterWorkspaceBindingId() : undefined,
        canWriteNonCharacterResources: () => this.canWriteNonCharacterResources(),
        now: this.now,
        onPersist: async runtime => {
          await persistence.persist(runtime);
        },
        onSkillsCommit: (skills, mountedIds) => this.commitMountedSkills(skills, mountedIds),
        onUpdate: view => this.updateService(view),
        operationRecoveryStore: this.operationRecoveryStore,
        requestToolApproval: request => this.requestToolConfirmation(request),
        resourceBaseUrl: this.resourceBaseUrl,
        preset: this.selectedPreset(agentConfiguration.presetId),
        tavernBridge: this.bridge,
        tavernChatBridge: this.chatBridge,
        sessionId,
        scope,
        skills: mountedSkills,
        title: input.title,
        workspaceFiles: await this.workspaceFileStore.project(
          scope === 'global' ? this.currentCharacterWorkspaceBindingId() : bindingId,
          sessionId,
        ),
        workspaceStore: this.workspaceFileStore,
      });
      await service.save();
      this.services.set(service.sessionId, service);
      if (modelSelection) this.serviceModelSelections.set(service.sessionId, this.modelSelectionKey(modelSelection));
      this.historyViews.delete(service.sessionId);
      this.activeService = service;
      this.state.activeSessionAccess = 'live';
      this.updateService(service.view());
      if (scope === 'character') {
        this.state.currentCharacter = {
          avatarId: current.character.avatarId,
          bindingId: current.character.bindingId,
          name: current.character.name,
        };
      }
      this.reloadSettingsState();
      if (scope === 'global') await this.reloadGlobalSessions();
      else await this.reloadCharacterSessions();
    });
    return this.requireService().view();
  }

  async openSession(sessionId: string): Promise<SessionView> {
    if (this.state.globalSessions.some(session => session.sessionId === sessionId)) {
      return this.openGlobalSession(sessionId);
    }
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
        await this.refreshServiceSkills(loaded);
        this.activeService = loaded;
        this.state.activeSessionAccess = 'live';
        this.updateService(loaded.view());
        return;
      }
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
      const mountedWorldbooks = new Set(revision.runtime.mountedWorldbooks);
      const sessionAdapter = this.customAdapterFactory
        ? adapter
        : new ProductionCardStateAdapter(this.bridge, bridge => readCharacterTavernState(bridge, mountedWorldbooks));
      const storedSelection = revision.runtime.modelSelection;
      const resolvedModel = findSelectedModel(this.settingsStore.load().providers, storedSelection);
      const attachmentStore = new ExternalSessionAttachmentStore(
        current.character.bindingId,
        this.workspaceFileStore,
        this.settingsStore,
      );
      const service = await CardAgentSessionService.restore(
        {
          adapter: sessionAdapter,
          attachmentStore,
          executor: resolvedModel
            ? this.executorFactory(resolvedModel.provider, resolvedModel.model)
            : new UnavailableModelStepExecutor(),
          contextWindow: resolvedModel ? this.modelContextWindow(resolvedModel.model) : DEFAULT_CONTEXT_WINDOW,
          lock: this.lock,
          mountedWorldbooks,
          now: this.now,
          canWriteNonCharacterResources: () => this.canWriteNonCharacterResources(),
          onPersist: async runtime => {
            await persistence.persist(runtime);
          },
          onSkillsCommit: (skills, mountedIds) => this.commitMountedSkills(skills, mountedIds),
          onUpdate: view => this.updateService(view),
          operationRecoveryStore: this.operationRecoveryStore,
          requestToolApproval: request => this.requestToolConfirmation(request),
          resourceBaseUrl: this.resourceBaseUrl,
          scope: revision.runtime.scope,
          tavernBridge: this.bridge,
          tavernChatBridge: this.chatBridge,
          workspaceFiles: await this.workspaceFileStore.project(current.character.bindingId, sessionId),
          workspaceStore: this.workspaceFileStore,
        },
        revision.runtime,
      );
      service.setMode(this.state.approvalMode);
      await this.refreshServiceSkills(service);
      this.services.set(service.sessionId, service);
      if (storedSelection && resolvedModel) {
        this.serviceModelSelections.set(service.sessionId, this.modelSelectionKey(storedSelection));
      }
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

  async openGlobalSession(sessionId: string): Promise<SessionView> {
    await this.run(async () => {
      if (this.activeService?.sessionId !== sessionId) await this.activeService?.finalizeManualEdits();
      const loaded = this.services.get(sessionId);
      if (loaded) {
        if (loaded.view().scope !== 'global') throw new Error('该会话不是全局会话。');
        await this.refreshServiceSkills(loaded);
        this.activeService = loaded;
        this.state.activeSessionAccess = 'live';
        this.updateService(loaded.view());
        return;
      }
      const revisionStore = new SessionRevisionStore(this.fileClient, this.settingsStore, this.now);
      const revision = await revisionStore.load(GLOBAL_SESSION_BINDING_ID, sessionId);
      const mountedWorldbooks = new Set(revision.runtime.mountedWorldbooks);
      if (revision.runtime.scope !== 'global') throw new Error('该会话不是全局会话。');
      const persistence = new SessionPersistenceCoordinator({
        bindingId: GLOBAL_SESSION_BINDING_ID,
        characterName: '全局会话',
        store: revisionStore,
      });
      const storedSelection = revision.runtime.modelSelection;
      const resolvedModel = findSelectedModel(this.settingsStore.load().providers, storedSelection);
      const service = await CardAgentSessionService.restore(
        {
          adapter: new ProductionCardStateAdapter(this.bridge, bridge =>
            readGlobalTavernState(bridge, mountedWorldbooks),
          ),
          attachmentStore: new ExternalSessionAttachmentStore(
            GLOBAL_SESSION_BINDING_ID,
            this.workspaceFileStore,
            this.settingsStore,
            undefined,
            'global',
          ),
          executor: resolvedModel
            ? this.executorFactory(resolvedModel.provider, resolvedModel.model)
            : new UnavailableModelStepExecutor(),
          contextWindow: resolvedModel ? this.modelContextWindow(resolvedModel.model) : DEFAULT_CONTEXT_WINDOW,
          lock: this.lock,
          mountedWorldbooks,
          onCharacterChanged: async () => {
            if (this.bridge.getCurrentCharacterId()) {
              await this.ensureStableBinding(new ProductionCardStateAdapter(this.bridge));
            }
          },
          storageBindingId: () => this.currentCharacterWorkspaceBindingId(),
          now: this.now,
          canWriteNonCharacterResources: () => this.canWriteNonCharacterResources(),
          onPersist: runtime => persistence.persist(runtime),
          onSkillsCommit: (skills, mountedIds) => this.commitMountedSkills(skills, mountedIds),
          onUpdate: view => this.updateService(view),
          operationRecoveryStore: this.operationRecoveryStore,
          requestToolApproval: request => this.requestToolConfirmation(request),
          resourceBaseUrl: this.resourceBaseUrl,
          scope: 'global',
          tavernBridge: this.bridge,
          tavernChatBridge: this.chatBridge,
          workspaceFiles: await this.workspaceFileStore.project(this.currentCharacterWorkspaceBindingId(), sessionId),
          workspaceStore: this.workspaceFileStore,
        },
        revision.runtime,
      );
      service.setMode(this.state.approvalMode);
      await this.refreshServiceSkills(service);
      this.services.set(sessionId, service);
      if (storedSelection && resolvedModel) this.serviceModelSelections.set(sessionId, this.modelSelectionKey(storedSelection));
      this.activeService = service;
      this.state.activeSessionAccess = 'live';
      this.updateService(service.view());
    });
    return this.requireService().view();
  }

  /** 关闭页签只卸载前端运行实例，持久化的会话与操作记录仍保留，可从历史重新打开。 */
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
    this.serviceModelSelections.delete(sessionId);
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
      await this.prepareServiceModel(service, service.view().modelSelection);
      await this.reloadSkills();
      const sessionConfiguration = this.settingsStore
        .load()
        .agentConfigurations.find(configuration => configuration.id === service.view().agentConfiguration.id);
      if (!sessionConfiguration) throw new Error('当前会话使用的 Agent 配置已被删除，请先选择新的 Agent。');
      await this.assertRemoteSkillsReady(sessionConfiguration);
      await service.syncAgentConfiguration(
        klona(sessionConfiguration),
        this.selectedPreset(sessionConfiguration.presetId),
        this.availableSkills(),
      );
      return service.send(message, undefined, attachments);
    });
  }

  async resume(): Promise<SessionView> {
    return this.runActiveView(async service => {
      const view = service.view();
      await this.prepareServiceModel(service, view.runModelSelection ?? view.modelSelection, false);
      return service.resume();
    });
  }

  async setModelControls(controls: Partial<SessionModelControls>): Promise<SessionView> {
    const service = this.requireService();
    if (service.updateModelControls(controls)) this.scheduleDeferredSessionSave(service);
    return service.view();
  }

  async selectSessionModel(selection?: ModelSelection): Promise<SessionView> {
    const service = this.requireService();
    if (selection && !findSelectedModel(this.settingsStore.load().providers, selection)) {
      throw new Error('所选模型不存在或已被禁用。');
    }
    if (service.updateModelSelection(selection)) this.scheduleDeferredSessionSave(service);
    return this.effectiveSessionView(service.view());
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

  async confirmOperationReplay(continueWithoutConflicts: boolean): Promise<SessionView> {
    return this.runActiveView(service => service.confirmOperationReplay(continueWithoutConflicts));
  }

  async resend(messageId: string): Promise<SessionView> {
    return this.runActiveView(service => service.resend(messageId));
  }

  async writeWorkingFile(
    path: string,
    content: string,
    overwriteConflict = false,
    expectedContent?: string,
  ): Promise<SessionView> {
    return this.runActiveView(service => service.writeWorkingFile(path, content, overwriteConflict, expectedContent));
  }

  async checkHtmlProject(projectYamlPath: string): Promise<HtmlProjectCheck> {
    if (!this.resourceBaseUrl) throw new Error('当前脚本没有配置工程编译资源地址。');
    const result = await new HtmlProjectCompiler(this.resourceBaseUrl).check(
      projectYamlPath,
      this.requireService().view().workingFiles,
    );
    return {
      diagnostics: result.diagnostics,
      outputBytes: result.outputBytes,
      projectName: result.projectName,
      renderer: result.renderer,
    };
  }

  async compileHtmlProject(
    projectYamlPath: string,
    options: { overwrite?: boolean; scope?: 'character' | 'global' | 'preset-current' } = {},
  ): Promise<SessionView> {
    if (!this.resourceBaseUrl) throw new Error('当前脚本没有配置工程编译资源地址。');
    const scope = options.scope ?? 'character';
    if (scope !== 'character' && !this.canWriteNonCharacterResources()) {
      throw new Error('NON_CHARACTER_RESOURCE_WRITE_DISABLED：请先在常规设置中启用红色的“允许修改非角色正则与脚本”。');
    }
    const service = this.requireService();
    const files = service.view().workingFiles;
    const compiler = new HtmlProjectCompiler(this.resourceBaseUrl);
    const checked = await compiler.check(projectYamlPath, files);
    const compiled = compiler.regexYaml(checked, projectYamlPath, files, scope, options.overwrite === true);
    return this.runActiveView(active =>
      active.writeWorkingFile(compiled.path, compiled.content, compiled.replace, compiled.replace
        ? files.find(file => file.path === compiled.path)?.content
        : undefined),
    );
  }

  async useCurrentWorkingFile(path: string): Promise<SessionView> {
    return this.runActiveView(service => service.useCurrentWorkingFile(path));
  }

  async deleteWorkingPath(path: string): Promise<SessionView> {
    return this.runActiveView(service => service.deleteWorkingPath(path));
  }

  async uploadWorkspaceFiles(targetDirectory: string, inputs: SessionAttachmentInput[]): Promise<SessionView> {
    return this.runActiveView(service => service.uploadWorkspaceFiles(targetDirectory, inputs));
  }

  async setWorkspaceAvatar(sourcePath: string, target: 'character' | { userName: string }): Promise<SessionView> {
    return this.runActiveView(service => service.setWorkspaceAvatar(sourcePath, target));
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.state.globalSessions.some(session => session.sessionId === sessionId)) {
      await this.deleteCharacterSession(GLOBAL_SESSION_BINDING_ID, sessionId);
      return;
    }
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
      this.serviceModelSelections.delete(sessionId);
      this.historyViews.delete(sessionId);
      delete this.state.sessionStatuses[sessionId];
      if (this.activeService?.sessionId === sessionId || this.state.active?.sessionId === sessionId) {
        this.activeService = undefined;
        this.state.active = undefined;
        this.state.activeSessionAccess = 'live';
      }
      this.updateLoadedSessionIds();
      if (bindingId === this.state.currentCharacter?.bindingId) await this.reloadCharacterSessions();
      if (bindingId === GLOBAL_SESSION_BINDING_ID) await this.reloadGlobalSessions();
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
        if (service.view().bindingId === character.bindingId) {
          this.services.delete(id);
          this.serviceModelSelections.delete(id);
        }
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
    const cleanedSessions = 0;
    let removedFiles = 0;
    await this.run(async () => {
      const character = this.state.currentCharacter;
      if (!character) throw new Error('请先打开角色卡。');
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
    if (REMOTE_BUILTIN_SKILL_IDS.includes(id)) {
      if (!this.remoteBuiltinSkillStore) throw new Error('当前脚本没有配置内置Skill资源地址。');
      const skill = await this.remoteBuiltinSkillStore.ensure(id);
      this.state.builtinSkillResources = this.remoteBuiltinSkillStore.statuses();
      this.emit();
      return skill;
    }
    return this.globalSkillStore.load(id);
  }

  async refreshBuiltinSkillResources(downloadEnabled = false): Promise<void> {
    if (!this.remoteBuiltinSkillStore) return;
    await this.remoteBuiltinSkillStore.refreshManifest();
    if (downloadEnabled) {
      const enabled = this.settingsStore
        .load()
        .agentConfigurations.flatMap(configuration => configuration.skills.filter(skill => skill.enabled).map(skill => skill.id));
      await this.remoteBuiltinSkillStore.syncEnabled(enabled);
    }
    this.state.builtinSkillResources = this.remoteBuiltinSkillStore.statuses();
    this.emit();
  }

  async downloadBuiltinSkillResource(id: string, force = false): Promise<void> {
    if (!this.remoteBuiltinSkillStore) throw new Error('当前脚本没有配置内置Skill资源地址。');
    try {
      await this.remoteBuiltinSkillStore.ensure(id, force);
    } finally {
      this.state.builtinSkillResources = this.remoteBuiltinSkillStore.statuses();
      this.emit();
    }
  }

  async removeBuiltinSkillResource(id: string): Promise<void> {
    if (!this.remoteBuiltinSkillStore) return;
    await this.remoteBuiltinSkillStore.remove(id);
    this.state.builtinSkillResources = this.remoteBuiltinSkillStore.statuses();
    this.emit();
  }

  async saveBuiltinSkillAsUser(id: string): Promise<AgentSkill> {
    if (!this.remoteBuiltinSkillStore) throw new Error('当前脚本没有配置内置Skill资源地址。');
    const source = await this.remoteBuiltinSkillStore.ensure(id);
    return this.saveGlobalSkill({
      ...structuredClone(source),
      builtin: false,
      id: `${source.id}-${crypto.randomUUID().slice(0, 8)}`,
      locked: false,
      name: `${source.name} 副本`,
    });
  }

  async removeGlobalSkill(id: string): Promise<void> {
    await this.run(async () => {
      await this.globalSkillStore.remove(id);
      const settings = this.settingsStore.load();
      settings.agentConfigurations = settings.agentConfigurations.map(configuration => ({
        ...configuration,
        skills: configuration.skills.filter(skill => skill.id !== id),
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
    const knownSkillIds = new Set([
      BUILTIN_CARD_WORKSPACE_SKILL.id,
      ...Object.keys(settings.globalSkills),
      ...REMOTE_BUILTIN_SKILL_IDS,
    ]);
    const configuration: AgentConfiguration = {
      id: input.id || `agent:${crypto.randomUUID()}`,
      name,
      presetId: input.presetId,
      skills: input.skills
        .filter((skill, index, all) => knownSkillIds.has(skill.id) && all.findIndex(item => item.id === skill.id) === index)
        .map(skill => ({ enabled: skill.enabled === true, id: skill.id, loading: skill.loading })),
      toolIds: [...new Set(input.toolIds.filter(isAgentToolId))],
    };
    const index = settings.agentConfigurations.findIndex(item => item.id === configuration.id);
    if (index >= 0) settings.agentConfigurations[index] = configuration;
    else settings.agentConfigurations.push(configuration);
    settings.activeAgentConfigurationId = configuration.id;
    await this.settingsStore.save(settings);
    await this.reloadSkills();
    for (const service of this.services.values()) {
      const view = service.view();
      if (view.agentConfiguration.id !== configuration.id) continue;
      if (isSessionOperationActive(view.status)) {
        this.pendingAgentSyncs.add(view.sessionId);
        continue;
      }
      await service.syncAgentConfiguration(
        klona(configuration),
        this.selectedPreset(configuration.presetId),
        this.availableSkills(),
      );
      await service.save();
    }
    this.reloadSettingsState();
    return klona(configuration);
  }

  async selectAgentConfiguration(id: string): Promise<void> {
    const settings = this.settingsStore.load();
    const configuration = settings.agentConfigurations.find(configuration => configuration.id === id);
    if (!configuration) throw new Error(`Agent配置不存在：${id}`);

    // 设置页只改变之后新建会话使用的默认 Agent；当前会话通过自己的选择器显式切换。
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
      this.availableSkills(),
    );
  }

  async renameSession(title: string): Promise<SessionView> {
    return this.runActiveView(service => service.rename(title));
  }

  async setMode(mode: SessionMode): Promise<void> {
    const settings = this.settingsStore.load();
    settings.approvalMode = mode;
    await this.settingsStore.save(settings);
    this.state.approvalMode = mode;
    for (const service of this.services.values()) service.setMode(mode);
    if (this.state.activeSessionAccess === 'live') this.state.active = this.activeService?.view();
    this.emit();
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
        activeConfiguration?.toolIds ?? [],
        this.state.active?.scope ?? 'character',
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
    const running = [...this.services.values()].find(service => isSessionOperationActive(service.view().status));
    if (!running) return;
    if (this.toolConfirmationResolve?.sessionId === running.sessionId) this.resolveToolConfirmation(false, running.sessionId);
    running.stop();
  }

  stopSession(sessionId: string): void {
    const service = this.services.get(sessionId);
    if (!service || !isSessionOperationActive(service.view().status)) return;
    if (this.toolConfirmationResolve?.sessionId === sessionId) this.resolveToolConfirmation(false, sessionId);
    service.stop();
  }

  resolveToolConfirmation(approved: boolean, sessionId = this.activeService?.sessionId): void {
    const pending = this.toolConfirmationResolve;
    if (pending && pending.sessionId !== sessionId) throw new Error('该审批不属于当前会话。');
    this.toolConfirmationResolve = undefined;
    this.state.toolConfirmation = undefined;
    pending?.resolve(approved);
    this.emit();
  }

  async listModels(input: ApiProviderInput | string): Promise<string[]> {
    let models: string[] = [];
    await this.run(async () => {
      let provider: ApiProvider;
      if (typeof input === 'string') {
        const existing = this.settingsStore.load().providers.find(item => item.id === input);
        if (!existing) throw new Error(`Provider不存在：${input}`);
        provider = existing;
      } else {
        const existing = input.id ? this.settingsStore.load().providers.find(item => item.id === input.id) : undefined;
        provider = existing ? await updateApiProvider(existing, input) : await createApiProvider(input);
      }
      try {
        models = await listProviderModels(provider);
      } catch (error) {
        throw new Error(normalizeProviderFailure(error).message, { cause: error });
      }
    });
    return models;
  }

  async saveProvider(input: ApiProviderInput): Promise<ApiProvider> {
    const settings = this.settingsStore.load();
    const name = input.name.trim().normalize('NFC');
    if (!name) throw new Error('Provider名称不能为空。');
    if (settings.providers.some(item => item.id !== input.id && item.name.normalize('NFC') === name)) {
      throw new Error(`Provider名称已存在：${name}`);
    }
    const existing = input.id ? settings.providers.find(item => item.id === input.id) : undefined;
    const provider = existing
      ? await updateApiProvider(existing, { ...input, id: existing.id, name })
      : await createApiProvider({ ...input, id: undefined, name });
    settings.providers = existing
      ? settings.providers.map(item => item.id === provider.id ? provider : item)
      : [...settings.providers, provider];
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
    return provider;
  }

  async saveModel(providerId: string, input: ApiModelInput): Promise<ApiModel> {
    const settings = this.settingsStore.load();
    const provider = settings.providers.find(item => item.id === providerId);
    if (!provider) throw new Error(`Provider不存在：${providerId}`);
    const name = input.name.trim().normalize('NFC');
    if (!name) throw new Error('模型显示名称不能为空。');
    if (provider.models.some(item => item.id !== input.id && item.name.normalize('NFC') === name)) {
      throw new Error(`该Provider下已有同名模型：${name}`);
    }
    const existing = input.id ? provider.models.find(item => item.id === input.id) : undefined;
    const model = existing
      ? await updateApiModel(existing, { ...input, id: existing.id, name })
      : await createApiModel({ ...input, id: undefined, name });
    provider.models = existing
      ? provider.models.map(item => item.id === model.id ? model : item)
      : [...provider.models, model];
    settings.providers = settings.providers.map(item => item.id === providerId ? provider : item);
    if (!settings.defaultModelSelection && provider.enabled && model.enabled) {
      settings.defaultModelSelection = { modelId: model.id, providerId };
    }
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
    return model;
  }

  async removeProvider(providerId: string): Promise<void> {
    const settings = this.settingsStore.load();
    if (!settings.providers.some(item => item.id === providerId)) return;
    settings.providers = settings.providers.filter(item => item.id !== providerId);
    if (settings.defaultModelSelection?.providerId === providerId) settings.defaultModelSelection = undefined;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  async removeModel(providerId: string, modelId: string): Promise<void> {
    const settings = this.settingsStore.load();
    const provider = settings.providers.find(item => item.id === providerId);
    if (!provider) return;
    provider.models = provider.models.filter(item => item.id !== modelId);
    settings.providers = settings.providers.map(item => item.id === providerId ? provider : item);
    if (settings.defaultModelSelection?.providerId === providerId && settings.defaultModelSelection.modelId === modelId) {
      settings.defaultModelSelection = undefined;
    }
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  async selectDefaultModel(selection?: ModelSelection): Promise<void> {
    const settings = this.settingsStore.load();
    if (selection && !findSelectedModel(settings.providers, selection)) throw new Error('所选模型不存在或已禁用。');
    settings.defaultModelSelection = selection ? klona(selection) : undefined;
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
  }

  async copyProvider(providerId: string): Promise<ApiProvider> {
    return this.importProviderBundle(await this.exportProviderBundle(providerId, true));
  }

  async exportProviderBundle(providerId: string, includeSecrets = false): Promise<string> {
    const provider = this.settingsStore.load().providers.find(item => item.id === providerId);
    if (!provider) throw new Error(`Provider不存在：${providerId}`);
    return JSON.stringify(await exportApiProviderBundle(provider, includeSecrets), null, 2);
  }

  async importProviderBundle(source: string): Promise<ApiProvider> {
    const bundle = parseApiProviderBundle(source);
    const settings = this.settingsStore.load();
    const uniqueName = (base: string, used: Set<string>) => {
      const normalized = base.trim() || '导入的Provider';
      if (!used.has(normalized.normalize('NFC'))) return normalized;
      let index = 2;
      while (used.has(`${normalized} ${index}`.normalize('NFC'))) index += 1;
      return `${normalized} ${index}`;
    };
    const providerNames = new Set(settings.providers.map(item => item.name.normalize('NFC')));
    const providerRequest = bundle.provider.request;
    const provider = await createApiProvider({
      apiKey: providerRequest?.apiKey ?? bundle.provider.apiKey ?? '',
      baseURL: bundle.provider.baseURL,
      bodyParameters: providerRequest?.bodyParameters ?? bundle.provider.bodyParameters,
      enabled: bundle.provider.enabled,
      excludedBodyParameters:
        providerRequest?.excludedBodyParameters ?? bundle.provider.excludedBodyParameters,
      interfaceType: bundle.provider.interfaceType,
      name: uniqueName(bundle.provider.name, providerNames),
      requestHeaders: providerRequest?.requestHeaders ?? bundle.provider.requestHeaders,
    });
    const modelNames = new Set<string>();
    for (const sourceModel of bundle.models) {
      const request = sourceModel.request;
      const name = uniqueName(sourceModel.name || sourceModel.modelId, modelNames);
      modelNames.add(name.normalize('NFC'));
      provider.models.push(await createApiModel({
        appliedModelTemplate: sourceModel.appliedModelTemplate,
        bodyParameters: request?.bodyParameters ?? sourceModel.bodyParameters,
        compatibilityMode: sourceModel.compatibilityMode,
        enabled: sourceModel.enabled,
        excludedBodyParameters: request?.excludedBodyParameters ?? sourceModel.excludedBodyParameters,
        modelId: sourceModel.modelId,
        modelSettings: sourceModel.modelSettings,
        name,
        requestHeaders: request?.requestHeaders ?? sourceModel.requestHeaders,
      }));
    }
    settings.providers.push(provider);
    await this.settingsStore.save(settings);
    this.reloadSettingsState();
    return provider;
  }

  async revealProvider(providerId: string) {
    const provider = this.settingsStore.load().providers.find(item => item.id === providerId);
    if (!provider) throw new Error(`Provider不存在：${providerId}`);
    return revealApiProvider(provider);
  }

  async revealModel(providerId: string, modelId: string) {
    const model = this.settingsStore.load().providers.find(item => item.id === providerId)?.models.find(item => item.id === modelId);
    if (!model) throw new Error(`模型不存在：${modelId}`);
    return revealApiModel(model);
  }

  async updateSettings(input: {
    activeThemeId?: string;
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
    const previous = {
      activeThemeId: this.state.activeThemeId,
      compressImages: this.state.compressImages,
      dangerousNonCharacterResourceWrites: this.state.dangerousNonCharacterResourceWrites,
      developerMode: this.state.developerMode,
      floatingButton: this.state.floatingButton,
      floatingButtonAnchor: this.state.floatingButtonAnchor,
      floatingButtonOffset: klona(this.state.floatingButtonOffset),
      onboardingDone: this.state.onboardingDone,
      sendWithCtrlEnter: this.state.sendWithCtrlEnter,
    };
    if (input.activeThemeId !== undefined) settings.activeThemeId = input.activeThemeId;
    if (input.compressImages !== undefined) settings.compressImages = input.compressImages;
    if (input.dangerousNonCharacterResourceWrites !== undefined) {
      settings.dangerousNonCharacterResourceWrites = input.dangerousNonCharacterResourceWrites;
    }
    if (input.developerMode !== undefined) settings.developerMode = input.developerMode;
    if (input.floatingButton !== undefined) settings.floatingButton = input.floatingButton;
    if (input.floatingButtonAnchor !== undefined) settings.floatingButtonAnchor = input.floatingButtonAnchor;
    if (input.floatingButtonOffset !== undefined) settings.floatingButtonOffset = input.floatingButtonOffset;
    if (input.onboardingDone !== undefined) settings.onboardingDone = input.onboardingDone;
    if (input.sendWithCtrlEnter !== undefined) settings.sendWithCtrlEnter = input.sendWithCtrlEnter;

    // 轻量设置先发布到当前页面，再异步落盘。否则每次开关和主题切换都要等待
    // 酒馆设置接口与跨窗口合并完成，视觉上会像按钮没有响应。
    this.applyLightweightSettingsState(settings);
    this.emit();
    this.localDeferredSaveDepth += 1;
    try {
      await this.settingsStore.save(settings);
      this.reloadSettingsState();
    } catch (error) {
      this.applyLightweightSettingsState(previous);
      this.emit();
      throw error;
    } finally {
      this.localDeferredSaveDepth = Math.max(0, this.localDeferredSaveDepth - 1);
    }
  }

  destroy(): void {
    this.resolveToolConfirmation(false, this.toolConfirmationResolve?.sessionId);
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
    const result = await applyRealtimeStateOperations(adapter, diffCardStates(current, materialized));
    if (result.error) throw result.error;
    return adapter.read();
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
  ): SessionView {
    const configuration = runtime.agentConfiguration ?? this.selectedAgentConfiguration();
    const ui = klona(runtime.ui);
    return {
      agentConfiguration: klona(configuration),
      bindingId: entry.bindingId,
      characterName: entry.characterName,
      contextUsage: measureContext(runtime.modelMessages, DEFAULT_CONTEXT_WINDOW),
      error: runtime.lastError,
      events: klona(runtime.events),
      mode: runtime.mode,
      modelControls: klona(runtime.modelControls ?? { reasoningEffort: 'auto', webSearch: false }),
      modelSelection: findSelectedModel(this.settingsStore.load().providers, runtime.modelSelection)
        ? klona(runtime.modelSelection)
        : undefined,
      runModelSelection: klona(runtime.runModelSelection),
      operationLog: klona(runtime.operationLog ?? { records: [], turns: [], version: 1 }),
      operationReplay: undefined,
      preset: cloneStructuredPreset(runtime.preset),
      renderPreviews: klona(runtime.renderPreviews ?? {}),
      scope: runtime.scope,
      sessionId: runtime.sessionId,
      skills: klona(runtime.skills),
      status: runtime.status,
      title: runtime.title,
      ui: ui.filter(item => !item.hidden),
      warnings: [...(runtime.warnings ?? [])],
      workingFiles: [],
    };
  }

  private async refreshSessionIndex(current: CardWorkspaceState): Promise<void> {
    await new SessionRevisionStore(this.fileClient, this.settingsStore, this.now).flushPending(
      current.character.bindingId,
    );
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
      await new SessionRevisionStore(this.fileClient, this.settingsStore, this.now).flushPending(character.bindingId);
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

  private async reloadGlobalSessions(): Promise<void> {
    try {
      await new SessionRevisionStore(this.fileClient, this.settingsStore, this.now).flushPending(
        GLOBAL_SESSION_BINDING_ID,
      );
      const metadata = await this.characterStore.load(GLOBAL_SESSION_BINDING_ID, {
        characterName: '全局会话',
      });
      this.state.globalSessions = Object.values(metadata.sessions).sort((left, right) => right.updatedAt - left.updatedAt);
      this.emit();
    } catch (error) {
      this.addDebug('warn', '读取全局会话索引失败', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async reloadCharacterGroups(): Promise<void> {
    const settings = this.settingsStore.load();
    const availableCharacters = this.bridge.listCharacters();
    this.state.availableCharacters = availableCharacters;
    const availableByAvatar = new Map(availableCharacters.map(character => [character.avatarId, character]));
    const current = this.state.currentCharacter;
    const references = new Map<string, CharacterStoreReference>(
      Object.values(settings.characterStores)
        .filter(reference => reference.bindingId !== GLOBAL_SESSION_BINDING_ID)
        .map(reference => [reference.bindingId, reference]),
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

  private async prepareServiceModel(
    service: CardAgentSessionService,
    selection?: ModelSelection,
    markRun = true,
  ): Promise<{ model: ApiModel; provider: ApiProvider }> {
    const selected = findSelectedModel(this.settingsStore.load().providers, selection);
    if (!selected) throw new Error('当前会话尚未选择可用模型。');
    const effort = service.view().modelControls.reasoningEffort;
    if (
      effort !== 'auto' &&
      effort !== 'off' &&
      !selected.model.modelSettings.reasoningEfforts.some(item => item.id === effort)
    ) {
      service.updateModelControls({ reasoningEffort: 'auto' });
    }
    if (markRun) service.updateRunModelSelection(selection as ModelSelection);
    const key = this.modelSelectionKey(selection as ModelSelection);
    if (this.serviceModelSelections.get(service.sessionId) !== key) {
      await service.setExecutor(
        this.executorFactory(selected.provider, selected.model),
        this.modelContextWindow(selected.model),
        selected.model.modelSettings.capabilities.vision !== 'disabled',
      );
      this.serviceModelSelections.set(service.sessionId, key);
    } else {
      // 同一个模型的能力配置也可能被用户实时修改；无需重建Provider，只更新请求转换策略。
      service.setModelVisionEnabled(selected.model.modelSettings.capabilities.vision !== 'disabled');
    }
    return selected;
  }

  private modelSelectionKey(selection: ModelSelection): string {
    return `${selection.providerId}\u0000${selection.modelId}`;
  }

  private currentCharacterWorkspaceBindingId(): string {
    const extension = this.bridge.getRawCharacter()?.data.extensions?.card_agent;
    if (extension && typeof extension === 'object' && !Array.isArray(extension)) {
      const bindingId = (extension as Record<string, unknown>).binding_id;
      if (typeof bindingId === 'string' && bindingId) return bindingId;
    }
    return GLOBAL_WORKSPACE_BINDING_ID;
  }

  private effectiveSessionView(view: SessionView): SessionView {
    const result = klona(view);
    if (!findSelectedModel(this.settingsStore.load().providers, result.modelSelection)) result.modelSelection = undefined;
    return result;
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
    const enabled = new Map(configuration.skills.filter(skill => skill.enabled).map(skill => [skill.id, skill.loading]));
    return this.availableSkills().flatMap(skill => {
      const loading = enabled.get(skill.id);
      return loading ? [{ ...klona(skill), loading }] : [];
    });
  }

  private availableSkills(): AgentSkill[] {
    return [BUILTIN_CARD_WORKSPACE_SKILL, ...(this.remoteBuiltinSkillStore?.loadedSkills() ?? []), ...this.state.skills];
  }

  private async assertRemoteSkillsReady(configuration: AgentConfiguration): Promise<void> {
    const required = configuration.skills
      .filter(skill => skill.enabled && REMOTE_BUILTIN_SKILL_IDS.includes(skill.id))
      .map(skill => skill.id);
    if (!required.length) return;
    if (!this.remoteBuiltinSkillStore) {
      throw new Error('当前Agent启用了远程内置Skill，但脚本没有资源地址。请到“设置 → 资源下载”检查，或关闭这些Skill。');
    }
    await this.remoteBuiltinSkillStore.syncEnabled(required);
    this.state.builtinSkillResources = this.remoteBuiltinSkillStore.statuses();
    const loaded = new Set(this.remoteBuiltinSkillStore.loadedSkills().map(skill => skill.id));
    const missing = required.filter(id => !loaded.has(id));
    if (missing.length) {
      const names = this.state.builtinSkillResources.filter(item => missing.includes(item.id)).map(item => item.name);
      throw new Error(`当前Agent所需内置Skill尚不可用：${names.join('、') || missing.join('、')}。请到“设置 → 资源下载”重试，或在Agent设置中关闭。`);
    }
  }

  /**
   * 恢复会话时，持久化正文仍保持当时的静态头部；这里只刷新当前可读的 /skills 投影。
   * 旧格式会话没有 Agent ID 时，以当前全局 Agent 配置补齐一次挂载。
   */
  private async refreshServiceSkills(service: CardAgentSessionService): Promise<void> {
    const view = service.view();
    if (['running', 'waiting-approval'].includes(view.status)) return;
    await this.reloadSkills();
    const settings = this.settingsStore.load();
    const storedConfiguration = settings.agentConfigurations.find(
      configuration => configuration.id === view.agentConfiguration.id,
    );
    const configuration = storedConfiguration;
    if (configuration) {
      await this.assertRemoteSkillsReady(configuration);
      await service.syncAgentConfiguration(
        klona(configuration),
        this.selectedPreset(configuration.presetId),
        this.availableSkills(),
      );
      return;
    }
    await this.assertRemoteSkillsReady(view.agentConfiguration);
    await service.setSkills(this.availableSkills());
  }

  private applyLightweightSettingsState(settings: {
    activeThemeId: string;
    compressImages: boolean;
    dangerousNonCharacterResourceWrites: boolean;
    developerMode: boolean;
    floatingButton: boolean;
    floatingButtonAnchor: FloatingButtonAnchor;
    floatingButtonOffset: FloatingButtonOffset;
    onboardingDone: boolean;
    sendWithCtrlEnter: boolean;
  }): void {
    this.state.activeThemeId = settings.activeThemeId;
    this.state.compressImages = settings.compressImages;
    this.state.dangerousNonCharacterResourceWrites = settings.dangerousNonCharacterResourceWrites;
    this.state.developerMode = settings.developerMode;
    this.state.floatingButton = settings.floatingButton;
    this.state.floatingButtonAnchor = settings.floatingButtonAnchor;
    this.state.floatingButtonOffset = klona(settings.floatingButtonOffset);
    this.state.onboardingDone = settings.onboardingDone;
    this.state.sendWithCtrlEnter = settings.sendWithCtrlEnter;
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
      this.serviceModelSelections.delete(sessionId);
      delete this.state.sessionStatuses[sessionId];
    }
    if (this.activeService?.view().bindingId === bindingId) {
      this.activeService = undefined;
      this.state.active = undefined;
    }
    this.updateLoadedSessionIds();
  }

  private modelContextWindow(model: ApiModel): number {
    return model.modelSettings.contextWindow || DEFAULT_CONTEXT_WINDOW;
  }

  private requireService(): CardAgentSessionService {
    if (!this.activeService) throw new Error('请先创建或打开一个Agent会话。');
    return this.activeService;
  }

  private requestToolConfirmation(request: ToolConfirmation): Promise<boolean> {
    if (this.toolConfirmationResolve) throw new Error('已有高危工具正在等待确认。');
    if (!request.sessionId) throw new Error('工具审批缺少会话归属。');
    this.state.toolConfirmation = request;
    this.emit();
    return new Promise(resolve => {
      this.toolConfirmationResolve = {
        resolve,
        sessionId: request.sessionId!,
        toolCallId: request.toolCallId,
      };
    });
  }

  private updateService(view: SessionView): void {
    const effectiveView = this.effectiveSessionView(view);
    this.state.sessionStatuses[view.sessionId] = view.status;
    // 会话正文、当前标题、角色索引和已打开页签是同一份会话的不同投影。
    // rename/send 会先更新运行中的 SessionView；在下一次索引回读前也要立即
    // 同步摘要，否则工具栏标题已变化，而侧边栏与页签仍显示旧名称。
    for (const session of this.state.sessions) {
      if (session.sessionId === view.sessionId) session.title = view.title;
    }
    for (const session of this.state.globalSessions) {
      if (session.sessionId === view.sessionId) session.title = view.title;
    }
    for (const group of this.state.characterGroups) {
      for (const session of group.sessions) {
        if (session.sessionId === view.sessionId) session.title = view.title;
      }
    }
    this.updateLoadedSessionIds();
    if (this.activeService?.sessionId === view.sessionId) {
      this.state.active = effectiveView;
      this.state.activeSessionAccess = 'live';
    }
    this.emit();
    if (!isSessionOperationActive(view.status) && this.pendingAgentSyncs.delete(view.sessionId)) {
      const service = this.services.get(view.sessionId);
      if (service) {
        void this.refreshServiceSkills(service)
          .then(() => service.save())
          .catch(error => {
            this.state.warnings = [
              ...new Set([
                ...this.state.warnings,
                `会话“${view.title}”刷新 Agent 配置失败：${error instanceof Error ? error.message : String(error)}`,
              ]),
            ];
            this.emit();
          });
      }
    }
  }

  private updateLoadedSessionIds(): void {
    this.state.loadedSessionIds = [...new Set([...this.services.keys(), ...this.historyViews.keys()])];
  }

  private reloadSettingsState(): void {
    const settings = this.settingsStore.load();
    const providerSettingsSignature = JSON.stringify(settings.providers);
    if (this.providerSettingsSignature && this.providerSettingsSignature !== providerSettingsSignature) {
      this.serviceModelSelections.clear();
    }
    this.providerSettingsSignature = providerSettingsSignature;
    this.state.activeThemeId = settings.activeThemeId;
    this.state.activeAgentConfigurationId = settings.activeAgentConfigurationId;
    this.state.defaultModelSelection = settings.defaultModelSelection;
    this.state.activePresetId = settings.activePresetId;
    this.state.approvalMode = settings.approvalMode;
    this.state.agentConfigurations = settings.agentConfigurations;
    this.state.compressImages = settings.compressImages;
    this.state.developerMode = settings.developerMode;
    this.state.dangerousNonCharacterResourceWrites = settings.dangerousNonCharacterResourceWrites;
    this.state.floatingButton = settings.floatingButton;
    this.state.floatingButtonAnchor = settings.floatingButtonAnchor;
    this.state.floatingButtonOffset = settings.floatingButtonOffset;
    this.state.onboardingDone = settings.onboardingDone;
    this.state.providers = settings.providers;
    this.state.presetProfiles = settings.presetProfiles;
    this.state.sendWithCtrlEnter = settings.sendWithCtrlEnter;
    this.state.storage.globalSkillBytes = Object.values(settings.files)
      .filter(file => file.bindingId === 'global')
      .reduce((total, file) => total + file.size, 0);
    this.state.storage.characters = this.workspaceFileStore.summaries();
    this.emit();
  }

  private canWriteNonCharacterResources(): boolean {
    return this.state.dangerousNonCharacterResourceWrites;
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
let configuredResourceBaseUrl: string | undefined;

export function configureDreamCardAgentResourceBase(url: string): void {
  configuredResourceBaseUrl = new URL(url).href;
}

export function getDreamCardAgentRuntime(): DreamCardAgentRuntime {
  globalRuntime ??= new DreamCardAgentRuntime();
  return globalRuntime;
}
