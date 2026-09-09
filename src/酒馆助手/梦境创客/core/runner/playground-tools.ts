import { tool } from 'ai';
import { z } from 'zod';
import { executeJavascript } from './javascript-execution';
import { isBinaryWorkspaceFile, type WorkspaceRepository } from '../workspace/types';
import type { RunnerTool, ToolConfirmation } from './tools';

export type PreparedRender = {
  backgroundCss?: string;
  createdAt: number;
  data?: unknown;
  inputText: string;
  renderId: string;
  renderer: 'plain-html' | 'tavern-helper';
  sourceHash: string;
  sourcePath: string;
  sourceType: 'file' | 'regex';
};

export type PlaygroundRunnerToolOptions = {
  approvalMode: () => 'full' | 'manual' | 'yolo';
  prepareRender: (render: PreparedRender) => void;
  requestApproval?: (request: ToolConfirmation, signal?: AbortSignal) => Promise<boolean>;
  onCodeResolved?: (toolCallId: string, code: string) => void;
};

async function sourceHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function tavernConfirmation(
  input: unknown,
  toolCallId: string,
  options: PlaygroundRunnerToolOptions,
): ToolConfirmation | undefined {
  const environment = (input as { environment?: string }).environment ?? 'sandbox';
  if (environment !== 'tavern' || options.approvalMode() !== 'manual') return undefined;
  return {
    description:
      (input as { intent?: string }).intent?.trim() ||
      '将在隔离环境中执行 JavaScript，并通过显式异步桥访问酒馆数据接口。',
    intent: input,
    risk: 'ordinary',
    toolCallId,
    toolName: 'run_javascript',
  };
}

export function createPlaygroundRunnerTools(
  repository: WorkspaceRepository,
  options: PlaygroundRunnerToolOptions,
): RunnerTool[] {
  return [
    {
      confirmation: (input, toolCallId) => tavernConfirmation(input, toolCallId, options),
      definition: tool({
        description:
          '执行一次性 JavaScript，支持顶层 await、显式 return 和末尾表达式结果；异步 IIFE 会等待完成。联网时设置 allowNetwork: true 并使用 fetch。tavern 环境可 await tavern.call(接口名,...参数)，tavern.apis 列出接口。返回 result、hasResult、console 与耗时。',
        inputSchema: z
          .object({
            intent: z
              .string()
              .trim()
              .min(1)
              .max(500)
              .describe('用一两句话说明本次执行的目的、操作对象与预期结果，供用户理解；不要只写“运行脚本”'),
            code: z.string().max(500_000).optional(),
            allowNetwork: z.boolean().optional().describe('允许本次执行使用 fetch 联网，默认 false'),
            environment: z.enum(['sandbox', 'tavern']).optional(),
            path: z.string().optional().describe('也可读取工作区内的.js/.mjs文件执行，与code二选一'),
            timeoutSeconds: z.number().min(1).max(60).optional(),
          })
          .refine(value => Boolean(value.code) !== Boolean(value.path), 'code与path必须且只能填写一个'),
      }),
      execute: async (input, _toolCallId, context) => {
        const value = input as {
          intent: string;
          allowNetwork?: boolean;
          code?: string;
          environment?: 'sandbox' | 'tavern';
          path?: string;
          timeoutSeconds?: number;
        };
        if (typeof value.intent !== 'string' || !value.intent.trim())
          throw new Error('请填写本次 JavaScript 执行意图。');
        let code = value.code;
        if (value.path) {
          const file = await repository.read(value.path);
          if (isBinaryWorkspaceFile(file) || !/\.m?js$/iu.test(file.path))
            throw new Error('run_javascript的path必须是文本.js/.mjs文件。');
          code = file.content;
        }
        const timeoutMs = Math.round((value.timeoutSeconds ?? 15) * 1000);
        if (value.path) options.onCodeResolved?.(_toolCallId, code ?? '');
        const result = await executeJavascript({
          intent: value.intent.trim(),
          code: code ?? '',
          timeoutMs,
          environment: value.environment ?? 'sandbox',
          allowNetwork: value.allowNetwork === true,
          approvalMode: options.approvalMode,
          requestApproval: options.requestApproval,
          baseUrl: window.parent.location.href,
          toolCallId: _toolCallId,
          signal: context?.abortSignal,
        });
        return { ...result, environment: value.environment ?? 'sandbox', path: value.path };
      },
      name: 'run_javascript',
      readonly: false,
    },
    {
      definition: tool({
        description:
          '准备一个会话内HTML预览。之后必须在助手回复中把 <dream-render id="返回的renderId"></dream-render> 单独放在一整行，且不得放进Markdown代码块；完成回复后界面才会展开。',
        inputSchema: z.object({
          backgroundCss: z
            .string()
            .max(20_000)
            .optional()
            .describe('应用到预览文档html与body的背景CSS声明，例如 background: #101418; color-scheme: dark；默认透明'),
          data: z.unknown().optional().describe('注入预览环境的JSON数据，最大1MB'),
          inputText: z.string().optional().describe('正则输入文本；普通HTML也可作为预览环境参数'),
          renderer: z.enum(['plain-html', 'tavern-helper']),
          sourcePath: z.string().min(1),
          sourceType: z.enum(['file', 'regex']),
        }),
      }),
      execute: async input => {
        const value = input as Omit<PreparedRender, 'createdAt' | 'renderId' | 'sourceHash'>;
        const dataBytes = new TextEncoder().encode(JSON.stringify(value.data ?? null)).byteLength;
        if (dataBytes > 1024 * 1024) throw new Error('预览data超过1MB。');
        const file = await repository.read(value.sourcePath);
        if (isBinaryWorkspaceFile(file)) throw new Error('预览源必须是文本文件或正则YAML。');
        const render: PreparedRender = {
          ...value,
          createdAt: Date.now(),
          inputText: value.inputText ?? '',
          renderId: `render_${crypto.randomUUID()}`,
          sourceHash: await sourceHash(file.content),
        };
        options.prepareRender(render);
        return {
          marker: `<dream-render id="${render.renderId}"></dream-render>`,
          renderId: render.renderId,
          renderer: render.renderer,
          sourceHash: render.sourceHash,
          sourcePath: render.sourcePath,
          sourceType: render.sourceType,
        };
      },
      name: 'prepare_render',
      readonly: true,
    },
  ];
}
