import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryTavernFileClient } from './file-client';
import { LeaseCoordinator, MemoryLeaseRecordStore, TavernLeaseRecordStore } from './lease';
import { MemoryAgentSettingsStore, type DreamCardAgentSettings } from './settings';

describe('session lease', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('阻止未过期竞争者，允许过期接管和手动接管', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    let now = 0;
    const store = new MemoryLeaseRecordStore();
    const first = new LeaseCoordinator({ holderId: 'a', now: () => now, sessionId: 's', store });
    const second = new LeaseCoordinator({ holderId: 'b', now: () => now, sessionId: 's', store });
    expect(await first.acquire()).toBe(true);
    expect(await second.acquire()).toBe(false);
    now = 30_001;
    expect(await second.isStale()).toBe(true);
    expect(await second.acquire()).toBe(true);
    expect(first.isOwner()).toBe(true);
    expect(await first.refresh()).toBe(false);
    expect(first.isOwner()).toBe(false);
    expect(await first.acquire(true)).toBe(true);
    first.close();
    second.close();
  });

  it('每10秒刷新一次并在关闭后停止', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.useFakeTimers();
    let now = 0;
    const store = new MemoryLeaseRecordStore();
    const lease = new LeaseCoordinator({ holderId: 'a', now: () => now, sessionId: 's', store });
    await lease.acquire();
    now = 10_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await store.read('s'))?.updatedAt).toBe(10_000);
    lease.close();
    now = 20_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await store.read('s'))?.updatedAt).toBe(10_000);
  });

  it('通过文件与设置索引保存跨浏览器租约', async () => {
    const initial: DreamCardAgentSettings = {
      activeProfileId: undefined,
      developerMode: false,
      files: {},
      floatingButton: true,
      onboardingDone: false,
      profiles: [],
      sessions: {
        s: {
          bindingId: 'role',
          characterName: '梦梦',
          createdAt: 1,
          manifestHash: 'hash',
          manifestUrl: '/manifest',
          revision: 1,
          sessionId: 's',
          title: '会话',
          updatedAt: 1,
        },
      },
      version: 1,
    };
    const settings = new MemoryAgentSettingsStore(initial);
    const client = new MemoryTavernFileClient();
    const store = new TavernLeaseRecordStore(client, settings, 'role');
    const record = { expiresAt: 31, holderId: 'tab', sessionId: 's', updatedAt: 1 };
    await store.write(record);
    expect(await store.read('s')).toEqual(record);
    expect(settings.load().sessions.s.leaseUrl).toContain('lease.json');
    expect(settings.load().files['lease:s']).toMatchObject({ bindingId: 'role' });
    expect(await store.read('missing')).toBeUndefined();
  });
});
