import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import type { RunnerEvent } from '../runner/agent-runner';
import type { WorkspaceFile } from '../workspace/types';
import { MemoryTavernFileClient } from './file-client';
import { SessionRevisionStore } from './session-store';
import { MemoryAgentSettingsStore } from './settings';

const working: WorkspaceFile[] = [
  { content: '角色描述', mediaType: 'text/markdown', path: '/character/description.md', readonly: false, resourceId: 'r1' },
];
const context: ModelMessage[] = [{ content: '请求', role: 'user' }];
const events: RunnerEvent[] = [
  { at: 1, status: 'running', type: 'status' },
  { at: 2, status: 'completed', type: 'status' },
  { at: 3, message: 'guide', type: 'guidance-injected' },
];

describe('session revision store', () => {
  it('分段保存事件、最后上传Manifest并完整载入', async () => {
    let now = 100;
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings, () => now++, 2);
    const entry = await store.commit({
      bindingId: 'role',
      characterName: '梦梦',
      context,
      events,
      sessionId: 'session',
      snapshotHashes: ['a', 'a', 'b'],
      status: 'completed',
      title: '第一次创作',
      workingCopy: working,
    });
    expect(entry.revision).toBe(1);
    expect(client.uploadedNames.at(-1)).toContain('manifest');
    const loaded = await store.load('session');
    expect(loaded.context).toEqual(context);
    expect(loaded.events).toEqual(events);
    expect(loaded.workingCopy).toEqual(working);
    expect(loaded.manifest.eventSegmentUrls).toHaveLength(2);
    expect(loaded.manifest.snapshotHashes).toEqual(['a', 'b']);
  });

  it('最新Revision损坏时恢复上一完整Revision并保留创建时间', async () => {
    let now = 1_000;
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings, () => now++);
    const first = await store.commit({
      bindingId: 'role',
      characterName: '梦梦',
      context,
      events: events.slice(0, 1),
      sessionId: 's',
      snapshotHashes: [],
      status: 'running',
      title: '会话',
      workingCopy: working,
    });
    const second = await store.commit({
      bindingId: 'role',
      characterName: '梦梦',
      context: [...context, { content: '回复', role: 'assistant' }],
      events,
      sessionId: 's',
      snapshotHashes: [],
      status: 'completed',
      title: '会话',
      workingCopy: working,
    });
    expect(second.createdAt).toBe(first.createdAt);
    client.corrupt(second.manifestUrl);
    const recovered = await store.load('s');
    expect(recovered.manifest.revision).toBe(1);
    expect(recovered.events).toEqual(events.slice(0, 1));
  });

  it('拒绝不存在的会话和首个损坏Manifest', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(client, settings);
    await expect(store.load('missing')).rejects.toThrow('会话不存在');
    const entry = await store.commit({
      bindingId: 'role',
      characterName: '梦梦',
      context,
      events: [],
      sessionId: 'bad',
      snapshotHashes: [],
      status: 'idle',
      title: 'bad',
      workingCopy: working,
    });
    client.corrupt(entry.manifestUrl);
    await expect(store.load('bad')).rejects.toThrow('missing');
  });
});
