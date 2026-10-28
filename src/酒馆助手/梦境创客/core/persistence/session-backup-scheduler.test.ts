import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionBackupScheduler, type BackupLifecycle } from './session-backup-scheduler';

const schedulers: SessionBackupScheduler[] = [];
afterEach(() => {
  schedulers.splice(0).forEach(item => item.dispose());
  vi.useRealTimers();
});
function fixture(check = vi.fn(async () => {}), seconds = 120) {
  vi.useFakeTimers();
  let available = true;
  let changed = () => {};
  const lifecycle: BackupLifecycle = {
    available: () => available,
    subscribe: listener => {
      changed = listener;
      return () => {};
    },
  };
  const scheduler = new SessionBackupScheduler(check, seconds, lifecycle);
  schedulers.push(scheduler);
  return {
    check,
    scheduler,
    change: (value: boolean) => {
      available = value;
      changed();
    },
  };
}

describe('备份检查调度', () => {
  it.each([30, 60, 120, 300, 600])('每 %i 秒检查一次', async seconds => {
    const f = fixture(undefined, seconds);
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
    expect(f.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.check).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
  });
  it('隐藏期间暂停，连续恢复事件只保留一个新的检查周期', async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(100_000);
    f.change(false);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(f.check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    for (let index = 0; index < 8; index += 1) f.change(true);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(f.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.check).toHaveBeenCalledOnce();
  });
  it('慢检查不会积累任务，完成后使用最新频率', async () => {
    let finish!: () => void;
    const f = fixture(
      vi.fn(
        () =>
          new Promise<void>(resolve => {
            finish = resolve;
          }),
      ),
    );
    await vi.advanceTimersByTimeAsync(120_000);
    f.scheduler.setFrequency(30);
    f.change(false);
    f.change(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(f.check).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    finish();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.check).toHaveBeenCalledTimes(2);
  });
  it('挂起后的过期回调只检查一次，销毁后不再重建定时器', async () => {
    const f = fixture();
    vi.setSystemTime(Date.now() + 60 * 60_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.check).toHaveBeenCalledOnce();
    f.scheduler.dispose();
    f.change(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.check).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
