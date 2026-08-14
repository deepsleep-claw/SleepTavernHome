import {
  findSelectedModel,
  normalizeApiProvider,
  type ApiProvider,
  type ModelSelection,
} from '../provider/provider-config';
import { cloneStructuredPreset, DEFAULT_PRESET, type StructuredPreset } from '../preset/compiler';
import {
  DEFAULT_BUILTIN_AGENT,
  defaultBuiltinAgentConfiguration,
  type AgentConfiguration,
} from './builtin-agent';
import type { SessionMode } from '../session/types';
import { isAgentToolId } from '../runner/tool-catalog';

export type { AgentConfiguration } from './builtin-agent';

export type FloatingButtonAnchor =
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right'
  | 'middle-center'
  | 'middle-left'
  | 'middle-right'
  | 'top-center'
  | 'top-left'
  | 'top-right';

export type FloatingButtonOffset = { x: number; y: number };

export function defaultFloatingButtonOffset(anchor: FloatingButtonAnchor): FloatingButtonOffset {
  const [vertical, horizontal] = anchor.split('-');
  return {
    x: horizontal === 'center' ? 0 : 18,
    y: vertical === 'middle' ? 0 : 18,
  };
}

export type StoredFileReference = {
  bindingId: string;
  createdAt: number;
  name: string;
  size: number;
  url: string;
};

export type DreamCreatorWorkspaceFileReference = {
  bindingId: string;
  createdAt: number;
  fileId: string;
  logicalPath: string;
  mediaType: string;
  name: string;
  orphanedAt?: number;
  referencedSessionIds: string[];
  scope: 'character-persistent' | 'character-temp' | 'global-persistent' | 'global-temp';
  sessionId?: string;
  sha256: string;
  size: number;
  sourceFileId?: string;
  updatedAt: number;
  url: string;
};

export type BuiltinSkillPackageReference = {
  downloadedAt: number;
  id: string;
  protocolVersion: number;
  sha256: string;
  size: number;
  sourceUrl: string;
  url: string;
  version: number;
};

export type GlobalSkillIndexEntry = {
  directories?: string[];
  description: string;
  files?: Record<string, GlobalSkillFileIndexEntry>;
  id: string;
  loading: 'full' | 'on-demand';
  locked?: boolean;
  name: string;
  revision: number;
  sha256?: string;
  updatedAt: number;
  url: string;
};

export type GlobalSkillFileIndexEntry = {
  mediaType: string;
  name: string;
  path: string;
  sha256: string;
  size: number;
  url: string;
};

export type SessionIndexEntry = {
  avatarId?: string;
  bindingId: string;
  characterName: string;
  createdAt: number;
  revision: number;
  sessionId: string;
  sha256: string;
  size: number;
  status: 'abnormal' | 'completed' | 'idle' | 'running' | 'stopped';
  title: string;
  updatedAt: number;
  url: string;
};

export type CharacterStoreReference = {
  avatarId?: string;
  bindingId: string;
  characterName: string;
  revision: number;
  sha256: string;
  size: number;
  updatedAt: number;
  url: string;
};

export type DreamCardAgentSettings = {
  activeThemeId: string;
  approvalMode: SessionMode;
  activeAgentConfigurationId: string;
  activePresetId: string;
  agentConfigurations: AgentConfiguration[];
  builtinSkillPackages: Record<string, BuiltinSkillPackageReference>;
  characterStores: Record<string, CharacterStoreReference>;
  compressImages: boolean;
  developerMode: boolean;
  dangerousNonCharacterResourceWrites: boolean;
  files: Record<string, StoredFileReference>;
  floatingButton: boolean;
  floatingButtonAnchor: FloatingButtonAnchor;
  floatingButtonOffset: FloatingButtonOffset;
  globalSkills: Record<string, GlobalSkillIndexEntry>;
  onboardingDone: boolean;
  defaultModelSelection?: ModelSelection;
  providers: ApiProvider[];
  presetProfiles: StructuredPreset[];
  sendWithCtrlEnter: boolean;
  syncRevision: number;
  version: 4;
  workspaceFiles: Record<string, DreamCreatorWorkspaceFileReference>;
};

export const DEFAULT_AGENT_CONFIGURATION_ID = DEFAULT_BUILTIN_AGENT.id;

export const DEFAULT_DREAM_CARD_AGENT_SETTINGS: DreamCardAgentSettings = {
  activeThemeId: 'builtin:clean',
  approvalMode: 'normal',
  activeAgentConfigurationId: DEFAULT_AGENT_CONFIGURATION_ID,
  activePresetId: DEFAULT_PRESET.id,
  agentConfigurations: [defaultBuiltinAgentConfiguration()],
  builtinSkillPackages: {},
  characterStores: {},
  compressImages: true,
  developerMode: false,
  dangerousNonCharacterResourceWrites: false,
  files: {},
  floatingButton: true,
  floatingButtonAnchor: 'middle-right',
  floatingButtonOffset: { x: 18, y: 0 },
  globalSkills: {},
  onboardingDone: false,
  providers: [],
  presetProfiles: [cloneStructuredPreset(DEFAULT_PRESET)],
  sendWithCtrlEnter: false,
  syncRevision: 0,
  version: 4,
  workspaceFiles: {},
};

export interface AgentSettingsStore {
  destroy?(): void;
  load(): DreamCardAgentSettings;
  save(settings: DreamCardAgentSettings): Promise<void>;
  subscribe?(listener: () => void): () => void;
}

export class MemoryAgentSettingsStore implements AgentSettingsStore {
  private readonly listeners = new Set<() => void>();
  private value: DreamCardAgentSettings;
  constructor(initial: DreamCardAgentSettings = DEFAULT_DREAM_CARD_AGENT_SETTINGS) {
    this.value = normalizeSettings(initial);
  }
  load(): DreamCardAgentSettings {
    return structuredClone(this.value);
  }
  async save(settings: DreamCardAgentSettings): Promise<void> {
    this.value = normalizeSettings(settings);
    this.listeners.forEach(listener => listener());
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const SETTINGS_KEY = 'dream-card-agent';
const SHARED_CACHE_KEY = 'dream-card-agent:settings:v4';
const SETTINGS_CHANNEL = 'dream-card-agent:settings';

async function saveTavernSettingsImmediately(): Promise<void> {
  if (typeof builtin !== 'undefined' && typeof builtin.saveSettings === 'function') {
    await builtin.saveSettings();
    return;
  }
  // 测试环境缺少立即保存入口时才降级；真实酒馆不能把防抖调度误当成已落盘。
  await Promise.resolve(SillyTavern.saveSettingsDebounced());
}

export function normalizeSettings(raw?: Partial<DreamCardAgentSettings>): DreamCardAgentSettings {
  const anchor = raw?.floatingButtonAnchor ?? 'middle-right';
  const defaultOffset = defaultFloatingButtonOffset(anchor);
  const offset = raw?.floatingButtonOffset;
  const userPresetProfiles = (raw?.presetProfiles ?? [])
    .filter(preset => preset.id !== DEFAULT_PRESET.id)
    .map(cloneStructuredPreset);
  // 内置预设始终来自当前脚本资源，不能被设置中的旧副本遮住。
  const presetProfiles = [cloneStructuredPreset(DEFAULT_PRESET), ...userPresetProfiles];
  const activePresetId = presetProfiles.some(preset => preset.id === raw?.activePresetId)
    ? raw!.activePresetId!
    : presetProfiles[0].id;
  const storedConfigurations = raw?.agentConfigurations ?? [];
  const sourceConfigurations = [
    defaultBuiltinAgentConfiguration(),
    ...storedConfigurations.filter(configuration => configuration.id !== DEFAULT_AGENT_CONFIGURATION_ID),
  ];
  const seenConfigurationIds = new Set<string>();
  const agentConfigurations = sourceConfigurations.flatMap((configuration, index): AgentConfiguration[] => {
    if (
      !Array.isArray(configuration.skills) ||
      !Array.isArray(configuration.toolIds) ||
      configuration.skills.some(
        skill =>
          typeof skill !== 'object' ||
          skill === null ||
          typeof skill.id !== 'string' ||
          typeof skill.enabled !== 'boolean' ||
          !['full', 'on-demand'].includes(skill.loading),
      )
    ) {
      return [];
    }
    return [{
    id:
      typeof configuration.id === 'string' && configuration.id.trim()
        ? configuration.id
        : `agent:recovered-${index + 1}`,
    name:
      typeof configuration.name === 'string' && configuration.name.trim()
        ? configuration.name.trim()
        : `Agent配置 ${index + 1}`,
    presetId: presetProfiles.some(preset => preset.id === configuration.presetId)
      ? configuration.presetId
      : presetProfiles[0].id,
      skills: configuration.skills.map(skill => ({ ...skill })),
      toolIds: [...new Set(configuration.toolIds.filter(isAgentToolId))],
    }];
  }).filter(configuration => {
    if (seenConfigurationIds.has(configuration.id)) return false;
    seenConfigurationIds.add(configuration.id);
    return true;
  });
  const requestedActiveId = raw?.activeAgentConfigurationId;
  const activeAgentConfigurationId = agentConfigurations.some(configuration => configuration.id === requestedActiveId)
    ? requestedActiveId!
    : DEFAULT_AGENT_CONFIGURATION_ID;
  const providers = (raw?.providers ?? []).map(normalizeApiProvider);
  const requestedModelSelection = raw?.defaultModelSelection;
  const defaultModelSelection = findSelectedModel(providers, requestedModelSelection)
    ? structuredClone(requestedModelSelection as ModelSelection)
    : undefined;
  return {
    ...structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS),
    ...structuredClone(raw ?? {}),
    approvalMode: ['full', 'normal', 'yolo'].includes(raw?.approvalMode ?? '') ? raw!.approvalMode! : 'normal',
    characterStores: structuredClone(raw?.characterStores ?? {}),
    activeThemeId:
      typeof raw?.activeThemeId === 'string' && raw.activeThemeId.trim()
        ? raw.activeThemeId.trim()
        : DEFAULT_DREAM_CARD_AGENT_SETTINGS.activeThemeId,
    compressImages: raw?.compressImages !== false,
    dangerousNonCharacterResourceWrites: raw?.dangerousNonCharacterResourceWrites === true,
    files: structuredClone(raw?.files ?? {}),
    activeAgentConfigurationId,
    activePresetId,
    agentConfigurations,
    builtinSkillPackages: structuredClone(raw?.builtinSkillPackages ?? {}),
    floatingButtonAnchor: anchor,
    floatingButtonOffset: {
      x: Number.isFinite(offset?.x) ? offset!.x : defaultOffset.x,
      y: Number.isFinite(offset?.y) ? offset!.y : defaultOffset.y,
    },
    globalSkills: structuredClone(raw?.globalSkills ?? {}),
    defaultModelSelection,
    providers,
    presetProfiles,
    sendWithCtrlEnter: raw?.sendWithCtrlEnter === true,
    syncRevision: Number.isFinite(raw?.syncRevision) ? Math.max(0, raw!.syncRevision!) : 0,
    version: 4,
    workspaceFiles: structuredClone(raw?.workspaceFiles ?? {}),
  };
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyRecordChanges<T>(base: Record<string, T>, incoming: Record<string, T>, latest: Record<string, T>) {
  const result = structuredClone(latest);
  for (const key of new Set([...Object.keys(base), ...Object.keys(incoming)])) {
    if (equal(base[key], incoming[key])) continue;
    if (!(key in incoming)) delete result[key];
    else result[key] = structuredClone(incoming[key]);
  }
  return result;
}

/** 把当前页面相对其读取基线的改动，重放到其它页面写入的最新设置上。 */
export function mergeSettingsChanges(
  base: DreamCardAgentSettings,
  incoming: DreamCardAgentSettings,
  latest: DreamCardAgentSettings,
): DreamCardAgentSettings {
  const choose = <K extends keyof DreamCardAgentSettings>(key: K): DreamCardAgentSettings[K] =>
    structuredClone(equal(base[key], incoming[key]) ? latest[key] : incoming[key]);
  return {
    activeThemeId: choose('activeThemeId'),
    approvalMode: choose('approvalMode'),
    activeAgentConfigurationId: choose('activeAgentConfigurationId'),
    activePresetId: choose('activePresetId'),
    agentConfigurations: choose('agentConfigurations'),
    builtinSkillPackages: applyRecordChanges(
      base.builtinSkillPackages,
      incoming.builtinSkillPackages,
      latest.builtinSkillPackages,
    ),
    characterStores: applyRecordChanges(base.characterStores, incoming.characterStores, latest.characterStores),
    compressImages: choose('compressImages'),
    developerMode: choose('developerMode'),
    dangerousNonCharacterResourceWrites: choose('dangerousNonCharacterResourceWrites'),
    files: applyRecordChanges(base.files, incoming.files, latest.files),
    floatingButton: choose('floatingButton'),
    floatingButtonAnchor: choose('floatingButtonAnchor'),
    floatingButtonOffset: choose('floatingButtonOffset'),
    globalSkills: applyRecordChanges(base.globalSkills, incoming.globalSkills, latest.globalSkills),
    onboardingDone: choose('onboardingDone'),
    defaultModelSelection: choose('defaultModelSelection'),
    providers: choose('providers'),
    presetProfiles: choose('presetProfiles'),
    sendWithCtrlEnter: choose('sendWithCtrlEnter'),
    syncRevision: Math.max(base.syncRevision, incoming.syncRevision, latest.syncRevision) + 1,
    version: 4,
    workspaceFiles: applyRecordChanges(base.workspaceFiles, incoming.workspaceFiles, latest.workspaceFiles),
  };
}

export class TavernAgentSettingsStore implements AgentSettingsStore {
  private readonly baselines = new WeakMap<DreamCardAgentSettings, DreamCardAgentSettings>();
  private readonly channel?: BroadcastChannel;
  private readonly listeners = new Set<() => void>();
  private readonly storageListener = (event: StorageEvent) => {
    if (event.key === SHARED_CACHE_KEY) this.notify();
  };

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(SETTINGS_CHANNEL);
      this.channel.addEventListener('message', () => this.notify());
    }
    window.addEventListener('storage', this.storageListener);
  }

  load(): DreamCardAgentSettings {
    const value = this.readLatest();
    const result = structuredClone(value);
    this.baselines.set(result, structuredClone(value));
    return result;
  }

  async save(settings: DreamCardAgentSettings): Promise<void> {
    const save = async () => {
      const latest = this.readLatest();
      const base = this.baselines.get(settings) ?? latest;
      const merged = mergeSettingsChanges(base, normalizeSettings(settings), latest);
      this.writeCache(merged);
      SillyTavern.extensionSettings[SETTINGS_KEY] = structuredClone(merged);
      await saveTavernSettingsImmediately();
      this.baselines.set(settings, structuredClone(settings));
      this.channel?.postMessage({ revision: merged.syncRevision, type: 'settings-updated' });
      this.notify();
    };
    if (navigator.locks) await navigator.locks.request(`${SETTINGS_CHANNEL}:write`, save);
    else await save();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.channel?.close();
    window.removeEventListener('storage', this.storageListener);
    this.listeners.clear();
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  private readLatest(): DreamCardAgentSettings {
    const tavern = normalizeSettings(
      SillyTavern.extensionSettings[SETTINGS_KEY] as Partial<DreamCardAgentSettings> | undefined,
    );
    let cached: DreamCardAgentSettings | undefined;
    try {
      const raw = localStorage.getItem(SHARED_CACHE_KEY);
      if (raw) cached = normalizeSettings(JSON.parse(raw) as Partial<DreamCardAgentSettings>);
    } catch {
      // 隐私模式或损坏缓存时仍以酒馆设置继续运行。
    }
    return structuredClone(cached && cached.syncRevision > tavern.syncRevision ? cached : tavern);
  }

  private writeCache(settings: DreamCardAgentSettings): void {
    try {
      localStorage.setItem(SHARED_CACHE_KEY, JSON.stringify(settings));
    } catch {
      // 缓存只是同浏览器窗口的协调层；酒馆设置仍是持久化副本。
    }
  }
}
