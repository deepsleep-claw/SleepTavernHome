import { tool } from 'ai';
import { z } from 'zod';
import { isBinaryWorkspaceFile, type WorkspaceRepository } from '../workspace/types';
import type { RunnerTool, ToolConfirmation } from './tools';

export type PreparedRender = {
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
};

type RunResult = {
  cleanup: string[];
  console: Array<{ level: string; values: unknown[] }>;
  durationMs: number;
  result?: unknown;
};

function serializable(value: unknown): unknown {
  try { return structuredClone(value); } catch { return String(value); }
}

async function sourceHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function runInWorker(code: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
  const workerSource = `
    self.onmessage = async event => {
      const logs = [];
      for (const level of ['log','info','warn','error','debug']) {
        console[level] = (...values) => logs.push({ level, values: values.map(value => {
          try { return structuredClone(value); } catch { return String(value); }
        }) });
      }
      const started = performance.now();
      try {
        const fn = new Function('"use strict"; return (async () => {\\n' + event.data + '\\n})()');
        const result = await fn();
        self.postMessage({ ok: true, logs, result, durationMs: performance.now() - started });
      } catch (error) {
        self.postMessage({ ok: false, logs, error: error?.stack || error?.message || String(error), durationMs: performance.now() - started });
      }
    };
  `;
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const worker = new Worker(url);
  try {
    return await new Promise<RunResult>((resolve, reject) => {
      const timer = window.setTimeout(() => { worker.terminate(); reject(new Error(`JavaScript执行超过${timeoutMs}ms，已终止。`)); }, timeoutMs);
      const abort = () => { worker.terminate(); reject(new DOMException('用户已中断JavaScript执行。', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = event => {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const value = event.data as { durationMs: number; error?: string; logs: RunResult['console']; ok: boolean; result?: unknown };
        if (!value.ok) reject(new Error(value.error ?? 'JavaScript执行失败。'));
        else resolve({ cleanup: ['Worker已终止'], console: value.logs, durationMs: value.durationMs, result: serializable(value.result) });
      };
      worker.onerror = event => { window.clearTimeout(timer); reject(new Error(event.message)); };
      worker.postMessage(code);
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

async function runInTavernFrame(code: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
  const iframe = document.createElement('iframe');
  iframe.hidden = true;
  iframe.sandbox.add('allow-scripts', 'allow-same-origin');
  document.body.append(iframe);
  const frame = iframe.contentWindow;
  if (!frame) { iframe.remove(); throw new Error('无法创建酒馆JavaScript运行环境。'); }
  const frameGlobals = frame as unknown as { console: Console; Function: FunctionConstructor };
  const cleanups: Array<() => void> = [];
  const cleanupLabels = new Set<string>();
  const logs: RunResult['console'] = [];
  const original = {
    clearInterval: frame.clearInterval.bind(frame), clearTimeout: frame.clearTimeout.bind(frame),
    setInterval: frame.setInterval.bind(frame), setTimeout: frame.setTimeout.bind(frame),
  };
  const timers = new Set<number>();
  frame.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = original.setTimeout(handler, delay, ...args); timers.add(id); return id;
  }) as typeof frame.setTimeout;
  frame.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = original.setInterval(handler, delay, ...args); timers.add(id); return id;
  }) as typeof frame.setInterval;
  Object.defineProperty(frame, 'onCleanup', { configurable: true, value: (callback: () => void) => cleanups.push(callback) });
  Object.defineProperty(frame, 'SillyTavern', { configurable: true, value: (window as unknown as { SillyTavern?: unknown }).SillyTavern });
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    frameGlobals.console[level] = (...values: unknown[]) => logs.push({ level, values: values.map(serializable) });
  }
  const started = performance.now();
  let result: unknown;
  try {
    const execute = frameGlobals.Function(`return (async () => {\n${code}\n})()`);
    result = await new Promise<unknown>((resolve, reject) => {
      const timer = original.setTimeout(() => reject(new Error(`JavaScript执行超过${timeoutMs}ms，已停止等待。`)), timeoutMs);
      const abort = () => reject(new DOMException('用户已中断JavaScript执行。', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve(execute()).then(resolve, reject).finally(() => {
        original.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      });
    });
  } finally {
    for (const id of timers) { original.clearTimeout(id); original.clearInterval(id); }
    if (timers.size) cleanupLabels.add(`${timers.size} 个计时器`);
    for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch { /* 清理失败不掩盖执行结果 */ } }
    if (cleanups.length) cleanupLabels.add(`${cleanups.length} 个自定义清理函数`);
    cleanupLabels.add('临时同源 iframe、DOM、事件监听器、观察器与进行中的请求');
    iframe.srcdoc = '';
    iframe.remove();
    cleanups.length = 0;
    logs.push({ level: 'debug', values: [`已清理：${[...cleanupLabels].join('、')}`] });
  }
  return {
    cleanup: [...cleanupLabels],
    console: logs,
    durationMs: performance.now() - started,
    result: serializable(result),
  };
}

function tavernConfirmation(input: unknown, toolCallId: string, options: PlaygroundRunnerToolOptions): ToolConfirmation | undefined {
  const environment = (input as { environment?: string }).environment ?? 'sandbox';
  if (environment !== 'tavern' || options.approvalMode() !== 'manual') return undefined;
  return {
    description: '将在临时同源页面中执行JavaScript，并允许访问酒馆助手接口；结束后会销毁运行环境。',
    intent: input,
    risk: 'ordinary',
    toolCallId,
    toolName: 'run_javascript',
  };
}

export function createPlaygroundRunnerTools(repository: WorkspaceRepository, options: PlaygroundRunnerToolOptions): RunnerTool[] {
  return [
    {
      confirmation: (input, toolCallId) => tavernConfirmation(input, toolCallId, options),
      definition: tool({
        description: '在一次性JavaScript环境执行代码。sandbox用于计算；tavern可访问酒馆助手接口并在结束后清理临时环境。',
        inputSchema: z.object({
          code: z.string().optional(),
          environment: z.enum(['sandbox', 'tavern']).optional(),
          path: z.string().optional().describe('也可读取工作区内的.js/.mjs文件执行，与code二选一'),
          timeoutSeconds: z.number().min(1).max(60).optional(),
        }).refine(value => Boolean(value.code) !== Boolean(value.path), 'code与path必须且只能填写一个'),
      }),
      execute: async (input, _toolCallId, context) => {
        const value = input as { code?: string; environment?: 'sandbox' | 'tavern'; path?: string; timeoutSeconds?: number };
        let code = value.code;
        if (value.path) {
          const file = await repository.read(value.path);
          if (isBinaryWorkspaceFile(file) || !/\.m?js$/iu.test(file.path)) throw new Error('run_javascript的path必须是文本.js/.mjs文件。');
          code = file.content;
        }
        const timeoutMs = Math.round((value.timeoutSeconds ?? 15) * 1000);
        const result = value.environment === 'tavern'
          ? await runInTavernFrame(code ?? '', timeoutMs, context?.abortSignal)
          : await runInWorker(code ?? '', timeoutMs, context?.abortSignal);
        return { ...result, environment: value.environment ?? 'sandbox', path: value.path };
      },
      name: 'run_javascript',
      readonly: false,
    },
    {
      definition: tool({
        description:
          '准备一个会话内HTML预览。之后在助手回复中原样输出 <dream-render id="返回的renderId"></dream-render>，完成回复后界面才会展开。',
        inputSchema: z.object({
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
