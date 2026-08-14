import { klona } from 'klona';
import type { TavernBridge, TavernPersonaData, TavernPresetData } from '../tavern/bridge';
import { canonicalEqual } from '../transaction/canonical';
import { decodeWorkspaceSegment, encodeWorkspaceSegment, parseFrontmatter, parseYamlObject, serializeFrontmatter, serializeYaml, slugifyFileName } from '../mapping/serde';
import { diffRequestedWorkspaceFiles } from './file-diff';
import type { LiveWorkspaceApplyInput, LiveWorkspaceApplyResult, LiveWorkspaceSource } from './live-repository';
import { WorkspaceError, type WorkspaceChange, type WorkspaceFile } from './types';

type BinaryReader = (file: WorkspaceFile) => Promise<Uint8Array>;

export type TavernWorkspaceSourceOptions = {
  backupBinary?: (file: WorkspaceFile, toolCallId: string) => Promise<WorkspaceFile>;
  bridge: TavernBridge;
  mountedPresets: Set<string>;
  readBinary: BinaryReader;
};

type PresetPromptReference = {
  enabled: boolean;
  extra?: Record<string, unknown>;
  file: string;
  id: string;
  name: string;
  position?: PresetPrompt['position'];
  role: PresetPrompt['role'];
};

function file(input: Omit<WorkspaceFile, 'content' | 'mediaType'> & { content?: string; mediaType?: string }): WorkspaceFile {
  return {
    content: input.content ?? '',
    mediaType: input.mediaType ?? 'text/markdown',
    path: input.path,
    readonly: input.readonly,
    resourceId: input.resourceId,
    external: input.external,
    skillResource: input.skillResource,
    virtualBinary: input.virtualBinary,
  };
}

function personaPath(name: string): string {
  return `/users/${encodeWorkspaceSegment(name)}.md`;
}

function personaAvatarPath(name: string): string {
  return `/users/${encodeWorkspaceSegment(name)}.avatar.png`;
}

function projectPersona(persona: TavernPersonaData, avatarUrl: string | null): WorkspaceFile[] {
  const metadata = {
    avatar: personaAvatarPath(persona.name),
    avatar_id: persona.avatar_id,
    connections: persona.connections,
    depth: persona.depth,
    is_default: persona.is_default,
    lorebook: persona.lorebook,
    position: persona.position,
    role: persona.role,
    title: persona.title,
  };
  const result = [
    file({
      content: serializeFrontmatter(metadata, persona.description ?? ''),
      path: personaPath(persona.name),
      readonly: false,
      resourceId: `persona:${persona.avatar_id}`,
    }),
  ];
  if (avatarUrl) {
    result.push(file({
      content: `avatar:${persona.avatar_id}`,
      mediaType: 'image/png',
      path: personaAvatarPath(persona.name),
      readonly: true,
      resourceId: `persona-avatar:${persona.avatar_id}`,
      virtualBinary: { mediaType: 'image/png', source: 'persona-avatar', url: avatarUrl },
    }));
  }
  return result;
}

function promptFileName(prompt: PresetPrompt, index: number): string {
  return `${String(index + 1).padStart(3, '0')}-${slugifyFileName(prompt.name || prompt.id, 'prompt')}-${slugifyFileName(prompt.id, 'id')}.md`;
}

function promptReference(prompt: PresetPrompt, index: number, persistedFile?: string): PresetPromptReference {
  return {
    enabled: prompt.enabled,
    extra: prompt.extra ? klona(prompt.extra) : undefined,
    file: persistedFile || promptFileName(prompt, index),
    id: prompt.id,
    name: prompt.name,
    position: prompt.position ? klona(prompt.position) : undefined,
    role: prompt.role,
  };
}

function projectPreset(preset: TavernPresetData, root: string, readonly: boolean, loadedName?: string): WorkspaceFile[] {
  const cardAgent = preset.extensions?.card_agent;
  const fileMetadata = cardAgent && typeof cardAgent === 'object' && !Array.isArray(cardAgent)
    ? (cardAgent as Record<string, unknown>).dream_creator
    : undefined;
  const promptFiles = fileMetadata && typeof fileMetadata === 'object' && !Array.isArray(fileMetadata)
    ? (fileMetadata as Record<string, unknown>).prompt_files
    : undefined;
  const fileGroups = promptFiles && typeof promptFiles === 'object' && !Array.isArray(promptFiles)
    ? promptFiles as Record<string, unknown>
    : {};
  const activeFiles = fileGroups.prompts && typeof fileGroups.prompts === 'object' && !Array.isArray(fileGroups.prompts)
    ? fileGroups.prompts as Record<string, unknown>
    : {};
  const unusedFiles = fileGroups.unused && typeof fileGroups.unused === 'object' && !Array.isArray(fileGroups.unused)
    ? fileGroups.unused as Record<string, unknown>
    : {};
  const prompts = preset.prompts.map((prompt, index) => {
    const persisted = activeFiles[prompt.id];
    return promptReference(prompt, index, typeof persisted === 'string' ? persisted : undefined);
  });
  const unused = preset.prompts_unused.map((prompt, index) => {
    const persisted = unusedFiles[prompt.id];
    return promptReference(prompt, index, typeof persisted === 'string' ? persisted : undefined);
  });
  const result: WorkspaceFile[] = [file({
    content: serializeYaml({
      extensions: preset.extensions,
      ...(loadedName === undefined ? {} : { loaded_name: loadedName }),
      prompts,
      prompts_unused: unused,
      settings: preset.settings,
    }),
    mediaType: 'text/yaml',
    path: `${root}/index.yaml`,
    readonly,
    resourceId: `preset:${root}:index`,
  })];
  preset.prompts.forEach((prompt, index) => result.push(file({
    content: prompt.content ?? '',
    path: `${root}/prompts/${prompts[index].file}`,
    readonly,
    resourceId: `preset:${root}:prompt:${prompt.id}`,
  })));
  preset.prompts_unused.forEach((prompt, index) => result.push(file({
    content: prompt.content ?? '',
    path: `${root}/unused/${unused[index].file}`,
    readonly,
    resourceId: `preset:${root}:unused:${prompt.id}`,
  })));
  return result;
}

function requiredString(value: unknown, label: string, path: string): string {
  if (typeof value !== 'string') throw new WorkspaceError('INVALID_PATCH', `${label}必须是字符串：${path}`, path);
  return value;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function materializePersona(input: WorkspaceFile, previous?: TavernPersonaData): TavernPersonaData {
  const { body, metadata } = parseFrontmatter(input.content, input.path);
  const name = decodeWorkspaceSegment(input.path.slice('/users/'.length, -'.md'.length));
  if (!name || name === 'current') throw new WorkspaceError('INVALID_PATH', `User名称无效：${input.path}`, input.path);
  if (metadata.avatar_id !== undefined && previous && metadata.avatar_id !== previous.avatar_id) {
    throw new WorkspaceError('READ_ONLY_PATH', `avatar_id是只读字段，请使用set_avatar修改头像：${input.path}`, input.path);
  }
  if (
    metadata.avatar !== undefined &&
    metadata.avatar !== personaAvatarPath(name) &&
    (!previous || metadata.avatar !== personaAvatarPath(previous.name))
  ) {
    throw new WorkspaceError('READ_ONLY_PATH', `avatar是只读虚拟引用，请使用set_avatar修改头像：${input.path}`, input.path);
  }
  const connections = Array.isArray(metadata.connections)
    ? metadata.connections.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const value = item as Record<string, unknown>;
        return (value.type === 'character' || value.type === 'group') && typeof value.id === 'string'
          ? [{ id: value.id, type: value.type as 'character' | 'group' }]
          : [];
      })
    : (previous?.connections ?? []);
  return {
    avatar: previous?.avatar ?? `${crypto.randomUUID()}.png`,
    avatar_id: previous?.avatar_id ?? crypto.randomUUID(),
    connections,
    depth: numberOr(metadata.depth, previous?.depth ?? 2),
    description: body,
    is_default: booleanOr(metadata.is_default, previous?.is_default ?? false),
    lorebook: typeof metadata.lorebook === 'string' ? metadata.lorebook : (previous?.lorebook ?? ''),
    name,
    position: numberOr(metadata.position, previous?.position ?? 0),
    role: numberOr(metadata.role, previous?.role ?? 0),
    title: typeof metadata.title === 'string' ? metadata.title : (previous?.title ?? name),
  };
}

function promptFromReference(
  raw: unknown,
  root: string,
  folder: 'prompts' | 'unused',
  files: Map<string, WorkspaceFile>,
  path: string,
): PresetPrompt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkspaceError('INVALID_PATCH', `提示词索引项必须是对象：${path}`, path);
  }
  const value = raw as Record<string, unknown>;
  const filename = requiredString(value.file, 'file', path);
  const content = files.get(`${root}/${folder}/${filename}`)?.content ?? '';
  const role = value.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant') {
    throw new WorkspaceError('INVALID_PATCH', `role必须是system、user或assistant：${path}`, path);
  }
  const result: PresetPrompt = {
    content,
    enabled: booleanOr(value.enabled, true),
    id: requiredString(value.id, 'id', path),
    name: requiredString(value.name, 'name', path),
    role,
  };
  if (value.position && typeof value.position === 'object' && !Array.isArray(value.position)) {
    result.position = klona(value.position as PresetPrompt['position']);
  }
  if (value.extra && typeof value.extra === 'object' && !Array.isArray(value.extra)) {
    result.extra = klona(value.extra as Record<string, unknown>);
  }
  return result;
}

function materializePreset(files: WorkspaceFile[], previous: TavernPresetData): TavernPresetData {
  const root = '/presets/current';
  const map = new Map(files.map(item => [item.path, item]));
  const indexPath = `${root}/index.yaml`;
  const index = map.get(indexPath);
  if (!index) throw new WorkspaceError('INVALID_PATCH', `当前预设必须保留${indexPath}`, indexPath);
  const metadata = parseYamlObject(index.content, indexPath);
  if (!Array.isArray(metadata.prompts) || !Array.isArray(metadata.prompts_unused)) {
    throw new WorkspaceError('INVALID_PATCH', 'index.yaml中的prompts和prompts_unused必须是数组。', indexPath);
  }
  if (!metadata.settings || typeof metadata.settings !== 'object' || Array.isArray(metadata.settings)) {
    throw new WorkspaceError('INVALID_PATCH', 'index.yaml中的settings必须是对象。', indexPath);
  }
  const extensions = metadata.extensions && typeof metadata.extensions === 'object' && !Array.isArray(metadata.extensions)
    ? klona(metadata.extensions as TavernPresetData['extensions'])
    : klona(previous.extensions);
  const activeReferences = metadata.prompts as Array<Record<string, unknown>>;
  const unusedReferences = metadata.prompts_unused as Array<Record<string, unknown>>;
  const cardAgent = extensions.card_agent && typeof extensions.card_agent === 'object' && !Array.isArray(extensions.card_agent)
    ? klona(extensions.card_agent as Record<string, unknown>)
    : {};
  const dreamCreator = cardAgent.dream_creator && typeof cardAgent.dream_creator === 'object' && !Array.isArray(cardAgent.dream_creator)
    ? klona(cardAgent.dream_creator as Record<string, unknown>)
    : {};
  dreamCreator.prompt_files = {
    prompts: Object.fromEntries(activeReferences.map(reference => [requiredString(reference.id, 'id', indexPath), requiredString(reference.file, 'file', indexPath)])),
    unused: Object.fromEntries(unusedReferences.map(reference => [requiredString(reference.id, 'id', indexPath), requiredString(reference.file, 'file', indexPath)])),
  };
  cardAgent.dream_creator = dreamCreator;
  extensions.card_agent = cardAgent;
  return {
    extensions,
    prompts: activeReferences.map(item => promptFromReference(item, root, 'prompts', map, indexPath)),
    prompts_unused: unusedReferences.map(item => promptFromReference(item, root, 'unused', map, indexPath)),
    settings: klona(metadata.settings as TavernPresetData['settings']),
  };
}

function isAvatarPath(path: string): boolean {
  return path === '/character/avatar.png' || /^\/users\/[^/]+\.avatar\.png$/u.test(path);
}

function requestedCurrentPresetFileDelete(change: WorkspaceChange, before: WorkspaceFile[]): boolean {
  if (change.kind !== 'delete' || !/^\/presets\/current\/(?:prompts|unused)\/[^/]+\.md$/u.test(change.path)) return false;
  const index = before.find(item => item.path === '/presets/current/index.yaml');
  if (!index) return false;
  const metadata = parseYamlObject(index.content, index.path);
  const filename = change.path.split('/').at(-1);
  return [...(Array.isArray(metadata.prompts) ? metadata.prompts : []), ...(Array.isArray(metadata.prompts_unused) ? metadata.prompts_unused : [])]
    .some(item => item && typeof item === 'object' && (item as { file?: unknown }).file === filename);
}

/** 酒馆原生User、当前/挂载预设与头像的实时VFS投影。 */
export class TavernWorkspaceLiveSource implements LiveWorkspaceSource {
  constructor(private readonly options: TavernWorkspaceSourceOptions) {}

  async load(): Promise<WorkspaceFile[]> {
    const bridge = this.options.bridge;
    const result: WorkspaceFile[] = [];
    for (const name of bridge.getPersonaNames()) {
      const persona = bridge.getPersona(name);
      result.push(...projectPersona(persona, bridge.getPersonaAvatarPath(name)));
    }
    const currentCharacter = bridge.getCurrentCharacterId();
    const characterAvatar = bridge.getCharacterAvatarPath();
    if (currentCharacter && characterAvatar) {
      result.push(file({
        content: `avatar:${currentCharacter}`,
        mediaType: 'image/png',
        path: '/character/avatar.png',
        readonly: true,
        resourceId: `character-avatar:${currentCharacter}`,
        virtualBinary: { mediaType: 'image/png', source: 'character-avatar', url: characterAvatar },
      }));
    }
    const loaded = bridge.getLoadedPresetName();
    if (loaded) {
      result.push(...projectPreset(bridge.getPreset('in_use'), '/presets/current', false, loaded));
      for (const name of [...this.options.mountedPresets].sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
        if (!bridge.getPresetNames().includes(name)) continue;
        result.push(...projectPreset(bridge.getPreset(name), `/presets/library/${encodeWorkspaceSegment(name)}`, true));
      }
    }
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }

  async apply(input: LiveWorkspaceApplyInput): Promise<LiveWorkspaceApplyResult> {
    const before = await this.load();
    if (input.changes.some(change => requestedCurrentPresetFileDelete(change, before))) {
      throw new WorkspaceError(
        'READ_ONLY_PATH',
        '提示词文件仍被/presets/current/index.yaml引用；请从索引移除引用，梦境创客会自动删除对应文件。',
        input.changes.find(change => requestedCurrentPresetFileDelete(change, before))?.path,
      );
    }
    const actual: WorkspaceChange[] = [];
    try {
      const avatarChanges = input.changes.filter(change => isAvatarPath(change.path));
      for (const change of avatarChanges) {
        if (change.kind !== 'modify') throw new WorkspaceError('READ_ONLY_PATH', '头像只能通过set_avatar替换。', change.path);
        const recoverableBefore = this.options.backupBinary
          ? await this.options.backupBinary(change.before, input.toolCallId)
          : change.before;
        const bytes = await this.options.readBinary(change.after);
        if (change.path === '/character/avatar.png') {
          await this.options.bridge.setCharacterAvatar(bytes, change.after.mediaType);
        } else {
          const name = decodeWorkspaceSegment(change.path.slice('/users/'.length, -'.avatar.png'.length));
          await this.options.bridge.setPersonaAvatar(name, bytes, change.after.mediaType);
        }
        actual.push({
          after: { ...klona(change.after), content: change.before.content },
          before: recoverableBefore,
          kind: 'modify',
          path: change.path,
        });
      }

      const personaChanges = input.changes.filter(change => /^\/users\/[^/]+\.md$/u.test(change.path));
      for (const change of personaChanges) {
        if (change.kind === 'create') {
          const persona = materializePersona(change.after);
          const { avatar: _avatar, avatar_id: _avatarId, ...newPersona } = persona;
          await this.options.bridge.createPersona(persona.name, newPersona);
        } else if (change.kind === 'delete') {
          const name = decodeWorkspaceSegment(change.path.slice('/users/'.length, -'.md'.length));
          await this.options.bridge.deletePersona(name);
        } else if (change.kind === 'move') {
          const oldName = decodeWorkspaceSegment(change.from.slice('/users/'.length, -'.md'.length));
          const previous = this.options.bridge.getPersona(oldName);
          const next = materializePersona(change.after, previous);
          await this.options.bridge.replacePersona(oldName, next);
        } else {
          const name = decodeWorkspaceSegment(change.path.slice('/users/'.length, -'.md'.length));
          const previous = this.options.bridge.getPersona(name);
          await this.options.bridge.replacePersona(name, materializePersona(change.after, previous));
        }
      }

      const presetChanges = input.changes.filter(change => change.path.startsWith('/presets/current/'));
      if (presetChanges.length > 0) {
        const desired = new Map(before.filter(item => item.path.startsWith('/presets/current/')).map(item => [item.path, klona(item)]));
        for (const change of presetChanges) {
          if (change.kind === 'delete') desired.delete(change.path);
          else if (change.kind === 'move') {
            desired.delete(change.from);
            desired.set(change.path, klona(change.after));
          } else desired.set(change.path, klona(change.after));
        }
        const previous = this.options.bridge.getPreset('in_use');
        const candidate = materializePreset([...desired.values()], previous);
        if (!canonicalEqual(candidate, previous)) await this.options.bridge.replacePreset('in_use', candidate);
      }
    } catch (error) {
      const afterFailure = await this.load();
      const changes = [...actual, ...diffRequestedWorkspaceFiles(input.changes, before, afterFailure)];
      if (changes.length === 0) throw error;
      return {
        changes,
        files: afterFailure,
        status: 'partial_success',
        warning: `部分酒馆资源已写入；后续操作失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const after = await this.load();
    const changed = diffRequestedWorkspaceFiles(input.changes, before, after);
    return { changes: [...actual.filter(change => !changed.some(item => item.path === change.path)), ...changed], files: after, status: 'success' };
  }
}
