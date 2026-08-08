import type { ModelMessage } from 'ai';
import type { WorkspaceFile } from '../workspace/types';
import { canonicalParse, canonicalStringify, sha256 } from '../transaction/canonical';
import type { RunnerEvent } from '../runner/agent-runner';
import type { PersistedSessionRuntime } from '../session/types';
import type { AgentSettingsStore, SessionIndexEntry } from './settings';
import type { TavernFileClient } from './file-client';

export type SessionManifest = {
  avatarId?: string;
  bindingId: string;
  contextUrl: string;
  createdAt: number;
  eventSegmentUrls: string[];
  revision: number;
  runtimeUrl?: string;
  schemaVersion: 1;
  sessionId: string;
  snapshotHashes: string[];
  status: 'abnormal' | 'completed' | 'idle' | 'running' | 'stopped';
  updatedAt: number;
  workingCopyUrl: string;
};

export type SessionRevision = {
  context: ModelMessage[];
  events: RunnerEvent[];
  manifest: SessionManifest;
  runtime?: PersistedSessionRuntime;
  workingCopy: WorkspaceFile[];
};

export type CommitSessionRevision = {
  avatarId?: string;
  bindingId: string;
  characterName: string;
  context: ModelMessage[];
  events: RunnerEvent[];
  runtime?: PersistedSessionRuntime;
  sessionId: string;
  snapshotHashes: string[];
  status: SessionManifest['status'];
  title: string;
  workingCopy: WorkspaceFile[];
};

function safe(value: string): string {
  return value.replace(/[^a-zA-Z\d_-]/gu, '_').slice(0, 80);
}

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalStringify(value));
}

export class SessionRevisionStore {
  constructor(
    private readonly client: TavernFileClient,
    private readonly settingsStore: AgentSettingsStore,
    private readonly now: () => number = Date.now,
    private readonly eventSegmentSize = 256,
  ) {}

  async commit(input: CommitSessionRevision): Promise<SessionIndexEntry> {
    const settings = this.settingsStore.load();
    const previous = settings.sessions[input.sessionId];
    const revision = (previous?.revision ?? 0) + 1;
    const prefix = `dream-card-agent--${safe(input.bindingId)}--${safe(input.sessionId)}--r${revision}`;
    const upload = async (name: string, data: Uint8Array): Promise<string> => {
      const url = await this.client.upload(name, data);
      settings.files[`session:${name}`] = {
        bindingId: input.bindingId,
        createdAt: this.now(),
        name,
        size: data.byteLength,
        url,
      };
      await this.settingsStore.save(settings);
      return url;
    };
    const workingCopyUrl = await upload(`${prefix}--working.json`, bytes(input.workingCopy));
    const contextUrl = await upload(`${prefix}--context.json`, bytes(input.context));
    const runtimeUrl = input.runtime
      ? await upload(`${prefix}--runtime.json`, bytes(input.runtime))
      : undefined;
    const eventSegmentUrls: string[] = [];
    for (let offset = 0; offset < input.events.length; offset += this.eventSegmentSize) {
      eventSegmentUrls.push(
        await upload(
          `${prefix}--events-${String(offset / this.eventSegmentSize + 1).padStart(4, '0')}.json`,
          bytes(input.events.slice(offset, offset + this.eventSegmentSize)),
        ),
      );
    }
    const timestamp = this.now();
    const manifest: SessionManifest = {
      bindingId: input.bindingId,
      avatarId: input.avatarId,
      contextUrl,
      createdAt: previous?.createdAt ?? timestamp,
      eventSegmentUrls,
      revision,
      runtimeUrl,
      schemaVersion: 1,
      sessionId: input.sessionId,
      snapshotHashes: [...new Set(input.snapshotHashes)],
      status: input.status,
      updatedAt: timestamp,
      workingCopyUrl,
    };
    const manifestBytes = bytes(manifest);
    const manifestHash = await sha256(manifestBytes);
    const manifestName = `${prefix}--manifest-${manifestHash.slice(0, 12)}.json`;
    const manifestUrl = await upload(manifestName, manifestBytes);
    const entry: SessionIndexEntry = {
      avatarId: input.avatarId ?? previous?.avatarId,
      bindingId: input.bindingId,
      characterName: input.characterName,
      createdAt: previous?.createdAt ?? timestamp,
      manifestHash,
      manifestUrl,
      leaseUrl: previous?.leaseUrl,
      previousManifestHash: previous?.manifestHash,
      previousManifestUrl: previous?.manifestUrl,
      revision,
      sessionId: input.sessionId,
      title: input.title,
      updatedAt: timestamp,
    };
    settings.sessions[input.sessionId] = entry;
    await this.settingsStore.save(settings);
    return entry;
  }

  async load(sessionId: string): Promise<SessionRevision> {
    const entry = this.settingsStore.load().sessions[sessionId];
    if (!entry) throw new Error(`会话不存在：${sessionId}`);
    try {
      return await this.loadManifest(entry.manifestUrl, entry.manifestHash, entry.revision);
    } catch (error) {
      if (!entry.previousManifestUrl || entry.revision <= 1) throw error;
      return this.loadManifest(entry.previousManifestUrl, entry.previousManifestHash ?? '', entry.revision - 1);
    }
  }

  private async loadManifest(url: string, expectedHash: string, expectedRevision: number): Promise<SessionRevision> {
    const manifestBytes = await this.client.download(url);
    if (expectedHash && (await sha256(manifestBytes)) !== expectedHash) {
      throw new Error(`会话Manifest哈希不匹配：${url}`);
    }
    const manifest = canonicalParse<SessionManifest>(new TextDecoder().decode(manifestBytes));
    if (manifest.schemaVersion !== 1 || manifest.revision !== expectedRevision) {
      throw new Error(`会话Manifest版本不匹配：${url}`);
    }
    const [workingCopy, context, runtime, segments] = await Promise.all([
      this.client.download(manifest.workingCopyUrl),
      this.client.download(manifest.contextUrl),
      manifest.runtimeUrl ? this.client.download(manifest.runtimeUrl) : undefined,
      Promise.all(manifest.eventSegmentUrls.map(segment => this.client.download(segment))),
    ]);
    return {
      context: canonicalParse<ModelMessage[]>(new TextDecoder().decode(context)),
      events: segments.flatMap(segment => canonicalParse<RunnerEvent[]>(new TextDecoder().decode(segment))),
      manifest,
      runtime: runtime ? canonicalParse<PersistedSessionRuntime>(new TextDecoder().decode(runtime)) : undefined,
      workingCopy: canonicalParse<WorkspaceFile[]>(new TextDecoder().decode(workingCopy)),
    };
  }
}
