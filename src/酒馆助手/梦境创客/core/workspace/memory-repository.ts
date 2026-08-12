import { klona } from 'klona';
import { decodeWorkspaceSegment, parseYamlObject, serializeYaml } from '../mapping/serde';
import { applyUnifiedPatch } from './unified-patch';
import { isSameOrDescendant, normalizeWorkspacePath, parentWorkspacePath } from './path';
import { searchWorkspaceFiles } from './search';
import {
  WorkspaceError,
  type SearchQuery,
  type SearchResult,
  type WorkspaceChange,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceRepository,
} from './types';

type MemoryWorkspaceOptions = {
  completedToolCallIds?: string[];
  currentFiles?: WorkspaceFile[];
  files?: WorkspaceFile[];
  readonlyRoots?: string[];
};

function inferMediaType(path: string): WorkspaceFile['mediaType'] {
  if (/\.ya?ml$/iu.test(path)) {
    return 'text/yaml';
  }
  if (/\.md$/iu.test(path)) {
    return 'text/markdown';
  }
  return 'text/plain';
}

function cloneFile(file: WorkspaceFile): WorkspaceFile {
  return klona(file);
}

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly base = new Map<string, WorkspaceFile>();
  private readonly current = new Map<string, WorkspaceFile>();
  private readonly completedToolCalls = new Set<string>();
  private readonly movedFrom = new Map<string, string>();
  private readonly readonlyRoots: string[];

  constructor(options: MemoryWorkspaceOptions = {}) {
    this.readonlyRoots = (options.readonlyRoots ?? []).map(normalizeWorkspacePath);
    options.completedToolCallIds?.forEach(id => this.completedToolCalls.add(id));
    for (const input of options.files ?? []) {
      const path = normalizeWorkspacePath(input.path);
      const file = { ...cloneFile(input), path };
      this.base.set(path, file);
      this.current.set(path, cloneFile(file));
    }
    if (options.currentFiles) {
      this.current.clear();
      for (const input of options.currentFiles) {
        const path = normalizeWorkspacePath(input.path);
        this.current.set(path, { ...cloneFile(input), path });
      }
    }
  }

  async list(inputPath: string): Promise<WorkspaceEntry[]> {
    const path = normalizeWorkspacePath(inputPath);
    const children = new Map<string, WorkspaceEntry>();
    for (const file of this.current.values()) {
      if (!isSameOrDescendant(file.path, path) || file.path === path) {
        continue;
      }
      const relative = path === '/' ? file.path.slice(1) : file.path.slice(path.length + 1);
      const [name, ...rest] = relative.split('/');
      const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
      const existing = children.get(childPath);
      if (rest.length > 0) {
        children.set(childPath, {
          kind: 'directory',
          name,
          path: childPath,
          readonly: existing?.readonly ?? this.isReadonly(childPath),
        });
      } else if (!existing) {
        children.set(childPath, {
          kind: 'file',
          name,
          path: childPath,
          readonly: file.readonly || this.isReadonly(childPath),
          size: file.external?.size ?? file.skillResource?.size ?? new TextEncoder().encode(file.content).byteLength,
        });
      }
    }
    for (const directory of this.virtualDirectories()) {
      if (parentWorkspacePath(directory.path) !== path || children.has(directory.path)) continue;
      children.set(directory.path, directory);
    }
    if (path !== '/' && children.size === 0 && !this.hasDirectory(path)) {
      throw new WorkspaceError('NOT_FOUND', `目录不存在：${path}`, path);
    }
    return [...children.values()].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }

  async read(inputPath: string): Promise<WorkspaceFile> {
    const path = normalizeWorkspacePath(inputPath);
    const file = this.current.get(path);
    if (!file) {
      throw new WorkspaceError('NOT_FOUND', `文件不存在：${path}`, path);
    }
    return cloneFile(file);
  }

  async write(inputPath: string, content: string, toolCallId: string): Promise<void> {
    await this.once(toolCallId, () => {
      const path = normalizeWorkspacePath(inputPath);
      const existing = this.current.get(path);
      this.assertWritable(path, existing);
      this.current.set(path, {
        content,
        external: undefined,
        mediaType: existing?.mediaType ?? inferMediaType(path),
        path,
        readonly: false,
        resourceId: existing?.resourceId ?? crypto.randomUUID(),
        skillResource: undefined,
      });
    });
  }

  async patch(inputPath: string, patch: string, toolCallId: string): Promise<void> {
    await this.once(toolCallId, async () => {
      const file = await this.read(inputPath);
      this.assertWritable(file.path, file);
      if (file.skillResource && !file.mediaType.startsWith('text/')) {
        throw new WorkspaceError('INVALID_PATCH', `二进制文件不能使用Patch：${file.path}`, file.path);
      }
      this.current.set(file.path, { ...file, content: applyUnifiedPatch(file.content, patch) });
    });
  }

  async move(inputFrom: string, inputTo: string, toolCallId: string): Promise<void> {
    await this.once(toolCallId, () => {
      const from = normalizeWorkspacePath(inputFrom);
      const to = normalizeWorkspacePath(inputTo);
      if (from === '/' || to === '/' || isSameOrDescendant(to, from)) {
        throw new WorkspaceError('INVALID_PATH', `不能将${from}移动到${to}。`, from);
      }
      const targets = [...this.current.values()].filter(file => isSameOrDescendant(file.path, from));
      if (targets.length === 0) {
        throw new WorkspaceError('NOT_FOUND', `路径不存在：${from}`, from);
      }
      const destinations = targets.map(file => `${to}${file.path.slice(from.length)}`);
      targets.forEach(file => this.assertWritable(file.path, file));
      destinations.forEach(path => this.assertWritable(path, this.current.get(path)));
      if (
        destinations.some(
          destination =>
            [...this.current.keys()].some(
              path =>
                !isSameOrDescendant(path, from) &&
                (path === destination || isSameOrDescendant(path, destination) || isSameOrDescendant(destination, path)),
            ),
        )
      ) {
        throw new WorkspaceError('ALREADY_EXISTS', `目标路径已经存在：${to}`, to);
      }
      const movedWorldbookMetadata = this.prepareMovedWorldbookMetadata(from, to);
      for (const file of targets) {
        const nextPath = `${to}${file.path.slice(from.length)}`;
        this.current.delete(file.path);
        this.current.set(nextPath, { ...file, path: nextPath });
        this.movedFrom.set(nextPath, file.path);
      }
      if (movedWorldbookMetadata) {
        const movedFile = this.current.get(movedWorldbookMetadata.path);
        if (movedFile) {
          this.current.set(movedWorldbookMetadata.path, {
            ...movedFile,
            content: movedWorldbookMetadata.content,
          });
        }
      }
    });
  }

  async remove(inputPath: string, toolCallId: string): Promise<void> {
    await this.once(toolCallId, () => {
      const path = normalizeWorkspacePath(inputPath);
      if (path === '/') {
        throw new WorkspaceError('INVALID_PATH', '不能删除工作区根目录。', path);
      }
      const targets = [...this.current.values()].filter(file => isSameOrDescendant(file.path, path));
      if (targets.length === 0) {
        throw new WorkspaceError('NOT_FOUND', `路径不存在：${path}`, path);
      }
      targets.forEach(file => this.assertWritable(file.path, file));
      for (const target of targets) {
        this.current.delete(target.path);
      }
    });
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    return searchWorkspaceFiles(this.current.values(), query);
  }

  snapshot(): WorkspaceFile[] {
    return [...this.current.values()].map(cloneFile).sort((left, right) => left.path.localeCompare(right.path));
  }

  /**
   * 把已提交的数据设为新的Base，同时保留本会话已经完成的工具调用ID。
   * Agent中途提交后仍有同一个Runner继续执行，因此不能替换Repository实例。
   */
  rebase(inputs: WorkspaceFile[]): void {
    const files = inputs.map(input => {
      const path = normalizeWorkspacePath(input.path);
      return { ...cloneFile(input), path };
    });
    this.base.clear();
    this.current.clear();
    this.movedFrom.clear();
    for (const input of files) {
      this.base.set(input.path, cloneFile(input));
      this.current.set(input.path, cloneFile(input));
    }
  }

  /**
   * 用最新的外部投影替换一个目录，同时更新Base与Working Copy。
   * 适用于聊天、只读资料库等不应进入角色卡Diff的实时视图。
   */
  replaceProjection(inputRoot: string, inputs: WorkspaceFile[]): void {
    const root = normalizeWorkspacePath(inputRoot);
    if (root === '/') throw new WorkspaceError('INVALID_PATH', '不能替换整个工作区投影。', root);
    const files = inputs.map(input => {
      const path = normalizeWorkspacePath(input.path);
      if (!isSameOrDescendant(path, root)) {
        throw new WorkspaceError('INVALID_PATH', `投影文件超出目标目录：${path}`, path);
      }
      return { ...cloneFile(input), path };
    });
    for (const path of [...this.base.keys()]) {
      if (isSameOrDescendant(path, root)) this.base.delete(path);
    }
    for (const path of [...this.current.keys()]) {
      if (isSameOrDescendant(path, root)) this.current.delete(path);
    }
    for (const input of files) {
      this.base.set(input.path, cloneFile(input));
      this.current.set(input.path, cloneFile(input));
    }
    for (const [path, from] of [...this.movedFrom]) {
      if (isSameOrDescendant(path, root) || isSameOrDescendant(from, root)) this.movedFrom.delete(path);
    }
  }

  /** 一次性建立一组Working Copy文件；整组共享同一个幂等工具调用。 */
  async stageFiles(inputs: WorkspaceFile[], toolCallId: string): Promise<void> {
    await this.once(toolCallId, () => {
      const files = inputs.map(input => {
        const path = normalizeWorkspacePath(input.path);
        const existing = this.current.get(path);
        this.assertWritable(path, existing);
        if (existing) throw new WorkspaceError('ALREADY_EXISTS', `文件已经存在：${path}`, path);
        return { ...cloneFile(input), path };
      });
      for (const input of files) this.current.set(input.path, input);
    });
  }

  changes(): WorkspaceChange[] {
    const changes: WorkspaceChange[] = [];
    for (const [path, before] of this.base) {
      const after = this.current.get(path);
      if (!after) {
        const moved = [...this.movedFrom].find(([, from]) => from === path);
        if (moved) {
          const movedFile = this.current.get(moved[0]);
          if (movedFile) {
            changes.push({ after: cloneFile(movedFile), before: cloneFile(before), from: path, kind: 'move', path: moved[0] });
            continue;
          }
        }
        changes.push({ before: cloneFile(before), kind: 'delete', path });
      } else if (
        after.content !== before.content ||
        after.mediaType !== before.mediaType ||
        JSON.stringify(after.external) !== JSON.stringify(before.external) ||
        JSON.stringify(after.skillResource) !== JSON.stringify(before.skillResource)
      ) {
        changes.push({ after: cloneFile(after), before: cloneFile(before), kind: 'modify', path });
      }
    }
    for (const [path, after] of this.current) {
      if (!this.base.has(path) && !this.movedFrom.has(path)) {
        changes.push({ after: cloneFile(after), kind: 'create', path });
      }
    }
    return changes.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async once(toolCallId: string, action: () => void | Promise<void>): Promise<void> {
    if (!toolCallId) {
      throw new WorkspaceError('INVALID_PATH', '工具调用必须包含稳定的toolCallId。');
    }
    if (this.completedToolCalls.has(toolCallId)) {
      return;
    }
    await action();
    this.completedToolCalls.add(toolCallId);
  }

  private assertWritable(path: string, file?: WorkspaceFile): void {
    if (file?.readonly || this.isReadonly(path)) {
      throw new WorkspaceError('READ_ONLY_PATH', `只读路径不能修改：${path}`, path);
    }
  }

  private isReadonly(path: string): boolean {
    return this.readonlyRoots.some(root => isSameOrDescendant(path, root));
  }

  private hasDirectory(path: string): boolean {
    return (
      this.virtualDirectories().some(directory => directory.path === path) ||
      [...this.current.keys()].some(
        filePath => parentWorkspacePath(filePath) === path || isSameOrDescendant(filePath, path),
      )
    );
  }

  /** 移动一本世界书时，book.yaml里的name只是目录名镜像，必须同步以免误导Agent。 */
  private prepareMovedWorldbookMetadata(from: string, to: string): { content: string; path: string } | undefined {
    if (!/^\/worldbooks\/[^/]+$/u.test(from) || !/^\/worldbooks\/[^/]+$/u.test(to)) return undefined;
    const sourcePath = `${from}/book.yaml`;
    const sourceFile = this.current.get(sourcePath);
    if (!sourceFile) return undefined;
    const metadata = parseYamlObject(sourceFile.content, sourcePath);
    metadata.name = decodeWorkspaceSegment(to.slice('/worldbooks/'.length));
    return { content: serializeYaml(metadata), path: `${to}/book.yaml` };
  }

  /** 世界书的 entries 是结构目录，即使书中暂时没有条目也应该可见、可列出。 */
  private virtualDirectories(): WorkspaceEntry[] {
    const directories = new Map<string, WorkspaceEntry>();
    for (const file of this.current.values()) {
      if (!file.path.endsWith('/book.yaml')) continue;
      const root = parentWorkspacePath(file.path);
      if (!/^\/(?:worldbooks|worldbooks-global-readonly)\/[^/]+$/u.test(root) &&
          !/^\/library\/worldbooks\/[^/]+$/u.test(root)) {
        continue;
      }
      const path = `${root}/entries`;
      directories.set(path, {
        kind: 'directory',
        name: 'entries',
        path,
        readonly: file.readonly || this.isReadonly(path),
      });
    }
    return [...directories.values()];
  }
}
