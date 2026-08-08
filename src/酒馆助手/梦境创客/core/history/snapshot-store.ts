import { canonicalParse, canonicalStringify, sha256 } from '../transaction/canonical';
import type { BinaryBlobStore } from './blob-store';

const RAW = 0;
const GZIP = 1;

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const input = new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(input).arrayBuffer());
}

async function encode(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    return Uint8Array.of(RAW, ...bytes);
  }
  const compressed = await transform(bytes, new CompressionStream('gzip'));
  const result = new Uint8Array(compressed.length + 1);
  result[0] = GZIP;
  result.set(compressed, 1);
  return result;
}

async function decode(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] === RAW) {
    return bytes.slice(1);
  }
  if (bytes[0] !== GZIP) {
    throw new Error('无法识别的快照压缩格式。');
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持gzip快照解压。');
  }
  return transform(bytes.slice(1), new DecompressionStream('gzip'));
}

export class ContentAddressedSnapshotStore {
  constructor(private readonly blobs: BinaryBlobStore) {}

  async collectGarbage(references: Iterable<string>): Promise<string[]> {
    const retained = new Set(references);
    const removed: string[] = [];
    for (const key of await this.blobs.keys()) {
      if (!retained.has(key)) {
        await this.blobs.delete(key);
        removed.push(key);
      }
    }
    return removed;
  }

  async get<T>(hash: string): Promise<T> {
    const stored = await this.blobs.get(hash);
    if (!stored) {
      throw new Error(`快照不存在：${hash}`);
    }
    const raw = await decode(stored);
    const actualHash = await sha256(raw);
    if (actualHash !== hash) {
      throw new Error(`快照校验失败：${hash}`);
    }
    return canonicalParse<T>(new TextDecoder().decode(raw));
  }

  async put<T>(value: T): Promise<string> {
    const raw = new TextEncoder().encode(canonicalStringify(value));
    const hash = await sha256(raw);
    if (!(await this.blobs.get(hash))) {
      await this.blobs.put(hash, await encode(raw));
    }
    return hash;
  }
}
