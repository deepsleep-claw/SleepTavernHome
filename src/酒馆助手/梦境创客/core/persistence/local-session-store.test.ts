import { afterEach, describe, expect, it, vi } from 'vitest';
import { compilePreset, DEFAULT_PRESET } from '../preset/compiler';
import { defaultPresetValues } from '../session/prompt';
import type { PersistedSessionRuntime } from '../session/types';
import { defaultBuiltinAgentConfiguration } from './builtin-agent';
import { MemoryBrowserRecordStore } from './browser-record-store';
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

  it('其他浏览器推进版本时保留双方内容并报告冲突', async () => {
    const { store, input, remote, statuses } = await fixture();
    await store.commit(input);
    await store.backup();
    await remote.commit({ ...input, runtime: { ...input.runtime, title: '远端版本' } });
    await store.commit({ ...input, runtime: { ...input.runtime, title: '本机版本' } });
    await store.backup();
    expect(statuses.at(-1)?.error).toContain('已被其他页面更新');
    expect((await store.load('card', 'one')).runtime.title).toBe('本机版本');
    expect((await remote.load('card', 'one')).runtime.title).toBe('远端版本');
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
