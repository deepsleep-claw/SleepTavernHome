import { afterEach, describe, expect, it, vi } from 'vitest';
import { compilePreset, DEFAULT_PRESET } from '../preset/compiler';
import { defaultPresetValues } from '../session/prompt';
import type { PersistedSessionRuntime } from '../session/types';
import { defaultBuiltinAgentConfiguration } from './builtin-agent';
import { MemoryBrowserRecordStore } from './browser-record-store';
import { BufferedSessionRecordStore } from './buffered-session-record-store';
import { CharacterMetadataStore } from './character-store';
import { MemoryTavernFileClient } from './file-client';
import { LocalSessionStore, type SessionBackupStatus } from './local-session-store';
import { MemorySessionDraftCache } from './session-draft-cache';
import { SessionRevisionStore } from './session-store';
import { MemoryAgentSettingsStore } from './settings';

const stores: LocalSessionStore[] = [];
afterEach(() => {
  stores.splice(0).forEach(store => store.dispose());
});

async function fixture() {
  const settings = new MemoryAgentSettingsStore();
  const files = new MemoryTavernFileClient();
  const local = new MemoryBrowserRecordStore();
  const remote = new SessionRevisionStore(files, settings, Date.now, new MemorySessionDraftCache(), true);
  const characters = new CharacterMetadataStore(files, settings);
  const statuses: SessionBackupStatus[] = [];
  const store = new LocalSessionStore(local, remote, characters, status => statuses.push(status));
  stores.push(store);
  const agentConfiguration = defaultBuiltinAgentConfiguration();
  const compiledPreset = await compilePreset(
    DEFAULT_PRESET,
    defaultPresetValues([], agentConfiguration.toolIds, 'character'),
  );
  const runtime: PersistedSessionRuntime = {
    agentConfiguration,
    compiledPreset,
    createdAt: 1,
    updatedAt: 2,
    events: [],
    ui: [],
    headerMessageCount: compiledPreset.messages.length,
    modelMessages: compiledPreset.messages,
    mode: 'normal',
    mountedWorldbooks: [],
    preset: DEFAULT_PRESET,
    scope: 'character',
    sessionId: 'one',
    skills: [],
    status: 'completed',
    title: '本地会话',
    version: 3,
  };
  const input = { bindingId: 'card', characterName: '测试', runtime, status: 'completed' as const };
  return { store, settings, files, local, remote, characters, input, statuses };
}

describe('local session persistence', () => {
  it('后端已收到相同内容时，重试补齐本机备份确认', async () => {
    const { store, remote, input, statuses } = await fixture();
    await store.commit(input);
    await remote.commit(input);
    await store.backup();
    expect(statuses.at(-1)).toMatchObject({ pending: 0, syncing: false });
    expect(statuses.at(-1)?.error).toBeUndefined();
    expect((await remote.load('card', 'one')).entry.revision).toBe(1);
  });

  it('补齐旧备份确认期间的新内容仍保持待备份', async () => {
    const { store, remote, input, statuses } = await fixture();
    await store.commit(input);
    await remote.commit(input);
    const load = remote.load.bind(remote);
    vi.spyOn(remote, 'load').mockImplementationOnce(async (...args) => {
      const result = await load(...args);
      await store.commit({ ...input, runtime: { ...input.runtime, title: '新内容', updatedAt: 3 } });
      return result;
    });
    await store.backup();
    expect(statuses.at(-1)).toMatchObject({ pending: 1, conflicts: [] });
    expect((await store.load('card', 'one')).runtime.title).toBe('新内容');
    await store.backup();
    expect((await remote.load('card', 'one')).runtime.title).toBe('新内容');
    expect(statuses.at(-1)?.pending).toBe(0);
  });

  it('页面离开后恢复尚未落盘的备份确认，不误报其他页面更新', async () => {
    vi.useFakeTimers();
    const buffers: BufferedSessionRecordStore[] = [];
    try {
      const { local, remote, characters, input } = await fixture();
      const data = new Map<string, string>();
      const recovery = {
        key: async () => 'page',
        storage: {
          getItem: (key: string) => data.get(key) ?? null,
          setItem: (key: string, value: string) => data.set(key, value),
          removeItem: (key: string) => data.delete(key),
        },
      };
      const firstBuffer = new BufferedSessionRecordStore(local, recovery);
      buffers.push(firstBuffer);
      const first = new LocalSessionStore(firstBuffer, remote, characters);
      stores.push(first);
      await first.commit(input);
      await firstBuffer.flush();
      await first.backup();
      const writes = vi.spyOn(local, 'update').mockRejectedValue(new Error('page suspended'));
      first.dispose();
      firstBuffer.dispose();
      await firstBuffer.flush().catch(() => {});
      writes.mockRestore();
      const nextBuffer = new BufferedSessionRecordStore(local, recovery);
      buffers.push(nextBuffer);
      const statuses: SessionBackupStatus[] = [];
      const next = new LocalSessionStore(nextBuffer, remote, characters, status => statuses.push(status));
      stores.push(next);
      const restored = await nextBuffer.get<{ dirty: boolean; remoteRevision: number }>('session:card:one');
      expect(restored).toMatchObject({ dirty: false, remoteRevision: 1 });
      await next.backup();
      expect(statuses.at(-1)).toMatchObject({ pending: 0, syncing: false });
      expect(statuses.at(-1)?.error).toBeUndefined();
    } finally {
      for (const buffer of buffers) {
        await buffer.flush().catch(() => {});
        buffer.dispose();
      }
      vi.useRealTimers();
    }
  });

  it('临时索引读取失败不会被永久缓存为空列表', async () => {
    const { store, characters, input } = await fixture();
    const load = vi.spyOn(characters, 'load').mockRejectedValueOnce(new Error('offline'));
    expect((await store.metadata(input.bindingId)).sessions).toEqual({});
    await store.metadata(input.bindingId);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('后端备份等待最后一次更新后的三秒', async () => {
    vi.useFakeTimers();
    try {
      const { store, input } = await fixture();
      const backup = vi.spyOn(store, 'backup').mockResolvedValue();
      await store.commit(input);
      await vi.advanceTimersByTimeAsync(2500);
      await store.commit({ ...input, runtime: { ...input.runtime, updatedAt: 3 } });
      await vi.advanceTimersByTimeAsync(2999);
      expect(backup).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(backup).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it('本地提交和索引读取不需要后端上传', async () => {
    const { store, files, input, statuses } = await fixture();
    await store.commit(input);
    expect(files.urls()).toEqual([]);
    expect((await store.load('card', 'one')).runtime.title).toBe('本地会话');
    expect((await store.metadata('card')).sessions.one.title).toBe('本地会话');
    expect(statuses.at(-1)?.pending).toBe(1);
  });

  it('备份失败保留本地内容，重试后可在另一个浏览器恢复', async () => {
    const { store, files, input, statuses, characters, remote } = await fixture();
    await store.commit(input);
    const upload = vi.spyOn(files, 'upload').mockRejectedValue(new Error('offline'));
    await store.backup();
    expect(statuses.at(-1)).toMatchObject({ pending: 1, syncing: false, error: 'offline' });
    expect((await store.load('card', 'one')).runtime.title).toBe('本地会话');
    upload.mockRestore();
    await store.backup();
    expect(statuses.at(-1)?.pending).toBe(0);
    const another = new LocalSessionStore(new MemoryBrowserRecordStore(), remote, characters);
    stores.push(another);
    expect((await another.load('card', 'one')).runtime.title).toBe('本地会话');
  });

  it('上传期间的新提交仍保持待备份状态', async () => {
    const { store, remote, input, statuses } = await fixture();
    await store.commit(input);
    const original = remote.commit.bind(remote);
    vi.spyOn(remote, 'commit').mockImplementationOnce(async value => {
      await store.commit({ ...input, runtime: { ...input.runtime, title: '更新后的会话', updatedAt: 3 } });
      return original(value);
    });
    await store.backup();
    expect(statuses.at(-1)?.pending).toBe(1);
    expect((await store.load('card', 'one')).runtime.title).toBe('更新后的会话');
    await store.backup();
    expect(statuses.at(-1)?.pending).toBe(0);
    expect((await remote.load('card', 'one')).runtime.title).toBe('更新后的会话');
  });

  it('本地删除不会被备份索引重新列出', async () => {
    const { store, input, characters } = await fixture();
    await store.commit(input);
    await store.backup();
    await store.removeSession('card', 'one');
    expect((await store.metadata('card')).sessions.one).toBeUndefined();
    await expect(store.load('card', 'one')).rejects.toThrow('已删除');
    await store.backup();
    expect((await characters.load('card')).sessions.one).toBeUndefined();
  });

  it('其他浏览器推进版本时保留双方内容并提供冲突详情', async () => {
    const { store, input, remote, statuses } = await fixture();
    await store.commit(input);
    await store.backup();
    await remote.commit({ ...input, runtime: { ...input.runtime, title: '远端版本' } });
    await store.commit({ ...input, runtime: { ...input.runtime, title: '本机版本' } });
    await store.backup();
    expect(statuses.at(-1)?.conflicts).toMatchObject([{ bindingId: 'card', sessionId: 'one', remoteRevision: 2 }]);
    expect((await store.load('card', 'one')).runtime.title).toBe('本机版本');
    expect((await remote.load('card', 'one')).runtime.title).toBe('远端版本');
  });

  it.each(['local', 'remote'] as const)('选择 %s 版本前保留双方恢复点，之后正常备份', async resolution => {
    const { store, input, remote, statuses } = await fixture();
    await store.commit(input);
    await store.backup();
    await remote.commit({ ...input, runtime: { ...input.runtime, title: '远端版本' } });
    await store.commit({ ...input, runtime: { ...input.runtime, title: '本机版本' } });
    await store.backup();
    const conflict = statuses.at(-1)!.conflicts![0];
    await store.resolveConflict(conflict, resolution);
    const title = resolution === 'local' ? '本机版本' : '远端版本';
    expect((await store.load('card', 'one')).runtime.title).toBe(title);
    expect((await remote.load('card', 'one')).runtime.title).toBe(title);
    expect(statuses.at(-1)).toMatchObject({ pending: 0, conflicts: [] });
    const exported = JSON.parse(await store.exportSessions());
    expect(
      exported.recovery.map(
        (row: { value: { input: { runtime: { title: string } } } }) => row.value.input.runtime.title,
      ),
    ).toEqual(expect.arrayContaining(['本机版本', '远端版本']));
    await store.commit({ ...input, runtime: { ...input.runtime, title: '继续创作', updatedAt: 4 } });
    await store.backup();
    expect((await remote.load('card', 'one')).runtime.title).toBe('继续创作');
    expect(statuses.at(-1)).toMatchObject({ pending: 0, conflicts: [] });
  });

  it('选择期间后端再次更新时拒绝旧选择并保留双方内容', async () => {
    const { store, input, remote, statuses } = await fixture();
    await store.commit(input);
    await store.backup();
    await remote.commit({ ...input, runtime: { ...input.runtime, title: '远端版本' } });
    await store.commit({ ...input, runtime: { ...input.runtime, title: '本机版本' } });
    await store.backup();
    const conflict = statuses.at(-1)!.conflicts![0];
    await remote.commit({ ...input, runtime: { ...input.runtime, title: '远端新版本' } });
    await expect(store.resolveConflict(conflict, 'local')).rejects.toThrow('又有更新');
    expect((await store.load('card', 'one')).runtime.title).toBe('本机版本');
    expect((await remote.load('card', 'one')).runtime.title).toBe('远端新版本');
    expect(statuses.at(-1)?.conflicts?.[0].remoteRevision).toBe(3);
  });

  it('无法保存恢复点时不替换任一版本', async () => {
    const { store, input, remote, statuses, local } = await fixture();
    await store.commit(input);
    await store.backup();
    await remote.commit({ ...input, runtime: { ...input.runtime, title: '远端版本' } });
    await store.commit({ ...input, runtime: { ...input.runtime, title: '本机版本' } });
    await store.backup();
    const conflict = statuses.at(-1)!.conflicts![0];
    const put = local.put.bind(local);
    vi.spyOn(local, 'put').mockImplementation(async (key, value) => {
      if (key.startsWith('session-recovery:')) throw new Error('quota');
      await put(key, value);
    });
    await expect(store.resolveConflict(conflict, 'remote')).rejects.toThrow('quota');
    expect((await store.load('card', 'one')).runtime.title).toBe('本机版本');
    expect((await remote.load('card', 'one')).runtime.title).toBe('远端版本');
  });

  it('真实冲突暂停自动重试，其他会话仍能备份', async () => {
    vi.useFakeTimers();
    try {
      const { store, input, remote, statuses } = await fixture();
      await store.commit(input);
      await store.backup();
      await remote.commit({ ...input, runtime: { ...input.runtime, title: '远端版本' } });
      await store.commit({ ...input, runtime: { ...input.runtime, title: '本机版本' } });
      await store.commit({ ...input, runtime: { ...input.runtime, sessionId: 'two' } });
      await store.backup();
      expect((await remote.load('card', 'two')).runtime.sessionId).toBe('two');
      expect(statuses.at(-1)).toMatchObject({ pending: 1, conflicts: [{ sessionId: 'one' }] });
      const backup = vi.spyOn(store, 'backup');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(backup).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('处理冲突只提交所选会话，其他待备份会话留给后续同步', async () => {
    const { store, input, remote, statuses } = await fixture();
    await store.commit(input);
    await store.backup();
    await remote.commit({ ...input, runtime: { ...input.runtime, title: '远端版本' } });
    await store.commit({ ...input, runtime: { ...input.runtime, title: '本机版本' } });
    await store.backup();
    const conflict = statuses.at(-1)!.conflicts![0];
    await store.commit({ ...input, runtime: { ...input.runtime, sessionId: 'two' } });
    const commit = vi.spyOn(remote, 'commit');
    await store.resolveConflict(conflict, 'local');
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0].runtime.sessionId).toBe('one');
    expect(statuses.at(-1)).toMatchObject({ pending: 1, conflicts: [] });
  });

  it('本地写入失败会明确拒绝保存', async () => {
    const { store, input, local, files } = await fixture();
    vi.spyOn(local, 'update').mockRejectedValue(new Error('quota'));
    await expect(store.commit(input)).rejects.toThrow('quota');
    expect(files.urls()).toEqual([]);
  });

  it('恢复后端记录前保留本机恢复点', async () => {
    const { store, input } = await fixture();
    await store.commit(input);
    await store.backup();
    await store.commit({ ...input, runtime: { ...input.runtime, title: '本机未备份内容' } });
    await store.restoreBackup('card', 'one');
    expect((await store.load('card', 'one')).runtime.title).toBe('本地会话');
    expect(await store.exportSessions()).toContain('本机未备份内容');
  });
});
