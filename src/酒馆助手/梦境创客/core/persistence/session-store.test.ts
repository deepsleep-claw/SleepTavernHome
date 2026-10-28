import { describe, expect, it, vi } from 'vitest';
import { compilePreset, DEFAULT_PRESET } from '../preset/compiler';
import { defaultPresetValues } from '../session/prompt';
import type { PersistedSessionRuntime } from '../session/types';
import { MemoryTavernFileClient } from './file-client';
import { SessionRevisionStore } from './session-store';
import { MemorySessionDraftCache } from './session-draft-cache';
import { MemoryAgentSettingsStore } from './settings';
import { defaultBuiltinAgentConfiguration } from './builtin-agent';

async function runtime(sessionId = 'session'): Promise<PersistedSessionRuntime> {
  const agentConfiguration = defaultBuiltinAgentConfiguration();
  const compiledPreset = await compilePreset(
    DEFAULT_PRESET,
    defaultPresetValues([], agentConfiguration.toolIds, 'character'),
  );
  return {
    agentConfiguration,
    compiledPreset,
    createdAt: 1,
    events: [{ at: 2, status: 'completed', type: 'status' }],
    headerMessageCount: compiledPreset.messages.length,
    mode: 'normal',
    modelMessages: compiledPreset.messages,
    mountedWorldbooks: [],
    preset: DEFAULT_PRESET,
    sessionId,
    skills: [],
    scope: 'character',
    status: 'completed',
    title: '第一次创作',
    ui: [],
    updatedAt: 2,
    version: 3,
  };
}

describe('single-file session store', () => {
  it('上传期间另一个写入者发布新版本时，保留其版本并拒绝过时索引', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings, Date.now, new MemorySessionDraftCache(), true);
    const other = new SessionRevisionStore(client, settings, Date.now, new MemorySessionDraftCache(), true);
    const input = { bindingId: 'role', characterName: '测试', runtime: await runtime(), status: 'completed' as const };
    await store.commit(input);
    const upload = client.upload.bind(client);
    let changed = false;
    vi.spyOn(client, 'upload').mockImplementation(async (name, bytes) => {
      const result = await upload(name, bytes);
      if (!changed && name.includes('--Session--')) {
        changed = true;
        await other.commit({ ...input, runtime: { ...input.runtime, title: '其他页面的版本' } });
      }
      return result;
    });
    await expect(
      store.commit({ ...input, runtime: { ...input.runtime, title: '上传中的旧基础版本' } }),
    ).rejects.toThrow('版本已更新');
    expect((await store.load('role', 'session')).runtime.title).toBe('其他页面的版本');
  });
  it('分块备份复用未变化的历史，缺块时拒绝不完整恢复', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings, Date.now, new MemorySessionDraftCache(), true);
    const state = await runtime();
    const input = { bindingId: 'role', characterName: '测试', runtime: state, status: 'completed' as const };
    const first = await store.commit(input);
    const uploaded = client.uploadedNames.length;
    const second = await store.commit({ ...input, runtime: { ...state, title: '只有标题改变' } });
    expect(client.uploadedNames.slice(uploaded).filter(name => name.includes('--Part--'))).toHaveLength(1);
    expect((await new SessionRevisionStore(client, settings).load('role', 'session')).runtime.title).toBe(
      '只有标题改变',
    );
    const manifest = JSON.parse(new TextDecoder().decode(await client.download(second.url)));
    const reference = Object.values(manifest.parts)[0] as { url: string };
    client.corrupt(reference.url);
    await expect(new SessionRevisionStore(client, settings).load('role', 'session')).rejects.toThrow();
    expect(client.urls()).toContain(first.url);
  });
  it('分块上传中断不发布索引，使用相同提交编号重试不会重传已确认块', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings, Date.now, new MemorySessionDraftCache(), true);
    const state = await runtime();
    const input = { bindingId: 'role', characterName: '测试', runtime: state, status: 'completed' as const };
    const first = await store.commit(input);
    const upload = client.upload.bind(client);
    let parts = 0;
    vi.spyOn(client, 'upload').mockImplementation(async (name, bytes) => {
      if (name.includes('--Part--') && ++parts === 2) throw new Error('interrupted');
      return upload(name, bytes);
    });
    const next = { ...input, commitId: 'retry-operation', runtime: { ...state, title: '新版', updatedAt: 9 } };
    await expect(store.commit(next)).rejects.toThrow('interrupted');
    expect(settings.load().characterStores.role).toBeDefined();
    expect((await store.load('role', 'session')).entry.url).toBe(first.url);
    const confirmed = client.uploadedNames.filter(name => name.includes('--Part--retry-operation'));
    expect(confirmed).toHaveLength(1);
    await store.commit(next);
    await store.commit(next);
    expect(client.uploadedNames.filter(name => name === confirmed[0])).toHaveLength(1);
    expect((await store.load('role', 'session')).entry.revision).toBe(2);
  });
  it('正文写入成功但索引更新失败后仍能加载较新且校验完整的记录', async () => {
    class PartialClient extends MemoryTavernFileClient {
      failMetadata = false;
      override async upload(name: string, bytes: Uint8Array) {
        if (this.failMetadata && name.includes('--Meta--')) throw new Error('metadata offline');
        return super.upload(name, bytes);
      }
    }
    const client = new PartialClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings);
    const state = await runtime();
    await store.commit({ bindingId: 'role', characterName: '梦梦', runtime: state, status: 'completed' });
    client.failMetadata = true;
    await expect(
      store.commit({
        bindingId: 'role',
        characterName: '梦梦',
        runtime: { ...state, title: '新记录' },
        status: 'completed',
      }),
    ).rejects.toThrow('metadata offline');
    const loaded = await new SessionRevisionStore(client, settings).load('role', state.sessionId);
    expect(loaded.runtime.title).toBe('新记录');
    expect(loaded.entry.revision).toBe(2);
    expect(loaded.runtime.warnings).toContain('会话索引落后，已读取通过校验的较新记录。');
  });
  it('每个角色一个元信息文件、每个会话一个压缩文件', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings, () => 100);
    const entry = await store.commit({
      bindingId: 'role',
      characterName: '梦梦',
      runtime: await runtime(),
      status: 'completed',
    });
    expect(entry.revision).toBe(1);
    expect(client.urls()).toHaveLength(2);
    expect(client.uploadedNames).toEqual([
      'DreamCreator--Session--role--session.json',
      'DreamCreator--Meta--role.json',
    ]);
    const loaded = await store.load('role', 'session');
    expect(loaded.runtime.title).toBe('第一次创作');
  });

  it('后续保存原子覆盖稳定文件名，不增加物理文件', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings, () => 200);
    const first = await runtime('same');
    await store.commit({
      bindingId: 'role',
      characterName: '梦梦',
      runtime: first,
      status: 'idle',
    });
    const second = { ...first, title: '新版', updatedAt: 3 };
    const entry = await store.commit({
      bindingId: 'role',
      characterName: '梦梦',
      runtime: second,
      status: 'completed',
    });
    expect(entry.revision).toBe(2);
    expect(client.urls()).toHaveLength(2);
    expect(client.uploadedNames.filter(name => name.includes('--Session--'))).toEqual([
      'DreamCreator--Session--role--same.json',
      'DreamCreator--Session--role--same.json',
    ]);
    expect((await store.load('role', 'same')).runtime.title).toBe('新版');
  });

  it('拒绝不存在或校验损坏的会话', async () => {
    const client = new MemoryTavernFileClient();
    const store = new SessionRevisionStore(client, new MemoryAgentSettingsStore());
    await expect(store.load('role', 'missing')).rejects.toThrow('会话不存在');
    const entry = await store.commit({
      bindingId: 'role',
      characterName: '梦梦',
      runtime: await runtime('bad'),
      status: 'idle',
    });
    client.corrupt(entry.url);
    await expect(store.load('role', 'bad')).rejects.toThrow('missing');
  });

  it('上传三次仍失败时保留浏览器草稿，重连刷新后自动补写', async () => {
    class ReconnectingClient extends MemoryTavernFileClient {
      offline = true;
      attempts = 0;
      override async upload(name: string, bytes: Uint8Array): Promise<string> {
        if (this.offline && name.includes('--Session--')) {
          this.attempts += 1;
          throw new Error('offline');
        }
        return super.upload(name, bytes);
      }
    }
    const client = new ReconnectingClient();
    const settings = new MemoryAgentSettingsStore();
    const cache = new MemorySessionDraftCache();
    const store = new SessionRevisionStore(client, settings, () => 300, cache);
    await expect(
      store.commit({ bindingId: 'role', characterName: '梦梦', runtime: await runtime('cached'), status: 'running' }),
    ).rejects.toThrow('offline');
    expect(client.attempts).toBe(3);
    expect(await cache.list('role')).toHaveLength(1);

    client.offline = false;
    expect(await store.flushPending('role')).toEqual({ failed: 0, recovered: 1 });
    expect(await cache.list('role')).toEqual([]);
    expect((await store.load('role', 'cached')).runtime.title).toBe('第一次创作');
  });
});
