import type { ApiProfile } from '../provider/profiles';
import { cloneStructuredPreset, DEFAULT_PRESET, type StructuredPreset } from '../preset/compiler';

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

export type GlobalSkillIndexEntry = {
  description: string;
  id: string;
  loading: 'full' | 'on-demand';
  name: string;
  revision: number;
  updatedAt: number;
  url: string;
};

export type AgentConfiguration = {
  id: string;
  name: string;
  presetId: string;
  /** 这套配置中开启的用户Skill；内置Skill始终挂载。 */
  skillIds: string[];
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
  activeAgentConfigurationId: string;
  activeProfileId?: string;
  activePresetId: string;
  agentConfigurations: AgentConfiguration[];
  characterStores: Record<string, CharacterStoreReference>;
  developerMode: boolean;
  files: Record<string, StoredFileReference>;
  floatingButton: boolean;
  floatingButtonAnchor: FloatingButtonAnchor;
  floatingButtonOffset: FloatingButtonOffset;
  globalSkills: Record<string, GlobalSkillIndexEntry>;
  onboardingDone: boolean;
  profiles: ApiProfile[];
  presetProfiles: StructuredPreset[];
  syncRevision: number;
  version: 3;
};

export const DEFAULT_AGENT_CONFIGURATION_ID = 'agent:default';

function defaultAgentConfiguration(presetId: string, skillIds: string[] = []): AgentConfiguration {
  return {
    id: DEFAULT_AGENT_CONFIGURATION_ID,
    name: '默认 Agent',
    presetId,
    skillIds: [...new Set(skillIds)],
  };
}

export const DEFAULT_DREAM_CARD_AGENT_SETTINGS: DreamCardAgentSettings = {
  activeAgentConfigurationId: DEFAULT_AGENT_CONFIGURATION_ID,
  activePresetId: DEFAULT_PRESET.id,
  agentConfigurations: [defaultAgentConfiguration(DEFAULT_PRESET.id)],
  characterStores: {},
  developerMode: false,
  files: {},
  floatingButton: true,
  floatingButtonAnchor: 'middle-right',
  floatingButtonOffset: { x: 18, y: 0 },
  globalSkills: {},
  onboardingDone: false,
  profiles: [],
  presetProfiles: [cloneStructuredPreset(DEFAULT_PRESET)],
  syncRevision: 0,
  version: 3,
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
    this.value = structuredClone(initial);
  }
  load(): DreamCardAgentSettings {
    return structuredClone(this.value);
  }
  async save(settings: DreamCardAgentSettings): Promise<void> {
    this.value = structuredClone(settings);
    this.listeners.forEach(listener => listener());
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const SETTINGS_KEY = 'dream-card-agent';
const SHARED_CACHE_KEY = 'dream-card-agent:settings:v3';
const SETTINGS_CHANNEL = 'dream-card-agent:settings';

function normalizeSettings(raw?: Partial<DreamCardAgentSettings>): DreamCardAgentSettings {
  const anchor = raw?.floatingButtonAnchor ?? 'middle-right';
  const defaultOffset = defaultFloatingButtonOffset(anchor);
  const offset = raw?.floatingButtonOffset;
  const presetProfiles = (raw?.presetProfiles?.length ? raw.presetProfiles : [DEFAULT_PRESET]).map(
    cloneStructuredPreset,
  );
  const activePresetId = presetProfiles.some(preset => preset.id === raw?.activePresetId)
    ? raw!.activePresetId!
    : presetProfiles[0].id;
  const legacyEnabledSkillIds = Object.values(raw?.globalSkills ?? {})
    .filter(entry => (entry as GlobalSkillIndexEntry & { enabled?: boolean }).enabled !== false)
    .map(entry => entry.id);
  const sourceConfigurations = raw?.agentConfigurations?.length
    ? raw.agentConfigurations
    : [defaultAgentConfiguration(activePresetId, legacyEnabledSkillIds)];
  const agentConfigurations = sourceConfigurations.map((configuration, index) => ({
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
    skillIds: [
      ...new Set((Array.isArray(configuration.skillIds) ? configuration.skillIds : []).filter(id => typeof id === 'string')),
    ],
  }));
  const activeAgentConfigurationId = agentConfigurations.some(
    configuration => configuration.id === raw?.activeAgentConfigurationId,
  )
    ? raw!.activeAgentConfigurationId!
    : agentConfigurations[0].id;
  return {
    ...structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS),
    ...structuredClone(raw ?? {}),
    characterStores: structuredClone(raw?.characterStores ?? {}),
    files: structuredClone(raw?.files ?? {}),
    activeAgentConfigurationId,
    activePresetId,
    agentConfigurations,
    floatingButtonAnchor: anchor,
    floatingButtonOffset: {
      x: Number.isFinite(offset?.x) ? offset!.x : defaultOffset.x,
      y: Number.isFinite(offset?.y) ? offset!.y : defaultOffset.y,
    },
    globalSkills: structuredClone(raw?.globalSkills ?? {}),
    profiles: structuredClone(raw?.profiles ?? []),
    presetProfiles,
    syncRevision: Number.isFinite(raw?.syncRevision) ? Math.max(0, raw!.syncRevision!) : 0,
    version: 3,
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
    activeAgentConfigurationId: choose('activeAgentConfigurationId'),
    activeProfileId: choose('activeProfileId'),
    activePresetId: choose('activePresetId'),
    agentConfigurations: choose('agentConfigurations'),
    characterStores: applyRecordChanges(base.characterStores, incoming.characterStores, latest.characterStores),
    developerMode: choose('developerMode'),
    files: applyRecordChanges(base.files, incoming.files, latest.files),
    floatingButton: choose('floatingButton'),
    floatingButtonAnchor: choose('floatingButtonAnchor'),
    floatingButtonOffset: choose('floatingButtonOffset'),
    globalSkills: applyRecordChanges(base.globalSkills, incoming.globalSkills, latest.globalSkills),
    onboardingDone: choose('onboardingDone'),
    profiles: choose('profiles'),
    presetProfiles: choose('presetProfiles'),
    syncRevision: Math.max(base.syncRevision, incoming.syncRevision, latest.syncRevision) + 1,
    version: 3,
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
      await SillyTavern.saveSettingsDebounced();
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
