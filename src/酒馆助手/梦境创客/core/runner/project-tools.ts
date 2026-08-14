import { tool } from 'ai';
import { z } from 'zod';
import { HtmlProjectCompiler } from '../projects/html-project';
import { isBinaryWorkspaceFile, type WorkspaceFile, type WorkspaceRepository } from '../workspace/types';
import type { RunnerTool, ToolConfirmation } from './tools';

export type ProjectRunnerToolOptions = {
  approvalMode: () => 'full' | 'manual' | 'yolo';
  canWriteNonCharacterResources: () => boolean;
  resourceBaseUrl: string;
};

async function collectFiles(repository: WorkspaceRepository, path = '/'): Promise<WorkspaceFile[]> {
  const result: WorkspaceFile[] = [];
  for (const entry of await repository.list(path)) {
    if (entry.kind === 'directory') result.push(...await collectFiles(repository, entry.path));
    else {
      const file = await repository.read(entry.path);
      if (!isBinaryWorkspaceFile(file)) result.push(file);
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
  const projectPathSchema = z.string().regex(/^\/(?:files|character\/files)\/.+\/project\.yaml$/u);
  const tools: RunnerTool[] = [
    {
      definition: tool({
        description: '检查一个HTML工程的project.yaml、HTML、CSS、正则和ES模块语法，但不写入正则。',
        inputSchema: z.object({ project: projectPathSchema }),
      }),
      execute: async input => {
        const project = (input as { project: string }).project;
        const result = await new HtmlProjectCompiler(options.resourceBaseUrl).check(project, await collectFiles(repository));
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
      execute: async (input, toolCallId) => {
        const value = input as {
          overwrite?: boolean;
          project: string;
          scope?: 'character' | 'global' | 'preset-current';
        };
        const scope = value.scope ?? 'character';
        if (scope !== 'character' && !options.canWriteNonCharacterResources()) {
          throw new Error('NON_CHARACTER_RESOURCE_WRITE_DISABLED：请让用户在常规设置中启用红色的“允许修改非角色正则与脚本”。');
        }
        const files = await collectFiles(repository);
        const compiler = new HtmlProjectCompiler(options.resourceBaseUrl);
        const checked = await compiler.check(value.project, files);
        const compiled = compiler.regexYaml(checked, value.project, files, scope, value.overwrite === true);
        await repository.write(compiled.path, compiled.content, toolCallId, { overwrite: compiled.replace });
        return {
          diagnostics: checked.diagnostics,
          outputBytes: checked.outputBytes,
          path: compiled.path,
          project: value.project,
          replaced: compiled.replace,
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
        const { action, ...payload } = input as Record<string, unknown> & { action: 'check' | 'compile' };
        if (action === 'check') return undefined;
        const result = await compile.confirmation?.(payload, toolCallId);
        return result ? { ...result, toolName: 'manage_html_project' } : undefined;
      },
      definition: tool({
        description: '检查或编译/files、/character/files中的HTML工程。check只检查；compile写入目标正则作用域。',
        inputSchema: z.object({
          action: z.enum(['check', 'compile']),
          overwrite: z.boolean().optional().describe('compile时是否覆盖目标作用域中最后一个同名正则'),
          project: projectPathSchema,
          scope: z.enum(['character', 'preset-current', 'global']).optional().describe('compile时的目标作用域'),
        }),
      }),
      execute: async (input, toolCallId, context) => {
        const { action, ...payload } = input as Record<string, unknown> & { action: 'check' | 'compile' };
        return (action === 'check' ? check : compile).execute(payload, toolCallId, context);
      },
      name: 'manage_html_project',
      readonly: false,
    },
  ];
}
