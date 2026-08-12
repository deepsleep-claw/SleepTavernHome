import { canonicalParse, canonicalStringify, sha256 } from '../transaction/canonical';
import type { AgentSettingsStore, CharacterStoreReference, SessionIndexEntry } from './settings';
import type { TavernFileClient } from './file-client';

export type CharacterMetadata = {
  avatarId?: string;
  bindingId: string;
  characterName: string;
  revision: number;
  schemaVersion: 1;
  sessions: Record<string, SessionIndexEntry>;
  updatedAt: number;
};

function safe(value: string): string {
  return value.replace(/[^a-zA-Z\d_-]/gu, '_').slice(0, 80);
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalStringify(value));
}

export class CharacterMetadataStore {
  constructor(
    private readonly client: TavernFileClient,
    private readonly settingsStore: AgentSettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  async load(
    bindingId: string,
    defaults: { avatarId?: string; characterName?: string } = {},
  ): Promise<CharacterMetadata> {
    const reference = this.settingsStore.load().characterStores[bindingId];
    if (!reference) {
      return {
        avatarId: defaults.avatarId,
        bindingId,
        characterName: defaults.characterName ?? '',
        revision: 0,
        schemaVersion: 1,
        sessions: {},
        updatedAt: this.now(),
      };
    }
    const bytes = await this.client.download(reference.url);
    const actualHash = await sha256(bytes);
    let metadata: CharacterMetadata;
    try {
      metadata = canonicalParse<CharacterMetadata>(new TextDecoder().decode(bytes));
    } catch {
      throw new Error(`角色会话索引格式不匹配：${bindingId}`);
    }
    if (metadata.schemaVersion !== 1 || metadata.bindingId !== bindingId) {
      throw new Error(`角色会话索引格式不匹配：${bindingId}`);
    }
    if (
      actualHash !== reference.sha256 ||
      metadata.revision !== reference.revision ||
      bytes.byteLength !== reference.size
    ) {
      console.warn('[梦境创客] 角色会话索引引用落后，已采用服务器上的有效索引并修复引用。', {
        actualRevision: metadata.revision,
        bindingId,
        referencedRevision: reference.revision,
      });
      const settings = this.settingsStore.load();
      const latestReference = settings.characterStores[bindingId];
      if (latestReference?.url === reference.url) {
        settings.characterStores[bindingId] = {
          avatarId: metadata.avatarId,
          bindingId,
          characterName: metadata.characterName,
          revision: metadata.revision,
          sha256: actualHash,
          size: bytes.byteLength,
          updatedAt: metadata.updatedAt,
          url: reference.url,
        };
        await this.settingsStore.save(settings).catch(error => {
          console.warn('[梦境创客] 有效角色索引已载入，但引用修复暂未持久化。', error);
        });
      }
    }
    return metadata;
  }

  async save(metadata: CharacterMetadata): Promise<CharacterStoreReference> {
    const value: CharacterMetadata = {
      ...structuredClone(metadata),
      revision: metadata.revision + 1,
      schemaVersion: 1,
      updatedAt: this.now(),
    };
    const bytes = encode(value);
    const hash = await sha256(bytes);
    const name = `DreamCreator--Meta--${safe(value.bindingId)}.json`;
    const url = await this.client.upload(name, bytes);
    const reference: CharacterStoreReference = {
      avatarId: value.avatarId,
      bindingId: value.bindingId,
      characterName: value.characterName,
      revision: value.revision,
      sha256: hash,
      size: bytes.byteLength,
      updatedAt: value.updatedAt,
      url,
    };
    const settings = this.settingsStore.load();
    settings.characterStores[value.bindingId] = reference;
    await this.settingsStore.save(settings);
    return reference;
  }

  async upsertSession(entry: SessionIndexEntry): Promise<CharacterMetadata> {
    const metadata = await this.load(entry.bindingId, {
      avatarId: entry.avatarId,
      characterName: entry.characterName,
    });
    metadata.avatarId = entry.avatarId ?? metadata.avatarId;
    metadata.characterName = entry.characterName;
    metadata.sessions[entry.sessionId] = structuredClone(entry);
    await this.save(metadata);
    return metadata;
  }

  async removeSession(bindingId: string, sessionId: string): Promise<SessionIndexEntry | undefined> {
    const metadata = await this.load(bindingId);
    const entry = metadata.sessions[sessionId];
    if (!entry) return undefined;
    delete metadata.sessions[sessionId];
    await this.save(metadata);
    await this.client.delete(entry.url).catch(() => undefined);
    return entry;
  }

  async removeCharacter(bindingId: string): Promise<SessionIndexEntry[]> {
    const metadata = await this.load(bindingId);
    const entries = Object.values(metadata.sessions);
    const settings = this.settingsStore.load();
    const reference = settings.characterStores[bindingId];
    delete settings.characterStores[bindingId];
    await this.settingsStore.save(settings);
    await Promise.all(entries.map(entry => this.client.delete(entry.url).catch(() => undefined)));
    if (reference) await this.client.delete(reference.url).catch(() => undefined);
    return entries;
  }
}
