import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { assessSkillMutation } from '../skills/skill-registry';
import type { WorkspaceRepository } from '../workspace/types';

export type ToolConfirmation = {
  description: string;
  toolCallId: string;
  toolName: string;
};

export type RunnerTool = {
  confirmation?: (input: unknown, toolCallId: string) => ToolConfirmation | undefined;
  definition: Tool;
  execute: (input: unknown, toolCallId: string) => Promise<unknown>;
  name: string;
  readonly: boolean;
};

const pathSchema = z.string().min(1).describe('工作区内的POSIX路径');
const DEFAULT_READ_LIMIT = 1_000;
const MAX_READ_CHARACTERS = 100_000;

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
  toolCallId: string,
  toolName: string,
): ToolConfirmation | undefined {
  if (!path.startsWith('/skills/')) return undefined;
  const assessment = assessSkillMutation(operation, path, existingSkillIds);
  if (!assessment.allowed) throw new Error(assessment.reason);
  return assessment.confirmationRequired
    ? { description: `高危Skill操作需要确认：${operation} ${path}`, toolCallId, toolName }
    : undefined;
}

export function createWorkspaceRunnerTools(
  repository: WorkspaceRepository,
  existingSkillIds: string[] = [],
): RunnerTool[] {
  return [
    {
      definition: tool({
        description: '列出目录的直接子项。路径使用大小写敏感的POSIX语义。',
        inputSchema: z.object({ path: pathSchema }),
      }),
      execute: async input => repository.list((input as { path: string }).path),
      name: 'list_directory',
      readonly: true,
    },
    {
      definition: tool({
        description:
          '读取文本文件的带行号视图。返回的“行号 | ”前缀只是定位元数据，不属于文件正文，写入或Patch时禁止复制。默认最多1000行和100000字符；用1基offset与limit继续分段读取。',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(DEFAULT_READ_LIMIT).optional().describe('最多读取多少行，默认1000'),
          offset: z.number().int().min(1).optional().describe('从第几行开始，1基，默认1'),
          path: pathSchema,
        }),
      }),
      execute: async input => {
        const value = input as { limit?: number; offset?: number; path: string };
        return lineNumberedView(await repository.read(value.path), value);
      },
      name: 'read_file',
      readonly: true,
    },
    {
      confirmation: (input, toolCallId) =>
        skillConfirmation('write', (input as { path: string }).path, existingSkillIds, toolCallId, 'write_file'),
      definition: tool({
        description: '新建或整体写入文本文件。已有长文件优先使用apply_patch。',
        inputSchema: z.object({ content: z.string(), path: pathSchema }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { content: string; path: string };
        await repository.write(value.path, value.content, toolCallId);
        return { path: value.path, written: true };
      },
      name: 'write_file',
      readonly: false,
    },
    {
      confirmation: (input, toolCallId) =>
        skillConfirmation('patch', (input as { path: string }).path, existingSkillIds, toolCallId, 'apply_patch'),
      definition: tool({
        description: '用精确的统一Diff修改已有文本文件；上下文不匹配时失败，不做模糊套用。',
        inputSchema: z.object({ patch: z.string().min(1), path: pathSchema }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { patch: string; path: string };
        await repository.patch(value.path, value.patch, toolCallId);
        return { patched: true, path: value.path };
      },
      name: 'apply_patch',
      readonly: false,
    },
    {
      confirmation: (input, toolCallId) => {
        const value = input as { from: string; to: string };
        return (
          skillConfirmation('move', value.from, existingSkillIds, toolCallId, 'move_path') ??
          skillConfirmation('move', value.to, existingSkillIds, toolCallId, 'move_path')
        );
      },
      definition: tool({
        description: '移动或重命名文件/目录，保留稳定资源身份。',
        inputSchema: z.object({ from: pathSchema, to: pathSchema }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { from: string; to: string };
        await repository.move(value.from, value.to, toolCallId);
        return { from: value.from, moved: true, to: value.to };
      },
      name: 'move_path',
      readonly: false,
    },
    {
      confirmation: (input, toolCallId) =>
        skillConfirmation('delete', (input as { path: string }).path, existingSkillIds, toolCallId, 'delete_path'),
      definition: tool({
        description: '删除文件或整个目录。删除世界书等高危变更仍会在最终提交阶段再次确认。',
        inputSchema: z.object({ path: pathSchema }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { path: string };
        await repository.remove(value.path, toolCallId);
        return { deleted: true, path: value.path };
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
      execute: async input => repository.search(input as Parameters<WorkspaceRepository['search']>[0]),
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
