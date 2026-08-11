import { normalizeWorkspacePath } from '../workspace/path';
import type { AgentSkill, SkillResource } from './types';

export const MAX_SKILL_RESOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_SKILL_PACKAGE_BYTES = 100 * 1024 * 1024;
export const MAX_SKILL_PACKAGE_ENTRIES = 500;

const TEXT_EXTENSIONS = new Set([
  'css',
  'csv',
  'html',
  'ini',
  'js',
  'json',
  'json5',
  'md',
  'mjs',
  'scss',
  'svg',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

export function normalizeSkillResourcePath(input: string): string {
  const normalized = normalizeWorkspacePath(input).slice(1);
  if (!normalized) throw new Error('Skill资源路径不能为空。');
  if (normalized.toLocaleLowerCase() === 'skill.md') {
    throw new Error('根目录SKILL.md由Skill本体占用，不能作为资源文件。');
  }
  return normalized;
}

export function normalizeSkillDirectoryPath(input: string): string {
  return normalizeSkillResourcePath(input).replace(/\/+$/gu, '');
}

export function inferSkillMediaType(path: string): string {
  const extension = path.split('.').at(-1)?.toLocaleLowerCase() ?? '';
  const known: Record<string, string> = {
    css: 'text/css',
    csv: 'text/csv',
    gif: 'image/gif',
    html: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    json: 'application/json',
    md: 'text/markdown',
    pdf: 'application/pdf',
    png: 'image/png',
    svg: 'image/svg+xml',
    ts: 'text/typescript',
    txt: 'text/plain',
    webp: 'image/webp',
    yaml: 'text/yaml',
    yml: 'text/yaml',
  };
  return known[extension] ?? (TEXT_EXTENSIONS.has(extension) ? 'text/plain' : 'application/octet-stream');
}

export function isTextSkillResource(resource: Pick<SkillResource, 'mediaType'>, path = ''): boolean {
  const mediaType = resource.mediaType.toLocaleLowerCase();
  return (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType === 'application/javascript' ||
    mediaType === 'application/xml' ||
    mediaType === 'image/svg+xml' ||
    TEXT_EXTENSIONS.has(path.split('.').at(-1)?.toLocaleLowerCase() ?? '')
  );
}

/** 把旧版references/assets折叠进自由资源树；同路径以resources为准。 */
export function skillResources(skill: AgentSkill): Record<string, SkillResource> {
  const encoder = new TextEncoder();
  const legacy = {
    ...Object.fromEntries(
      Object.entries(skill.references ?? {}).map(([path, content]) => [
        `references/${path}`,
        { content, mediaType: inferSkillMediaType(path), size: encoder.encode(content).byteLength },
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(skill.assets ?? {}).map(([path, content]) => [
        `assets/${path}`,
        { content, mediaType: inferSkillMediaType(path), size: encoder.encode(content).byteLength },
      ]),
    ),
  } satisfies Record<string, SkillResource>;
  return Object.fromEntries(
    Object.entries({ ...legacy, ...(skill.resources ?? {}) }).map(([path, resource]) => [
      normalizeSkillResourcePath(path),
      { ...resource },
    ]),
  );
}

export function skillDirectories(skill: AgentSkill): string[] {
  return [...new Set((skill.directories ?? []).map(normalizeSkillDirectoryPath))].sort((a, b) => a.localeCompare(b));
}

export function stripTransientSkillData(skill: AgentSkill): AgentSkill {
  return {
    body: skill.body,
    builtin: skill.builtin,
    description: skill.description,
    directories: skillDirectories(skill),
    id: skill.id,
    loading: skill.loading,
    name: skill.name,
    resources: Object.fromEntries(
      Object.entries(skillResources(skill)).map(([path, resource]) => [path, { ...resource, data: undefined }]),
    ),
  };
}
