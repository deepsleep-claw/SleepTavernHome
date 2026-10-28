// @vitest-environment happy-dom
import { createApp, nextTick, ref, shallowRef } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import StorageSettings from './StorageSettings.vue';

const mock = vi.hoisted(() => ({ context: undefined as unknown }));
vi.mock('../../composables/runtime', () => ({ useDreamCardAgent: () => mock.context }));
let dispose = () => {};
afterEach(() => dispose());

function mount() {
  const state = shallowRef({
    backupFrequencySeconds: 120,
    busy: false,
    storage: { characters: [], globalSkillBytes: 0 },
    sessionBackup: { pending: 0, syncing: false, updates: [] },
  });
  const updateSettings = vi.fn(async (patch: { backupFrequencySeconds: number }) => {
    state.value = { ...state.value, ...patch };
  });
  const runtime = { updateSettings, backupSessions: vi.fn(), refreshSessionBackups: vi.fn() };
  mock.context = {
    state,
    runtime,
    workspaceView: ref('settings'),
    openedSessionIds: ref([]),
    backupConflictsOpen: ref(false),
    action: async (work: () => Promise<unknown>) => {
      try {
        await work();
        return true;
      } catch {
        return false;
      }
    },
  };
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(StorageSettings);
  app.mount(root);
  dispose = () => {
    app.unmount();
    root.remove();
  };
  const select = root.querySelector<HTMLSelectElement>('[aria-label="备份频率"]')!;
  const button = (text: string) =>
    [...root.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!;
  return { state, runtime, root, select, button };
}

it('提供五档检查间隔，保存选择并保留立即备份及检查更新入口', async () => {
  const f = mount();
  expect([...f.select.options].map(option => [option.value, option.textContent?.trim()])).toEqual([
    ['30', '30 秒'],
    ['60', '1 分钟'],
    ['120', '2 分钟'],
    ['300', '5 分钟'],
    ['600', '10 分钟'],
  ]);
  expect(f.select.value).toBe('120');
  f.select.value = '300';
  f.select.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  await nextTick();
  expect(f.runtime.updateSettings).toHaveBeenCalledWith({ backupFrequencySeconds: 300 });
  expect(f.select.value).toBe('300');
  f.button('检查后端更新').click();
  await nextTick();
  expect(f.runtime.refreshSessionBackups).toHaveBeenCalledOnce();
  expect(f.runtime.backupSessions).not.toHaveBeenCalled();
  f.button('立即备份').click();
  await nextTick();
  expect(f.runtime.backupSessions).toHaveBeenCalledOnce();
});

it('设置保存失败后显示原频率，备份进行中禁止重复点击', async () => {
  const f = mount();
  f.runtime.updateSettings.mockRejectedValueOnce(new Error('offline'));
  f.select.value = '30';
  f.select.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  await nextTick();
  expect(f.select.value).toBe('120');
  f.state.value = { ...f.state.value, sessionBackup: { ...f.state.value.sessionBackup, syncing: true } };
  await nextTick();
  expect(f.button('立即备份').disabled).toBe(true);
});
