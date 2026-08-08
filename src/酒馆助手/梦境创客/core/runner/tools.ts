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

export function createWorkspaceRunnerTools(repository: WorkspaceRepository, existingSkillIds: string[] = []): RunnerTool[] {
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
        description: '读取一个文本文件及其媒体类型、资源ID和只读状态。',
        inputSchema: z.object({ path: pathSchema }),
      }),
      execute: async input => repository.read((input as { path: string }).path),
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
        description: '像rg一样按路径、Glob、正则/固定字符串、大小写、上下文行和结果上限搜索文本文件。',
        inputSchema: z.object({
          caseSensitive: z.boolean().optional(),
          contextLines: z.number().int().min(0).max(5).optional(),
          fixedStrings: z.boolean().optional(),
          glob: z.string().optional(),
          maxResults: z.number().int().min(1).max(500).optional(),
          path: pathSchema.optional(),
          pattern: z.string(),
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
