import { afterEach, describe, expect, it, vi } from 'vitest';
import { transactionState } from '../transaction/test-fixture';
import { MemoryBinaryBlobStore } from './blob-store';
import { ContentAddressedSnapshotStore } from './snapshot-store';

describe('content addressed snapshots', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('使用SHA-256去重并无损恢复正则', async () => {
    const blobs = new MemoryBinaryBlobStore();
    const snapshots = new ContentAddressedSnapshotStore(blobs);
    const state = transactionState();
    const first = await snapshots.put(state);
    const second = await snapshots.put(structuredClone(state));
    expect(first).toBe(second);
    expect(await blobs.keys()).toEqual([first]);
    const restored = await snapshots.get<typeof state>(first);
    expect(restored).toEqual(state);
    expect(restored.worldbooks[0].entries[0].strategy.keys[1]).toBeInstanceOf(RegExp);
  });

  it('清理未引用Blob并报告缺失快照', async () => {
    const blobs = new MemoryBinaryBlobStore();
    const snapshots = new ContentAddressedSnapshotStore(blobs);
    const retained = await snapshots.put({ value: 1 });
    const removed = await snapshots.put({ value: 2 });
    expect(await snapshots.collectGarbage([retained])).toEqual([removed]);
    await expect(snapshots.get(removed)).rejects.toThrow('快照不存在');
  });

  it('检测损坏的快照内容', async () => {
    const blobs = new MemoryBinaryBlobStore();
    const snapshots = new ContentAddressedSnapshotStore(blobs);
    const hash = await snapshots.put({ value: 'safe' });
    const data = await blobs.get(hash);
    expect(data).toBeDefined();
    data![data!.length - 1] ^= 0xff;
    await blobs.put(hash, data!);
    await expect(snapshots.get(hash)).rejects.toThrow();
  });

  it('在不支持CompressionStream时使用原始格式并校验哈希', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const blobs = new MemoryBinaryBlobStore();
    const snapshots = new ContentAddressedSnapshotStore(blobs);
    const hash = await snapshots.put({ value: 'raw' });
    const stored = await blobs.get(hash);
    expect(stored?.[0]).toBe(0);
    expect(await snapshots.get(hash)).toEqual({ value: 'raw' });
    stored![stored!.length - 1] ^= 1;
    await blobs.put(hash, stored!);
    await expect(snapshots.get(hash)).rejects.toThrow('校验失败');
  });

  it('拒绝未知压缩格式和缺失的gzip解压能力', async () => {
    const blobs = new MemoryBinaryBlobStore();
    const snapshots = new ContentAddressedSnapshotStore(blobs);
    await blobs.put('invalid', Uint8Array.of(9, 1, 2));
    await expect(snapshots.get('invalid')).rejects.toThrow('无法识别');

    const hash = await snapshots.put({ value: 'gzip' });
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(snapshots.get(hash)).rejects.toThrow('不支持gzip');
  });
});
