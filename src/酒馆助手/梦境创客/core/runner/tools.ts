import { tool, type FilePart, type Tool } from 'ai';
import { z } from 'zod';
import { parseYamlObject } from '../mapping/serde';
import { assessSkillMutation } from '../skills/skill-registry';
import { dreamCreatorFileReference } from '../session/attachments';
import { base64ForBytes } from '../persistence/workspace-file-store';
import type { TavernChatWorkspace } from '../tavern/chat-workspace';
import { parentWorkspacePath } from '../workspace/path';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { applyUnifiedPatch, createUnifiedPatch } from '../workspace/unified-patch';
import { maskSecretsForModel, restoreSecretsFromModel } from '../workspace/secret-protection';
import { isBinaryWorkspaceFile, WorkspaceError, type WorkspaceRepository } from '../workspace/types';
import { richToolOutput } from './tool-output';
import { globToRegex } from '../workspace/search';

export type ToolConfirmation = {
  description: string;
  intent?: unknown;
  risk?: 'high' | 'ordinary';
  sessionId?: string;
  toolCallId: string;
  toolName: string;
};

export type RunnerTool = {
  confirmation?: (input: unknown, toolCallId: string) => Promise<ToolConfirmation | undefined> | ToolConfirmation | undefined;
  definition: Tool;
  execute: (input: unknown, toolCallId: string, context?: { abortSignal: AbortSignal }) => Promise<unknown>;
  name: string;
  readonly: boolean;
};

const pathSchema = z.string().min(1).describe('工作区内的POSIX路径');
const DEFAULT_READ_LIMIT = 1_000;
const MAX_READ_CHARACTERS = 100_000;
const DEFAULT_LIST_RESULTS = 500;
const MAX_LIST_RESULTS = 2_000;
const MAX_LIST_DEPTH = 10;

type ListPathInput = {
  depth?: number;
  glob?: string;
  kind?: 'all' | 'directories' | 'files';
  maxResults?: number;
  path: string;
  recursive?: boolean;
};

async function listPath(repository: WorkspaceRepository, input: ListPathInput) {
  try {
    const file = await repository.read(input.path);
    return {
      entries: [{
        path: file.path,
        readonly: file.readonly,
        size: file.external?.size ?? file.skillResource?.size ?? file.virtualBinary?.size ?? new TextEncoder().encode(file.content).byteLength,
        type: 'file',
      }],
      path: file.path,
      truncated: false,
      type: 'file',
    };
  } catch (error) {
    if (!(error instanceof WorkspaceError) || error.code !== 'NOT_FOUND') throw error;
  }

  const requestedDepth = input.recursive ? (input.depth ?? 2) : 1;
  const depth = Math.min(MAX_LIST_DEPTH, Math.max(1, requestedDepth));
  const maxResults = Math.min(MAX_LIST_RESULTS, Math.max(1, input.maxResults ?? DEFAULT_LIST_RESULTS));
  const pattern = input.glob ? globToRegex(input.glob.replace(/^\/+/, '')) : undefined;
  const discovered: Array<{ depth: number; kind: 'directory' | 'file'; path: string; readonly: boolean; size?: number }> = [];
  const queue: Array<{ depth: number; path: string }> = [{ depth: 0, path: input.path }];
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await repository.list(current.path);
    for (const child of children) {
      if (discovered.length >= MAX_LIST_RESULTS) {
        truncated = true;
        queue.length = 0;
        break;
      }
      const item = { depth: current.depth + 1, kind: child.kind, path: child.path, readonly: child.readonly, size: child.size };
      discovered.push(item);
      if (child.kind === 'directory' && item.depth < MAX_LIST_DEPTH) queue.push({ depth: item.depth, path: child.path });
    }
  }

  const directoryStats = new Map<string, { childCount: number; size: number }>();
  for (const item of discovered) {
    if (item.kind === 'directory') directoryStats.set(item.path, { childCount: 0, size: 0 });
  }
  for (const item of discovered) {
    const parent = item.path.slice(0, item.path.lastIndexOf('/')) || '/';
    const parentStats = directoryStats.get(parent);
    if (parentStats) parentStats.childCount += 1;
    if (item.kind !== 'file') continue;
    for (const [directory, stats] of directoryStats) {
      if (item.path.startsWith(`${directory}/`)) stats.size += item.size ?? 0;
    }
  }

  const kind = input.kind ?? 'all';
  const entries = discovered
    .filter(item => item.depth <= depth)
    .filter(item => kind === 'all' || (kind === 'files' ? item.kind === 'file' : item.kind === 'directory'))
    .filter(item => !pattern || pattern.test(item.path.replace(/^\/+/, '')))
    .slice(0, maxResults)
    .map(item => ({
      ...(item.kind === 'directory' ? directoryStats.get(item.path) : { size: item.size ?? 0 }),
      depth: item.depth,
      path: item.path,
      readonly: item.readonly,
      type: item.kind,
    }));
  if (entries.length < discovered.filter(item => item.depth <= depth).length) truncated = true;
  return {
    depth,
    entries,
    path: input.path,
    recursive: input.recursive === true,
    truncated,
    warning: truncated ? '结果已截断，请缩小路径、Glob或递归深度后继续列出。' : undefined,
  };
}

function mutationSummary(repository: WorkspaceRepository, toolCallId: string) {
  const result = repository.mutationResult?.(toolCallId);
  return result
    ? {
        changedFiles: result.changes.length,
        idempotent: result.idempotent ?? false,
        status: result.status,
        warning: result.warning,
      }
    : undefined;
}

function lineNumberedView(
  file: Awaited<ReturnType<WorkspaceRepository['read']>>,
  input: { limit?: number; offset?: number },
) {
  const lines = file.content === '' ? [] : file.content.split(/\r\n|\n|\r/u);
  const offset = input.offset ?? 1;
  const limit = input.limit ?? DEFAULT_READ_LIMIT;
  const requested = lines.slice(offset - 1, offset - 1 + limit);
  const selected: string[] = [];
  let characters = 0;
  let partialLine = false;
  for (const line of requested) {
    const extra = line.length + (selected.length > 0 ? 1 : 0);
    if (characters + extra <= MAX_READ_CHARACTERS) {
      selected.push(line);
      characters += extra;
      continue;
    }
    if (selected.length === 0) {
      selected.push(`${line.slice(0, MAX_READ_CHARACTERS)}…`);
      partialLine = true;
    }
    break;
  }
  const startLine = selected.length > 0 ? offset : 0;
  const endLine = selected.length > 0 ? offset + selected.length - 1 : 0;
  const moreLines = endLine > 0 && endLine < lines.length;
  const width = Math.max(String(endLine || offset).length, 1);
  return {
    endLine,
    lineNumbering: {
      format: '<line> | <source>',
      prefixesAreFileContent: false,
      warning: '行号和分隔符只是读取视图的元数据，不属于文件正文；写入或Patch时不要复制它们。',
    },
    mediaType: file.mediaType,
    nextOffset: moreLines && !partialLine ? endLine + 1 : undefined,
    partialLine,
    path: file.path,
    readonly: file.readonly,
    resourceId: file.resourceId,
    startLine,
    totalLines: lines.length,
    truncated: moreLines || partialLine,
    view: selected.map((line, index) => `${String(offset + index).padStart(width)} | ${line}`).join('\n'),
  };
}

function skillConfirmation(
  operation: 'delete' | 'move' | 'patch' | 'write',
  path: string,
  existingSkillIds: string[],
  lockedSkillIds: string[],
  toolCallId: string,
  toolName: string,
): ToolConfirmation | undefined {
  if (!path.startsWith('/skills/')) return undefined;
  const assessment = assessSkillMutation(operation, path, existingSkillIds, lockedSkillIds);
  if (!assessment.allowed) throw new Error(assessment.reason);
  return assessment.confirmationRequired
    ? { description: `高危Skill操作需要确认：${operation} ${path}`, risk: 'high', toolCallId, toolName }
    : undefined;
}

export type WorkspaceRunnerToolOptions = {
  approvalMode?: () => 'full' | 'manual' | 'yolo';
  canWriteNonCharacterResources?: () => boolean;
  chatWorkspace?: TavernChatWorkspace;
  isYolo?: () => boolean;
  lockedSkillIds?: string[];
};

type MutationOperation = 'delete' | 'move' | 'patch' | 'write';

function nonCharacterResourcePath(path: string): boolean {
  return /^\/(?:regexes|scripts)\/(?:global|preset-current)(?:\/|$)/u.test(path);
}

function characterScriptPath(path: string): boolean {
  return path.startsWith('/scripts/character/');
}

function chatPath(path: string): boolean {
  return path.startsWith('/character/chats/');
}

function chatConfirmation(
  path: string,
  options: WorkspaceRunnerToolOptions,
  toolCallId: string,
  toolName: string,
): ToolConfirmation | undefined {
  if (!chatPath(path) || !options.chatWorkspace) return undefined;
  return {
    description: '将直接修改当前角色的酒馆聊天记录；聊天改动不可由梦境创客Undo。',
    risk: 'ordinary',
    toolCallId,
    toolName,
  };
}

function approvalMode(options: WorkspaceRunnerToolOptions): 'full' | 'manual' | 'yolo' {
  if (options.approvalMode) return options.approvalMode();
  return options.isYolo?.() ? 'yolo' : 'manual';
}

function ordinaryConfirmation(operation: MutationOperation, path: string, toolCallId: string, toolName: string) {
  const verb = operation === 'delete' ? '删除' : operation === 'move' ? '移动' : operation === 'patch' ? '修改' : '写入';
  return {
    description: `${verb}工作区内容：${path}`,
    risk: 'ordinary' as const,
    toolCallId,
    toolName,
  };
}

function inherentlyHighRisk(operation: MutationOperation, path: string, input: unknown): boolean {
  if (operation === 'delete') {
    return (
      /^\/worldbooks\/[^/]+(?:\/)?$/u.test(path) ||
      path === '/character/greetings' ||
      path.startsWith('/files/') ||
      path.startsWith('/skills/user/')
    );
  }
  if (operation === 'write' && (input as { overwrite?: boolean } | undefined)?.overwrite === true) {
    return (
      path === '/worldbooks/bindings.yaml' ||
      path === '/character/greetings/index.yaml' ||
      path.startsWith('/files/') ||
      path.startsWith('/skills/user/') ||
      nonCharacterResourcePath(path)
    );
  }
  return false;
}

async function mutationConfirmation(
  operation: MutationOperation,
  path: string,
  input: unknown,
  repository: WorkspaceRepository,
  existingSkillIds: string[],
  options: WorkspaceRunnerToolOptions,
  toolCallId: string,
  toolName: string,
): Promise<ToolConfirmation | undefined> {
  const specialized =
    chatConfirmation(path, options, toolCallId, toolName) ??
    skillConfirmation(operation, path, existingSkillIds, options.lockedSkillIds ?? [], toolCallId, toolName) ??
    (await resourceConfirmation(operation, path, input, repository, options, toolCallId, toolName));
  const highRisk = specialized?.risk === 'high' || inherentlyHighRisk(operation, path, input);
  const mode = approvalMode(options);
  if (mode === 'full') return undefined;
  if (mode === 'yolo' && !highRisk) return undefined;
  const confirmation = specialized ?? ordinaryConfirmation(operation, path, toolCallId, toolName);
  return { ...confirmation, intent: input, risk: highRisk ? 'high' : 'ordinary' };
}

async function currentScriptEnabled(repository: WorkspaceRepository, path: string): Promise<boolean> {
  const directory = parentWorkspacePath(path);
  try {
    const info = await repository.read(`${directory}/info.yaml`);
    return parseYamlObject(info.content, info.path).enabled === true;
  } catch {
    return false;
  }
}

async function resourceConfirmation(
  operation: MutationOperation,
  path: string,
  input: unknown,
  repository: WorkspaceRepository,
  options: WorkspaceRunnerToolOptions,
  toolCallId: string,
  toolName: string,
): Promise<ToolConfirmation | undefined> {
  if (nonCharacterResourcePath(path)) {
    if (!options.canWriteNonCharacterResources?.()) {
      throw new Error(
        'NON_CHARACTER_RESOURCE_WRITE_DISABLED：全局与当前预设的正则/脚本默认只读。请让用户在常规设置中显式开启标红的危险写入权限。',
      );
    }
    return { description: `高危非角色资源操作需要确认：${operation} ${path}`, risk: 'high', toolCallId, toolName };
  }
  if (!characterScriptPath(path) || operation === 'delete' || operation === 'move') return undefined;
  if (path.endsWith('/script.js') && (await currentScriptEnabled(repository, path))) {
    return { description: `修改已启用脚本的代码需要确认：${path}`, risk: 'high', toolCallId, toolName };
  }
  if (!path.endsWith('/info.yaml')) return undefined;
  let candidate: string;
  try {
    if (operation === 'write') candidate = (input as { content: string }).content;
    else {
      const current = await repository.read(path);
      candidate = applyUnifiedPatch(current.content, (input as { patch: string }).patch);
    }
    const nextEnabled = parseYamlObject(candidate, path).enabled === true;
    const previousEnabled = await currentScriptEnabled(repository, path);
    if (nextEnabled && !previousEnabled) {
      return { description: `启用或创建已启用脚本需要确认：${path}`, risk: 'high', toolCallId, toolName };
    }
  } catch {
    // 无效 YAML 会在文件工具或候选物化时返回明确错误，不在确认阶段吞掉真正写入。
  }
  return undefined;
}

export function createWorkspaceRunnerTools(
  repository: WorkspaceRepository,
  existingSkillIds: string[] = [],
  options: WorkspaceRunnerToolOptions = {},
): RunnerTool[] {
  return [
    {
      definition: tool({
        description:
          '像系统ls/tree一样查看路径。文件路径返回单个文件元信息；目录可列出文件和子目录，并支持递归深度、类型、Glob与结果上限。',
        inputSchema: z.object({
          depth: z.number().int().min(1).max(MAX_LIST_DEPTH).optional().describe('递归深度，默认2，最大10'),
          glob: z.string().min(1).optional().describe('可选路径Glob过滤'),
          kind: z.enum(['all', 'files', 'directories']).optional().describe('默认all'),
          maxResults: z.number().int().min(1).max(MAX_LIST_RESULTS).optional().describe('默认500，最大2000'),
          path: pathSchema,
          recursive: z.boolean().optional().describe('是否递归列出，默认false'),
        }),
      }),
      execute: async input => listPath(repository, input as ListPathInput),
      name: 'list_path',
      readonly: true,
    },
    {
      definition: tool({
        description:
          '读取文件。文本返回带行号视图；图片、PDF等二进制文件直接作为多模态工具结果交给模型。行号前缀不是正文。',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(DEFAULT_READ_LIMIT).optional().describe('最多读取多少行，默认1000'),
          offset: z.number().int().min(1).optional().describe('从第几行开始，1基，默认1'),
          path: pathSchema,
        }),
      }),
      execute: async input => {
        const value = input as { limit?: number; offset?: number; path: string };
        const file = await repository.read(value.path);
        if (isBinaryWorkspaceFile(file)) {
          if (file.skillResource) {
            throw new Error(
              `BINARY_SKILL_RESOURCE_NOT_READABLE：${file.path}是二进制Skill资源（${file.mediaType}，${file.skillResource.size} bytes），当前文件工具只能列出、移动或删除它，不能把内容发送给模型。`,
            );
          }
          let data: FilePart['data'];
          let size = file.external?.size ?? file.virtualBinary?.size ?? 0;
          if (file.external) {
            data = dreamCreatorFileReference(file.external.fileId);
          } else if (file.virtualBinary) {
            const response = await fetch(file.virtualBinary.url, { cache: 'no-cache' });
            if (!response.ok) throw new Error(`读取酒馆图片失败（HTTP ${response.status}）：${file.path}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            size = bytes.byteLength;
            data = { data: base64ForBytes(bytes), type: 'data' };
          } else {
            throw new Error(`二进制文件缺少可读来源：${file.path}`);
          }
          return richToolOutput(
            {
              type: 'content',
              value: [
                {
                  text: `已读取二进制文件：${file.path}（${file.mediaType}，${size} bytes）。`,
                  type: 'text',
                },
                {
                  data,
                  filename: file.path.split('/').at(-1),
                  mediaType: file.mediaType,
                  type: 'file',
                },
              ],
            },
            {
              binary: true,
              mediaType: file.mediaType,
              path: file.path,
              size,
            },
          );
        }
        const protectedView = await maskSecretsForModel(file.content, file.path);
        return {
          ...lineNumberedView({ ...file, content: protectedView.maskedContent }, value),
          secretProtection: {
            masked: protectedView.findings.length,
            warning: protectedView.warning,
          },
        };
      },
      name: 'read_file',
      readonly: true,
    },
    {
      confirmation: async (input, toolCallId) => {
        const path = (input as { path: string }).path;
        return mutationConfirmation(
          'write',
          path,
          input,
          repository,
          existingSkillIds,
          options,
          toolCallId,
          'write_file',
        );
      },
      definition: tool({
        description: '新建或整体写入文本文件。已有长文件优先使用apply_patch。',
        inputSchema: z.object({
          content: z.string(),
          overwrite: z
            .boolean()
            .optional()
            .describe('默认false。仅在确认需要整体替换一个已有文件时显式设为true。'),
          path: pathSchema,
        }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { content: string; overwrite?: boolean; path: string };
        if (chatPath(value.path) && options.chatWorkspace) {
          options.chatWorkspace.authorizeRun();
          const result = await options.chatWorkspace.executeOnce(toolCallId, () =>
            options.chatWorkspace!.writeFile(value.path, value.content, repository as MemoryWorkspaceRepository),
          );
          return { idempotent: !result.executed, path: value.path, written: true };
        }
        let current = '';
        let exists = false;
        try {
          current = (await repository.read(value.path)).content;
          exists = true;
        } catch (error) {
          if (!(error instanceof WorkspaceError) || error.code !== 'NOT_FOUND') throw error;
        }
        if (exists && value.overwrite !== true) {
          throw new WorkspaceError(
            'ALREADY_EXISTS',
            `文件已经存在：${value.path}。请使用apply_patch，或显式设置overwrite=true进行整体替换。`,
            value.path,
          );
        }
        const restored = await restoreSecretsFromModel(current, value.content, value.path);
        await repository.write(value.path, restored.content, toolCallId, { overwrite: value.overwrite });
        return {
          mutation: mutationSummary(repository, toolCallId),
          overwritten: exists,
          path: value.path,
          secretProtectionWarning: restored.warning,
          written: true,
        };
      },
      name: 'write_file',
      readonly: false,
    },
    {
      confirmation: async (input, toolCallId) => {
        const path = (input as { path: string }).path;
        return mutationConfirmation(
          'patch',
          path,
          input,
          repository,
          existingSkillIds,
          options,
          toolCallId,
          'apply_patch',
        );
      },
      definition: tool({
        description: '用精确的统一Diff修改已有文本文件；上下文不匹配时失败，不做模糊套用。',
        inputSchema: z.object({ patch: z.string().min(1), path: pathSchema }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { patch: string; path: string };
        if (chatPath(value.path) && options.chatWorkspace) {
          options.chatWorkspace.authorizeRun();
          const result = await options.chatWorkspace.executeOnce(toolCallId, () =>
            options.chatWorkspace!.patchFile(value.path, value.patch, repository as MemoryWorkspaceRepository),
          );
          return { idempotent: !result.executed, patched: true, path: value.path };
        }
        const current = await repository.read(value.path);
        if (isBinaryWorkspaceFile(current)) throw new Error(`二进制文件不能使用apply_patch：${current.path}`);
        const masked = await maskSecretsForModel(current.content, current.path);
        const patched = applyUnifiedPatch(masked.maskedContent, value.patch, current.path);
        const restored = await restoreSecretsFromModel(current.content, patched, current.path);
        const realPatch = createUnifiedPatch(current.path, current.content, restored.content);
        await repository.patch(current.path, realPatch, toolCallId);
        return {
          mutation: mutationSummary(repository, toolCallId),
          patched: true,
          path: value.path,
          secretProtectionWarning: restored.warning,
        };
      },
      name: 'apply_patch',
      readonly: false,
    },
    {
      confirmation: async (input, toolCallId) => {
        const value = input as { from: string; to: string };
        const source = await mutationConfirmation(
          'move', value.from, input, repository, existingSkillIds, options, toolCallId, 'move_path',
        );
        const target = await mutationConfirmation(
          'move', value.to, input, repository, existingSkillIds, options, toolCallId, 'move_path',
        );
        return source?.risk === 'high' ? source : target?.risk === 'high' ? target : source ?? target;
      },
      definition: tool({
        description: '移动或重命名文件/目录，保留稳定资源身份。',
        inputSchema: z.object({ from: pathSchema, to: pathSchema }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { from: string; to: string };
        options.chatWorkspace?.assertNoMoveOrDelete(value.from);
        options.chatWorkspace?.assertNoMoveOrDelete(value.to);
        await repository.move(value.from, value.to, toolCallId);
        return { from: value.from, moved: true, mutation: mutationSummary(repository, toolCallId), to: value.to };
      },
      name: 'move_path',
      readonly: false,
    },
    {
      confirmation: async (input, toolCallId) => {
        const value = input as { from: string; overwrite?: boolean; to: string };
        const target = await mutationConfirmation(
          'write', value.to, input, repository, existingSkillIds, options, toolCallId, 'copy_path',
        );
        return target;
      },
      definition: tool({
        description:
          '复制文件或整个目录。递归复制会先检查全部来源、目标冲突与权限，通过后才开始写入；默认不覆盖已有目标。',
        inputSchema: z.object({
          from: pathSchema,
          overwrite: z.boolean().optional().describe('默认false；明确需要覆盖目标时设为true'),
          to: pathSchema,
        }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { from: string; overwrite?: boolean; to: string };
        options.chatWorkspace?.assertNoMoveOrDelete(value.to);
        await repository.copy(value.from, value.to, toolCallId, { overwrite: value.overwrite });
        return { copied: true, from: value.from, mutation: mutationSummary(repository, toolCallId), to: value.to };
      },
      name: 'copy_path',
      readonly: false,
    },
    {
      confirmation: async (input, toolCallId) => {
        const path = (input as { path: string }).path;
        return mutationConfirmation(
          'delete',
          path,
          input,
          repository,
          existingSkillIds,
          options,
          toolCallId,
          'delete_path',
        );
      },
      definition: tool({
        description: '删除文件或整个目录。高风险路径会在执行此工具前请求确认。',
        inputSchema: z.object({ path: pathSchema }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { path: string };
        options.chatWorkspace?.assertNoMoveOrDelete(value.path);
        await repository.remove(value.path, toolCallId);
        return { deleted: true, mutation: mutationSummary(repository, toolCallId), path: value.path };
      },
      name: 'delete_path',
      readonly: false,
    },
    {
      definition: tool({
        description:
          '像rg一样搜索文本。pattern默认是普通文本，搜索*、[等符号无需转义；仅在mode="regex"时按正则解释。glob/excludeGlob只筛选文件路径，例如**/*.md。',
        inputSchema: z.object({
          caseSensitive: z.boolean().optional(),
          contextAfter: z.number().int().min(0).max(5).optional(),
          contextBefore: z.number().int().min(0).max(5).optional(),
          contextLines: z.number().int().min(0).max(5).optional(),
          excludeGlob: z.union([z.string(), z.array(z.string())]).optional(),
          glob: z.union([z.string(), z.array(z.string())]).optional(),
          maxResults: z.number().int().min(1).max(500).optional(),
          mode: z.enum(['literal', 'regex']).optional(),
          path: pathSchema.optional(),
          pattern: z.string().min(1),
          wordMatch: z.boolean().optional(),
        }),
      }),
      execute: async input => {
        const result = await repository.search(input as Parameters<WorkspaceRepository['search']>[0]);
        const maskedLines = new Map<string, string[]>();
        for (const path of new Set(result.matches.map(match => match.path))) {
          const file = await repository.read(path);
          const masked = await maskSecretsForModel(file.content, file.path);
          maskedLines.set(path, masked.maskedContent.split(/\r\n|\n|\r/u));
        }
        return {
          ...result,
          matches: result.matches.map(match => {
            const lines = maskedLines.get(match.path) ?? [];
            const beforeCount = match.contextBefore.length;
            const afterCount = match.contextAfter.length;
            return {
              ...match,
              contextAfter: lines.slice(match.line, match.line + afterCount),
              contextBefore: lines.slice(Math.max(0, match.line - 1 - beforeCount), match.line - 1),
              text: lines[match.line - 1] ?? '',
            };
          }),
        };
      },
      name: 'search_files',
      readonly: true,
    },
  ];
}

export const COMPACT_CONTEXT_TOOL: RunnerTool = {
  definition: tool({
    description:
      '把旧助手回复和已完成工具链压缩为忠实摘要。摘要必须保留目标、用户约束、已完成修改、关键发现、失败点和待办，不得改写用户意图。',
    inputSchema: z.object({ summary: z.string().min(1) }),
  }),
  execute: async input => ({ compacted: true, summary: (input as { summary: string }).summary }),
  name: 'compact_context',
  readonly: false,
};
