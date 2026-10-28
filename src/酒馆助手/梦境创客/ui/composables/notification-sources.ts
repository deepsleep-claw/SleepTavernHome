import { watch } from 'vue';
import type { DreamCardAgentContext } from './runtime';
import type { NotificationInput } from './notifications';

export function useRuntimeNotifications(context: DreamCardAgentContext) {
  const { state, notifications, runtime, backupConflictsOpen } = context;
  const warningSources = new Set<string>();
  watch(
    state,
    snapshot => {
      if (snapshot.error)
        notifications.upsert({ id: 'runtime:error', title: '运行遇到问题', message: snapshot.error, level: 'error' });
      else notifications.resolve('runtime:error');

      const warnings = new Map<string, NotificationInput>();
      for (const message of snapshot.warnings ?? [])
        warnings.set(`runtime:warning:${message}`, {
          id: `runtime:warning:${message}`,
          title: '工作台提示',
          message,
          level: 'warning',
        });
      const active = snapshot.active;
      if (active && snapshot.activeSessionAccess === 'readonly-history') {
        const sessionId = active.sessionId;
        notifications.upsert({
          id: 'readonly-history',
          title: `${active.title} · 历史记录只读`,
          message: active.error || '对应角色卡已不可用，仍可查看已保存的消息和修改记录。',
          level: 'info',
          actions:
            active.scope === 'global' || active.bindingId === snapshot.currentCharacter?.bindingId
              ? [
                  {
                    id: 'reload',
                    label: '重新加载工作区',
                    disabled: snapshot.busy,
                    run: () =>
                      active.scope === 'global' ? runtime.openGlobalSession(sessionId) : runtime.openSession(sessionId),
                  },
                ]
              : [],
        });
      } else notifications.resolve('readonly-history');
      for (const message of active?.warnings ?? []) {
        const id = `session:${active!.sessionId}:warning:${message}`;
        warnings.set(id, { id, title: `${active!.title} · 会话提示`, message, level: 'warning' });
      }
      for (const id of warningSources)
        if (!warnings.has(id)) {
          notifications.resolve(id);
          warningSources.delete(id);
        }
      for (const [id, input] of warnings) {
        warningSources.add(id);
        notifications.upsert(input);
      }

      const backup = snapshot.sessionBackup;
      if (backup?.localError) {
        notifications.upsert({
          id: 'session-local-save',
          title: '本机会话尚未保存',
          message: backup.localError,
          level: 'error',
          required: true,
          actions: [{ id: 'retry-local', label: '重试本机保存', run: () => runtime.retryLocalSessionSave() }],
        });
      } else notifications.resolve('session-local-save', '本机会话已保存。');
      const conflicts = backup?.conflicts ?? [];
      const pending = backup?.pending ?? 0;
      const required = conflicts.length > 0;
      if (required || backup?.error || pending || backup?.localPending || backup?.syncing) {
        const actions = [];
        if (conflicts.length)
          actions.push({
            id: 'resolve',
            label: '处理备份冲突',
            run: () => {
              notifications.close();
              backupConflictsOpen.value = true;
            },
          });
        if (pending > conflicts.length || (backup?.error && !conflicts.length))
          actions.push({
            id: 'retry',
            label: '重试备份',
            disabled: backup?.syncing,
            run: () => runtime.backupSessions(),
          });
        if (required || backup?.error)
          actions.push({
            id: 'storage',
            label: '查看详情',
            run: () => {
              notifications.close();
              context.openSettings('storage');
            },
          });
        notifications.upsert({
          id: 'session-backup',
          title: required ? '备份版本需要选择' : backup?.error ? '后端备份暂未完成' : '会话保存与备份',
          message:
            backup?.error ||
            (conflicts.length
              ? `${conflicts.length} 个会话的本机记录与后端备份不同，请选择保留版本。`
              : backup?.localPending
                ? '等待自动保存'
                : backup?.syncing
                  ? '本机已保存 · 正在备份'
                  : `本机已保存 · ${pending} 项等待备份`),
          level: required || backup?.error ? 'warning' : 'info',
          required,
          actions,
          toast: required,
        });
      } else notifications.resolve('session-backup', '本机会话与后端备份已同步。');
    },
    { immediate: true },
  );
}
