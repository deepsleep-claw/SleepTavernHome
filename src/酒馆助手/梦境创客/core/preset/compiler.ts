import type { ModelMessage } from 'ai';
import { sha256 } from '../transaction/canonical';

export const PRESET_MACROS = [
  'agent_identity',
  'tools_can_use',
  'tool_rules',
  'skill_instructions',
  'safety_rules',
  'output_style',
  'custom_instructions',
] as const;

export type PresetMacro = (typeof PRESET_MACROS)[number];

export type PresetNode = {
  content: string;
  enabled: boolean;
  id: string;
  order: number;
  role: 'assistant' | 'system' | 'user';
  title: string;
};

export type StructuredPreset = {
  id: string;
  name: string;
  nodes: PresetNode[];
  version: number;
};

export type CompiledPreset = {
  hash: string;
  messages: ModelMessage[];
  presetId: string;
  presetVersion: number;
};

const MACRO_PATTERN = /\{\{([a-z_][a-z\d_]*)\}\}/giu;

export async function compilePreset(
  preset: StructuredPreset,
  values: Record<PresetMacro, string>,
): Promise<CompiledPreset> {
  const messages = preset.nodes
    .filter(node => node.enabled)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map(node => {
      const unknown = [...node.content.matchAll(MACRO_PATTERN)].map(match => match[1]).filter(name => !PRESET_MACROS.includes(name as PresetMacro));
      if (unknown.length > 0) {
        throw new Error(`预设节点“${node.title}”包含未知宏：${[...new Set(unknown)].join('、')}`);
      }
      const content = node.content.replace(MACRO_PATTERN, (_match, name: PresetMacro) => values[name]);
      if (MACRO_PATTERN.test(content)) {
        MACRO_PATTERN.lastIndex = 0;
        throw new Error(`预设节点“${node.title}”产生了递归宏。`);
      }
      MACRO_PATTERN.lastIndex = 0;
      return { content, role: node.role } as ModelMessage;
    });
  return {
    hash: await sha256(JSON.stringify(messages)),
    messages,
    presetId: preset.id,
    presetVersion: preset.version,
  };
}

export const DEFAULT_PRESET: StructuredPreset = {
  id: 'dream-card-agent-default',
  name: '梦境创客默认预设',
  nodes: [
    { content: '{{agent_identity}}', enabled: true, id: 'identity', order: 10, role: 'system', title: '身份' },
    {
      content: '{{tools_can_use}}\n\n{{tool_rules}}',
      enabled: true,
      id: 'tools',
      order: 20,
      role: 'system',
      title: '工具',
    },
    {
      content: '{{skill_instructions}}',
      enabled: true,
      id: 'skills',
      order: 30,
      role: 'system',
      title: 'Skill',
    },
    {
      content: '{{safety_rules}}\n\n{{output_style}}\n\n{{custom_instructions}}',
      enabled: true,
      id: 'rules',
      order: 40,
      role: 'system',
      title: '规则',
    },
  ],
  version: 1,
};
