import { canonicalEqual, sha256 } from '../transaction/canonical';
import { normalizeWorkspacePath } from '../workspace/path';
import type { WorkspaceFile } from '../workspace/types';
import type { TavernFileClient } from './file-client';
import type {
  AgentSettingsStore,
  DreamCreatorWorkspaceFileReference,
} from './settings';

export const MAX_DREAMCREATOR_FILE_BYTES = 20 * 1024 * 1024;
export const DREAMCREATOR_ORPHAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const GLOBAL_WORKSPACE_BINDING_ID = 'global';

export type ManagedFileSummary = DreamCreatorWorkspaceFileReference & {
  characterName: string;
};

export type CharacterFileStorageSummary = {
  attachmentBytes: number;
  bindingId: string;
  cacheBytes: number;
  characterName: string;
  files: ManagedFileSummary[];
  orphanBytes: number;
  persistentBytes: number;
  projectBytes: number;
  totalBytes: number;
};

function safe(value: string, limit = 80): string {
  return value.replace(/[^a-zA-Z\d_-]/gu, '_').slice(0, limit) || 'unknown';
}

function normalizedRelativePath(value: string): string {
  const normalized = normalizeWorkspacePath(`/${value.replace(/^\/+/, '')}`);
  if (normalized === '/') throw new Error('文件路径不能为空。');
  return normalized.slice(1);
}

function bytesForBase64(value: string): Uint8Array {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

export function base64ForBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/') || /(?:json|javascript|typescript|yaml|xml)$/iu.test(mediaType);
}

function rootFor(
  scope: DreamCreatorWorkspaceFileReference['scope'],
): '/character/files' | '/character/temp' | '/files' | '/temp' {
  if (scope === 'character-persistent') return '/character/files';
  if (scope === 'character-temp') return '/character/temp';
  return scope === 'global-persistent' ? '/files' : '/temp';
}

function workspacePath(file: DreamCreatorWorkspaceFileReference): string {
  return `${rootFor(file.scope)}/${file.logicalPath}`;
}

function logicalPathFromWorkspace(path: string): {
  logicalPath: string;
  scope: DreamCreatorWorkspaceFileReference['scope'];
} {
  const normalized = normalizeWorkspacePath(path);
  if (normalized.startsWith('/files/')) {
    return { logicalPath: normalizedRelativePath(normalized.slice('/files/'.length)), scope: 'global-persistent' };
  }
  if (normalized.startsWith('/temp/')) {
    return { logicalPath: normalizedRelativePath(normalized.slice('/temp/'.length)), scope: 'global-temp' };
  }
  if (normalized.startsWith('/character/files/')) {
    return {
      logicalPath: normalizedRelativePath(normalized.slice('/character/files/'.length)),
      scope: 'character-persistent',
    };
  }
  if (normalized.startsWith('/character/temp/')) {
    return {
      logicalPath: normalizedRelativePath(normalized.slice('/character/temp/'.length)),
      scope: 'character-temp',
    };
  }
  throw new Error(`不是梦境创客存储路径：${path}`);
}

function cloneReference(value: DreamCreatorWorkspaceFileReference): DreamCreatorWorkspaceFileReference {
  return structuredClone(value);
}

export class DreamCreatorWorkspaceFileStore {
  private readonly memory = new Map<string, Uint8Array>();

  constructor(
    private readonly client: TavernFileClient,
    private readonly settingsStore: AgentSettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  listReferences(bindingId?: string): DreamCreatorWorkspaceFileReference[] {
    return Object.values(this.settingsStore.load().workspaceFiles)
      .filter(file => !bindingId || file.bindingId === bindingId)
      .map(cloneReference)
      .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath, 'zh-CN'));
  }

  getReference(fileId: string): DreamCreatorWorkspaceFileReference | undefined {
    const value = this.settingsStore.load().workspaceFiles[fileId];
    return value ? cloneReference(value) : undefined;
  }

  async read(fileId: string): Promise<Uint8Array> {
    const cached = this.memory.get(fileId);
    if (cached) return Uint8Array.from(cached);
    const reference = this.getReference(fileId);
    if (!reference) throw new Error(`文件已被清理：${fileId}`);
    const bytes = await this.client.download(reference.url);
    if ((await sha256(bytes)) !== reference.sha256) throw new Error(`文件校验失败：${reference.name}`);
    this.memory.set(fileId, Uint8Array.from(bytes));
    return bytes;
  }

  async project(bindingId: string, sessionId: string): Promise<WorkspaceFile[]> {
    await this.collectExpiredOrphans(bindingId);
    if (bindingId !== GLOBAL_WORKSPACE_BINDING_ID) await this.collectExpiredOrphans(GLOBAL_WORKSPACE_BINDING_ID);
    const loadReferences = () =>
      this.listReferences().filter(file => file.bindingId === bindingId || file.bindingId === GLOBAL_WORKSPACE_BINDING_ID);
    let references = loadReferences().filter(
      file =>
        !file.orphanedAt &&
        !file.logicalPath.startsWith('_recovery/') &&
        !file.logicalPath.startsWith('_staging/') &&
        (file.scope === 'global-persistent' ||
          file.scope === 'character-persistent' ||
          ((file.scope === 'global-temp' || file.scope === 'character-temp') && file.sessionId === sessionId)),
    );
    if (
      references.some(
        file =>
          (file.scope === 'global-persistent' || file.scope === 'character-persistent') &&
          !file.referencedSessionIds.includes(sessionId),
      )
    ) {
      const settings = this.settingsStore.load();
      for (const file of references) {
        const stored = settings.workspaceFiles[file.fileId];
        if (
          !stored ||
          (stored.scope !== 'global-persistent' && stored.scope !== 'character-persistent') ||
          stored.referencedSessionIds.includes(sessionId)
        )
          continue;
        stored.referencedSessionIds.push(sessionId);
        stored.updatedAt = this.now();
      }
      await this.settingsStore.save(settings);
      references = loadReferences().filter(
        file =>
          !file.orphanedAt &&
          !file.logicalPath.startsWith('_recovery/') &&
          !file.logicalPath.startsWith('_staging/') &&
          (file.scope === 'global-persistent' ||
            file.scope === 'character-persistent' ||
            ((file.scope === 'global-temp' || file.scope === 'character-temp') && file.sessionId === sessionId)),
      );
    }
    return Promise.all(
      references.map(async file => ({
        content: isTextMediaType(file.mediaType) ? new TextDecoder().decode(await this.read(file.fileId)) : '',
        external: {
          fileId: file.fileId,
          mediaType: file.mediaType,
          scope: file.scope,
          sha256: file.sha256,
          size: file.size,
        },
        mediaType: file.mediaType,
        path: workspacePath(file),
        readonly: false,
        resourceId: file.fileId,
      })),
    );
  }

  async putPersistent(input: {
    bindingId: string;
    bytes?: Uint8Array;
    data?: string;
    logicalPath: string;
    mediaType: string;
    referencedSessionId?: string;
    overwrite?: boolean;
    global?: boolean;
  }): Promise<DreamCreatorWorkspaceFileReference> {
    return this.put({ ...input, scope: input.global ? 'global-persistent' : 'character-persistent' });
  }

  async putTemp(input: {
    bindingId: string;
    bytes: Uint8Array;
    logicalPath: string;
    mediaType: string;
    sessionId: string;
    sourceFileId?: string;
    global?: boolean;
  }): Promise<DreamCreatorWorkspaceFileReference> {
    return this.put({
      ...input,
      overwrite: true,
      referencedSessionId: input.sessionId,
      scope: input.global ? 'global-temp' : 'character-temp',
    });
  }

  async addSessionReference(fileId: string, sessionId: string): Promise<void> {
    const settings = this.settingsStore.load();
    const file = settings.workspaceFiles[fileId];
    if (!file) throw new Error(`附件已被清理：${fileId}`);
    file.referencedSessionIds = [...new Set([...file.referencedSessionIds, sessionId])];
    file.orphanedAt = undefined;
    file.updatedAt = this.now();
    await this.settingsStore.save(settings);
  }

  async applyWorkspace(
    bindingId: string,
    sessionId: string,
    baseFiles: WorkspaceFile[],
    workingFiles: WorkspaceFile[],
    decisions: Record<string, 'agent' | 'current'>,
  ): Promise<WorkspaceFile[]> {
    const settingsBefore = this.settingsStore.load();
    const urlsBefore = new Set(Object.values(settingsBefore.workspaceFiles).map(file => file.url));
    const storagePath = (path: string) => /^\/(?:files|temp)(?:\/|$)|^\/character\/(?:files|temp)(?:\/|$)/u.test(path);
    const base = new Map(baseFiles.filter(file => storagePath(file.path)).map(file => [file.path, file]));
    const working = new Map(
      workingFiles.filter(file => storagePath(file.path)).map(file => [file.path, file]),
    );
    const currentFiles = await this.project(bindingId, sessionId);
    const current = new Map(currentFiles.map(file => [file.path, file]));
    const paths = new Set([...base.keys(), ...working.keys()]);
    try {
      for (const path of paths) {
        const before = base.get(path);
        const after = working.get(path);
        if (canonicalEqual(before, after)) continue;
        const { logicalPath, scope } = logicalPathFromWorkspace(path);
        const choice = scope.endsWith('-temp') ? 'agent' : decisions[path];
        if (choice !== 'agent') continue;
        const nowValue = current.get(path);
        if (!canonicalEqual(nowValue, before) && !canonicalEqual(nowValue, after)) {
          throw new Error(`FILE_CONFLICT：${path} 已被其他会话修改，请重新读取后再提交。`);
        }
        if (!after) {
          if (nowValue?.external?.fileId) await this.orphan(nowValue.external.fileId);
          continue;
        }
        if (
          before &&
          after.external &&
          before.external?.fileId === after.external.fileId &&
          after.content === before.content
        ) {
          await this.activateExisting(after.external.fileId, logicalPath, sessionId, scope);
          continue;
        }
        const bytes = isTextMediaType(after.mediaType)
          ? new TextEncoder().encode(after.content)
          : await this.bytesForWorkspaceFile(after);
        await this.put({
          bindingId: scope.startsWith('global-') ? GLOBAL_WORKSPACE_BINDING_ID : bindingId,
          bytes,
          logicalPath,
          mediaType: after.mediaType || 'text/plain',
          overwrite: true,
          referencedSessionId: sessionId,
          scope,
          sessionId: scope.endsWith('-temp') ? sessionId : undefined,
        });
      }
    } catch (error) {
      let rollbackError: unknown;
      try {
        const afterFailure = this.settingsStore.load();
        const uploadedUrls = [...new Set(Object.values(afterFailure.workspaceFiles).map(file => file.url))].filter(
          url => !urlsBefore.has(url),
        );
        afterFailure.workspaceFiles = structuredClone(settingsBefore.workspaceFiles);
        await this.settingsStore.save(afterFailure);
        this.memory.clear();
        for (const url of uploadedUrls) await this.client.delete(url).catch(() => undefined);
      } catch (rollback) {
        rollbackError = rollback;
      }
      if (rollbackError) {
        const message = error instanceof Error ? error.message : String(error);
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(`${message}；文件事务回滚失败：${rollbackMessage}`, { cause: error });
      }
      throw error;
    }
    return this.project(bindingId, sessionId);
  }

  async releaseSession(bindingId: string, sessionId: string): Promise<void> {
    const settings = this.settingsStore.load();
    const tempIds: string[] = [];
    for (const file of Object.values(settings.workspaceFiles)) {
      if (file.bindingId !== bindingId) continue;
      if (file.scope.endsWith('-temp') && file.sessionId === sessionId) tempIds.push(file.fileId);
      if (file.scope.endsWith('-persistent') && file.referencedSessionIds.includes(sessionId)) {
        file.referencedSessionIds = file.referencedSessionIds.filter(id => id !== sessionId);
        if (file.referencedSessionIds.length === 0) file.orphanedAt ??= this.now();
      }
    }
    await this.settingsStore.save(settings);
    for (const id of tempIds) await this.removeImmediately(id);
  }

  async clearCache(bindingId?: string): Promise<number> {
    const targets = this.listReferences(bindingId).filter(
      file => file.scope.endsWith('-temp') || (file.orphanedAt !== undefined && this.now() - file.orphanedAt >= 0),
    );
    for (const file of targets) await this.removeImmediately(file.fileId);
    return targets.length;
  }

  async clearAttachments(bindingId?: string): Promise<number> {
    const targets = this.listReferences(bindingId).filter(file => file.scope.endsWith('-persistent'));
    for (const file of targets) await this.removeImmediately(file.fileId);
    await this.clearCache(bindingId);
    return targets.length;
  }

  async resetCharacter(bindingId: string): Promise<number> {
    const targets = this.listReferences(bindingId);
    for (const file of targets) await this.removeImmediately(file.fileId);
    return targets.length;
  }

  async removeImmediately(fileId: string): Promise<void> {
    const settings = this.settingsStore.load();
    const file = settings.workspaceFiles[fileId];
    if (!file) return;
    delete settings.workspaceFiles[fileId];
    await this.settingsStore.save(settings);
    this.memory.delete(fileId);
    const shared = Object.values(settings.workspaceFiles).some(item => item.url === file.url);
    if (!shared) await this.client.delete(file.url).catch(() => undefined);
  }

  summaries(): CharacterFileStorageSummary[] {
    const settings = this.settingsStore.load();
    const names = new Map(
      Object.values(settings.characterStores).map(character => [character.bindingId, character.characterName]),
    );
    const groups = new Map<string, DreamCreatorWorkspaceFileReference[]>();
    for (const file of Object.values(settings.workspaceFiles)) {
      const group = groups.get(file.bindingId) ?? [];
      group.push(cloneReference(file));
      groups.set(file.bindingId, group);
    }
    return [...new Set([...names.keys(), ...groups.keys()])]
      .map(bindingId => {
        const files = groups.get(bindingId) ?? [];
        const characterName = names.get(bindingId) ?? '未知角色';
        const managed = files.map(file => ({ ...file, characterName }));
        const cacheBytes = files.filter(file => file.scope.endsWith('-temp')).reduce((total, file) => total + file.size, 0);
        const orphanBytes = files.filter(file => file.orphanedAt !== undefined).reduce((total, file) => total + file.size, 0);
        const persistentBytes = files
          .filter(file => file.scope.endsWith('-persistent') && file.orphanedAt === undefined)
          .reduce((total, file) => total + file.size, 0);
        const projectBytes = files
          .filter(file => file.logicalPath.endsWith('/project.yaml') && file.orphanedAt === undefined)
          .reduce((total, file) => total + file.size, 0);
        return {
          attachmentBytes: persistentBytes,
          bindingId,
          cacheBytes,
          characterName,
          files: managed.sort((left, right) => right.updatedAt - left.updatedAt),
          orphanBytes,
          persistentBytes,
          projectBytes,
          totalBytes: files.reduce((total, file) => total + file.size, 0),
        };
      })
      .sort((left, right) => left.characterName.localeCompare(right.characterName, 'zh-CN'));
  }

  private async put(input: {
    bindingId: string;
    bytes?: Uint8Array;
    data?: string;
    logicalPath: string;
    mediaType: string;
    overwrite?: boolean;
    referencedSessionId?: string;
    scope: DreamCreatorWorkspaceFileReference['scope'];
    sessionId?: string;
    sourceFileId?: string;
  }): Promise<DreamCreatorWorkspaceFileReference> {
    const bytes = input.bytes ?? (input.data === undefined ? undefined : bytesForBase64(input.data));
    if (!bytes) throw new Error('缺少文件内容。');
    if (bytes.byteLength > MAX_DREAMCREATOR_FILE_BYTES) throw new Error('单个文件不能超过20MB。');
    if (bytes.byteLength === 0) throw new Error('不能上传空文件。');
    const logicalPath = normalizedRelativePath(input.logicalPath);
    const settings = this.settingsStore.load();
    const active = Object.values(settings.workspaceFiles).filter(
      file =>
        file.bindingId === input.bindingId &&
        file.scope === input.scope &&
        file.sessionId === input.sessionId &&
        file.orphanedAt === undefined,
    );
    const hash = await sha256(bytes);
    let targetPath = logicalPath;
    const occupied = active.find(file => file.logicalPath === targetPath);
    if (occupied && occupied.sha256 === hash) {
      if (input.referencedSessionId) {
        occupied.referencedSessionIds = [...new Set([...occupied.referencedSessionIds, input.referencedSessionId])];
        occupied.updatedAt = this.now();
        settings.workspaceFiles[occupied.fileId] = occupied;
        await this.settingsStore.save(settings);
      }
      return cloneReference(occupied);
    }
    if (occupied && !input.overwrite) targetPath = this.uniquePath(logicalPath, active);
    if (occupied && input.overwrite) {
      occupied.orphanedAt = this.now();
      occupied.updatedAt = this.now();
    }
    const identical = active.find(file => file.sha256 === hash && file.size === bytes.byteLength);
    const fileId = crypto.randomUUID();
    const at = this.now();
    const name = targetPath.split('/').at(-1) ?? 'file';
    const physicalName = `DreamCreator--${input.scope.endsWith('-persistent') ? 'File' : 'Temp'}--${safe(
      input.scope.endsWith('-temp') ? input.sessionId ?? 'session' : input.bindingId,
    )}--${safe(fileId)}.bin`;
    let uploadedUrl: string | undefined;
    const url = identical?.url ?? (uploadedUrl = await this.client.upload(physicalName, bytes));
    const reference: DreamCreatorWorkspaceFileReference = {
      bindingId: input.bindingId,
      createdAt: at,
      fileId,
      logicalPath: targetPath,
      mediaType: input.mediaType || 'application/octet-stream',
      name,
      referencedSessionIds: input.referencedSessionId ? [input.referencedSessionId] : [],
      scope: input.scope,
      sessionId: input.sessionId,
      sha256: hash,
      size: bytes.byteLength,
      sourceFileId: input.sourceFileId,
      updatedAt: at,
      url,
    };
    settings.workspaceFiles[fileId] = reference;
    try {
      await this.settingsStore.save(settings);
    } catch (error) {
      if (uploadedUrl) await this.client.delete(uploadedUrl).catch(() => undefined);
      throw error;
    }
    this.memory.set(fileId, Uint8Array.from(bytes));
    return cloneReference(reference);
  }

  private async bytesForWorkspaceFile(file: WorkspaceFile): Promise<Uint8Array> {
    if (file.external?.fileId) return this.read(file.external.fileId);
    if (file.skillResource) throw new Error(`Skill二进制资源不能直接复制到文件存储：${file.path}`);
    const remoteUrl = file.virtualBinary?.url;
    if (remoteUrl) {
      const response = await fetch(remoteUrl, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`读取待复制文件失败（HTTP ${response.status}）：${file.path}`);
      return new Uint8Array(await response.arrayBuffer());
    }
    return new TextEncoder().encode(file.content);
  }

  private uniquePath(path: string, entries: DreamCreatorWorkspaceFileReference[]): string {
    const slash = path.lastIndexOf('/');
    const folder = slash >= 0 ? path.slice(0, slash + 1) : '';
    const filename = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const suffix = dot > 0 ? filename.slice(dot) : '';
    for (let index = 2; ; index += 1) {
      const candidate = `${folder}${stem} (${index})${suffix}`;
      if (!entries.some(file => file.logicalPath === candidate)) return candidate;
    }
  }

  private async orphan(fileId: string): Promise<void> {
    const settings = this.settingsStore.load();
    const file = settings.workspaceFiles[fileId];
    if (!file) return;
    file.orphanedAt ??= this.now();
    file.updatedAt = this.now();
    await this.settingsStore.save(settings);
  }

  private async activateExisting(
    fileId: string,
    logicalPath: string,
    sessionId: string,
    scope: DreamCreatorWorkspaceFileReference['scope'],
  ): Promise<void> {
    const settings = this.settingsStore.load();
    const file = settings.workspaceFiles[fileId];
    if (!file) throw new Error(`历史文件已经被清理：${fileId}`);
    for (const other of Object.values(settings.workspaceFiles)) {
      if (
        other.fileId !== fileId &&
        other.bindingId === file.bindingId &&
        other.scope === scope &&
        other.logicalPath === logicalPath &&
        other.orphanedAt === undefined
      ) {
        other.orphanedAt = this.now();
      }
    }
    file.logicalPath = logicalPath;
    file.scope = scope;
    file.sessionId = scope.endsWith('-temp') ? sessionId : undefined;
    file.orphanedAt = undefined;
    file.referencedSessionIds = [...new Set([...file.referencedSessionIds, sessionId])];
    file.updatedAt = this.now();
    await this.settingsStore.save(settings);
  }

  private async collectExpiredOrphans(bindingId?: string): Promise<void> {
    const expired = this.listReferences(bindingId).filter(
      file => file.orphanedAt !== undefined && this.now() - file.orphanedAt >= DREAMCREATOR_ORPHAN_RETENTION_MS,
    );
    for (const file of expired) await this.removeImmediately(file.fileId);
  }
}
