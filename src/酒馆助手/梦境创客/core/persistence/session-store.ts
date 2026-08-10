import type { WorkspaceFile } from '../workspace/types';
import { canonicalParse, canonicalStringify, sha256 } from '../transaction/canonical';
import type { PersistedSessionRuntime } from '../session/types';
import { CharacterMetadataStore } from './character-store';
import type { AgentSettingsStore, SessionIndexEntry } from './settings';
import type { TavernFileClient } from './file-client';

type SessionFilePayload = {
  runtime: PersistedSessionRuntime;
  snapshotBlobs: Record<string, string>;
  workingCopy: WorkspaceFile[];
};

type SessionFileEnvelope = {
  data: string;
  encoding: 'base64' | 'gzip+base64';
  format: 'dream-card-agent-session';
  revision: number;
  schemaVersion: 2;
  sha256: string;
};

export type SessionRevision = {
  entry: SessionIndexEntry;
  runtime: PersistedSessionRuntime;
  snapshotBlobs: Record<string, Uint8Array>;
  workingCopy: WorkspaceFile[];
};

export type CommitSessionRevision = {
  avatarId?: string;
  bindingId: string;
  characterName: string;
  runtime: PersistedSessionRuntime;
  snapshotBlobs: Record<string, Uint8Array>;
  status: SessionIndexEntry['status'];
  workingCopy: WorkspaceFile[];
};

function safe(value: string): string {
  return value.replace(/[^a-zA-Z\d_-]/gu, '_').slice(0, 80);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const buffer = Uint8Array.from(bytes).buffer;
  return new Uint8Array(await new Response(new Blob([buffer]).stream().pipeThrough(stream)).arrayBuffer());
}

async function envelope(payload: SessionFilePayload, revision: number): Promise<SessionFileEnvelope> {
  const raw = new TextEncoder().encode(canonicalStringify(payload));
  const compressed =
    typeof CompressionStream === 'undefined' ? raw : await transform(raw, new CompressionStream('gzip'));
  return {
    data: toBase64(compressed),
    encoding: typeof CompressionStream === 'undefined' ? 'base64' : 'gzip+base64',
    format: 'dream-card-agent-session',
    revision,
    schemaVersion: 2,
    sha256: await sha256(raw),
  };
}

async function openEnvelope(value: SessionFileEnvelope): Promise<SessionFilePayload> {
  if (value.format !== 'dream-card-agent-session' || value.schemaVersion !== 2) {
    throw new Error('会话文件格式不匹配。');
  }
  let raw = fromBase64(value.data);
  if (value.encoding === 'gzip+base64') {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持gzip会话解压。');
    raw = await transform(raw, new DecompressionStream('gzip'));
  }
  if ((await sha256(raw)) !== value.sha256) throw new Error('会话文件内容校验失败。');
  return canonicalParse<SessionFilePayload>(new TextDecoder().decode(raw));
}

function encodeSnapshots(blobs: Record<string, Uint8Array>): Record<string, string> {
  return Object.fromEntries(Object.entries(blobs).map(([hash, bytes]) => [hash, toBase64(bytes)]));
}

function decodeSnapshots(blobs: Record<string, string>): Record<string, Uint8Array> {
  return Object.fromEntries(Object.entries(blobs).map(([hash, bytes]) => [hash, fromBase64(bytes)]));
}

export class SessionRevisionStore {
  private readonly characters: CharacterMetadataStore;

  constructor(
    private readonly client: TavernFileClient,
    settingsStore: AgentSettingsStore,
    private readonly now: () => number = Date.now,
  ) {
    this.characters = new CharacterMetadataStore(client, settingsStore, now);
  }

  async commit(input: CommitSessionRevision): Promise<SessionIndexEntry> {
    const metadata = await this.characters.load(input.bindingId, {
      avatarId: input.avatarId,
      characterName: input.characterName,
    });
    const previous = metadata.sessions[input.runtime.sessionId];
    const revision = (previous?.revision ?? 0) + 1;
    const packed = await envelope(
      {
        runtime: input.runtime,
        snapshotBlobs: encodeSnapshots(input.snapshotBlobs),
        workingCopy: input.workingCopy,
      },
      revision,
    );
    const bytes = new TextEncoder().encode(canonicalStringify(packed));
    const name = `dream-card-agent--${safe(input.bindingId)}--session--${safe(input.runtime.sessionId)}.json`;
    const url = await this.client.upload(name, bytes);
    const timestamp = this.now();
    const entry: SessionIndexEntry = {
      avatarId: input.avatarId ?? previous?.avatarId,
      bindingId: input.bindingId,
      characterName: input.characterName,
      createdAt: previous?.createdAt ?? input.runtime.createdAt,
      revision,
      sessionId: input.runtime.sessionId,
      sha256: await sha256(bytes),
      size: bytes.byteLength,
      status: input.status,
      title: input.runtime.title,
      updatedAt: timestamp,
      url,
    };
    await this.characters.upsertSession(entry);
    return entry;
  }

  async load(bindingId: string, sessionId: string): Promise<SessionRevision> {
    const metadata = await this.characters.load(bindingId);
    const entry = metadata.sessions[sessionId];
    if (!entry) throw new Error(`会话不存在：${sessionId}`);
    const bytes = await this.client.download(entry.url);
    if ((await sha256(bytes)) !== entry.sha256) throw new Error(`会话文件校验失败：${sessionId}`);
    const packed = canonicalParse<SessionFileEnvelope>(new TextDecoder().decode(bytes));
    if (packed.revision !== entry.revision) throw new Error(`会话Revision不匹配：${sessionId}`);
    const payload = await openEnvelope(packed);
    if (payload.runtime.sessionId !== sessionId) throw new Error(`会话ID不匹配：${sessionId}`);
    return {
      entry,
      runtime: payload.runtime,
      snapshotBlobs: decodeSnapshots(payload.snapshotBlobs),
      workingCopy: payload.workingCopy,
    };
  }
}
