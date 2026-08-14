import type { TavernFileClient } from '../persistence/file-client';
import type { AgentSettingsStore, BuiltinSkillPackageReference } from '../persistence/settings';
import { sha256 } from '../transaction/canonical';
import { importSkillZip } from './skill-package';
import { REMOTE_BUILTIN_SKILLS } from './remote-builtin-catalog';
import type { AgentSkill } from './types';

export type RemoteSkillManifestEntry = {
  description: string;
  file: string;
  id: string;
  loading: 'on-demand';
  name: string;
  sha256: string;
  size: number;
  version: number;
};

export type RemoteSkillManifest = {
  protocolVersion: number;
  skills: RemoteSkillManifestEntry[];
};

export type RemoteBuiltinSkillStatus = RemoteSkillManifestEntry & {
  cached: boolean;
  error?: string;
  sourceUrl: string;
  state: 'available' | 'downloading' | 'error' | 'missing' | 'outdated';
};

const SUPPORTED_RESOURCE_PROTOCOL = 1;

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z\d_-]/gu, '_').slice(0, 80);
}

function validManifest(value: unknown): value is RemoteSkillManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<RemoteSkillManifest>;
  return manifest.protocolVersion === SUPPORTED_RESOURCE_PROTOCOL && Array.isArray(manifest.skills) &&
    manifest.skills.every(skill =>
      skill && typeof skill === 'object' && typeof skill.id === 'string' && typeof skill.name === 'string' &&
      typeof skill.file === 'string' && typeof skill.sha256 === 'string' && Number.isFinite(skill.size) &&
      Number.isInteger(skill.version) && skill.loading === 'on-demand');
}

export class RemoteBuiltinSkillStore {
  private readonly errors = new Map<string, string>();
  private readonly loaded = new Map<string, AgentSkill>();
  private manifest?: RemoteSkillManifest;
  private readonly pending = new Map<string, Promise<AgentSkill>>();

  constructor(
    private readonly baseUrl: string,
    private readonly client: TavernFileClient,
    private readonly settingsStore: AgentSettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  async refreshManifest(): Promise<RemoteSkillManifest> {
    const url = new URL('manifest.json', this.baseUrl).href;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`内置Skill清单下载失败（HTTP ${response.status}）：${url}`);
    const value = await response.json() as unknown;
    if (!validManifest(value)) throw new Error(`内置Skill清单格式或协议版本不受支持：${url}`);
    const known = new Set(REMOTE_BUILTIN_SKILLS.map(skill => skill.id));
    this.manifest = {
      ...value,
      skills: value.skills.filter(skill => known.has(skill.id)),
    };
    return structuredClone(this.manifest);
  }

  manifestSnapshot(): RemoteSkillManifest | undefined {
    return this.manifest ? structuredClone(this.manifest) : undefined;
  }

  loadedSkills(): AgentSkill[] {
    return [...this.loaded.values()].map(skill => structuredClone(skill));
  }

  statuses(): RemoteBuiltinSkillStatus[] {
    const settings = this.settingsStore.load();
    const entries = this.manifest?.skills ?? REMOTE_BUILTIN_SKILLS.map(skill => ({
      ...skill,
      file: `${skill.id}.zip`,
      loading: 'on-demand' as const,
      sha256: '',
      size: 0,
      version: 0,
    }));
    return entries.map(entry => {
      const cached = settings.builtinSkillPackages[entry.id];
      const current = cached && (!entry.sha256 || cached.sha256 === entry.sha256);
      return {
        ...entry,
        cached: Boolean(cached),
        error: this.errors.get(entry.id),
        sourceUrl: new URL(entry.file, this.baseUrl).href,
        state: this.pending.has(entry.id)
          ? 'downloading'
          : this.errors.has(entry.id)
            ? 'error'
            : current && this.loaded.has(entry.id)
              ? 'available'
              : cached
                ? 'outdated'
                : 'missing',
      };
    });
  }

  async syncEnabled(enabledIds: Iterable<string>): Promise<void> {
    if (!this.manifest) await this.refreshManifest();
    const enabled = new Set(enabledIds);
    await Promise.allSettled((this.manifest?.skills ?? []).filter(skill => enabled.has(skill.id)).map(skill => this.ensure(skill.id)));
  }

  async ensure(id: string, force = false): Promise<AgentSkill> {
    if (!this.manifest) await this.refreshManifest();
    const descriptor = this.manifest?.skills.find(skill => skill.id === id);
    if (!descriptor) throw new Error(`远程内置Skill不存在：${id}`);
    if (!force && this.loaded.has(id)) return structuredClone(this.loaded.get(id)!);
    const existing = this.pending.get(id);
    if (existing) return structuredClone(await existing);
    const task = this.loadOrDownload(descriptor, force);
    this.pending.set(id, task);
    try {
      const skill = await task;
      this.loaded.set(id, skill);
      this.errors.delete(id);
      return structuredClone(skill);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errors.set(id, message);
      throw error;
    } finally {
      this.pending.delete(id);
    }
  }

  async remove(id: string): Promise<void> {
    const settings = this.settingsStore.load();
    const reference = settings.builtinSkillPackages[id];
    if (reference) await this.client.delete(reference.url);
    delete settings.builtinSkillPackages[id];
    await this.settingsStore.save(settings);
    this.loaded.delete(id);
    this.errors.delete(id);
  }

  async bytes(id: string): Promise<Uint8Array> {
    const reference = this.settingsStore.load().builtinSkillPackages[id];
    if (!reference) throw new Error(`内置Skill尚未下载：${id}`);
    return this.client.download(reference.url);
  }

  private async loadOrDownload(descriptor: RemoteSkillManifestEntry, force: boolean): Promise<AgentSkill> {
    const settings = this.settingsStore.load();
    const cached = settings.builtinSkillPackages[descriptor.id];
    if (!force && cached?.protocolVersion === SUPPORTED_RESOURCE_PROTOCOL) {
      try {
        const bytes = await this.client.download(cached.url);
        if (await sha256(bytes) === descriptor.sha256) return this.parse(descriptor, bytes);
      } catch {
        // 损坏或丢失的缓存直接重下；错误会由下载阶段给出完整URL。
      }
    }
    const sourceUrl = new URL(descriptor.file, this.baseUrl).href;
    let response: Response;
    try {
      response = await fetch(sourceUrl, { cache: 'no-store' });
    } catch (error) {
      // 新资源失败时，协议兼容的旧包仍可继续使用。
      if (cached?.protocolVersion === SUPPORTED_RESOURCE_PROTOCOL) {
        try {
          return this.parse(descriptor, await this.client.download(cached.url), true);
        } catch { /* 使用原始下载错误。 */ }
      }
      throw new Error(`内置Skill下载失败：${sourceUrl}。${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(`内置Skill下载失败（HTTP ${response.status}）：${sourceUrl}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== descriptor.size || await sha256(bytes) !== descriptor.sha256) {
      throw new Error(`内置Skill下载校验失败：${sourceUrl}`);
    }
    const skill = this.parse(descriptor, bytes);
    const name = `DreamCreator--Resource--BuiltinSkill--${safeId(descriptor.id)}--${descriptor.sha256.slice(0, 12)}.zip`;
    const url = await this.client.upload(name, bytes);
    const next = this.settingsStore.load();
    const previous = next.builtinSkillPackages[descriptor.id];
    const reference: BuiltinSkillPackageReference = {
      downloadedAt: this.now(),
      id: descriptor.id,
      protocolVersion: SUPPORTED_RESOURCE_PROTOCOL,
      sha256: descriptor.sha256,
      size: descriptor.size,
      sourceUrl,
      url,
      version: descriptor.version,
    };
    next.builtinSkillPackages[descriptor.id] = reference;
    await this.settingsStore.save(next);
    if (previous?.url && previous.url !== url) await this.client.delete(previous.url).catch(() => undefined);
    return skill;
  }

  private parse(descriptor: RemoteSkillManifestEntry, bytes: Uint8Array, allowOldHash = false): AgentSkill {
    const imported = importSkillZip(bytes, descriptor.file);
    if (!allowOldHash && (imported.name !== descriptor.name || imported.loading !== 'on-demand')) {
      throw new Error(`内置Skill包与清单不一致：${descriptor.id}`);
    }
    return {
      ...imported,
      builtin: true,
      description: allowOldHash ? imported.description : descriptor.description,
      id: descriptor.id,
      loading: 'on-demand',
      locked: true,
      name: allowOldHash ? imported.name : descriptor.name,
    };
  }
}
