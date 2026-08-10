import { describe, expect, it } from 'vitest';
import { compilePreset, DEFAULT_PRESET } from '../preset/compiler';
import { defaultPresetValues } from '../session/prompt';
import type { PersistedSessionRuntime } from '../session/types';
import type { WorkspaceFile } from '../workspace/types';
import { MemoryTavernFileClient } from './file-client';
import { SessionRevisionStore } from './session-store';
import { MemoryAgentSettingsStore } from './settings';

const working: WorkspaceFile[] = [
  { content: '角色描述', mediaType: 'text/markdown', path: '/character/description.md', readonly: false, resourceId: 'r1' },
];

async function runtime(sessionId = 'session'): Promise<PersistedSessionRuntime> {
  const compiledPreset = await compilePreset(DEFAULT_PRESET, defaultPresetValues([]));
  return {
    compiledPreset,
    createdAt: 1,
    events: [{ at: 2, status: 'completed', type: 'status' }],
    headerMessageCount: compiledPreset.messages.length,
    history: { checkpoints: [], position: -1 },
    mode: 'normal',
    modelMessages: compiledPreset.messages,
    preset: DEFAULT_PRESET,
    sessionId,
    skills: [],
    status: 'completed',
    title: '第一次创作',
    ui: [],
    updatedAt: 2,
    version: 1,
  };
}

describe('single-file session store', () => {
  it('每个角色一个元信息文件、每个会话一个压缩文件并完整载入快照', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings, () => 100);
    const entry = await store.commit({
      bindingId: 'role',
      characterName: '梦梦',
      runtime: await runtime(),
      snapshotBlobs: { hash: Uint8Array.of(1, 2, 3) },
      status: 'completed',
      workingCopy: working,
    });
    expect(entry.revision).toBe(1);
    expect(client.urls()).toHaveLength(2);
    expect(client.uploadedNames).toEqual([
      'dream-card-agent--role--session--session.json',
      'dream-card-agent--role--meta.json',
    ]);
    const loaded = await store.load('role', 'session');
    expect(loaded.runtime.title).toBe('第一次创作');
    expect(loaded.workingCopy).toEqual(working);
    expect(loaded.snapshotBlobs.hash).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('后续保存原子覆盖稳定文件名，不增加物理文件', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings, () => 200);
    const first = await runtime('same');
    await store.commit({
      bindingId: 'role', characterName: '梦梦', runtime: first, snapshotBlobs: {}, status: 'idle', workingCopy: working,
    });
    const second = { ...first, title: '新版', updatedAt: 3 };
    const entry = await store.commit({
      bindingId: 'role', characterName: '梦梦', runtime: second, snapshotBlobs: {}, status: 'completed', workingCopy: working,
    });
    expect(entry.revision).toBe(2);
    expect(client.urls()).toHaveLength(2);
    expect(client.uploadedNames.filter(name => name.includes('--session--'))).toEqual([
      'dream-card-agent--role--session--same.json',
      'dream-card-agent--role--session--same.json',
    ]);
    expect((await store.load('role', 'same')).runtime.title).toBe('新版');
  });

  it('拒绝不存在或校验损坏的会话', async () => {
    const client = new MemoryTavernFileClient();
    const store = new SessionRevisionStore(client, new MemoryAgentSettingsStore());
    await expect(store.load('role', 'missing')).rejects.toThrow('会话不存在');
    const entry = await store.commit({
      bindingId: 'role', characterName: '梦梦', runtime: await runtime('bad'), snapshotBlobs: {}, status: 'idle', workingCopy: working,
    });
    client.corrupt(entry.url);
    await expect(store.load('role', 'bad')).rejects.toThrow('missing');
  });
});
