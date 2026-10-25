import { decodeWorkspaceSegment } from '../mapping/serde';
import type { AgentSkill } from '../skills/types';

export const REFERENCE_CATEGORIES = [
  { id: 'character', label: '角色资料', icon: 'fa-regular fa-address-card' },
  { id: 'worldbook', label: '世界书', icon: 'fa-solid fa-book-atlas' },
  { id: 'preset', label: '预设', icon: 'fa-solid fa-sliders' },
  { id: 'chat', label: '聊天', icon: 'fa-regular fa-comments' },
  { id: 'skill', label: 'Skills', icon: 'fa-solid fa-wand-magic-sparkles' },
  { id: 'file', label: '文件', icon: 'fa-regular fa-file-lines' },
] as const;
export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number]['id'];
export type ComposerReference = {
  id: string;
  category: ReferenceCategory;
  label: string;
  path: string;
  description: string;
  insertion: string;
};

export function fileReference(path: string, label = decodeWorkspaceSegment(path.split('/').at(-1) ?? path)): string {
  const name = label.replace(/[\\[\]<>]/gu, '\\$&').replace(/[\r\n]/gu, ' ');
  const link = encodeURI(path).replace(/[()?#]/gu, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `[${name}](${link})`;
}

export function skillReferencePath(skill: Pick<AgentSkill, 'builtin' | 'id'>): string {
  return `/skills/${skill.builtin ? 'builtin' : 'user'}/${skill.id}/SKILL.md`;
}

function referenceCategory(path: string): ReferenceCategory {
  if (path.startsWith('/skills/')) return 'skill';
  if (path.startsWith('/presets/')) return 'preset';
  if (/(?:^|\/)worldbooks?(?:\/|$)/u.test(path)) return 'worldbook';
  if (path.startsWith('/character/chats/')) return 'chat';
  if (path.startsWith('/character/') || path.startsWith('/users/')) return 'character';
  return 'file';
}

const CHARACTER_LABELS: Record<string, string> = {
  '/character/definition/description.md': '角色描述',
  '/character/definition/personality.md': '角色性格',
  '/character/definition/scenario.md': '场景设定',
  '/character/definition/example-dialogue.md': '示例对话',
  '/character/definition/creator-notes.md': '创作者备注',
  '/character/definition/system-prompt.md': '系统提示词',
  '/character/definition/post-history-instructions.md': '历史后置指令',
};

export function composerReferences(
  files: readonly { path: string }[],
  skills: readonly AgentSkill[],
): ComposerReference[] {
  const byPath = new Map<string, ComposerReference>();
  for (const file of files) {
    const label = CHARACTER_LABELS[file.path] ?? decodeWorkspaceSegment(file.path.split('/').at(-1) ?? file.path);
    byPath.set(file.path, {
      id: `file:${file.path}`,
      category: referenceCategory(file.path),
      label,
      path: file.path,
      description: file.path,
      insertion: fileReference(file.path, label),
    });
  }
  for (const skill of skills) {
    const path = skillReferencePath(skill);
    byPath.set(path, {
      id: `skill:${skill.id}`,
      category: 'skill',
      label: skill.name,
      path,
      description: skill.description || path,
      insertion: fileReference(path, skill.name),
    });
  }
  return [...byPath.values()];
}

export function resolveCommandSkill(skills: AgentSkill[], args: string): { skill: AgentSkill; task: string } {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/u.exec(args.trim());
  let id: string;
  try {
    id = decodeURIComponent(match?.[1] ?? '');
  } catch {
    throw new Error('Skill 标识无效，请从候选列表重新选择。');
  }
  const byId = skills.find(skill => skill.id === id);
  const candidates = byId ? [byId] : skills.filter(skill => skill.name === id);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length ? 'Skill 名称有重名，请从候选列表选择。' : '此 Skill 未在当前会话挂载，请重新选择。',
    );
  const task = match?.[2]?.trim();
  if (!task) throw new Error('请在 Skill 后填写任务，例如 /skill 技能标识 检查角色设定。');
  return { skill: candidates[0], task };
}
