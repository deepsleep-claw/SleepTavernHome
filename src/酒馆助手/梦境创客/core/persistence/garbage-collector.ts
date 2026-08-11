import type { TavernFileClient } from './file-client';
import type { AgentSettingsStore, DreamCardAgentSettings } from './settings';

const DEFAULT_ORPHAN_AGE = 7 * 24 * 60 * 60 * 1000;

function manifestReferences(settings: DreamCardAgentSettings): Set<string> {
  const references = new Set<string>();
  Object.values(settings.globalSkills).forEach(skill => {
    references.add(skill.url);
    Object.values(skill.files ?? {}).forEach(file => references.add(file.url));
  });
  Object.values(settings.characterStores).forEach(store => references.add(store.url));
  return references;
}

export class FileRegistryGarbageCollector {
  constructor(
    private readonly client: TavernFileClient,
    private readonly settingsStore: AgentSettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  async collect(additionalReferences: Iterable<string> = [], orphanAge = DEFAULT_ORPHAN_AGE): Promise<string[]> {
    const settings = this.settingsStore.load();
    const retained = manifestReferences(settings);
    for (const reference of additionalReferences) retained.add(reference);
    const removed: string[] = [];
    for (const [key, file] of Object.entries(settings.files)) {
      if (retained.has(file.url) || this.now() - file.createdAt < orphanAge) continue;
      try {
        await this.client.delete(file.url);
        delete settings.files[key];
        removed.push(file.url);
      } catch {
        // 保留登记项，下一次维护时重试。
      }
    }
    if (removed.length > 0) await this.settingsStore.save(settings);
    return removed.sort();
  }
}
