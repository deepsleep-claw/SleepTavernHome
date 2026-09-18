import type { ModelMessage, UserContent } from 'ai';
import { boundedWait } from '../async';
import {
  decideContext,
  compactModelMessages,
  measureContext,
  type ApiUsageBaseline,
  type ContextUsage,
} from './context';
import type {
  ModelRequestControls,
  ModelStepExecutor,
  RunnerToolCall,
  RunnerToolInputDelta,
  RunnerToolInputStart,
} from './step-executor';
import { COMPACT_CONTEXT_TOOL, type RunnerTool, type ToolConfirmation } from './tools';
import { isRichToolOutput, type ToolResultOutput } from './tool-output';
import { isSameOrDescendant, normalizeWorkspacePath } from '../workspace/path';

export type RunnerStatus =
  'completed' | 'context-exhausted' | 'failed' | 'idle' | 'running' | 'stopped' | 'waiting-approval';

export type RunnerEvent =
  | { at: number; messages: ModelMessage[]; type: 'model-completed' }
  | { at: number; call: RunnerToolCall; type: 'tool-started' }
  | { at: number; call: RunnerToolCall; type: 'tool-executing' }
  | { at: number; call: RunnerToolCall; output: unknown; type: 'tool-completed' }
  | { at: number; call: RunnerToolCall; error: string; type: 'tool-failed' }
  | { at: number; message: string; ids?: string[]; type: 'guidance-injected' }
  | { at: number; summary: string; type: 'context-compacted' }
  | { at: number; type: 'context-compaction-started' }
  | { at: number; failure?: string; status: RunnerStatus; type: 'status' };

export interface RunnerJournal {
  append(event: RunnerEvent): Promise<void>;
}

export class MemoryRunnerJournal implements RunnerJournal {
  readonly events: RunnerEvent[] = [];
  async append(event: RunnerEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

export type PendingRunnerStep = {
  calls: RunnerToolCall[];
  compacting: boolean;
  nextCall: number;
};

export type AgentRunnerState = {
  guidance: Array<{ id: string; message: string }>;
  contextUsage: ContextUsage;
  failure?: string;
  messages: ModelMessage[];
  pending?: PendingRunnerStep;
  status: RunnerStatus;
};

export type AgentRunnerOptions = {
  initialApiUsageBaseline?: ApiUsageBaseline;
  initialGuidance?: Array<{ id: string; message: string }>;
  compactionEnabled?: boolean;
  contextWindow?: number;
  executor: ModelStepExecutor;
  headerMessageCount?: number;
  initialMessages?: ModelMessage[];
  initialPending?: PendingRunnerStep;
  initialStatus?: RunnerStatus;
  journal: RunnerJournal;
  modelControls?: ModelRequestControls;
  now?: () => number;
  onReasoningDelta?: (delta: string) => void;
  onTextDelta?: (delta: string) => void;
  onToolInputDelta?: (update: RunnerToolInputDelta) => void;
  onToolInputReady?: (call: RunnerToolCall) => void;
  onToolInputStarted?: (call: RunnerToolInputStart) => void;
  prepareMessages?: (messages: ModelMessage[]) => Promise<ModelMessage[]>;
  refreshCompactionHeader?: () => Promise<ModelMessage[]>;
  requestApproval?: (request: ToolConfirmation) => Promise<boolean>;
  tools: RunnerTool[];
};

function toolResultMessage(call: RunnerToolCall, output: unknown): ModelMessage {
  const modelOutput: ToolResultOutput = isRichToolOutput(output)
    ? output.modelOutput
    : { type: 'json', value: output as never };
  return {
    content: [
      {
        output: modelOutput,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        type: 'tool-result',
      },
    ],
    role: 'tool',
  };
}

function toolFailureOutput(error: unknown, skipped = false): Record<string, unknown> {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: {
      code: typeof value?.code === 'string' ? value.code : 'TOOL_EXECUTION_FAILED',
      message,
      path: typeof value?.path === 'string' ? value.path : undefined,
    },
    instruction: skipped
      ? '前一个有依赖关系的工具失败，本调用没有执行。请根据错误重新规划。'
      : '请检查参数与当前工作区状态，自行决定修正后重试、改用其他工具或向用户说明。',
    ok: false,
    retryable: true,
    skipped,
  };
}

function guidanceMessage(messages: string[]): string {
  return `<mid_turn_guidance>\n用户在运行期间发来的新指示；根据其意图补充、纠正或替换当前目标。\n${messages.join('\n')}\n</mid_turn_guidance>`;
}

function fileToolPaths(call: RunnerToolCall): string[] | undefined {
  const input = call.input as Record<string, unknown> | undefined;
  const keys = ['copy_path', 'move_path'].includes(call.toolName)
    ? ['from', 'to']
    : ['read_file', 'list_path', 'search_files', 'write_file', 'apply_patch', 'delete_path'].includes(call.toolName)
      ? ['path']
      : undefined;
  if (!input || !keys) return undefined;
  try {
    return keys.map(key => normalizeWorkspacePath(typeof input[key] === 'string' ? input[key] : '/'));
  } catch {
    return undefined;
  }
}

function mayDependOn(call: RunnerToolCall, failed: RunnerToolCall): boolean {
  const paths = fileToolPaths(call);
  const failedPaths = fileToolPaths(failed);
  if (!paths || !failedPaths) return true;
  return paths.some(path => failedPaths.some(previous => isSameOrDescendant(path, previous) || isSameOrDescendant(previous, path)));
}

export class AgentRunner {
  private apiUsageBaseline?: ApiUsageBaseline;
  private readonly contextWindow: number;
  private controller?: AbortController;
  private runController?: AbortController;
  private toolController?: AbortController;
  private compactionFresh = false;
  private manualCompaction = false;
  private readonly compactionEnabled: boolean;
  private readonly executor: ModelStepExecutor;
  private headerMessageCount: number;
  private readonly journal: RunnerJournal;
  private readonly modelControls: ModelRequestControls;
  private providerWebSearchCount = 0;
  private readonly now: () => number;
  private readonly onReasoningDelta?: (delta: string) => void;
  private readonly onTextDelta?: (delta: string) => void;
  private readonly onToolInputDelta?: (update: RunnerToolInputDelta) => void;
  private readonly onToolInputReady?: (call: RunnerToolCall) => void;
  private readonly onToolInputStarted?: (call: RunnerToolInputStart) => void;
  private readonly prepareMessages?: (messages: ModelMessage[]) => Promise<ModelMessage[]>;
  private readonly refreshCompactionHeader?: () => Promise<ModelMessage[]>;
  private readonly requestApproval?: (request: ToolConfirmation) => Promise<boolean>;
  private stopRequested = false;
  private readonly toolMap: Map<string, RunnerTool>;
  private readonly tools: RunnerTool[];
  readonly state: AgentRunnerState;

  constructor(options: AgentRunnerOptions) {
    this.apiUsageBaseline = options.initialApiUsageBaseline
      ? structuredClone(options.initialApiUsageBaseline)
      : undefined;
    this.contextWindow = options.contextWindow ?? 128_000;
    this.compactionEnabled = options.compactionEnabled ?? true;
    this.executor = options.executor;
    this.headerMessageCount = options.headerMessageCount ?? 0;
    this.journal = {
      append: event =>
        boundedWait(
          options.journal.append(event),
          '保存任务进度',
          event.type === 'status' && !['running', 'waiting-approval'].includes(event.status) ? 1000 : 15_000,
          event.type === 'status' && !['running', 'waiting-approval'].includes(event.status)
            ? undefined
            : this.runController?.signal,
        ),
    };
    this.modelControls = options.modelControls ?? { reasoningEffort: 'auto', webSearch: false };
    this.now = options.now ?? Date.now;
    this.onReasoningDelta = options.onReasoningDelta;
    this.onTextDelta = options.onTextDelta;
    this.onToolInputDelta = options.onToolInputDelta;
    this.onToolInputReady = options.onToolInputReady;
    this.onToolInputStarted = options.onToolInputStarted;
    this.prepareMessages = options.prepareMessages;
    this.refreshCompactionHeader = options.refreshCompactionHeader;
    this.requestApproval = options.requestApproval;
    this.tools = this.compactionEnabled ? [...options.tools, COMPACT_CONTEXT_TOOL] : [...options.tools];
    this.toolMap = new Map(this.tools.map(item => [item.name, item]));
    const messages = structuredClone(options.initialMessages ?? []);
    this.state = {
      guidance: structuredClone(options.initialGuidance ?? []),
      contextUsage: measureContext(messages, this.contextWindow, this.apiUsageBaseline),
      messages,
      pending: options.initialPending ? structuredClone(options.initialPending) : undefined,
      status: options.initialStatus ?? 'idle',
    };
  }

  enqueueGuidance(message: string, id = crypto.randomUUID()): string {
    const trimmed = message.trim();
    if (trimmed) this.state.guidance.push({ id, message: trimmed });
    return id;
  }

  usageBaseline(): ApiUsageBaseline | undefined {
    return this.apiUsageBaseline ? structuredClone(this.apiUsageBaseline) : undefined;
  }

  resetUsageBaseline(): void {
    this.apiUsageBaseline = undefined;
    this.state.contextUsage = this.measureContext();
  }

  stop(): void {
    this.stopRequested = true;
    this.runController?.abort();
    this.controller?.abort();
    this.toolController?.abort();
  }

  async start(userMessage: UserContent): Promise<AgentRunnerState> {
    if (this.state.status === 'running' || this.state.status === 'waiting-approval') {
      throw new Error('Agent已经在运行。');
    }
    this.state.messages.push({ content: userMessage, role: 'user' });
    this.compactionFresh = false;
    return this.runLoop();
  }

  async resume(): Promise<AgentRunnerState> {
    if (!['failed', 'stopped', 'context-exhausted'].includes(this.state.status)) {
      throw new Error('当前Agent没有可恢复的中断点。');
    }
    return this.runLoop();
  }

  async compact(): Promise<AgentRunnerState> {
    if (!this.compactionEnabled) throw new Error('当前助手未启用上下文压缩工具。');
    if (['running', 'waiting-approval'].includes(this.state.status) || this.state.pending)
      throw new Error('请先停止或完成当前任务再压缩。');
    this.compactionFresh = false;
    return this.runLoop(true);
  }

  private async runLoop(manualCompaction = false): Promise<AgentRunnerState> {
    this.manualCompaction = manualCompaction;
    this.runController = new AbortController();
    try {
      return await this.runLoopUnsafe();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.failure = this.stopRequested ? '用户已停止当前任务。' : message;
      this.state.status = this.stopRequested ? 'stopped' : 'failed';
      try {
        await boundedWait(
          this.journal.append({
            at: this.now(),
            failure: this.state.failure,
            status: this.state.status,
            type: 'status',
          }),
          '保存任务结束状态',
          1000,
        );
      } catch {
        // 日志或UI订阅本身失败时也必须收束状态，不能留下没有执行协程的running僵尸。
      }
      return this.state;
    } finally {
      this.controller = undefined;
      this.toolController = undefined;
      this.runController = undefined;
      this.manualCompaction = false;
    }
  }

  private async runLoopUnsafe(): Promise<AgentRunnerState> {
    this.stopRequested = false;
    this.state.failure = undefined;
    await this.setStatus('running');
    let modelSteps = 0;
    while (modelSteps < 64) {
      if (this.stopRequested) return this.finishStopped();
      if (this.state.pending) {
        const completed = await this.executePending();
        if (!completed) return this.state;
        if (this.manualCompaction && this.compactionFresh) {
          await this.setStatus('completed');
          return this.state;
        }
        await this.injectGuidance();
        continue;
      }
      await this.injectGuidance();
      const reserve = Math.min(4096, Math.floor(this.contextWindow * 0.1));
      const decision = decideContext(this.measureContext(), reserve);
      this.state.contextUsage = this.measureContext();
      if (decision === 'users-exhausted') {
        this.state.failure = '全部用户消息已超过上下文窗口的80%，请新建会话、编辑历史或更换更大上下文模型。';
        await this.setStatus('context-exhausted');
        return this.state;
      }
      if (decision === 'compact' && !this.compactionEnabled) {
        this.state.failure = '上下文已达到压缩阈值，但当前Agent关闭了上下文压缩工具。请新建会话或换用更大上下文模型。';
        await this.setStatus('context-exhausted');
        return this.state;
      }
      if (this.manualCompaction || (decision === 'compact' && !this.compactionFresh)) {
        await this.compactBeforeRequest();
        if (this.manualCompaction) {
          await this.setStatus('completed');
          return this.state;
        }
        continue;
      }
      if (this.compactionFresh && this.measureContext().remainingTokens < reserve) {
        this.state.failure = '压缩后仍没有足够的上下文空间，请减少本轮输入或更换更大上下文模型。';
        await this.setStatus('context-exhausted');
        return this.state;
      }
      this.controller = new AbortController();
      let result;
      const liveProviderStarted = new Set<string>();
      const liveProviderCompleted = new Set<string>();
      try {
        const persistedMessages = structuredClone(this.state.messages);
        const requestMessages = this.prepareMessages
          ? await boundedWait(
              this.prepareMessages(persistedMessages),
              '读取消息附件',
              15_000,
              this.runController?.signal,
            )
          : persistedMessages;
        result = await this.executor.execute({
          abortSignal: this.controller.signal,
          messages: requestMessages,
          modelSettings: {
            ...this.modelControls,
            webSearch: this.modelControls.webSearch && this.providerWebSearchCount < 10,
            webSearchMaxUses: Math.max(0, 10 - this.providerWebSearchCount),
          },
          onProviderToolCompleted: async call => {
            liveProviderCompleted.add(call.toolCallId);
            await this.journal.append({
              at: this.now(),
              call,
              output: call.output ?? { ok: true },
              type: 'tool-completed',
            });
          },
          onProviderToolStarted: async call => {
            liveProviderStarted.add(call.toolCallId);
            if (call.toolName === 'web_search') this.providerWebSearchCount += 1;
            await this.journal.append({ at: this.now(), call, type: 'tool-started' });
          },
          onReasoningDelta: this.onReasoningDelta,
          onTextDelta: this.onTextDelta,
          onToolInputDelta: this.onToolInputDelta,
          onToolInputReady: this.onToolInputReady,
          onToolInputStarted: this.onToolInputStarted,
          tools: this.tools,
        });
      } catch (error) {
        if (this.stopRequested) return this.finishStopped();
        this.state.failure = error instanceof Error ? error.message : String(error);
        await this.setStatus('failed');
        return this.state;
      }
      modelSteps += 1;
      this.compactionFresh = false;
      this.state.messages.push(...structuredClone(result.assistantMessages));
      if (typeof result.inputTokens === 'number' && typeof result.outputTokens === 'number') {
        this.apiUsageBaseline = {
          estimatedTokens: measureContext(this.state.messages, this.contextWindow).totalTokens,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        };
      }
      await this.journal.append({ at: this.now(), messages: result.assistantMessages, type: 'model-completed' });
      for (const call of result.invalidToolCalls ?? []) {
        // responseMessages中已经带有AI SDK生成的唯一tool-result；这里只补UI事件，绝不能再次执行或追加结果。
        await this.journal.append({ at: this.now(), call, type: 'tool-started' });
        await this.journal.append({ at: this.now(), call, error: call.error, type: 'tool-failed' });
      }
      for (const call of result.providerToolCalls ?? []) {
        if (!liveProviderStarted.has(call.toolCallId)) {
          if (call.toolName === 'web_search') this.providerWebSearchCount += 1;
          await this.journal.append({ at: this.now(), call, type: 'tool-started' });
        }
        if (!liveProviderCompleted.has(call.toolCallId)) {
          await this.journal.append({
            at: this.now(),
            call,
            output: call.output ?? { ok: true },
            type: 'tool-completed',
          });
        }
      }
      if (result.toolCalls.length > 0) {
        this.state.pending = { calls: result.toolCalls, compacting: false, nextCall: 0 };
        continue;
      }
      if ((result.invalidToolCalls?.length ?? 0) > 0) {
        // 参数校验错误属于可恢复的工具失败：把SDK生成的错误结果送回模型，让它修正参数。
        await this.injectGuidance();
        continue;
      }
      if (this.state.guidance.length > 0) {
        await this.injectGuidance();
        continue;
      }
      this.state.contextUsage = this.measureContext();
      await this.setStatus('completed');
      return this.state;
    }
    this.state.failure = '单次任务超过64个模型步骤，已暂停以避免失控循环。';
    await this.setStatus('failed');
    return this.state;
  }

  private async executePending(): Promise<boolean> {
    const pending = this.state.pending!;
    let completedCompaction: RunnerToolCall | undefined;
    const remaining = pending.calls.slice(pending.nextCall);
    const allReadonly = remaining.every(call => this.toolMap.get(call.toolName)?.readonly);
    if (allReadonly) {
      const settled = await Promise.allSettled(remaining.map(call => this.executeOne(call)));
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        const call = remaining[index];
        if (result.status === 'rejected') {
          await this.failTool(call, result.reason);
        } else {
          await this.completeTool(call, result.value);
        }
        pending.nextCall += 1;
      }
    } else {
      const failedCalls: RunnerToolCall[] = [];
      for (const call of remaining) {
        if (this.stopRequested) return this.finishStopped().then(() => false);
        if (failedCalls.some(failed => mayDependOn(call, failed))) {
          await this.skipTool(call);
          failedCalls.push(call);
          pending.nextCall += 1;
          continue;
        }
        try {
          const output = await this.executeOne(call);
          await this.completeTool(call, output);
          if (call.toolName === 'compact_context') completedCompaction = call;
          pending.nextCall += 1;
        } catch (error) {
          await this.failTool(call, error);
          pending.nextCall += 1;
          failedCalls.push(call);
        }
      }
    }
    if (pending.compacting || completedCompaction) {
      const compactCall = completedCompaction;
      const summary = (compactCall?.input as { summary?: unknown } | undefined)?.summary;
      if (typeof summary !== 'string' || !summary.trim()) {
        this.state.failure = 'compact_context没有返回有效摘要。';
        await this.setStatus('failed');
        return false;
      }
      const previousHeaderMessageCount = this.headerMessageCount;
      const replacementHeader = this.refreshCompactionHeader
        ? await this.refreshCompactionHeader()
        : this.state.messages.slice(0, previousHeaderMessageCount);
      this.headerMessageCount = replacementHeader.length;
      this.state.messages = compactModelMessages(
        this.state.messages,
        summary,
        previousHeaderMessageCount,
        replacementHeader,
      );
      this.apiUsageBaseline = undefined;
      this.compactionFresh = true;
      await this.journal.append({ at: this.now(), summary, type: 'context-compacted' });
    }
    this.state.pending = undefined;
    this.state.contextUsage = this.measureContext();
    return true;
  }

  /** 独立的摘要请求不进入对话工具链；成功后才替换下一次调用所用的上下文。 */
  private async compactBeforeRequest(): Promise<void> {
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const original = structuredClone(this.state.messages);
    await this.journal.append({ at: this.now(), type: 'context-compaction-started' });
    const messages = this.prepareMessages
      ? await boundedWait(this.prepareMessages(original), '准备压缩上下文', 15_000, signal)
      : original;
    const result = await this.executor.execute({
      abortSignal: signal,
      messages: [
        ...messages,
        {
          role: 'user',
          content:
            '请只输出一份简明的上下文交接摘要，保留用户目标与约束、已完成的真实修改、关键发现、失败点、最新请求和待办。不要继续执行任务，不要调用工具，不要声称完成未经证实的操作。',
        },
      ],
      modelSettings: { ...this.modelControls, webSearch: false, maxOutputTokens: 4096 },
      tools: [],
    });
    if (this.stopRequested) throw new Error('压缩已取消。');
    const summary = result.text.trim();
    if (!summary || result.toolCalls.length) throw new Error('压缩请求没有返回有效的文本摘要，原上下文已保留。');
    const oldHeaderCount = this.headerMessageCount;
    const header = this.refreshCompactionHeader
      ? await this.refreshCompactionHeader()
      : original.slice(0, oldHeaderCount);
    this.state.messages = compactModelMessages(original, summary, oldHeaderCount, header);
    this.headerMessageCount = header.length;
    this.apiUsageBaseline = undefined;
    this.compactionFresh = true;
    this.state.contextUsage = this.measureContext();
    await this.journal.append({ at: this.now(), summary, type: 'context-compacted' });
  }

  private async executeOne(call: RunnerToolCall): Promise<unknown> {
    const target = this.toolMap.get(call.toolName);
    if (!target) throw new Error(`模型调用了未知工具：${call.toolName}`);
    await this.journal.append({ at: this.now(), call, type: 'tool-started' });
    const confirmation = await target.confirmation?.(call.input, call.toolCallId);
    if (confirmation) {
      await this.setStatus('waiting-approval');
      const approved = this.requestApproval
        ? await boundedWait(
            this.requestApproval(confirmation),
            '等待工具确认',
            24 * 60 * 60 * 1000,
            this.runController?.signal,
          )
        : false;
      await this.setStatus('running');
      if (!approved) return { approved: false, message: '用户拒绝了这次高危操作。' };
    }
    await this.journal.append({ at: this.now(), call, type: 'tool-executing' });
    this.toolController = new AbortController();
    if (this.stopRequested) this.toolController.abort();
    try {
      return await target.execute(call.input, call.toolCallId, { abortSignal: this.toolController.signal });
    } finally {
      this.toolController = undefined;
    }
  }

  private async completeTool(call: RunnerToolCall, output: unknown): Promise<void> {
    this.state.messages.push(toolResultMessage(call, output));
    await this.journal.append({
      at: this.now(),
      call,
      output: isRichToolOutput(output) ? output.display : output,
      type: 'tool-completed',
    });
  }

  private async failTool(call: RunnerToolCall, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.state.messages.push(toolResultMessage(call, toolFailureOutput(error)));
    await this.journal.append({ at: this.now(), call, error: message, type: 'tool-failed' });
  }

  private async skipTool(call: RunnerToolCall): Promise<void> {
    const message = '前一个有依赖关系的工具失败，本调用未执行。';
    await this.journal.append({ at: this.now(), call, type: 'tool-started' });
    this.state.messages.push(toolResultMessage(call, toolFailureOutput(message, true)));
    await this.journal.append({ at: this.now(), call, error: message, type: 'tool-failed' });
  }

  private async injectGuidance(): Promise<void> {
    if (this.state.guidance.length === 0) return;
    const queued = this.state.guidance.splice(0);
    const message = guidanceMessage(queued.map(item => item.message));
    this.state.messages.push({ content: message, role: 'user' });
    await this.journal.append({ at: this.now(), ids: queued.map(item => item.id), message, type: 'guidance-injected' });
  }

  private async finishStopped(): Promise<AgentRunnerState> {
    this.state.contextUsage = this.measureContext();
    await this.setStatus('stopped');
    return this.state;
  }

  private async setStatus(status: RunnerStatus): Promise<void> {
    this.state.status = status;
    await boundedWait(
      this.journal.append({ at: this.now(), failure: this.state.failure, status, type: 'status' }),
      '保存任务状态',
      15_000,
      status === 'running' || status === 'waiting-approval' ? this.runController?.signal : undefined,
    );
  }

  private measureContext(): ContextUsage {
    return measureContext(this.state.messages, this.contextWindow, this.apiUsageBaseline);
  }
}
