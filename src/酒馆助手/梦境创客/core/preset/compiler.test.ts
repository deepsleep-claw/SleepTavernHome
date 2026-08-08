import { describe, expect, it } from 'vitest';
import { compilePreset, DEFAULT_PRESET, type PresetMacro, type StructuredPreset } from './compiler';

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
    await expect(compilePreset(DEFAULT_PRESET, { ...values, agent_identity: '{{tools_can_use}}' })).rejects.toThrow('递归宏');
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
