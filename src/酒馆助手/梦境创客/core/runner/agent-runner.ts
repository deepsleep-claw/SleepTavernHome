import type { ModelMessage, UserContent } from 'ai';
import {
  decideContext,
  compactModelMessages,
  measureContext,
  type ApiUsageBaseline,
  type ContextUsage,
} from './context';
import type { ModelRequestControls, ModelStepExecutor, RunnerToolCall } from './step-executor';
import { COMPACT_CONTEXT_TOOL, type RunnerTool, type ToolConfirmation } from './tools';
import { isRichToolOutput, type ToolResultOutput } from './tool-output';

export type RunnerStatus =
  'completed' | 'context-exhausted' | 'failed' | 'idle' | 'running' | 'stopped' | 'waiting-approval';

export type RunnerEvent =
  | { at: number; messages: ModelMessage[]; type: 'model-completed' }
  | { at: number; call: RunnerToolCall; type: 'tool-started' }
  | { at: number; call: RunnerToolCall; output: unknown; type: 'tool-completed' }
  | { at: number; call: RunnerToolCall; error: string; type: 'tool-failed' }
  | { at: number; message: string; type: 'guidance-injected' }
  | { at: number; summary: string; type: 'context-compacted' }
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
  contextUsage: ContextUsage;
  failure?: string;
  messages: ModelMessage[];
  pending?: PendingRunnerStep;
  status: RunnerStatus;
};

export type AgentRunnerOptions = {
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

/**
 * 旧版Runner可能把AI SDK生成的参数校验错误与本地误执行结果同时保存。
 * 请求前只保留每个call_id的第一份结果，使已有失败会话也能安全恢复。
 */
function deduplicateToolResults(messages: ModelMessage[]): ModelMessage[] {
  const seen = new Set<string>();
  return messages.flatMap(message => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) return [message];
    const content = message.content.filter(part => {
      if (part.type !== 'tool-result') return true;
      if (seen.has(part.toolCallId)) return false;
      seen.add(part.toolCallId);
      return true;
    });
    return content.length > 0 ? [{ ...message, content }] : [];
  });
}

function guidanceMessage(messages: string[]): string {
  return `<mid_turn_guidance>\n这是对当前未完成目标的中途补充，不是替换旧目标的新任务。\n${messages.join('\n')}\n</mid_turn_guidance>`;
}

export class AgentRunner {
  private apiUsageBaseline?: ApiUsageBaseline;
  private readonly contextWindow: number;
  private controller?: AbortController;
  private toolController?: AbortController;
  private compactionFresh = false;
  private readonly executor: ModelStepExecutor;
  private headerMessageCount: number;
  private readonly journal: RunnerJournal;
  private readonly modelControls: ModelRequestControls;
  private providerWebSearchCount = 0;
  private readonly now: () => number;
  private readonly onReasoningDelta?: (delta: string) => void;
  private readonly onTextDelta?: (delta: string) => void;
  private readonly prepareMessages?: (messages: ModelMessage[]) => Promise<ModelMessage[]>;
  private readonly refreshCompactionHeader?: () => Promise<ModelMessage[]>;
  private readonly requestApproval?: (request: ToolConfirmation) => Promise<boolean>;
  private stopRequested = false;
  private readonly toolMap: Map<string, RunnerTool>;
  private readonly tools: RunnerTool[];
  private readonly guidance: string[] = [];
  readonly state: AgentRunnerState;

  constructor(options: AgentRunnerOptions) {
    this.contextWindow = options.contextWindow ?? 128_000;
    this.executor = options.executor;
    this.headerMessageCount = options.headerMessageCount ?? 0;
    this.journal = options.journal;
    this.modelControls = options.modelControls ?? { reasoningEffort: 'auto', webSearch: false };
    this.now = options.now ?? Date.now;
    this.onReasoningDelta = options.onReasoningDelta;
    this.onTextDelta = options.onTextDelta;
    this.prepareMessages = options.prepareMessages;
    this.refreshCompactionHeader = options.refreshCompactionHeader;
    this.requestApproval = options.requestApproval;
    this.tools = [...options.tools, COMPACT_CONTEXT_TOOL];
    this.toolMap = new Map(this.tools.map(item => [item.name, item]));
    const messages = structuredClone(options.initialMessages ?? []);
    this.state = {
      contextUsage: measureContext(messages, this.contextWindow),
      messages,
      pending: options.initialPending ? structuredClone(options.initialPending) : undefined,
      status: options.initialStatus ?? 'idle',
    };
  }

  enqueueGuidance(message: string): void {
    const trimmed = message.trim();
    if (trimmed) this.guidance.push(trimmed);
  }

  stop(): void {
    this.stopRequested = true;
    this.controller?.abort();
    this.toolController?.abort();
  }

  async start(userMessage: UserContent): Promise<AgentRunnerState> {
    if (this.state.status === 'running' || this.state.status === 'waiting-approval') {
      throw new Error('Agent已经在运行。');
    }
    this.state.messages.push({ content: userMessage, role: 'user' });
    return this.runLoop();
  }

  async resume(): Promise<AgentRunnerState> {
    if (!['failed', 'stopped', 'context-exhausted'].includes(this.state.status)) {
      throw new Error('当前Agent没有可恢复的中断点。');
    }
    return this.runLoop();
  }

  private async runLoop(): Promise<AgentRunnerState> {
    try {
      return await this.runLoopUnsafe();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.failure = this.stopRequested ? '用户已停止当前任务。' : message;
      this.state.status = this.stopRequested ? 'stopped' : 'failed';
      try {
        await this.journal.append({
          at: this.now(),
          failure: this.state.failure,
          status: this.state.status,
          type: 'status',
        });
      } catch {
        // 日志或UI订阅本身失败时也必须收束状态，不能留下没有执行协程的running僵尸。
      }
      return this.state;
    } finally {
      this.controller = undefined;
      this.toolController = undefined;
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
        await this.injectGuidance();
        continue;
      }
      const decision = decideContext(this.measureContext());
      this.state.contextUsage = this.measureContext();
      if (decision === 'users-exhausted') {
        this.state.failure = '全部用户消息已超过上下文窗口的80%，请新建会话、编辑历史或更换更大上下文模型。';
        await this.setStatus('context-exhausted');
        return this.state;
      }
      const compacting = decision === 'compact' && !this.compactionFresh;
      this.controller = new AbortController();
      let result;
      const liveProviderStarted = new Set<string>();
      const liveProviderCompleted = new Set<string>();
      try {
        const persistedMessages = deduplicateToolResults(structuredClone(this.state.messages));
        const requestMessages = this.prepareMessages
          ? await this.prepareMessages(persistedMessages)
          : persistedMessages;
        result = await this.executor.execute({
          abortSignal: this.controller.signal,
          forceTool: compacting ? 'compact_context' : undefined,
          messages: requestMessages,
          modelSettings: {
            ...this.modelControls,
            webSearch: this.modelControls.webSearch && this.providerWebSearchCount < 10,
            webSearchMaxUses: Math.max(0, 10 - this.providerWebSearchCount),
          },
          onProviderToolCompleted: async call => {
            liveProviderCompleted.add(call.toolCallId);
            await this.journal.append({ at: this.now(), call, output: call.output ?? { ok: true }, type: 'tool-completed' });
          },
          onProviderToolStarted: async call => {
            liveProviderStarted.add(call.toolCallId);
            if (call.toolName === 'web_search') this.providerWebSearchCount += 1;
            await this.journal.append({ at: this.now(), call, type: 'tool-started' });
          },
          onReasoningDelta: this.onReasoningDelta,
          onTextDelta: this.onTextDelta,
          tools: this.tools,
        });
      } catch (error) {
        if (this.stopRequested) return this.finishStopped();
        this.state.failure = error instanceof Error ? error.message : String(error);
        await this.setStatus('failed');
        return this.state;
      }
      modelSteps += 1;
      if (!compacting) this.compactionFresh = false;
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
          await this.journal.append({ at: this.now(), call, output: call.output ?? { ok: true }, type: 'tool-completed' });
        }
      }
      const attemptedCalls = [...result.toolCalls, ...(result.invalidToolCalls ?? [])];
      if (compacting && !attemptedCalls.some(call => call.toolName === 'compact_context')) {
        this.state.failure = '模型没有按要求调用compact_context。';
        await this.setStatus('failed');
        return this.state;
      }
      if (result.toolCalls.length > 0) {
        this.state.pending = { calls: result.toolCalls, compacting, nextCall: 0 };
        continue;
      }
      if ((result.invalidToolCalls?.length ?? 0) > 0) {
        // 参数校验错误属于可恢复的工具失败：把SDK生成的错误结果送回模型，让它修正参数。
        await this.injectGuidance();
        continue;
      }
      if (this.guidance.length > 0) {
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
      let dependencyFailed = false;
      for (const call of remaining) {
        if (this.stopRequested) return this.finishStopped().then(() => false);
        if (dependencyFailed) {
          await this.skipTool(call);
          pending.nextCall += 1;
          continue;
        }
        try {
          const output = await this.executeOne(call);
          await this.completeTool(call, output);
          pending.nextCall += 1;
        } catch (error) {
          await this.failTool(call, error);
          pending.nextCall += 1;
          dependencyFailed = true;
        }
      }
    }
    if (pending.compacting) {
      const compactCall = pending.calls.find(call => call.toolName === 'compact_context');
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

  private async executeOne(call: RunnerToolCall): Promise<unknown> {
    const target = this.toolMap.get(call.toolName);
    if (!target) throw new Error(`模型调用了未知工具：${call.toolName}`);
    await this.journal.append({ at: this.now(), call, type: 'tool-started' });
    const confirmation = await target.confirmation?.(call.input, call.toolCallId);
    if (confirmation) {
      await this.setStatus('waiting-approval');
      const approved = (await this.requestApproval?.(confirmation)) ?? false;
      await this.setStatus('running');
      if (!approved) return { approved: false, message: '用户拒绝了这次高危操作。' };
    }
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
    if (this.guidance.length === 0) return;
    const message = guidanceMessage(this.guidance.splice(0));
    this.state.messages.push({ content: message, role: 'user' });
    await this.journal.append({ at: this.now(), message, type: 'guidance-injected' });
  }

  private async finishStopped(): Promise<AgentRunnerState> {
    this.state.contextUsage = this.measureContext();
    await this.setStatus('stopped');
    return this.state;
  }

  private async setStatus(status: RunnerStatus): Promise<void> {
    this.state.status = status;
    await this.journal.append({ at: this.now(), failure: this.state.failure, status, type: 'status' });
  }

  private measureContext(): ContextUsage {
    return measureContext(this.state.messages, this.contextWindow, this.apiUsageBaseline);
  }
}
