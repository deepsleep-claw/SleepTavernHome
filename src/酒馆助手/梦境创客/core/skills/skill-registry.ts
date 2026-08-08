import { parseFrontmatter, serializeFrontmatter, slugifyFileName } from '../mapping/serde';
import { parentWorkspacePath, workspaceBasename } from '../workspace/path';
import { WorkspaceError, type WorkspaceFile } from '../workspace/types';
import { BUILTIN_CARD_WORKSPACE_SKILL } from './builtin-card-workspace';
import type { AgentSkill, SkillLoadingMode, SkillMutationAssessment } from './types';

function skillRoot(skill: AgentSkill): string {
  return `/skills/${skill.builtin ? 'builtin' : 'user'}/${skill.id}`;
}

function skillFile(skill: AgentSkill): WorkspaceFile {
  const path = `${skillRoot(skill)}/SKILL.md`;
  return {
    content: serializeFrontmatter(
      {
        description: skill.description,
        enabled: skill.enabled,
        loading: skill.loading,
        name: skill.name,
      },
      skill.body,
    ),
    mediaType: 'text/markdown',
    path,
    readonly: skill.builtin,
    resourceId: `skill:${skill.id}`,
  };
}

function resourceFile(skill: AgentSkill, kind: 'assets' | 'references', name: string, content: string): WorkspaceFile {
  return {
    content,
    mediaType: name.endsWith('.md') ? 'text/markdown' : 'text/plain',
    path: `${skillRoot(skill)}/${kind}/${name}`,
    readonly: skill.builtin,
    resourceId: `skill:${skill.id}:${kind}:${name}`,
  };
}

function buildIndex(skills: AgentSkill[]): string {
  const enabled = skills.filter(skill => skill.enabled);
  return [
    '# 已启用 Skill',
    '',
    ...enabled.flatMap(skill => [
      `## ${skill.name}`,
      '',
      `- 摘要：${skill.description}`,
      `- 加载：${skill.loading}`,
      `- 路径：${skillRoot(skill)}/SKILL.md`,
      '',
    ]),
  ].join('\n');
}

export function projectSkills(skills: AgentSkill[]): WorkspaceFile[] {
  const all = [BUILTIN_CARD_WORKSPACE_SKILL, ...skills.filter(skill => skill.id !== BUILTIN_CARD_WORKSPACE_SKILL.id)];
  const files = all.flatMap(skill => [
    skillFile(skill),
    ...Object.entries(skill.references).map(([name, content]) => resourceFile(skill, 'references', name, content)),
    ...Object.entries(skill.assets).map(([name, content]) => resourceFile(skill, 'assets', name, content)),
  ]);
  files.push({
    content: buildIndex(all),
    mediaType: 'text/markdown',
    path: '/skills/index.md',
    readonly: true,
    resourceId: 'skills:index',
  });
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function requiredString(value: unknown, label: string, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是非空字符串：${path}`, path);
  }
  return value;
}

function parseSkill(input: WorkspaceFile, allFiles: WorkspaceFile[]): AgentSkill {
  const { body, metadata } = parseFrontmatter(input.content, input.path);
  const root = parentWorkspacePath(input.path);
  const loading = metadata.loading;
  if (loading !== 'full' && loading !== 'on-demand') {
    throw new WorkspaceError('INVALID_PATCH', `Skill loading必须是full或on-demand：${input.path}`, input.path);
  }
  if (typeof metadata.enabled !== 'boolean') {
    throw new WorkspaceError('INVALID_PATCH', `Skill enabled必须是布尔值：${input.path}`, input.path);
  }
  const collect = (kind: 'assets' | 'references') =>
    Object.fromEntries(
      allFiles
        .filter(file => parentWorkspacePath(file.path).startsWith(`${root}/${kind}`))
        .map(file => [file.path.slice(`${root}/${kind}/`.length), file.content]),
    );
  return {
    assets: collect('assets'),
    body,
    builtin: input.path.startsWith('/skills/builtin/'),
    description: requiredString(metadata.description, 'description', input.path),
    enabled: metadata.enabled,
    id: workspaceBasename(root),
    loading,
    name: requiredString(metadata.name, 'name', input.path),
    references: collect('references'),
  };
}

export function materializeUserSkills(files: Iterable<WorkspaceFile>): AgentSkill[] {
  const all = [...files];
  return all
    .filter(file => file.path.startsWith('/skills/user/') && file.path.endsWith('/SKILL.md'))
    .map(file => parseSkill(file, all))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function compileFullSkillInstructions(skills: AgentSkill[]): string {
  return [BUILTIN_CARD_WORKSPACE_SKILL, ...skills]
    .filter(skill => skill.enabled && skill.loading === 'full')
    .map(skill => `## Skill：${skill.name}\n\n${skill.body.trim()}`)
    .join('\n\n');
}

export function createSkillTemplate(name: string, description: string, loading: SkillLoadingMode): AgentSkill {
  const id = slugifyFileName(name.toLowerCase(), `skill-${crypto.randomUUID().slice(0, 8)}`);
  return {
    assets: {},
    body: '# 工作流程\n\n在这里写入简短、可执行的步骤。',
    builtin: false,
    description,
    enabled: true,
    id,
    loading,
    name,
    references: {},
  };
}

export function assessSkillMutation(
  operation: 'delete' | 'move' | 'patch' | 'write',
  path: string,
  existingSkillIds: Iterable<string>,
): SkillMutationAssessment {
  if (path === '/skills/index.md' || path.startsWith('/skills/builtin/')) {
    return { allowed: false, confirmationRequired: false, reason: '内置Skill和Skill索引不可修改。' };
  }
  const match = path.match(/^\/skills\/user\/([^/]+)(?:\/|$)/u);
  if (!match) {
    return { allowed: false, confirmationRequired: false, reason: 'Skill只能写入/skills/user。' };
  }
  const exists = new Set(existingSkillIds).has(match[1]);
  const confirmationRequired = exists && ['delete', 'move', 'patch', 'write'].includes(operation);
  return { allowed: true, confirmationRequired };
}
