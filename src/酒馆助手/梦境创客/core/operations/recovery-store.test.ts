import { describe, expect, it, vi } from 'vitest';
import { MemoryOperationRecoveryStore, OperationRecoveryCoordinator, type OperationRecoveryStore } from './recovery-store';
import type { PersistedOperationLog } from './types';

const log: PersistedOperationLog = { records: [], turns: [], version: 1 };

describe('operation recovery store', () => {
  it('在浏览器缓存中保存会话级操作日志', async () => {
    const store = new MemoryOperationRecoveryStore();
    const coordinator = new OperationRecoveryCoordinator(store);
    expect(await coordinator.persist('session', 'turn', log)).toBe(true);
    expect(await store.load('session')).toEqual(log);
  });

  it('某轮第一次失败后不再尝试IndexedDB，但不向调用方抛错', async () => {
    const save = vi.fn(async () => { throw new Error('quota'); });
    const store: OperationRecoveryStore = { load: vi.fn(), remove: vi.fn(), save };
    const coordinator = new OperationRecoveryCoordinator(store);
    expect(await coordinator.persist('session', 'turn', log)).toBe(false);
    expect(await coordinator.persist('session', 'turn', log)).toBe(false);
    expect(save).toHaveBeenCalledOnce();
    expect(coordinator.isAvailable('turn')).toBe(false);
  });
});
