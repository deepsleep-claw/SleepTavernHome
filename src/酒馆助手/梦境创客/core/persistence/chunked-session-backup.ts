import type { PersistedSessionRuntime } from '../session/types';
import type { TavernFileClient } from './file-client';
import { joinSessionRuntime, splitSessionRuntime, type SessionPartField } from './session-parts';

type ChunkReference = { url: string; size: number; encoding: 'json' | 'gzip' };
export type ChunkedSessionManifest = {
  format: 'dream-creator-session-parts';
  version: 1;
  revision: number;
  commitId: string;
  sessionId: string;
  fields: SessionPartField[];
  parts: Record<string, ChunkReference>;
  retired: Array<ChunkReference & { retiredAt: number }>;
};

export function isChunkedSessionManifest(value: unknown): value is ChunkedSessionManifest {
  return Boolean(
    value && typeof value === 'object' && (value as ChunkedSessionManifest).format === 'dream-creator-session-parts',
  );
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(stream)).arrayBuffer(),
  );
}

/** 完成的数据块保持地址稳定，索引发布后才成为可恢复的备份。 */
export class ChunkedSessionBackup {
  private readonly cache = new Map<string, string>();
  private cacheCharacters = 0;
  private readonly uploaded = new Map<string, ChunkReference>();
  private readonly collected = new Set<string>();

  constructor(private readonly client: TavernFileClient) {}

  private remember(url: string, text: string): void {
    this.cacheCharacters -= this.cache.get(url)?.length ?? 0;
    this.cache.delete(url);
    this.cache.set(url, text);
    this.cacheCharacters += text.length;
    while (this.cacheCharacters > 4 * 1024 * 1024) {
      const first = this.cache.entries().next().value;
      if (!first) break;
      this.cache.delete(first[0]);
      this.cacheCharacters -= first[1].length;
    }
  }

  async manifest(url?: string): Promise<ChunkedSessionManifest | undefined> {
    if (!url) return undefined;
    const value: unknown = JSON.parse(new TextDecoder().decode(await this.client.download(url)));
    if (!isChunkedSessionManifest(value)) return undefined;
    if (
      value.version !== 1 ||
      !Array.isArray(value.fields) ||
      !value.parts ||
      !Number.isInteger(value.revision) ||
      value.revision < 1 ||
      typeof value.sessionId !== 'string'
    )
      throw new Error('后端会话分块索引格式无效。');
    return value;
  }

  private async readPart(part: ChunkReference): Promise<string> {
    const cached = this.cache.get(part.url);
    if (cached !== undefined) return cached;
    let bytes = await this.client.download(part.url);
    if (bytes.byteLength !== part.size) throw new Error('后端会话分块尚未完整写入。');
    if (part.encoding === 'gzip') bytes = await transform(bytes, new DecompressionStream('gzip'));
    else if (part.encoding !== 'json') throw new Error('会话分块编码不受支持。');
    const text: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof text !== 'string') throw new Error('后端会话分块格式无效。');
    this.remember(part.url, text);
    return text;
  }

  async load(manifest: ChunkedSessionManifest): Promise<PersistedSessionRuntime> {
    if (manifest.version !== 1) throw new Error('会话分块版本不受支持。');
    const parts = new Map<string, string>();
    for (const key of manifest.fields.flatMap(field => field.groups.flat())) {
      const reference = manifest.parts[key];
      if (!reference) throw new Error(`会话分块引用缺失：${key}`);
      parts.set(key, await this.readPart(reference));
    }
    const runtime = joinSessionRuntime(manifest.fields, parts);
    if (runtime.sessionId !== manifest.sessionId) throw new Error('会话分块所属会话不匹配。');
    return runtime;
  }

  async upload(input: {
    runtime: PersistedSessionRuntime;
    revision: number;
    commitId: string;
    previousUrl?: string;
  }): Promise<{ url: string; size: number; manifest: ChunkedSessionManifest }> {
    const previous = await this.manifest(input.previousUrl);
    const split = splitSessionRuntime(input.runtime);
    const parts: Record<string, ChunkReference> = {};
    let index = 0;
    for (const [key, text] of split.parts) {
      const old = previous?.parts[key];
      if (old && (await this.readPart(old).catch(() => undefined)) === text) parts[key] = old;
      else {
        const name = `DreamCreator--Part--${input.commitId}--${index}.bin`;
        let reference = this.uploaded.get(name);
        if (!reference) {
          let bytes: Uint8Array = new TextEncoder().encode(JSON.stringify(text));
          const encoding = typeof CompressionStream === 'undefined' ? 'json' : 'gzip';
          if (encoding === 'gzip') bytes = await transform(bytes, new CompressionStream('gzip'));
          const url = await this.client.upload(name, bytes);
          reference = { url, size: bytes.byteLength, encoding };
          this.uploaded.set(name, reference);
          this.remember(url, text);
        }
        parts[key] = reference;
      }
      index += 1;
    }
    const currentUrls = new Set(Object.values(parts).map(part => part.url));
    const retired = new Map(
      (previous?.retired ?? []).filter(part => !this.collected.has(part.url)).map(part => [part.url, part]),
    );
    for (const part of Object.values(previous?.parts ?? {})) {
      if (!currentUrls.has(part.url)) retired.set(part.url, { ...part, retiredAt: Date.now() });
    }
    for (const url of currentUrls) retired.delete(url);
    const manifest: ChunkedSessionManifest = {
      format: 'dream-creator-session-parts',
      version: 1,
      revision: input.revision,
      commitId: input.commitId,
      sessionId: input.runtime.sessionId,
      fields: split.fields,
      parts,
      retired: [...retired.values()],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const url = await this.client.upload(`DreamCreator--Session--${input.commitId}.json`, bytes);
    return {
      url,
      size: bytes.byteLength + Object.values(parts).reduce((total, part) => total + part.size, 0),
      manifest,
    };
  }

  async collect(manifest: ChunkedSessionManifest, previousUrl?: string): Promise<void> {
    const previous = await this.manifest(previousUrl);
    const protectedUrls = new Set(
      [...Object.values(manifest.parts), ...Object.values(previous?.parts ?? {})].map(part => part.url),
    );
    for (const part of manifest.retired) {
      const name = new URL(part.url, 'https://local.invalid').pathname.split('/').at(-1) ?? '';
      if (!/^DreamCreator--Part--[a-zA-Z\d-]+--\d+\.bin$/u.test(name)) continue;
      if (protectedUrls.has(part.url) || Date.now() - part.retiredAt < 7 * 24 * 60 * 60_000) continue;
      try {
        await this.client.delete(part.url);
        this.collected.add(part.url);
      } catch {
        continue;
      }
      const cached = this.cache.get(part.url);
      if (cached !== undefined) {
        this.cache.delete(part.url);
        this.cacheCharacters -= cached.length;
      }
    }
    for (const name of this.uploaded.keys())
      if (name.startsWith(`DreamCreator--Part--${manifest.commitId}--`)) this.uploaded.delete(name);
  }
}
