import { parseFrontmatter, serializeFrontmatter, slugifyFileName } from '../mapping/serde';
import { parentWorkspacePath, workspaceBasename } from '../workspace/path';
import { WorkspaceError, type WorkspaceFile } from '../workspace/types';
import { BUILTIN_CARD_WORKSPACE_SKILL } from './builtin-card-workspace';
import { isTextSkillResource, skillDirectories, skillResources } from './resources';
import type { AgentSkill, SkillLoadingMode, SkillMutationAssessment, SkillResource } from './types';

function skillRoot(skill: AgentSkill): string {
  return `/skills/${skill.builtin ? 'builtin' : 'user'}/${skill.id}`;
}

function skillFile(skill: AgentSkill): WorkspaceFile {
  const path = `${skillRoot(skill)}/SKILL.md`;
  return {
    content: serializeFrontmatter(
      {
        description: skill.description,
        loading: skill.loading,
        locked: skill.locked === true,
        name: skill.name,
      },
      skill.body,
    ),
    mediaType: 'text/markdown',
    path,
    readonly: skill.builtin || skill.locked === true,
    resourceId: `skill:${skill.id}`,
  };
}

function resourceFile(skill: AgentSkill, name: string, resource: SkillResource): WorkspaceFile {
  const binary = !isTextSkillResource(resource, name);
  return {
    content: binary ? '' : (resource.content ?? ''),
    mediaType: resource.mediaType,
    path: `${skillRoot(skill)}/${name}`,
    readonly: skill.builtin || skill.locked === true,
    resourceId: `skill:${skill.id}:resource:${name}`,
    skillResource: binary
      ? { sha256: resource.sha256 ?? `unresolved:${skill.id}:${name}`, size: resource.size }
      : undefined,
  };
}

function buildIndex(skills: AgentSkill[]): string {
  return [
    '# 已启用 Skill',
    '',
    '这里列出当前Agent配置启用的全部Skill。full已进入本轮固定头部；on-demand不会自动注入，需要时请读取对应SKILL.md并按其说明探索资源文件。',
    '',
    ...skills.flatMap(skill => [
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
    ...Object.entries(skillResources(skill)).map(([name, resource]) => resourceFile(skill, name, resource)),
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

function parseSkill(input: WorkspaceFile, allFiles: WorkspaceFile[], previous?: AgentSkill): AgentSkill {
  const { body, metadata } = parseFrontmatter(input.content, input.path);
  const root = parentWorkspacePath(input.path);
  const loading = metadata.loading;
  if (loading !== 'full' && loading !== 'on-demand') {
    throw new WorkspaceError('INVALID_PATCH', `Skill loading必须是full或on-demand：${input.path}`, input.path);
  }
  const previousResources = previous ? skillResources(previous) : {};
  const resources = Object.fromEntries(
    allFiles
      .filter(file => file.path.startsWith(`${root}/`) && file.path !== input.path)
      .map(file => {
        const name = file.path.slice(root.length + 1);
        const previousResource = previousResources[name];
        if (file.skillResource) {
          return [
            name,
            {
              mediaType: file.mediaType,
              sha256: file.skillResource.sha256,
              size: file.skillResource.size,
              ...(previousResource?.data ? { data: previousResource.data } : {}),
            },
          ];
        }
        return [
          name,
          {
            content: file.content,
            mediaType: file.mediaType,
            size: new TextEncoder().encode(file.content).byteLength,
          },
        ];
      }),
  );
  return {
    body,
    builtin: input.path.startsWith('/skills/builtin/'),
    description: requiredString(metadata.description, 'description', input.path),
    directories: previous ? skillDirectories(previous) : [],
    id: workspaceBasename(root),
    loading,
    ...(metadata.locked === true || previous?.locked === true ? { locked: true } : {}),
    name: requiredString(metadata.name, 'name', input.path),
    resources,
  };
}

export function materializeUserSkills(files: Iterable<WorkspaceFile>, previousSkills: AgentSkill[] = []): AgentSkill[] {
  const all = [...files];
  const previous = new Map(previousSkills.map(skill => [skill.id, skill]));
  return all
    .filter(file => file.path.startsWith('/skills/user/') && file.path.endsWith('/SKILL.md'))
    .map(file => parseSkill(file, all, previous.get(workspaceBasename(parentWorkspacePath(file.path)))))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export type FullSkillInstruction = { content: string; id: string; name: string };

export function fullSkillInstructions(skills: AgentSkill[]): FullSkillInstruction[] {
  return [BUILTIN_CARD_WORKSPACE_SKILL, ...skills]
    .filter(skill => skill.loading === 'full')
    .map(skill => ({ content: `## Skill：${skill.name}\n\n${skill.body.trim()}`, id: skill.id, name: skill.name }));
}

export function compileFullSkillInstructions(skills: AgentSkill[]): string {
  return fullSkillInstructions(skills)
    .map(skill => skill.content)
    .join('\n\n');
}

export function createSkillTemplate(name: string, description: string, loading: SkillLoadingMode): AgentSkill {
  const id = slugifyFileName(name.toLowerCase(), `skill-${crypto.randomUUID().slice(0, 8)}`);
  return {
    body: '# 工作流程\n\n在这里写入简短、可执行的步骤。',
    builtin: false,
    description,
    directories: [],
    id,
    loading,
    name,
    resources: {},
  };
}

export function assessSkillMutation(
  operation: 'delete' | 'move' | 'patch' | 'write',
  path: string,
  existingSkillIds: Iterable<string>,
  lockedSkillIds: Iterable<string> = [],
): SkillMutationAssessment {
  if (path === '/skills/index.md' || path.startsWith('/skills/builtin/')) {
    return { allowed: false, confirmationRequired: false, reason: '内置Skill和Skill索引不可修改。' };
  }
  const match = path.match(/^\/skills\/user\/([^/]+)(?:\/|$)/u);
  if (!match) {
    return { allowed: false, confirmationRequired: false, reason: 'Skill只能写入/skills/user。' };
  }
  const exists = new Set(existingSkillIds).has(match[1]);
  if (new Set(lockedSkillIds).has(match[1])) {
    return {
      allowed: false,
      confirmationRequired: false,
      reason: `SKILL_LOCKED：Skill“${match[1]}”已由用户在设置中锁定，Agent不能修改、移动或删除它。`,
    };
  }
  const confirmationRequired = exists && ['delete', 'move', 'patch', 'write'].includes(operation);
  return { allowed: true, confirmationRequired };
}
