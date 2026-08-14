import { describe, expect, it } from 'vitest';
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
      bindingId: 'role', characterName: '梦梦', runtime: first, status: 'idle',
    });
    const second = { ...first, title: '新版', updatedAt: 3 };
    const entry = await store.commit({
      bindingId: 'role', characterName: '梦梦', runtime: second, status: 'completed',
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
      bindingId: 'role', characterName: '梦梦', runtime: await runtime('bad'), status: 'idle',
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
