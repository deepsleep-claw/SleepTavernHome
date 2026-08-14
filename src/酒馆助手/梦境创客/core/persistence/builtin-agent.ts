import { parse } from 'yaml';
import builtinAgentSource from '../../内置资源/Agents/梦境创客默认Agent.yaml?raw';
import { ALL_AGENT_TOOL_IDS, isAgentToolId, type AgentToolId } from '../runner/tool-catalog';
import type { SkillLoadingMode } from '../skills/types';

export type AgentSkillSetting = {
  enabled: boolean;
  id: string;
  loading: SkillLoadingMode;
};

export type AgentConfiguration = {
  id: string;
  name: string;
  presetId: string;
  /** Skill默认策略来自Skill文件；这里保存当前Agent的最终覆盖值。 */
  skills: AgentSkillSetting[];
  /** 工具Schema只注册这里启用且适用于当前会话作用域的工具。 */
  toolIds: AgentToolId[];
};

export type BuiltinAgentDefinition = AgentConfiguration & { version: number };

const DEFAULT_BUILTIN_AGENT_PATH = '内置资源/Agents/梦境创客默认Agent.yaml';

function definitionError(path: string, message: string): Error {
  return new Error(`无法读取${path}：${message}`);
}

function requiredString(value: unknown, field: string, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw definitionError(path, `${field}必须是非空字符串。`);
  return value.trim();
}

function parseSkillSettings(value: unknown, path: string): AgentSkillSetting[] {
  if (!Array.isArray(value)) throw definitionError(path, 'skills必须是对象数组。');
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw definitionError(path, `skills[${index}]必须是对象。`);
    }
    const item = raw as Record<string, unknown>;
    const id = requiredString(item.id, `skills[${index}].id`, path);
    if (seen.has(id)) throw definitionError(path, `Skill不能重复：${id}`);
    seen.add(id);
    if (item.loading !== 'full' && item.loading !== 'on-demand') {
      throw definitionError(path, `skills[${index}].loading必须是full或on-demand。`);
    }
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') {
      throw definitionError(path, `skills[${index}].enabled必须是布尔值。`);
    }
    return { enabled: item.enabled !== false, id, loading: item.loading };
  });
}

function parseToolIds(value: unknown, path: string): AgentToolId[] {
  if (!Array.isArray(value) || value.some(item => !isAgentToolId(item))) {
    throw definitionError(path, `tools只能包含已知工具：${ALL_AGENT_TOOL_IDS.join('、')}`);
  }
  return [...new Set(value)] as AgentToolId[];
}

export function parseBuiltinAgentSource(
  source: string,
  path = DEFAULT_BUILTIN_AGENT_PATH,
): BuiltinAgentDefinition {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw definitionError(path, error instanceof Error ? error.message : String(error));
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw definitionError(path, '根节点必须是YAML对象。');
  }
  const value = raw as Record<string, unknown>;
  if (!Number.isInteger(value.version) || Number(value.version) < 1) {
    throw definitionError(path, 'version必须是大于等于1的整数。');
  }
  return {
    id: requiredString(value.id, 'id', path),
    name: requiredString(value.name, 'name', path),
    presetId: requiredString(value.preset, 'preset', path),
    skills: parseSkillSettings(value.skills, path),
    toolIds: parseToolIds(value.tools, path),
    version: Number(value.version),
  };
}

export function cloneAgentConfiguration(configuration: AgentConfiguration): AgentConfiguration {
  return {
    id: configuration.id,
    name: configuration.name,
    presetId: configuration.presetId,
    skills: configuration.skills.map(skill => ({ ...skill })),
    toolIds: [...configuration.toolIds],
  };
}

export const DEFAULT_BUILTIN_AGENT = parseBuiltinAgentSource(builtinAgentSource);

export function defaultBuiltinAgentConfiguration(): AgentConfiguration {
  return cloneAgentConfiguration(DEFAULT_BUILTIN_AGENT);
}
