import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationCenter } from './notifications';

let center: ReturnType<typeof createNotificationCenter>;
beforeEach(() => {
  vi.useFakeTimers();
  center = createNotificationCenter();
});
afterEach(() => {
  center.dispose();
  vi.useRealTimers();
});
const message = { id: 'notice', title: '提示', message: '设置已保存', level: 'success' as const };

describe('通知生命周期', () => {
  it('自动收起保留未读记录，打开通知中心后可清除', () => {
    center.upsert(message);
    vi.advanceTimersByTime(6000);
    expect(center.entries.value[0]).toMatchObject({ floating: false, unread: true });
    center.show();
    expect(center.unreadCount.value).toBe(0);
    expect(center.entries.value).toHaveLength(1);
    center.clear();
    expect(center.entries.value).toHaveLength(0);
  });

  it('待处理消息只能收起，源状态恢复后才允许清除', () => {
    center.upsert({ ...message, required: true, level: 'warning' });
    vi.advanceTimersByTime(9000);
    center.dismiss(message.id);
    center.show();
    center.clear();
    expect(center.requiredCount.value).toBe(1);
    expect(center.entries.value[0].floating).toBe(false);
    center.resolve(message.id, '备份完成');
    expect(center.requiredCount.value).toBe(0);
    center.clear();
    expect(center.entries.value).toHaveLength(0);
  });

  it('连续快照不延长展示或重建已清除消息，恢复后复发可重新提醒', () => {
    center.upsert(message);
    vi.advanceTimersByTime(4000);
    center.upsert(message);
    vi.advanceTimersByTime(2000);
    expect(center.entries.value[0].floating).toBe(false);
    center.dismiss(message.id);
    center.upsert(message);
    expect(center.entries.value).toHaveLength(0);
    center.resolve(message.id);
    center.upsert(message);
    expect(center.entries.value[0].floating).toBe(true);
    center.resolve(message.id);
    center.upsert(message);
    expect(center.entries.value[0]).toMatchObject({ floating: true, resolved: false });
  });

  it('悬停期间暂停倒计时，并为新消息保留展示空间', () => {
    center.upsert(message);
    vi.advanceTimersByTime(4000);
    center.pause(message.id);
    vi.advanceTimersByTime(10000);
    expect(center.entries.value[0].floating).toBe(true);
    center.resume(message.id);
    vi.advanceTimersByTime(2000);
    expect(center.entries.value[0].floating).toBe(false);
    for (let i = 0; i < 3; i++) {
      center.upsert({ ...message, id: `other:${i}` });
      vi.advanceTimersByTime(10);
    }
    center.upsert(message, true);
    expect(center.entries.value.filter(item => item.floating)).toHaveLength(3);
    expect(center.entries.value.find(item => item.id === message.id)?.floating).toBe(true);
    expect(center.entries.value.find(item => item.id === 'other:0')?.floating).toBe(false);
  });

  it('重复点击只执行一次，动作失败不解除待处理状态', async () => {
    let reject!: (reason: Error) => void;
    const run = vi.fn(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    center.upsert({ ...message, required: true, actions: [{ id: 'retry', label: '重试', run }] });
    const task = center.run(message.id, 'retry');
    await center.run(message.id, 'retry');
    expect(run).toHaveBeenCalledOnce();
    center.hide(message.id);
    expect(center.entries.value[0]).toMatchObject({ floating: false, required: true, busy: 'retry' });
    reject(new Error('网络不可用'));
    await task;
    expect(center.requiredCount.value).toBe(1);
    expect(center.entries.value.find(item => item.id === message.id)?.busy).toBeUndefined();
    expect(center.entries.value.some(item => item.message === '网络不可用')).toBe(true);
  });
});
