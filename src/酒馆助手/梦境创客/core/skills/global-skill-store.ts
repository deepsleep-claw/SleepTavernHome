import { klona } from 'klona';
import { parseFrontmatter, serializeFrontmatter } from '../mapping/serde';
import type { TavernFileClient } from '../persistence/file-client';
import type { AgentSettingsStore, GlobalSkillIndexEntry, StoredFileReference } from '../persistence/settings';
import type { AgentSkill } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assertUserSkill(value: string, id: string, url: string): AgentSkill {
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
    assets: {},
    body,
    builtin: false,
    description: metadata.description,
    id,
    loading: metadata.loading,
    name: metadata.name,
    references: {},
  };
}

function indexEntry(skill: AgentSkill, url: string, revision: number, updatedAt: number): GlobalSkillIndexEntry {
  return {
    description: skill.description,
    id: skill.id,
    loading: skill.loading,
    name: skill.name,
    revision,
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
      name: skill.name,
    },
    skill.body,
  );
}

/** 每个用户Skill对应一个稳定Markdown文件；保存时原子覆盖，不产生Revision碎片。 */
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
    return Promise.all(
      entries.map(async entry => assertUserSkill(decoder.decode(await this.client.download(entry.url)), entry.id, entry.url)),
    );
  }

  async save(skill: AgentSkill): Promise<AgentSkill> {
    if (skill.builtin) throw new Error('内置Skill不可修改。');
    if (Object.keys(skill.assets).length > 0 || Object.keys(skill.references).length > 0) {
      throw new Error('当前版本只支持轻量单文件Skill。');
    }
    const settings = this.settingsStore.load();
    const previous = settings.globalSkills[skill.id];
    const revision = (previous?.revision ?? 0) + 1;
    const normalizedId = skill.id
      .normalize('NFKD')
      .replace(/[^a-zA-Z\d_-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 64);
    const unicodeId = Array.from(skill.id)
      .map(character => character.codePointAt(0)!.toString(16))
      .join('-')
      .slice(0, 56);
    const safeId = normalizedId || `skill-${unicodeId || 'unnamed'}`;
    const name = `DreamCreator--GlobalSkill--${safeId}.md`;
    const bytes = encoder.encode(skillSource({ ...klona(skill), assets: {}, builtin: false, references: {} }));
    const url = await this.client.upload(name, bytes);
    const at = this.now();
    settings.globalSkills[skill.id] = indexEntry(skill, url, revision, at);
    const registryKey = `global-skill:${skill.id}`;
    const reference: StoredFileReference = { bindingId: 'global', createdAt: at, name, size: bytes.byteLength, url };
    for (const key of Object.keys(settings.files)) {
      if (key === registryKey || key.startsWith(`global-skill:${skill.id}:`)) delete settings.files[key];
    }
    settings.files[registryKey] = reference;
    await this.settingsStore.save(settings);
    return { ...klona(skill), assets: {}, builtin: false, references: {} };
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
    await this.client.delete(entry.url).catch(() => undefined);
  }

  async replace(skills: AgentSkill[]): Promise<AgentSkill[]> {
    const current = new Map((await this.list()).map(skill => [skill.id, skill]));
    const incoming = new Map(skills.map(skill => [skill.id, skill]));
    for (const [id] of current) {
      if (!incoming.has(id)) await this.remove(id);
    }
    for (const skill of skills) {
      if (JSON.stringify(current.get(skill.id)) !== JSON.stringify(skill)) await this.save(skill);
    }
    return this.list();
  }
}
