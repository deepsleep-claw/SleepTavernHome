import { klona } from 'klona';
import { parseFrontmatter, serializeFrontmatter } from '../mapping/serde';
import type { TavernFileClient } from '../persistence/file-client';
import type {
  AgentSettingsStore,
  GlobalSkillFileIndexEntry,
  GlobalSkillIndexEntry,
  StoredFileReference,
} from '../persistence/settings';
import { sha256 } from '../transaction/canonical';
import {
  isTextSkillResource,
  MAX_SKILL_PACKAGE_BYTES,
  MAX_SKILL_PACKAGE_ENTRIES,
  MAX_SKILL_RESOURCE_BYTES,
  normalizeSkillResourcePath,
  skillDirectories,
  skillResources,
  stripTransientSkillData,
} from './resources';
import type { AgentSkill, SkillResource } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parseSkillSource(value: string, id: string, url: string): Omit<AgentSkill, 'directories' | 'resources'> {
  const { body, metadata } = parseFrontmatter(value, url);
  if (
    typeof metadata.name !== 'string' ||
    typeof metadata.description !== 'string' ||
    (metadata.loading !== 'full' && metadata.loading !== 'on-demand') ||
    !body.trim()
  ) {
    throw new Error(`全局Skill文件缺少必要字段：${url}`);
  }
  return {
    body,
    builtin: false,
    description: metadata.description,
    id,
    loading: metadata.loading,
    ...(metadata.locked === true ? { locked: true } : {}),
    name: metadata.name,
  };
}

function indexEntry(
  skill: AgentSkill,
  url: string,
  mainSha256: string,
  files: Record<string, GlobalSkillFileIndexEntry>,
  revision: number,
  updatedAt: number,
): GlobalSkillIndexEntry {
  return {
    description: skill.description,
    directories: skillDirectories(skill),
    files,
    id: skill.id,
    loading: skill.loading,
    locked: skill.locked === true,
    name: skill.name,
    revision,
    sha256: mainSha256,
    updatedAt,
    url,
  };
}

function skillSource(skill: AgentSkill): string {
  return serializeFrontmatter(
    {
      description: skill.description,
      id: skill.id,
      loading: skill.loading,
      locked: skill.locked === true,
      name: skill.name,
    },
    skill.body,
  );
}

function safeSkillId(id: string): string {
  const normalized = id
    .normalize('NFKD')
    .replace(/[^a-zA-Z\d_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  const unicodeId = Array.from(id)
    .map(character => character.codePointAt(0)!.toString(16))
    .join('-')
    .slice(0, 40);
  return normalized || `skill-${unicodeId || 'unnamed'}`;
}

function fileExtension(path: string): string {
  const match = path.split('/').at(-1)?.match(/\.[a-zA-Z\d]{1,10}$/u);
  return match?.[0].toLocaleLowerCase() ?? '.bin';
}

async function physicalName(skillId: string, logicalPath: string, contentHash: string): Promise<string> {
  const pathHash = await sha256(logicalPath);
  return `DreamCreator--GlobalSkill--${safeSkillId(skillId)}--${pathHash.slice(0, 12)}--${contentHash.slice(0, 16)}${fileExtension(logicalPath)}`;
}

function registryKey(skillId: string, path: string): string {
  return `global-skill:${skillId}:${path}`;
}

function referencedUrls(entry?: GlobalSkillIndexEntry): Set<string> {
  return new Set(entry ? [entry.url, ...Object.values(entry.files ?? {}).map(file => file.url)] : []);
}

function normalizeResource(resource: SkillResource, path: string): SkillResource {
  const mediaType = resource.mediaType || 'application/octet-stream';
  const content = resource.content;
  const data = resource.data;
  const size = data?.byteLength ?? (content === undefined ? resource.size : encoder.encode(content).byteLength);
  if (!Number.isFinite(size) || size < 0) throw new Error(`Skill资源大小无效：${path}`);
  if (size > MAX_SKILL_RESOURCE_BYTES) throw new Error(`Skill单个资源不能超过20MB：${path}`);
  return { content, data, mediaType, sha256: resource.sha256, size };
}

/** 每个用户Skill由一个SKILL.md和若干独立资源文件组成；设置中的文件清单是原子生效点。 */
export class GlobalSkillStore {
  constructor(
    private readonly client: TavernFileClient,
    private readonly settingsStore: AgentSettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<AgentSkill[]> {
    const entries = Object.values(this.settingsStore.load().globalSkills).sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-CN'),
    );
    return Promise.all(entries.map(entry => this.readEntry(entry, false)));
  }

  async load(id: string): Promise<AgentSkill> {
    const entry = this.settingsStore.load().globalSkills[id];
    if (!entry) throw new Error(`全局Skill不存在：${id}`);
    return this.readEntry(entry, true);
  }

  async save(input: AgentSkill): Promise<AgentSkill> {
    if (input.builtin) throw new Error('内置Skill不可修改。');
    const skill: AgentSkill = {
      ...klona(input),
      assets: undefined,
      builtin: false,
      directories: skillDirectories(input),
      references: undefined,
      resources: skillResources(input),
    };
    if (!skill.name.trim() || !skill.description.trim() || !skill.body.trim()) {
      throw new Error('Skill名称、摘要和正文不能为空。');
    }
    const resources = Object.fromEntries(
      Object.entries(skill.resources ?? {}).map(([path, resource]) => [
        normalizeSkillResourcePath(path),
        normalizeResource(resource, path),
      ]),
    );
    if (Object.keys(resources).length + (skill.directories?.length ?? 0) > MAX_SKILL_PACKAGE_ENTRIES) {
      throw new Error('单个Skill最多包含500个文件和空目录。');
    }
    const totalBytes = Object.values(resources).reduce((sum, resource) => sum + resource.size, 0);
    if (totalBytes > MAX_SKILL_PACKAGE_BYTES) throw new Error('单个Skill的资源总大小不能超过100MB。');

    const settings = this.settingsStore.load();
    const previous = settings.globalSkills[skill.id];
    const previousFiles = previous?.files ?? {};
    const previousByHash = new Map(
      Object.values(previousFiles).map(file => [`${file.sha256}:${file.mediaType}`, file] as const),
    );
    const uploadedUrls: string[] = [];
    const nextFiles: Record<string, GlobalSkillFileIndexEntry> = {};
    try {
      for (const [path, resource] of Object.entries(resources)) {
        let bytes: Uint8Array | undefined;
        if (resource.data) bytes = Uint8Array.from(resource.data);
        else if (resource.content !== undefined) bytes = encoder.encode(resource.content);
        const contentHash = bytes ? await sha256(bytes) : resource.sha256;
        if (!contentHash) throw new Error(`二进制Skill资源缺少可复用内容：${path}`);
        const reusable =
          (previousFiles[path]?.sha256 === contentHash ? previousFiles[path] : undefined) ??
          previousByHash.get(`${contentHash}:${resource.mediaType}`);
        let url = reusable?.url;
        let name = reusable?.name;
        if (!url || !name) {
          if (!bytes) throw new Error(`Skill资源内容尚未载入：${path}`);
          name = await physicalName(skill.id, path, contentHash);
          url = await this.client.upload(name, bytes);
          uploadedUrls.push(url);
        }
        nextFiles[path] = {
          mediaType: resource.mediaType,
          name,
          path,
          sha256: contentHash,
          size: resource.size,
          url,
        };
      }

      const mainBytes = encoder.encode(skillSource(skill));
      const mainSha256 = await sha256(mainBytes);
      let mainUrl = previous?.sha256 === mainSha256 ? previous.url : undefined;
      let mainName = mainUrl ? settings.files[registryKey(skill.id, 'SKILL.md')]?.name : undefined;
      if (!mainUrl || !mainName) {
        mainName = await physicalName(skill.id, 'SKILL.md', mainSha256);
        mainUrl = await this.client.upload(mainName, mainBytes);
        uploadedUrls.push(mainUrl);
      }

      const at = this.now();
      settings.globalSkills[skill.id] = indexEntry(
        skill,
        mainUrl,
        mainSha256,
        nextFiles,
        (previous?.revision ?? 0) + 1,
        at,
      );
      for (const key of Object.keys(settings.files)) {
        if (key === `global-skill:${skill.id}` || key.startsWith(`global-skill:${skill.id}:`)) delete settings.files[key];
      }
      const references: Array<[string, StoredFileReference]> = [
        [
          registryKey(skill.id, 'SKILL.md'),
          { bindingId: 'global', createdAt: at, name: mainName, size: mainBytes.byteLength, url: mainUrl },
        ],
        ...Object.entries(nextFiles).map(([path, file]): [string, StoredFileReference] => [
          registryKey(skill.id, path),
          { bindingId: 'global', createdAt: at, name: file.name, size: file.size, url: file.url },
        ]),
      ];
      Object.assign(settings.files, Object.fromEntries(references));
      await this.settingsStore.save(settings);

      const retained = referencedUrls(settings.globalSkills[skill.id]);
      for (const url of referencedUrls(previous)) {
        if (!retained.has(url)) await this.client.delete(url).catch(() => undefined);
      }
      return stripTransientSkillData(skill);
    } catch (error) {
      for (const url of uploadedUrls) await this.client.delete(url).catch(() => undefined);
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const settings = this.settingsStore.load();
    const entry = settings.globalSkills[id];
    if (!entry) throw new Error(`全局Skill不存在：${id}`);
    delete settings.globalSkills[id];
    for (const key of Object.keys(settings.files)) {
      if (key === `global-skill:${id}` || key.startsWith(`global-skill:${id}:`)) delete settings.files[key];
    }
    await this.settingsStore.save(settings);
    for (const url of referencedUrls(entry)) await this.client.delete(url).catch(() => undefined);
  }

  async replace(skills: AgentSkill[]): Promise<AgentSkill[]> {
    const current = new Map((await this.list()).map(skill => [skill.id, skill]));
    const incoming = new Map(skills.map(skill => [skill.id, skill]));
    for (const [id] of current) {
      if (!incoming.has(id)) await this.remove(id);
    }
    for (const skill of skills) {
      if (JSON.stringify(current.get(skill.id)) !== JSON.stringify(stripTransientSkillData(skill))) await this.save(skill);
    }
    return this.list();
  }

  private async readEntry(entry: GlobalSkillIndexEntry, includeBinaryData: boolean): Promise<AgentSkill> {
    const main = parseSkillSource(decoder.decode(await this.client.download(entry.url)), entry.id, entry.url);
    const resources = Object.fromEntries(
      await Promise.all(
        Object.entries(entry.files ?? {}).map(async ([path, file]) => {
          const normalized = normalizeSkillResourcePath(path);
          const resource: SkillResource = {
            mediaType: file.mediaType,
            sha256: file.sha256,
            size: file.size,
          };
          if (isTextSkillResource(resource, normalized)) {
            resource.content = decoder.decode(await this.client.download(file.url));
          } else if (includeBinaryData) {
            resource.data = await this.client.download(file.url);
          }
          return [normalized, resource] as const;
        }),
      ),
    );
    return {
      ...main,
      directories: [...(entry.directories ?? [])],
      resources,
    };
  }
}
