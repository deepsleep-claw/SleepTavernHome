import { asSchema, type ModelMessage, type UserContent } from 'ai';
import { boundedWait } from '../async';
import { createCooperativeYield } from '../cooperative';
import {
  decideContext,
  compactModelMessages,
  measureContext,
  estimateTokens,
  normalizeTokenUsage,
  outputTokenBudget,
  type ApiUsageBaseline,
  type ContextUsage,
} from './context';
import { selectCompaction, reduceCompactionInput, composeCompactedMessages } from './context-compaction';
import { isContextExceeded, isRetryableSummaryError } from './context-errors';
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
  | { at: number; summary: string; beforeTokens?: number; afterTokens?: number; type: 'context-compacted' }
  | { at: number; type: 'context-compaction-started' }
  | { at: number; reason: string; type: 'context-compaction-skipped' }
  | { at: number; attempt: number; reason: string; type: 'context-compaction-retrying' }
  | { at: number; failure?: string; status: RunnerStatus; type: 'status' };

export interface RunnerJournal {
  append(event: RunnerEvent): Promise<void>;
}

class CompactionSaveError extends Error {
  constructor(cause: unknown) {
    super('压缩结果未能保存，原上下文已保留。', { cause });
  }
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
  return paths.some(path =>
    failedPaths.some(previous => isSameOrDescendant(path, previous) || isSameOrDescendant(previous, path)),
  );
}

export class AgentRunner {
  private apiUsageBaseline?: ApiUsageBaseline;
  private readonly contextWindow: number;
  private controller?: AbortController;
  private runController?: AbortController;
  private toolController?: AbortController;
  private compactionFresh = false;
  private manualCompaction = false;
  private compactionInstructions = '';
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
  private toolSchemaTokens = 0;
  private toolSchemaReady?: Promise<void>;
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
    this.toolSchemaTokens = options.initialApiUsageBaseline?.toolSchemaTokens ?? 0;
    const messages = structuredClone(options.initialMessages ?? []);
    this.state = {
      guidance: structuredClone(options.initialGuidance ?? []),
      contextUsage: measureContext(messages, this.contextWindow, this.apiUsageBaseline, this.toolSchemaTokens),
      messages,
      pending: options.initialPending ? structuredClone(options.initialPending) : undefined,
      status: options.initialStatus ?? 'idle',
    };
  }

  enqueueGuidance(message: string, id: string = crypto.randomUUID()): string {
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

  async compact(instructions = ''): Promise<AgentRunnerState> {
    if (!this.compactionEnabled) throw new Error('当前助手未启用上下文压缩工具。');
    if (['running', 'waiting-approval'].includes(this.state.status)) throw new Error('请先停止或完成当前任务再压缩。');
    this.compactionFresh = false;
    this.compactionInstructions = instructions.trim();
    try {
      return await this.runLoop(true);
    } finally {
      this.compactionInstructions = '';
    }
  }

  private async runLoop(manualCompaction = false): Promise<AgentRunnerState> {
    this.manualCompaction = manualCompaction;
    this.runController = new AbortController();
    try {
      return await this.runLoopUnsafe();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.failure = this.stopRequested ? '用户已停止当前任务。' : message;
      this.state.status = this.stopRequested ? 'stopped' : isContextExceeded(error) ? 'context-exhausted' : 'failed';
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
    await this.prepareToolSchemas();
    if (this.manualCompaction) {
      await this.compactBeforeRequest();
      if (this.stopRequested) return this.finishStopped();
      await this.setStatus('completed');
      return this.state;
    }
    let modelSteps = 0;
    let reactiveCompactionAttempted = false;
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
      const reserve = Math.min(this.executor.maxOutputTokens ?? 32_000, Math.floor(this.contextWindow * 0.2));
      const decision = decideContext(this.measureContext(), reserve);
      this.state.contextUsage = this.measureContext();
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
      const maxOutputTokens = outputTokenBudget(
        this.contextWindow,
        this.measureContext().totalTokens,
        this.executor.maxOutputTokens,
      );
      if (maxOutputTokens <= 0) {
        this.state.failure = '压缩后仍没有足够的上下文空间，请减少本轮输入或更换更大上下文模型。';
        await this.setStatus('context-exhausted');
        return this.state;
      }
      this.controller = new AbortController();
      let result;
      const estimatedAtRequest = measureContext(
        this.state.messages,
        this.contextWindow,
        undefined,
        this.toolSchemaTokens,
      ).totalTokens;
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
            maxOutputTokens,
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
        if (isContextExceeded(result.rawFinishReason) || isContextExceeded(result.finishReason))
          throw new Error(result.rawFinishReason ?? result.finishReason);
      } catch (error) {
        if (this.stopRequested) return this.finishStopped();
        if (isContextExceeded(error) && this.compactionEnabled && !reactiveCompactionAttempted) {
          reactiveCompactionAttempted = true;
          await this.compactBeforeRequest();
          continue;
        }
        this.state.failure = error instanceof Error ? error.message : String(error);
        await this.setStatus(isContextExceeded(error) ? 'context-exhausted' : 'failed');
        return this.state;
      }
      modelSteps += 1;
      reactiveCompactionAttempted = false;
      this.compactionFresh = false;
      this.state.messages.push(...structuredClone(result.assistantMessages));
      const usage = normalizeTokenUsage(result);
      if (usage.inputTokens !== undefined && usage.inputTokens > 0) {
        this.apiUsageBaseline = {
          ...usage,
          version: 2,
          estimatedTokens: estimatedAtRequest,
          inputTokens: usage.inputTokens,
          toolSchemaTokens: this.toolSchemaTokens,
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
      const candidate = compactModelMessages(
        this.state.messages,
        summary,
        previousHeaderMessageCount,
        replacementHeader,
      );
      await this.commitCompaction(candidate, summary, replacementHeader.length);
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
    let selection = selectCompaction(original, this.headerMessageCount);
    if (
      this.manualCompaction &&
      this.measureContext().ratio < 0.7 &&
      measureContext(selection.groups.flat(), this.contextWindow).totalTokens < 256
    ) {
      await this.journal.append({
        at: this.now(),
        reason: '暂无足够可压缩的旧消息，当前内容已保留。',
        type: 'context-compaction-skipped',
      });
      return;
    }
    if (selection.groups.length === 0)
      throw new Error(
        '上下文空间不足，当前只有最新输入和最近模型步骤，无法继续压缩。请缩短最新输入或更换更大上下文模型。',
      );
    const beforeTokens = measureContext(original, this.contextWindow, undefined, this.toolSchemaTokens).totalTokens;
    await this.journal.append({ at: this.now(), type: 'context-compaction-started' });
    // 摘要有独立输出预算，为推理内容留出空间，同时服从模型上限和剩余窗口。
    let summaryLimit = Math.min(8192, this.executor.maxOutputTokens ?? 20_000);
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (this.stopRequested || signal.aborted) throw new Error('压缩已取消。');
      const selected = [...selection.header, ...selection.systems, ...selection.groups.flat()];
      const messages = this.prepareMessages
        ? await boundedWait(this.prepareMessages(selected), '准备压缩上下文', 15_000, signal)
        : selected;
      const requestMessages: ModelMessage[] = [
        ...messages,
        {
          role: 'user',
          content:
            '请只输出一份简明的上下文交接摘要，保留用户目标与约束、已完成的真实修改、关键发现、失败点和待办。最新输入和最近步骤会另外保留，不要继续执行任务，不要调用工具。摘要应显著短于原文，最多约 1500 字。' +
            (this.manualCompaction && this.compactionInstructions
              ? `\n\n用户指定的摘要重点：\n${this.compactionInstructions}`
              : ''),
        },
      ];
      const budget = outputTokenBudget(
        this.contextWindow,
        measureContext(requestMessages, this.contextWindow).totalTokens,
        summaryLimit,
      );
      let reason: string;
      try {
        if (budget <= 0) throw new Error('摘要输入超过上下文窗口。');
        const result = await this.executor.execute({
          abortSignal: signal,
          purpose: 'summary',
          messages: requestMessages,
          modelSettings: { ...this.modelControls, webSearch: false, maxOutputTokens: budget },
          tools: [],
        });
        if (this.stopRequested || signal.aborted) throw new Error('压缩已取消。');
        if (isContextExceeded(result.rawFinishReason) || isContextExceeded(result.finishReason))
          throw new Error(result.rawFinishReason ?? result.finishReason);
        const summary = result.text.trim();
        if (result.toolCalls.length) throw new Error('压缩请求意外返回了工具调用，原上下文已保留。');
        if (!summary || result.finishReason !== 'stop') {
          reason = !summary ? '摘要为空' : `摘要未完整结束（${result.finishReason}）`;
          summaryLimit = Math.min(summaryLimit * 2, this.executor.maxOutputTokens ?? 20_000, 20_000);
        } else {
          const header = this.refreshCompactionHeader ? await this.refreshCompactionHeader() : selection.header;
          if (this.stopRequested || signal.aborted) throw new Error('压缩已取消。');
          const candidate = composeCompactedMessages(selection, summary, header);
          const afterTokens = measureContext(
            candidate,
            this.contextWindow,
            undefined,
            this.toolSchemaTokens,
          ).totalTokens;
          if (afterTokens >= beforeTokens) {
            reason = '摘要未减少上下文占用';
          } else {
            await this.commitCompaction(candidate, summary, header.length);
            return;
          }
        }
      } catch (error) {
        if (error instanceof CompactionSaveError) throw error;
        if (this.stopRequested || signal.aborted) throw new Error('压缩已取消。');
        if (isContextExceeded(error)) {
          const reduced = reduceCompactionInput(selection);
          if (!reduced)
            throw new Error('摘要输入仍超出模型上下文窗口，原上下文已保留。请更换更大上下文模型后重试。', {
              cause: error,
            });
          selection = reduced;
          reason = '摘要输入超限，已缩小待摘要范围';
        } else if (isRetryableSummaryError(error)) {
          reason = error instanceof Error ? error.message : String(error);
        } else throw error;
      }
      if (attempt === 3) throw new Error(`压缩在 3 次尝试后仍未完成：${reason}。原上下文已保留。`);
      await this.journal.append({ at: this.now(), attempt: attempt + 1, reason, type: 'context-compaction-retrying' });
    }
  }

  private async commitCompaction(messages: ModelMessage[], summary: string, headerCount: number): Promise<void> {
    const original = this.state.messages;
    const header = this.headerMessageCount;
    const baseline = this.apiUsageBaseline;
    const beforeTokens = measureContext(original, this.contextWindow, undefined, this.toolSchemaTokens).totalTokens;
    const afterTokens = measureContext(messages, this.contextWindow, undefined, this.toolSchemaTokens).totalTokens;
    if (afterTokens >= beforeTokens) throw new Error('摘要未减少上下文占用，原上下文已保留。');
    this.state.messages = messages;
    this.headerMessageCount = headerCount;
    this.apiUsageBaseline = undefined;
    this.state.contextUsage = this.measureContext();
    try {
      await this.journal.append({ at: this.now(), summary, beforeTokens, afterTokens, type: 'context-compacted' });
      this.compactionFresh = true;
    } catch (error) {
      this.state.messages = original;
      this.headerMessageCount = header;
      this.apiUsageBaseline = baseline;
      this.state.contextUsage = this.measureContext();
      throw new CompactionSaveError(error);
    }
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
      await createCooperativeYield()(this.toolController.signal, true);
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
    return measureContext(this.state.messages, this.contextWindow, this.apiUsageBaseline, this.toolSchemaTokens);
  }

  private async prepareToolSchemas(): Promise<void> {
    this.toolSchemaReady ??= Promise.all(
      this.tools.map(async item => ({
        name: item.name,
        description: item.definition.description,
        parameters: await asSchema(item.definition.inputSchema).jsonSchema,
      })),
    ).then(schemas => {
      this.toolSchemaTokens = schemas.length ? estimateTokens(schemas) : 0;
      this.state.contextUsage = this.measureContext();
    });
    await this.toolSchemaReady;
  }
}
