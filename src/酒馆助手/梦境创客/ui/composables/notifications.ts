import { computed, shallowRef } from 'vue';

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';
export type NotificationAction = {
  id: string;
  label: string;
  run: () => unknown | Promise<unknown>;
  disabled?: boolean;
};
export type NotificationInput = {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  required?: boolean;
  actions?: NotificationAction[];
  toast?: boolean;
};
export type WorkspaceNotification = NotificationInput & {
  createdAt: number;
  unread: boolean;
  floating: boolean;
  resolved: boolean;
  busy?: string;
};

type Timer = { handle?: ReturnType<typeof setTimeout>; started: number; remaining: number };
const sameContent = (left: NotificationInput, right: NotificationInput) =>
  left.title === right.title &&
  left.message === right.message &&
  left.level === right.level &&
  Boolean(left.required) === Boolean(right.required);

export function createNotificationCenter() {
  const entries = shallowRef<WorkspaceNotification[]>([]);
  const open = shallowRef(false);
  const timers = new Map<string, Timer>();
  const dismissed = new Map<string, NotificationInput>();
  let disposed = false;

  function update(id: string, change: Partial<WorkspaceNotification>) {
    entries.value = entries.value.map(item => (item.id === id ? { ...item, ...change } : item));
  }
  function stopTimer(id: string) {
    const timer = timers.get(id);
    if (timer?.handle !== undefined) clearTimeout(timer.handle);
    timers.delete(id);
  }
  function hide(id: string, read = true) {
    stopTimer(id);
    update(id, { floating: false, ...(read ? { unread: false } : {}) });
  }
  function resume(id: string) {
    const timer = timers.get(id);
    if (!timer || timer.handle !== undefined) return;
    timer.started = Date.now();
    timer.handle = setTimeout(() => hide(id, false), timer.remaining);
  }
  function pause(id: string) {
    const timer = timers.get(id);
    if (!timer || timer.handle === undefined) return;
    clearTimeout(timer.handle);
    timer.handle = undefined;
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started));
  }
  function float(id: string) {
    stopTimer(id);
    if (open.value) return;
    const entry = entries.value.find(item => item.id === id);
    if (!entry) return;
    update(id, { floating: true });
    timers.set(id, { remaining: entry.required ? 9000 : 6000, started: Date.now() });
    resume(id);
    entries.value
      .filter(item => item.floating)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(3)
      .forEach(item => hide(item.id, false));
  }
  function trimHistory() {
    const removable = entries.value
      .filter(item => !item.required && !item.busy)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(50);
    for (const entry of removable) stopTimer(entry.id);
    const ids = new Set(removable.map(item => item.id));
    entries.value = entries.value.filter(item => !ids.has(item.id));
  }
  function upsert(input: NotificationInput, repeat = false) {
    if (disposed) return;
    const previous = entries.value.find(item => item.id === input.id);
    const hidden = dismissed.get(input.id);
    if (!repeat && hidden && sameContent(hidden, input)) return;
    dismissed.delete(input.id);
    if (previous) {
      // 快照刷新只更新内容；新的事件或已恢复问题再次出现时才重新提醒。
      const announce = repeat || previous.resolved || (!previous.required && Boolean(input.required));
      update(input.id, {
        ...input,
        resolved: false,
        ...(announce ? { unread: input.toast !== false && !open.value, createdAt: Date.now() } : {}),
      });
      if (announce && input.toast !== false) float(input.id);
    } else {
      entries.value = [
        {
          ...input,
          createdAt: Date.now(),
          unread: input.toast !== false && !open.value,
          floating: false,
          resolved: false,
        },
        ...entries.value,
      ];
      if (input.toast !== false) float(input.id);
    }
    trimHistory();
  }
  function resolve(id: string, message?: string) {
    dismissed.delete(id);
    const entry = entries.value.find(item => item.id === id);
    if (!entry || entry.resolved) return;
    hide(id);
    update(id, {
      required: false,
      resolved: true,
      actions: [],
      ...(message ? { message, level: 'success' as const } : {}),
    });
  }
  function dismiss(id: string) {
    const entry = entries.value.find(item => item.id === id);
    if (!entry || entry.required || entry.busy) return;
    dismissed.set(id, entry);
    stopTimer(id);
    entries.value = entries.value.filter(item => item.id !== id);
  }
  function clear() {
    entries.value.filter(item => !item.required).forEach(item => dismiss(item.id));
  }
  function show() {
    open.value = true;
    for (const id of timers.keys()) stopTimer(id);
    entries.value = entries.value.map(item => ({ ...item, floating: false, unread: false }));
  }
  function close() {
    open.value = false;
  }
  async function run(id: string, actionId: string) {
    const entry = entries.value.find(item => item.id === id);
    const action = entry?.actions?.find(item => item.id === actionId);
    if (!entry || entry.busy || !action || action.disabled) return;
    pause(id);
    update(id, { busy: actionId });
    try {
      await action.run();
    } catch (error) {
      upsert(
        {
          id: `action-error:${id}`,
          title: '操作未完成',
          message: error instanceof Error ? error.message : String(error),
          level: 'error',
        },
        true,
      );
    } finally {
      if (!disposed) {
        update(id, { busy: undefined });
        resume(id);
      }
    }
  }
  function dispose() {
    disposed = true;
    for (const id of timers.keys()) stopTimer(id);
    entries.value = [];
    dismissed.clear();
  }
  return {
    entries,
    open,
    requiredCount: computed(() => entries.value.filter(item => item.required).length),
    unreadCount: computed(() => entries.value.filter(item => item.unread).length),
    upsert,
    resolve,
    hide,
    dismiss,
    clear,
    show,
    close,
    pause,
    resume,
    run,
    dispose,
  };
}

export type NotificationCenter = ReturnType<typeof createNotificationCenter>;
const sinks = new Set<(input: NotificationInput) => void>();
export function connectNotifications(center: NotificationCenter) {
  const sink = (input: NotificationInput) => center.upsert(input, true);
  sinks.add(sink);
  return () => sinks.delete(sink);
}

function publish(level: NotificationLevel, message: string, title = '梦境创客') {
  // 工作台尚未挂载时，启动与窗口错误仍可通过宿主提示呈现。
  if (!sinks.size) {
    toastr[level](message, title);
    return;
  }
  const label =
    title === '梦境创客'
      ? { info: '提示', success: '操作已完成', warning: '需要留意', error: '操作失败' }[level]
      : title;
  const input = { id: `message:${level}:${title}:${message}`, level, message, title: label };
  sinks.forEach(sink => sink(input));
}
export const notify = {
  info: (message: string, title?: string) => publish('info', message, title),
  success: (message: string, title?: string) => publish('success', message, title),
  warning: (message: string, title?: string) => publish('warning', message, title),
  error: (message: string, title?: string) => publish('error', message, title),
};
