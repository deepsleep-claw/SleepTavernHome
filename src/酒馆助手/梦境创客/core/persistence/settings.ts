import type { ApiProfile } from '../provider/profiles';

export type StoredFileReference = {
  bindingId: string;
  createdAt: number;
  name: string;
  size: number;
  url: string;
};

export type SessionIndexEntry = {
  bindingId: string;
  characterName: string;
  createdAt: number;
  leaseUrl?: string;
  manifestHash: string;
  manifestUrl: string;
  previousManifestHash?: string;
  previousManifestUrl?: string;
  revision: number;
  sessionId: string;
  title: string;
  updatedAt: number;
};

export type DreamCardAgentSettings = {
  activeProfileId?: string;
  developerMode: boolean;
  files: Record<string, StoredFileReference>;
  floatingButton: boolean;
  profiles: ApiProfile[];
  sessions: Record<string, SessionIndexEntry>;
  version: 1;
};

export const DEFAULT_DREAM_CARD_AGENT_SETTINGS: DreamCardAgentSettings = {
  developerMode: false,
  files: {},
  floatingButton: true,
  profiles: [],
  sessions: {},
  version: 1,
};

export interface AgentSettingsStore {
  load(): DreamCardAgentSettings;
  save(settings: DreamCardAgentSettings): Promise<void>;
}

export class MemoryAgentSettingsStore implements AgentSettingsStore {
  private value: DreamCardAgentSettings;
  constructor(initial: DreamCardAgentSettings = DEFAULT_DREAM_CARD_AGENT_SETTINGS) {
    this.value = structuredClone(initial);
  }
  load(): DreamCardAgentSettings {
    return structuredClone(this.value);
  }
  async save(settings: DreamCardAgentSettings): Promise<void> {
    this.value = structuredClone(settings);
  }
}

export class TavernAgentSettingsStore implements AgentSettingsStore {
  private readonly key = 'dream-card-agent';

  load(): DreamCardAgentSettings {
    const raw = SillyTavern.extensionSettings[this.key] as Partial<DreamCardAgentSettings> | undefined;
    return {
      ...structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS),
      ...structuredClone(raw ?? {}),
      files: structuredClone(raw?.files ?? {}),
      profiles: structuredClone(raw?.profiles ?? []),
      sessions: structuredClone(raw?.sessions ?? {}),
      version: 1,
    };
  }

  async save(settings: DreamCardAgentSettings): Promise<void> {
    SillyTavern.extensionSettings[this.key] = structuredClone(settings);
    await SillyTavern.saveSettingsDebounced();
  }
}
