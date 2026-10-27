import { tool } from 'ai';
import { z } from 'zod';
import { createCooperativeYield } from '../cooperative';
import { HtmlProjectCompiler } from '../projects/html-project';
import { htmlProjectTemplate } from '../projects/html-project-template';
import { parentWorkspacePath } from '../workspace/path';
import { WorkspaceError, isBinaryWorkspaceFile, type WorkspaceFile, type WorkspaceRepository } from '../workspace/types';
import type { RunnerTool, ToolConfirmation } from './tools';

export type ProjectRunnerToolOptions = {
  approvalMode: () => 'full' | 'manual' | 'yolo';
  canWriteNonCharacterResources: () => boolean;
  resourceBaseUrl: string;
};

async function collectFiles(repository: WorkspaceRepository, path: string, signal?: AbortSignal, optional = false): Promise<WorkspaceFile[]> {
  const result: WorkspaceFile[] = [];
  const pending = [path];
  const yieldIfBusy = createCooperativeYield();
  while (pending.length) {
    await yieldIfBusy(signal);
    const directory = pending.pop()!;
    let entries;
    try { entries = await repository.list(directory); }
    catch (error) {
      if (optional && directory === path && error instanceof WorkspaceError && error.code === 'NOT_FOUND') continue;
      throw error;
    }
    for (const entry of entries) {
      await yieldIfBusy(signal);
      if (entry.kind === 'directory') pending.push(entry.path);
      else {
        const file = await repository.read(entry.path);
        if (!isBinaryWorkspaceFile(file)) result.push(file);
      }
    }
  }
  return result;
}

function compileConfirmation(
  input: unknown,
  toolCallId: string,
  options: ProjectRunnerToolOptions,
): ToolConfirmation | undefined {
  const value = input as { scope?: 'character' | 'global' | 'preset-current' };
  const scope = value.scope ?? 'character';
  const mode = options.approvalMode();
  if (mode === 'full' || (mode === 'yolo' && scope === 'character')) return undefined;
  return {
    description: scope === 'character'
      ? '将把HTML工程编译为角色正则。'
      : `将把HTML工程编译到${scope === 'global' ? '全局' : '当前预设'}正则；这是非角色资源写入。`,
    intent: input,
    risk: scope === 'character' ? 'ordinary' : 'high',
    toolCallId,
    toolName: 'compile_html_project',
  };
}

export function createProjectRunnerTools(
  repository: WorkspaceRepository,
  options: ProjectRunnerToolOptions,
): RunnerTool[] {
  const projectPathSchema = z.string().regex(/^\/(?:files|character\/files)\/.+\/project\.yaml$/u).describe('完整清单路径，例如 /character/files/status/project.yaml；不能填写目录或 HTML 文件路径');
  const tools: RunnerTool[] = [
    {
      definition: tool({
        description: '检查一个HTML工程的project.yaml、HTML、CSS、正则和ES模块语法，但不写入正则。',
        inputSchema: z.object({ project: projectPathSchema }),
      }),
      execute: async (input, _toolCallId, context) => {
        const project = (input as { project: string }).project;
        const result = await new HtmlProjectCompiler(options.resourceBaseUrl).check(project, await collectFiles(repository, parentWorkspacePath(project), context?.abortSignal));
        context?.abortSignal?.throwIfAborted();
        return {
          diagnostics: result.diagnostics,
          outputBytes: result.outputBytes,
          project,
          projectName: result.projectName,
          renderer: result.renderer,
          valid: !result.diagnostics.some(item => item.severity === 'error'),
        };
      },
      name: 'check_html_project',
      readonly: true,
    },
    {
      confirmation: (input, toolCallId) => compileConfirmation(input, toolCallId, options),
      definition: tool({
        description:
          '手动编译HTML工程为酒馆正则。默认写入角色正则；写入当前预设或全局前必须已启用非角色资源写入权限。',
        inputSchema: z.object({
          overwrite: z.boolean().optional().describe('是否覆盖目标作用域中最后一个同名正则，默认false（新建）'),
          project: projectPathSchema,
          scope: z.enum(['character', 'preset-current', 'global']).optional(),
        }),
      }),
      execute: async (input, toolCallId, context) => {
        const value = input as {
          overwrite?: boolean;
          project: string;
          scope?: 'character' | 'global' | 'preset-current';
        };
        const scope = value.scope ?? 'character';
        if (scope !== 'character' && !options.canWriteNonCharacterResources()) {
          throw new Error('NON_CHARACTER_RESOURCE_WRITE_DISABLED：请让用户在常规设置中启用红色的“允许修改非角色正则与脚本”。');
        }
        const files = [
          ...await collectFiles(repository, parentWorkspacePath(value.project), context?.abortSignal),
          ...await collectFiles(repository, `/regexes/${scope}`, context?.abortSignal, true),
        ];
        await createCooperativeYield()(context?.abortSignal, true);
        const compiler = new HtmlProjectCompiler(options.resourceBaseUrl);
        const checked = await compiler.check(value.project, files);
        context?.abortSignal?.throwIfAborted();
        const compiled = compiler.regexYaml(checked, value.project, files, scope, value.overwrite === true);
        await repository.write(compiled.path, compiled.content, toolCallId, { overwrite: compiled.replace });
        return {
          diagnostics: checked.diagnostics,
          outputBytes: checked.outputBytes,
          path: compiled.path,
          project: value.project,
          replaced: compiled.replace,
          renderer: checked.renderer,
          scope,
        };
      },
      name: 'compile_html_project',
      readonly: false,
    },
  ];
  const check = tools[0];
  const compile = tools[1];
  return [
    {
      confirmation: async (input, toolCallId) => {
        const { action, ...payload } = input as Record<string, unknown> & { action: 'template' | 'check' | 'compile' };
        if (action !== 'compile') return undefined;
        const result = await compile.confirmation?.(payload, toolCallId);
        return result ? { ...result, toolName: 'manage_html_project' } : undefined;
      },
      definition: tool({
        description: 'HTML正则工程工具。template返回可写入的完整工程模板；check检查；compile生成并写入正则。先写 project.yaml 和源码，清单必填 name、renderer、build.entry、regex.find。renderer仅支持plain-html或tavern-helper。project.yaml与/regexes中的完整正则YAML格式不同。check通过后再compile；regex.destination默认仅显示。格式说明：/skills/builtin/html-project/references/project-format.md。',
        inputSchema: z.object({
          action: z.enum(['template', 'check', 'compile']).describe('新建工程可先用template获取完整文件，再通过write_file写入；修改后check，最后compile'),
          overwrite: z.boolean().optional().describe('compile时是否覆盖目标作用域中最后一个同名正则'),
          project: projectPathSchema,
          renderer: z.enum(['plain-html', 'tavern-helper']).optional().describe('仅template使用；有脚本交互选tavern-helper，纯展示选plain-html。check/compile读取清单内renderer'),
          scope: z.enum(['character', 'preset-current', 'global']).optional().describe('compile时的目标作用域'),
        }),
      }),
      execute: async (input, toolCallId, context) => {
        const { action, ...payload } = input as Record<string, unknown> & { action: 'template' | 'check' | 'compile' };
        if (action === 'template') {
          const project = projectPathSchema.parse(payload.project);
          const renderer = payload.renderer === 'tavern-helper' ? 'tavern-helper' : 'plain-html';
          const root = parentWorkspacePath(project);
          return {
            project, renderer,
            files: htmlProjectTemplate(renderer).map(file => ({ ...file, path: `${root}/${file.path}` })),
            requiredFields: ['name', 'renderer', 'build.entry', 'regex.find'],
            next: { check: { action: 'check', project }, compile: { action: 'compile', project, scope: 'character', overwrite: false } },
          };
        }
        return (action === 'check' ? check : compile).execute(payload, toolCallId, context);
      },
      name: 'manage_html_project',
      readonly: false,
    },
  ];
}
