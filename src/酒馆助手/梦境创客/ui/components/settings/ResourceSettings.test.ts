// @vitest-environment happy-dom
import { createApp, h, nextTick, ref, shallowRef, type Component } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentSettings from './AgentSettings.vue';
import PresetSettings from './PresetSettings.vue';
import { createResourceDrafts } from '../../composables/resource-drafts';

const mock = vi.hoisted(() => ({ context: undefined as unknown }));
vi.mock('../../composables/runtime', () => ({ useDreamCardAgent: () => mock.context }));
let dispose = () => {};
afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});

function mount(kind: 'agent' | 'preset', component: Component) {
  const presets = ['a', 'b'].map(id => ({
    id,
    name: `预设 ${id}`,
    version: 1,
    nodes: [{ id: 'node', title: '规则', role: 'system', enabled: true, order: 10, content: '{{skill_instructions}}' }],
  }));
  const agents = ['a', 'b'].map(id => ({ id, name: `Agent ${id}`, presetId: 'a', skills: [], toolIds: [] }));
  const state = shallowRef({
    activeAgentConfigurationId: 'a',
    activePresetId: 'a',
    agentConfigurations: agents,
    presetProfiles: presets,
    skills: [],
    builtinSkillResources: [],
  });
  const bank = createResourceDrafts();
  let resolve!: () => void;
  const save = vi.fn(
    (value, _options) =>
      new Promise<typeof value>(done => {
        resolve = () => {
          const key = kind === 'agent' ? 'agentConfigurations' : 'presetProfiles';
          const next = {
            ...state.value,
            [key]: state.value[key].map(item => (item.id === value.id ? structuredClone(value) : item)),
          };
          state.value = next;
          done(structuredClone(value));
        };
      }),
  );
  mock.context = {
    state,
    resourceDrafts: bank,
    action: async (work: () => Promise<unknown>) => {
      try {
        await work();
        return true;
      } catch {
        return false;
      }
    },
    runtime: {
      saveAgentConfiguration: save,
      savePresetProfile: save,
      selectAgentConfiguration: async (id: string) => {
        state.value = { ...state.value, activeAgentConfigurationId: id };
      },
      selectPresetProfile: async (id: string) => {
        state.value = { ...state.value, activePresetId: id };
      },
    },
  };
  vi.stubGlobal('toastr', { success: vi.fn(), error: vi.fn(), info: vi.fn() });
  const visible = ref(true);
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp({
    setup: () => () => h('div', { class: 'dca-app' }, visible.value ? h(component) : h('p', '另一设置页')),
  });
  app.mount(root);
  dispose = () => {
    app.unmount();
    bank.dispose();
    root.remove();
  };
  const input = () => root.querySelector<HTMLInputElement>('input[type="text"]')!;
  const button = (label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
  const write = async (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  };
  const select = async (id: string) => {
    root
      .querySelector<HTMLButtonElement>(`button[aria-label="${kind === 'agent' ? '默认 Agent' : '当前预设 Profile'}"]`)!
      .click();
    await nextTick();
    [...root.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.id.endsWith(`-${id}`))!.click();
    await nextTick();
  };
  return { root, input, button, write, select, state, visible, save, finish: () => resolve() };
}

describe.each([
  ['agent', AgentSettings],
  ['preset', PresetSettings],
] as const)('%s 草稿', (kind, component) => {
  it('保存失败保留草稿并提供重新保存入口', async () => {
    const f = mount(kind, component);
    f.save.mockRejectedValueOnce(new Error('暂时离线'));
    await f.write('失败后保留');
    f.button(kind === 'agent' ? '保存 Agent' : '保存 Profile').click();
    await nextTick();
    await nextTick();
    expect(f.input().value).toBe('失败后保留');
    expect(f.root.textContent).toContain('保存失败：暂时离线');
    expect(f.button(kind === 'agent' ? '保存 Agent' : '保存 Profile').disabled).toBe(false);
  });
  it('切页保留编辑，后台快照不覆盖，放弃修改恢复服务端值', async () => {
    const f = mount(kind, component);
    await f.write('尚未保存的名称');
    f.visible.value = false;
    await nextTick();
    f.visible.value = true;
    await nextTick();
    expect(f.input().value).toBe('尚未保存的名称');
    const key = kind === 'agent' ? 'agentConfigurations' : 'presetProfiles';
    f.state.value = { ...f.state.value, [key]: f.state.value[key].map(item => ({ ...item, name: '后台名称' })) };
    await nextTick();
    expect(f.input().value).toBe('尚未保存的名称');
    f.button('放弃修改').click();
    await nextTick();
    expect(f.input().value).toBe('后台名称');
  });
  it('保存去重，迟到回执保留新编辑并且不会切回旧配置', async () => {
    const f = mount(kind, component);
    await f.write('提交的名称');
    const saveButton = f.button(kind === 'agent' ? '保存 Agent' : '保存 Profile');
    saveButton.click();
    saveButton.click();
    await nextTick();
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save.mock.calls[0][1]).toEqual({ makeDefault: false });
    await f.write('保存期间的新名称');
    await f.select('b');
    f.finish();
    await nextTick();
    await nextTick();
    expect(f.input().value).toBe(kind === 'agent' ? 'Agent b' : '预设 b');
    await f.select('a');
    expect(f.input().value).toBe('保存期间的新名称');
    expect(f.root.textContent).toContain('有未保存的修改');
  });
});
