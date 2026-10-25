// @vitest-environment happy-dom
import { createApp, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionBackupDialog from './SessionBackupDialog.vue';
import type { SessionBackupConflict, SessionBackupStatus } from '../../core/persistence/local-session-store';

const mock = vi.hoisted(() => ({ context: undefined as unknown }));
vi.mock('../composables/runtime', () => ({ useDreamCardAgent: () => mock.context }));
let dispose = () => {};
afterEach(() => dispose());

const conflict: SessionBackupConflict = {
  bindingId: 'card',
  sessionId: 'a',
  title: '创作记录',
  characterName: '角色卡',
  localRevision: 2,
  remoteRevision: 2,
  localUpdatedAt: 1000,
  remoteUpdatedAt: 2000,
  deleted: false,
};

function mount(status: SessionBackupStatus) {
  const state = shallowRef({ sessionBackup: status, sessionStatuses: {} as Record<string, string> });
  const runtime = { backupSessions: vi.fn(async () => {}), resolveSessionBackupConflict: vi.fn(async () => {}) };
  mock.context = {
    state,
    runtime,
    backupConflictsOpen: shallowRef(true),
    action: async (work: () => Promise<unknown>) => {
      await work();
      return true;
    },
  };
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(SessionBackupDialog);
  app.mount(root);
  dispose = () => {
    app.unmount();
    root.remove();
  };
  return { root, state, runtime };
}

describe('SessionBackupDialog', () => {
  it.each(['local', 'remote'] as const)('将 %s 版本选择提交给对应冲突，解决后自动关闭', async resolution => {
    const { root, state, runtime } = mount({ pending: 1, syncing: false, conflicts: [conflict] });
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    root.querySelectorAll<HTMLButtonElement>('.dca-backup-options button')[resolution === 'local' ? 0 : 1].click();
    expect(runtime.resolveSessionBackupConflict).toHaveBeenCalledWith(conflict, resolution);
    state.value = { ...state.value, sessionBackup: { pending: 0, syncing: false, conflicts: [] } };
    await nextTick();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  it('运行中的目标会话不能替换备份记录', async () => {
    const { root, state } = mount({ pending: 1, syncing: false, conflicts: [conflict] });
    state.value = { ...state.value, sessionStatuses: { a: 'running' } };
    await nextTick();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.dca-backup-options button')];
    expect(buttons.every(button => button.disabled)).toBe(true);
    expect(root.textContent).toContain('请先停止或完成');
  });
});
