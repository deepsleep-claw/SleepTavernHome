import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import {
  cloneStructuredPreset,
  compilePreset,
  DEFAULT_PRESET,
  parseStructuredPresetSource,
  type PresetMacro,
  type StructuredPreset,
} from './compiler';

const values = Object.fromEntries(
  [
    'agent_identity',
    'tools_can_use',
    'tool_rules',
    'skill_instructions',
    'safety_rules',
    'output_style',
    'custom_instructions',
  ].map(name => [name, `<${name}>`]),
) as Record<PresetMacro, string>;

describe('structured preset compiler', () => {
  it('从内置YAML读取默认预设，并允许身份节点直接书写正文', () => {
    expect(DEFAULT_PRESET).toMatchObject({ id: 'dream-card-agent-default', name: '梦境创客默认预设', version: 1 });
    expect(DEFAULT_PRESET.nodes[0]).toMatchObject({ id: 'identity', role: 'system', title: '身份' });
    expect(DEFAULT_PRESET.nodes[0].content).toContain('你是“梦境创客”');
    expect(DEFAULT_PRESET.nodes[0].content).not.toContain('{{agent_identity}}');
  });

  it('为损坏的内置预设YAML提供可定位的错误', () => {
    expect(() => parseStructuredPresetSource('id: broken\nnodes: []\n', 'broken.yaml')).toThrow('broken.yaml');
    expect(() =>
      parseStructuredPresetSource(
        'id: x\nname: x\nversion: 1\nnodes:\n  - id: same\n    title: A\n    role: bad\n    order: 1\n    enabled: true\n    content: x\n',
        'broken.yaml',
      ),
    ).toThrow('role');
  });

  it('可以克隆Vue响应式预设并解除嵌套引用', () => {
    const reactivePreset = reactive(DEFAULT_PRESET);
    const cloned = cloneStructuredPreset(reactivePreset);

    cloned.nodes[0].title = '已修改';

    expect(cloned).not.toBe(reactivePreset);
    expect(cloned.nodes[0]).not.toBe(reactivePreset.nodes[0]);
    expect(reactivePreset.nodes[0].title).toBe('身份');
  });

  it('按启用状态、顺序与角色只编译静态头部', async () => {
    const preset: StructuredPreset = {
      ...DEFAULT_PRESET,
      nodes: [
        { content: 'second {{tools_can_use}}', enabled: true, id: 'b', order: 2, role: 'user', title: 'B' },
        { content: 'disabled', enabled: false, id: 'x', order: 0, role: 'system', title: 'X' },
        { content: 'first {{agent_identity}}', enabled: true, id: 'a', order: 1, role: 'system', title: 'A' },
      ],
    };
    const compiled = await compilePreset(preset, values);
    expect(compiled.messages).toEqual([
      { content: 'first <agent_identity>', role: 'system' },
      { content: 'second <tools_can_use>', role: 'user' },
    ]);
    expect(compiled.hash).toMatch(/^[a-f\d]{64}$/u);
  });

  it('拒绝未知宏和递归宏', async () => {
    const unknown = {
      ...DEFAULT_PRESET,
      nodes: [{ ...DEFAULT_PRESET.nodes[0], content: '{{unknown_macro}}' }],
    };
    await expect(compilePreset(unknown, values)).rejects.toThrow('未知宏');
    const recursive = {
      ...DEFAULT_PRESET,
      nodes: [{ ...DEFAULT_PRESET.nodes[0], content: '{{agent_identity}}' }],
    };
    await expect(compilePreset(recursive, { ...values, agent_identity: '{{tools_can_use}}' })).rejects.toThrow('递归宏');
  });

  it('同序节点使用稳定ID排序', async () => {
    const preset = {
      ...DEFAULT_PRESET,
      nodes: [
        { content: 'B', enabled: true, id: 'b', order: 1, role: 'system' as const, title: 'B' },
        { content: 'A', enabled: true, id: 'a', order: 1, role: 'system' as const, title: 'A' },
      ],
    };
    expect((await compilePreset(preset, values)).messages.map(message => message.content)).toEqual(['A', 'B']);
  });
});
