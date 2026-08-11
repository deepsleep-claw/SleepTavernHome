import { describe, expect, it } from 'vitest';
import { MemoryTavernFileClient } from './file-client';
import { MemoryAgentSettingsStore } from './settings';
import { DreamCreatorWorkspaceFileStore } from './workspace-file-store';

describe('DreamCreatorWorkspaceFileStore', () => {
  it('按角色投影 /files，共享相同内容的物理文件并给重名上传加后缀', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new DreamCreatorWorkspaceFileStore(client, settings, () => 100);
    const first = await store.putPersistent({
      bindingId: 'role',
      bytes: Uint8Array.of(1, 2, 3),
      logicalPath: '资料/a.bin',
      mediaType: 'application/octet-stream',
      referencedSessionId: 's1',
    });
    const alias = await store.putPersistent({
      bindingId: 'role',
      bytes: Uint8Array.of(1, 2, 3),
      logicalPath: '资料/copy.bin',
      mediaType: 'application/octet-stream',
      referencedSessionId: 's2',
    });
    const renamed = await store.putPersistent({
      bindingId: 'role',
      bytes: Uint8Array.of(4),
      logicalPath: '资料/a.bin',
      mediaType: 'application/octet-stream',
      referencedSessionId: 's1',
    });

    expect(first.url).toBe(alias.url);
    expect(client.uploadedNames).toHaveLength(2);
    expect(client.uploadedNames.every(name => name.startsWith('DreamCreator--File--role--'))).toBe(true);
    expect(renamed.logicalPath).toBe('资料/a (2).bin');
    expect((await store.project('role', 's1')).map(file => file.path).sort()).toEqual([
      '/files/资料/a (2).bin',
      '/files/资料/a.bin',
      '/files/资料/copy.bin',
    ]);

    await store.removeImmediately(first.fileId);
    expect(client.urls()).toContain(alias.url);
    expect(await store.read(alias.fileId)).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('把 Temp 隔离到会话，释放会话时删除 Temp 并把无引用附件标成孤立版本', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new DreamCreatorWorkspaceFileStore(client, settings, () => 200);
    const attachment = await store.putPersistent({
      bindingId: 'role',
      bytes: Uint8Array.of(1),
      logicalPath: 'a.txt',
      mediaType: 'text/plain',
      referencedSessionId: 's1',
    });
    const temp = await store.putTemp({
      bindingId: 'role',
      bytes: Uint8Array.of(2),
      logicalPath: '_attachments/a.webp',
      mediaType: 'image/webp',
      sessionId: 's1',
      sourceFileId: attachment.fileId,
    });

    expect((await store.project('role', 's1')).some(file => file.path.startsWith('/temp/'))).toBe(true);
    expect((await store.project('role', 's2')).some(file => file.path.startsWith('/temp/'))).toBe(false);
    await store.releaseSession('role', 's1');
    expect(store.getReference(temp.fileId)).toBeUndefined();
    expect(store.getReference(attachment.fileId)?.orphanedAt).toBeUndefined();
    await store.releaseSession('role', 's2');
    expect(store.getReference(attachment.fileId)?.orphanedAt).toBe(200);
    expect(await store.clearCache('role')).toBe(1);
    expect(store.listReferences('role')).toEqual([]);
  });

  it('Agent 对 /files 的文本修改产生新版本，并可恢复历史快照', async () => {
    let time = 10;
    const store = new DreamCreatorWorkspaceFileStore(
      new MemoryTavernFileClient(),
      new MemoryAgentSettingsStore(),
      () => time++,
    );
    await store.putPersistent({
      bindingId: 'role',
      bytes: new TextEncoder().encode('old'),
      logicalPath: 'note.md',
      mediaType: 'text/markdown',
      referencedSessionId: 's1',
    });
    const base = await store.project('role', 's1');
    const working = base.map(file => (file.path === '/files/note.md' ? { ...file, content: 'new' } : file));
    const committed = await store.applyWorkspace('role', 's1', base, working, { '/files/note.md': 'agent' });
    expect(committed.find(file => file.path === '/files/note.md')?.content).toBe('new');

    const restored = await store.restorePersistentSnapshot('role', 's1', base);
    expect(restored.find(file => file.path === '/files/note.md')?.content).toBe('old');
  });

  it('多文件提交中途失败时恢复原索引并删除已经上传的新版本', async () => {
    class FailingClient extends MemoryTavernFileClient {
      failAt = Number.POSITIVE_INFINITY;
      override async upload(name: string, bytes: Uint8Array): Promise<string> {
        if (this.uploadedNames.length + 1 === this.failAt) throw new Error('simulated upload failure');
        return super.upload(name, bytes);
      }
    }
    const client = new FailingClient();
    const store = new DreamCreatorWorkspaceFileStore(client, new MemoryAgentSettingsStore());
    for (const path of ['a.md', 'b.md']) {
      await store.putPersistent({
        bindingId: 'role',
        bytes: new TextEncoder().encode(`old-${path}`),
        logicalPath: path,
        mediaType: 'text/markdown',
        referencedSessionId: 's1',
      });
    }
    const base = await store.project('role', 's1');
    const working = base.map(file => ({ ...file, content: `new-${file.path}` }));
    client.failAt = 4;
    await expect(
      store.applyWorkspace('role', 's1', base, working, {
        '/files/a.md': 'agent',
        '/files/b.md': 'agent',
      }),
    ).rejects.toThrow('simulated upload failure');
    expect((await store.project('role', 's1')).map(file => file.content).sort()).toEqual(['old-a.md', 'old-b.md']);
    expect(client.urls()).toHaveLength(2);
  });

  it('拒绝越界路径和超过20MB的单文件', async () => {
    const store = new DreamCreatorWorkspaceFileStore(
      new MemoryTavernFileClient(),
      new MemoryAgentSettingsStore(),
    );
    await expect(
      store.putPersistent({
        bindingId: 'role',
        bytes: Uint8Array.of(1),
        logicalPath: '../outside.txt',
        mediaType: 'text/plain',
      }),
    ).rejects.toThrow();
    await expect(
      store.putPersistent({
        bindingId: 'role',
        bytes: new Uint8Array(20 * 1024 * 1024 + 1),
        logicalPath: 'huge.bin',
        mediaType: 'application/octet-stream',
      }),
    ).rejects.toThrow('20MB');
  });
});
