import builtinSkillSource from '../../内置资源/Skills/角色卡工作区读写.md?raw';
import { parseFrontmatter } from '../mapping/serde';
import { WorkspaceError } from '../workspace/types';
import type { AgentSkill } from './types';

const BUILTIN_SKILL_PATH = '内置资源/Skills/角色卡工作区读写.md';

function requiredString(value: unknown, field: string, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkspaceError('INVALID_PATCH', `内置Skill的${field}必须是非空字符串：${path}`, path);
  }
  return value;
}

export function parseBuiltinSkillSource(source: string, path = BUILTIN_SKILL_PATH): AgentSkill {
  const { body, metadata } = parseFrontmatter(source, path);
  if (metadata.loading !== 'full' && metadata.loading !== 'on-demand') {
    throw new WorkspaceError('INVALID_PATCH', `内置Skill的loading必须是full或on-demand：${path}`, path);
  }
  if (!body.trim()) {
    throw new WorkspaceError('INVALID_PATCH', `内置Skill正文不能为空：${path}`, path);
  }
  return {
    assets: {},
    body,
    builtin: true,
    description: requiredString(metadata.description, 'description', path),
    id: requiredString(metadata.id, 'id', path),
    loading: metadata.loading,
    name: requiredString(metadata.name, 'name', path),
    references: {},
  };
}

export const BUILTIN_CARD_WORKSPACE_SKILL = parseBuiltinSkillSource(builtinSkillSource);
