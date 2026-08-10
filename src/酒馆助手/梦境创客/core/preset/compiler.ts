import type { ModelMessage } from 'ai';
import { parse } from 'yaml';
import defaultPresetSource from '../../内置资源/预设/梦境创客默认预设.yaml?raw';
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

/**
 * Vue 会把放进响应式状态的预设包装为 Proxy，浏览器的 structuredClone
 * 无法直接克隆 Proxy。预设结构固定且只包含这些纯数据字段，因此在边界处
 * 显式复制可以同时解除响应式包装并避免 JSON 序列化带来的隐式行为。
 */
export function cloneStructuredPreset(preset: StructuredPreset): StructuredPreset {
  return {
    id: preset.id,
    name: preset.name,
    nodes: preset.nodes.map(node => ({ ...node })),
    version: preset.version,
  };
}

const MACRO_PATTERN = /\{\{([a-z_][a-z\d_]*)\}\}/giu;

export async function compilePreset(
  preset: StructuredPreset,
  values: Record<PresetMacro, string>,
): Promise<CompiledPreset> {
  const messages = preset.nodes
    .filter(node => node.enabled)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map(node => {
      const unknown = [...node.content.matchAll(MACRO_PATTERN)]
        .map(match => match[1])
        .filter(name => !PRESET_MACROS.includes(name as PresetMacro));
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

const DEFAULT_PRESET_PATH = '内置资源/预设/梦境创客默认预设.yaml';

function presetError(path: string, message: string): Error {
  return new Error(`无法读取${path}：${message}`);
}

function requiredString(value: unknown, field: string, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw presetError(path, `${field}必须是非空字符串。`);
  return value;
}

export function parseStructuredPresetSource(source: string, path = DEFAULT_PRESET_PATH): StructuredPreset {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw presetError(path, error instanceof Error ? error.message : String(error));
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw presetError(path, '根节点必须是YAML对象。');
  }
  const value = raw as Record<string, unknown>;
  if (!Number.isInteger(value.version) || Number(value.version) < 1) {
    throw presetError(path, 'version必须是大于等于1的整数。');
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    throw presetError(path, 'nodes必须是非空数组。');
  }
  const nodes = value.nodes.map((rawNode, index): PresetNode => {
    if (typeof rawNode !== 'object' || rawNode === null || Array.isArray(rawNode)) {
      throw presetError(path, `nodes[${index}]必须是对象。`);
    }
    const node = rawNode as Record<string, unknown>;
    if (!['assistant', 'system', 'user'].includes(String(node.role))) {
      throw presetError(path, `nodes[${index}].role必须是assistant、system或user。`);
    }
    if (!Number.isFinite(node.order)) throw presetError(path, `nodes[${index}].order必须是数字。`);
    if (typeof node.enabled !== 'boolean') throw presetError(path, `nodes[${index}].enabled必须是布尔值。`);
    return {
      content: requiredString(node.content, `nodes[${index}].content`, path),
      enabled: node.enabled,
      id: requiredString(node.id, `nodes[${index}].id`, path),
      order: Number(node.order),
      role: node.role as PresetNode['role'],
      title: requiredString(node.title, `nodes[${index}].title`, path),
    };
  });
  if (new Set(nodes.map(node => node.id)).size !== nodes.length) {
    throw presetError(path, '节点id不能重复。');
  }
  return {
    id: requiredString(value.id, 'id', path),
    name: requiredString(value.name, 'name', path),
    nodes,
    version: Number(value.version),
  };
}

export const DEFAULT_PRESET = parseStructuredPresetSource(defaultPresetSource);
