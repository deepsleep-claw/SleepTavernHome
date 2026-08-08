import type { TavernFileClient } from './file-client';
import type { SessionManifest } from './session-store';
import type { AgentSettingsStore, DreamCardAgentSettings } from './settings';

const DEFAULT_ORPHAN_AGE = 7 * 24 * 60 * 60 * 1000;

function manifestReferences(settings: DreamCardAgentSettings): Set<string> {
  const references = new Set<string>();
  for (const session of Object.values(settings.sessions)) {
    references.add(session.manifestUrl);
    if (session.previousManifestUrl) references.add(session.previousManifestUrl);
    if (session.leaseUrl) references.add(session.leaseUrl);
  }
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
    await this.expandManifestReferences(settings, retained);
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

  private async expandManifestReferences(settings: DreamCardAgentSettings, retained: Set<string>): Promise<void> {
    for (const session of Object.values(settings.sessions)) {
      for (const url of [session.manifestUrl, session.previousManifestUrl]) {
        if (!url) continue;
        try {
          const bytes = await this.client.download(url);
          const manifest = JSON.parse(new TextDecoder().decode(bytes)) as SessionManifest;
          retained.add(manifest.contextUrl);
          retained.add(manifest.workingCopyUrl);
          if (manifest.runtimeUrl) retained.add(manifest.runtimeUrl);
          manifest.eventSegmentUrls.forEach(item => retained.add(item));
          for (const hash of manifest.snapshotHashes) {
            const snapshot = settings.files[hash];
            if (snapshot) retained.add(snapshot.url);
          }
        } catch {
          // Manifest损坏时不猜测引用，保留Manifest本身供恢复诊断。
        }
      }
    }
  }
}
