import { effectScope, nextTick, ref, shallowRef } from 'vue';
import { expect, it, vi } from 'vitest';
import type { DreamCardAgentContext } from './runtime';
import { createNotificationCenter } from './notifications';
import { useRuntimeNotifications } from './notification-sources';

it('后台备份失败保留状态，本机保存失败和真实冲突单独提醒', async () => {
  const scope = effectScope();
  const notifications = createNotificationCenter();
  const state = shallowRef({
    sessionBackup: { pending: 1, syncing: false, error: 'offline', localError: undefined as string | undefined },
  });
  const retryLocalSessionSave = vi.fn();
  try {
    scope.run(() =>
      useRuntimeNotifications({
        state,
        notifications,
        runtime: { retryLocalSessionSave },
        backupConflictsOpen: ref(false),
      } as unknown as DreamCardAgentContext),
    );
    expect(notifications.entries.value.find(item => item.id === 'session-backup')).toMatchObject({
      required: false,
      floating: false,
    });
    state.value = { sessionBackup: { ...state.value.sessionBackup, localError: 'quota' } };
    await nextTick();
    const entry = notifications.entries.value.find(item => item.id === 'session-local-save');
    expect(entry).toMatchObject({ required: true, floating: true, message: 'quota' });
    await entry!.actions![0].run();
    expect(retryLocalSessionSave).toHaveBeenCalledOnce();
    state.value = { sessionBackup: { ...state.value.sessionBackup, localError: undefined } };
    await nextTick();
    expect(notifications.entries.value.find(item => item.id === 'session-local-save')?.resolved).toBe(true);
  } finally {
    scope.stop();
    notifications.dispose();
  }
});
