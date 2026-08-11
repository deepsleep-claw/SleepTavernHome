import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import { parseFrontmatter, serializeFrontmatter } from '../mapping/serde';
import { createSkillTemplate } from './skill-registry';
import {
  inferSkillMediaType,
  isTextSkillResource,
  MAX_SKILL_PACKAGE_BYTES,
  MAX_SKILL_PACKAGE_ENTRIES,
  MAX_SKILL_RESOURCE_BYTES,
  normalizeSkillDirectoryPath,
  normalizeSkillResourcePath,
  skillDirectories,
  skillResources,
} from './resources';
import type { AgentSkill, SkillLoadingMode, SkillResource } from './types';

function safeArchivePath(input: string): string {
  if (input.startsWith('/') || input.includes('\\') || /(^|\/)\.\.(?:\/|$)/u.test(input)) {
    throw new Error(`ZIP包含越界路径：${input}`);
  }
  const normalized = input
    .split('/')
    .filter(segment => segment && segment !== '.')
    .join('/');
  if (!normalized || [...normalized].some(character => (character.codePointAt(0) ?? 0) <= 0x1f)) {
    throw new Error(`ZIP包含非法路径：${input}`);
  }
  return normalized;
}

function parseMainSkill(source: string, path: string): Pick<AgentSkill, 'body' | 'description' | 'loading' | 'name'> {
  const { body, metadata } = parseFrontmatter(source, path);
  if (metadata.loading !== 'full' && metadata.loading !== 'on-demand') {
    throw new Error('Skill loading必须是full或on-demand。');
  }
  if (typeof metadata.name !== 'string' || typeof metadata.description !== 'string' || !body.trim()) {
    throw new Error('Skill缺少name、description或正文。');
  }
  return {
    body: body.trim(),
    description: metadata.description.trim(),
    loading: metadata.loading as SkillLoadingMode,
    name: metadata.name.trim(),
  };
}

function freshSkill(main: ReturnType<typeof parseMainSkill>, resources: Record<string, SkillResource>, directories: string[]) {
  const template = createSkillTemplate(main.name, main.description, main.loading);
  return {
    ...template,
    ...main,
    builtin: false,
    directories,
    id: `${template.id}-${crypto.randomUUID().slice(0, 8)}`,
    resources,
  } satisfies AgentSkill;
}

export function skillMarkdownSource(skill: AgentSkill): string {
  return serializeFrontmatter(
    { description: skill.description, loading: skill.loading, name: skill.name },
    skill.body,
  );
}

export function importSkillMarkdown(source: string, path = 'SKILL.md'): AgentSkill {
  return freshSkill(parseMainSkill(source, path), {}, []);
}

export function exportSkillZip(skill: AgentSkill): Uint8Array {
  const files: Record<string, Uint8Array> = { 'SKILL.md': strToU8(skillMarkdownSource(skill)) };
  for (const directory of skillDirectories(skill)) files[`${directory}/`] = new Uint8Array();
  for (const [path, resource] of Object.entries(skillResources(skill))) {
    if (resource.data) files[path] = Uint8Array.from(resource.data);
    else if (resource.content !== undefined) files[path] = strToU8(resource.content);
    else throw new Error(`导出ZIP前尚未载入二进制资源：${path}`);
  }
  return zipSync(files, { level: 6 });
}

export function importSkillZip(bytes: Uint8Array, filename = 'skill.zip'): AgentSkill {
  let count = 0;
  let totalBytes = 0;
  const unzipped = unzipSync(bytes, {
    filter(file) {
      count += 1;
      if (count > MAX_SKILL_PACKAGE_ENTRIES) throw new Error('Skill ZIP最多包含500个文件和目录。');
      safeArchivePath(file.name);
      if (file.originalSize > MAX_SKILL_RESOURCE_BYTES && !file.name.endsWith('/')) {
        throw new Error(`ZIP内单个文件不能超过20MB：${file.name}`);
      }
      totalBytes += file.originalSize;
      if (totalBytes > MAX_SKILL_PACKAGE_BYTES) throw new Error('Skill ZIP解压后不能超过100MB。');
      return true;
    },
  });
  return skillFromUnzipped(unzipped, filename);
}

function skillFromUnzipped(unzipped: Unzipped, filename: string): AgentSkill {
  const entries = Object.entries(unzipped).map(([rawPath, data]) => {
    const path = safeArchivePath(rawPath);
    return { data, path: rawPath.endsWith('/') ? `${path}/` : path };
  });
  const mainCandidates = entries.filter(entry => entry.path.split('/').at(-1)?.toLocaleLowerCase() === 'skill.md');
  if (mainCandidates.length !== 1) throw new Error('Skill ZIP必须且只能包含一个SKILL.md。');
  const mainEntry = mainCandidates[0];
  const segments = mainEntry.path.split('/');
  if (segments.length > 2) throw new Error('SKILL.md只能位于ZIP根目录或单层包装目录中。');
  const prefix = segments.length === 2 ? `${segments[0]}/` : '';
  if (prefix && entries.some(entry => !entry.path.startsWith(prefix))) {
    throw new Error('ZIP使用包装目录时，所有Skill资源必须位于同一目录内。');
  }

  const resources: Record<string, SkillResource> = {};
  const directories: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const relative = prefix ? entry.path.slice(prefix.length) : entry.path;
    if (!relative || relative.toLocaleLowerCase() === 'skill.md') continue;
    if (relative.endsWith('/')) {
      directories.push(normalizeSkillDirectoryPath(relative.slice(0, -1)));
      continue;
    }
    const path = normalizeSkillResourcePath(relative);
    if (seen.has(path)) throw new Error(`ZIP包含重复路径：${path}`);
    seen.add(path);
    const mediaType = inferSkillMediaType(path);
    const descriptor = { mediaType, size: entry.data.byteLength };
    resources[path] = isTextSkillResource(descriptor, path)
      ? { ...descriptor, content: strFromU8(entry.data) }
      : { ...descriptor, data: Uint8Array.from(entry.data) };
  }
  return freshSkill(parseMainSkill(strFromU8(mainEntry.data), `${filename}:${mainEntry.path}`), resources, directories);
}
