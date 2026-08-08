import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileBackedBlobStore, GlobalTavernFileClient, MemoryTavernFileClient } from './file-client';
import { MemoryAgentSettingsStore } from './settings';

describe('Tavern file clients', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('通过酒馆文件接口上传、读取和删除', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: '/user/files/a.bin' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(Uint8Array.of(1, 2, 3), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('SillyTavern', { getRequestHeaders: () => ({ 'x-csrf-token': 'token' }) });
    const client = new GlobalTavernFileClient();
    expect(await client.upload('a.bin', Uint8Array.of(1, 2, 3))).toBe('/user/files/a.bin');
    expect(await client.download('/user/files/a.bin')).toEqual(Uint8Array.of(1, 2, 3));
    await expect(client.delete('/user/files/a.bin')).resolves.toBeUndefined();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ data: 'AQID', name: 'a.bin' });
  });

  it('报告文件接口异常与无效上传响应', async () => {
    vi.stubGlobal('SillyTavern', { getRequestHeaders: () => ({}) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 500 })));
    const client = new GlobalTavernFileClient();
    await expect(client.upload('a', Uint8Array.of())).rejects.toThrow('上传失败');
    await expect(client.download('/bad')).rejects.toThrow('读取失败');
    await expect(client.delete('/bad')).rejects.toThrow('删除失败');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(client.upload('a', Uint8Array.of())).rejects.toThrow('缺少path');
  });

  it('内容Blob去重、计量角色配额并维护文件索引', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new FileBackedBlobStore('role/one', client, settings, 5, () => 12);
    await store.put('hash-a', Uint8Array.of(1, 2, 3));
    await store.put('hash-a', Uint8Array.of(9));
    expect(client.uploadedNames).toHaveLength(1);
    expect(await store.get('hash-a')).toEqual(Uint8Array.of(1, 2, 3));
    expect(await store.keys()).toEqual(['hash-a']);
    await expect(store.put('hash-b', Uint8Array.of(4, 5, 6))).rejects.toThrow('配额');
    await store.delete('hash-a');
    expect(await store.get('hash-a')).toBeUndefined();
    await expect(store.delete('missing')).resolves.toBeUndefined();
  });

  it('快照Blob枚举不会误包含会话文件、租约或其他角色文件', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const current = new FileBackedBlobStore('role-a', client, settings);
    const other = new FileBackedBlobStore('role-b', client, settings);
    await current.put('snapshot-a', Uint8Array.of(1));
    await other.put('snapshot-b', Uint8Array.of(2));
    const value = settings.load();
    value.files['session:x'] = { bindingId: 'role-a', createdAt: 1, name: 'x', size: 1, url: '/x' };
    value.files['lease:x'] = { bindingId: 'role-a', createdAt: 1, name: 'l', size: 1, url: '/l' };
    await settings.save(value);
    expect(await current.keys()).toEqual(['snapshot-a']);
  });
});
