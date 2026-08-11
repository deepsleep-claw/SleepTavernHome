import { parse } from 'yaml';
import builtinAgentSource from '../../内置资源/Agents/梦境创客默认Agent.yaml?raw';

export type AgentConfiguration = {
  id: string;
  name: string;
  presetId: string;
  /** 这套配置中开启的用户Skill；内置Skill始终挂载。 */
  skillIds: string[];
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
  if (!Array.isArray(value.skills) || value.skills.some(skill => typeof skill !== 'string' || !skill.trim())) {
    throw definitionError(path, 'skills必须是字符串数组。');
  }
  return {
    id: requiredString(value.id, 'id', path),
    name: requiredString(value.name, 'name', path),
    presetId: requiredString(value.preset, 'preset', path),
    skillIds: [...new Set(value.skills.map(skill => String(skill).trim()))],
    version: Number(value.version),
  };
}

export function cloneAgentConfiguration(configuration: AgentConfiguration): AgentConfiguration {
  return {
    id: configuration.id,
    name: configuration.name,
    presetId: configuration.presetId,
    skillIds: [...configuration.skillIds],
  };
}

export const DEFAULT_BUILTIN_AGENT = parseBuiltinAgentSource(builtinAgentSource);

export function defaultBuiltinAgentConfiguration(): AgentConfiguration {
  return cloneAgentConfiguration(DEFAULT_BUILTIN_AGENT);
}
