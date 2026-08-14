import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import {
  CHAT_PROVIDER_OPTIONS_KEY,
  type ProviderCompatibilityMode,
  type ProviderInterfaceType,
  type ProviderRuntime,
} from '../provider-probe';
import { normalizeProviderFailure } from '../provider/provider-failure';
import { withProviderModelRuntime, type ApiModel, type ApiProvider } from '../provider/provider-config';
import { takeDeepSeekWebSearchResult } from '../provider/deepseek-responses-adapter';
import type { RunnerTool } from './tools';

export type RunnerToolCall = {
  input: unknown;
  providerExecuted?: boolean;
  toolCallId: string;
  toolName: string;
};

export type InvalidRunnerToolCall = RunnerToolCall & {
  /** AI SDK已经为这个无效调用写入工具错误；Runner只能记录，不能再次执行。 */
  error: string;
};

export type ProviderToolCall = RunnerToolCall & {
  output?: unknown;
  providerExecuted: true;
};

export type RunnerToolInputStart = Omit<RunnerToolCall, 'input'>;

export type RunnerToolInputDelta = {
  delta: string;
  toolCallId: string;
};

export type ModelRequestControls = {
  reasoningEffort: 'auto' | 'off' | string;
  webSearch: boolean;
};

export type ModelRequestSettings = ModelRequestControls & {
  compatibilityMode?: ProviderCompatibilityMode;
  interfaceType?: ProviderInterfaceType;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  webSearchMaxUses?: number;
};

export type ModelStepRequest = {
  abortSignal: AbortSignal;
  forceTool?: string;
  messages: ModelMessage[];
  modelSettings?: ModelRequestSettings;
  onProviderToolCompleted?: (call: ProviderToolCall) => Promise<void> | void;
  onProviderToolStarted?: (call: ProviderToolCall) => Promise<void> | void;
  onReasoningDelta?: (delta: string) => void;
  onTextDelta?: (delta: string) => void;
  onToolInputDelta?: (update: RunnerToolInputDelta) => void;
  onToolInputReady?: (call: RunnerToolCall) => void;
  onToolInputStarted?: (call: RunnerToolInputStart) => void;
  tools: RunnerTool[];
};

export type ModelStepResult = {
  assistantMessages: ModelMessage[];
  finishReason: string;
  inputTokens?: number;
  invalidToolCalls?: InvalidRunnerToolCall[];
  outputTokens?: number;
  providerToolCalls?: ProviderToolCall[];
  text: string;
  toolCalls: RunnerToolCall[];
};

export interface ModelStepExecutor {
  execute(request: ModelStepRequest): Promise<ModelStepResult>;
}

function reasoningEffort(settings?: ModelRequestSettings): string | undefined {
  if (!settings || settings.reasoningEffort === 'auto') return undefined;
  return settings.reasoningEffort === 'off' ? 'none' : settings.reasoningEffort;
}

export function requestProviderOptions(
  settings?: ModelRequestSettings,
): Record<string, Record<string, unknown>> | undefined {
  const effort = reasoningEffort(settings);
  const mode = settings?.compatibilityMode ?? 'standard';
  switch (settings?.interfaceType) {
    case 'anthropic':
      if (mode === 'deepseek') {
        return {
          anthropic: {
            effort: effort === 'none' ? undefined : effort,
            sendReasoning: true,
            thinking:
              settings?.reasoningEffort === 'auto'
                ? undefined
                : effort === 'none'
                  ? { type: 'disabled' }
                  : { type: 'enabled' },
          },
        };
      }
      return {
        anthropic: {
          effort: effort === 'none' ? undefined : effort,
          sendReasoning: true,
          thinking:
            settings?.reasoningEffort === 'auto'
              ? undefined
              : effort === 'none'
                ? { type: 'disabled' }
                : { type: 'adaptive' },
        },
      };
    case 'openai-chat':
      if (mode === 'deepseek') {
        if (settings?.reasoningEffort === 'auto') return undefined;
        return {
          [CHAT_PROVIDER_OPTIONS_KEY]: {
            reasoningEffort: effort === 'none' ? undefined : effort,
            thinking: { type: effort === 'none' ? 'disabled' : 'enabled' },
          },
        };
      }
      return effort ? { [CHAT_PROVIDER_OPTIONS_KEY]: { reasoningEffort: effort } } : undefined;
    case 'openai-responses':
      if (mode === 'deepseek') {
        return {
          openai: {
            forceReasoning: effort !== 'none',
            include: settings.webSearch ? ['web_search_call.results'] : undefined,
            metadata: effort === 'none' ? { dream_card_agent_reasoning_effort: 'none' } : undefined,
            reasoningEffort: effort === 'none' ? undefined : effort,
            store: false,
          },
        };
      }
      return {
        openai: {
          include: ['reasoning.encrypted_content'],
          maxToolCalls: settings.webSearch ? settings.webSearchMaxUses ?? 10 : undefined,
          reasoningEffort: effort,
        },
      };
    case undefined:
      return undefined;
  }
}

function sanitizeProviderOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeProviderOutput);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'encryptedContent')
      .map(([key, item]) => [key, sanitizeProviderOutput(item)]),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AiSdkModelStepExecutor implements ModelStepExecutor {
  constructor(private readonly getModel: () => Promise<LanguageModel | ProviderRuntime>) {}

  async execute(request: ModelStepRequest): Promise<ModelStepResult> {
    const resolvedModel = await this.getModel();
    const runtime: ProviderRuntime =
      typeof resolvedModel === 'object' && resolvedModel !== null && 'model' in resolvedModel
        ? resolvedModel
        : {
            capabilities: { nativeWebSearch: false, samplingIgnoredWhenReasoning: false },
            model: resolvedModel,
          };
    const entries: [string, ToolSet[string]][] = request.tools.map(item => [item.name, item.definition]);
    if (request.modelSettings?.webSearch && runtime.capabilities.nativeWebSearch && runtime.webSearchTool) {
      entries.push(['web_search', runtime.webSearchTool]);
    }
    const tools = Object.fromEntries(entries) as ToolSet;
    let streamError: unknown;
    const providerOutputByCallId = new Map<string, unknown>();
    const supplementedProviderCalls = new Set<string>();
    const streamedToolCalls = new Set<string>();
    const result = streamText({
      abortSignal: request.abortSignal,
      allowSystemInMessages: true,
      maxOutputTokens: request.modelSettings?.maxOutputTokens,
      messages: request.messages,
      model: runtime.model,
      onChunk: async chunk => {
        if (chunk.chunk.type === 'text-delta') request.onTextDelta?.(chunk.chunk.text);
        if (chunk.chunk.type === 'reasoning-delta') request.onReasoningDelta?.(chunk.chunk.text);
        if (chunk.chunk.type === 'tool-input-start') {
          streamedToolCalls.add(chunk.chunk.id);
          request.onToolInputStarted?.({
            providerExecuted: chunk.chunk.providerExecuted,
            toolCallId: chunk.chunk.id,
            toolName: chunk.chunk.toolName,
          });
        }
        if (chunk.chunk.type === 'tool-input-delta') {
          request.onToolInputDelta?.({ delta: chunk.chunk.delta, toolCallId: chunk.chunk.id });
        }
        if (chunk.chunk.type === 'tool-call') {
          const call: RunnerToolCall = {
            input: chunk.chunk.input,
            providerExecuted: chunk.chunk.providerExecuted,
            toolCallId: chunk.chunk.toolCallId,
            toolName: chunk.chunk.toolName,
          };
          // 有些兼容渠道只发完整tool-call；仍要在执行前创建同一张流式卡片。
          if (!streamedToolCalls.has(call.toolCallId)) {
            streamedToolCalls.add(call.toolCallId);
            request.onToolInputStarted?.(call);
          }
          request.onToolInputReady?.(call);
        }
        if (chunk.chunk.type === 'tool-call' && chunk.chunk.providerExecuted) {
          await request.onProviderToolStarted?.({
            input: chunk.chunk.input,
            providerExecuted: true,
            toolCallId: chunk.chunk.toolCallId,
            toolName: chunk.chunk.toolName,
          });
        }
        if (chunk.chunk.type === 'tool-result' && chunk.chunk.providerExecuted) {
          const supplemental =
            request.modelSettings?.compatibilityMode === 'deepseek' && chunk.chunk.toolName === 'web_search'
              ? takeDeepSeekWebSearchResult(chunk.chunk.toolCallId)
              : undefined;
          const output = supplemental ?? sanitizeProviderOutput(chunk.chunk.output);
          providerOutputByCallId.set(chunk.chunk.toolCallId, output);
          if (supplemental !== undefined) supplementedProviderCalls.add(chunk.chunk.toolCallId);
          await request.onProviderToolCompleted?.({
            input: undefined,
            output,
            providerExecuted: true,
            toolCallId: chunk.chunk.toolCallId,
            toolName: chunk.chunk.toolName,
          });
        }
      },
      onError: event => {
        streamError = event.error;
      },
      telemetry: { isEnabled: false },
      temperature: request.modelSettings?.temperature,
      toolChoice: request.forceTool ? { toolName: request.forceTool, type: 'tool' } : 'auto',
      toolOrder: entries.map(([name]) => name),
      topP: request.modelSettings?.topP,
      tools,
      providerOptions: requestProviderOptions(request.modelSettings) as never,
    });
    let resolved: Awaited<
      ReturnType<
        typeof Promise.all<
          [
            typeof result.responseMessages,
            typeof result.toolCalls,
            typeof result.toolResults,
            typeof result.text,
            typeof result.usage,
            typeof result.finishReason,
            typeof result.rawFinishReason,
          ]
        >
      >
    >;
    try {
      resolved = await Promise.all([
        result.responseMessages,
        result.toolCalls,
        result.toolResults,
        result.text,
        result.usage,
        result.finishReason,
        result.rawFinishReason,
      ]);
    } catch (error) {
      throw streamError ?? error;
    }
    const [assistantMessages, toolCalls, toolResults, text, usage, finishReason, rawFinishReason] = resolved;
    if (streamError) throw streamError;
    if (assistantMessages.length === 0 && toolCalls.length === 0 && !text.trim()) {
      const reason = rawFinishReason ? `${finishReason}/${rawFinishReason}` : finishReason;
      throw new Error(
        `模型返回了空响应（finishReason: ${reason}）。接口可能与所选协议不兼容；若使用OpenAI Responses，请确认Base URL填写到API版本根路径（常见形式为https://服务地址/v1），而不是站点根地址。`,
      );
    }
    const resultByCallId = new Map(toolResults.map(result => [result.toolCallId, result]));
    const localCalls = toolCalls.filter(call => !call.providerExecuted);
    const invalidLocalCalls = localCalls.filter(call => call.dynamic === true && call.invalid === true);
    const executableLocalCalls = localCalls.filter(call => !(call.dynamic === true && call.invalid === true));
    const providerCalls = toolCalls.filter(call => call.providerExecuted);
    for (const call of providerCalls) {
      if (request.modelSettings?.compatibilityMode !== 'deepseek' || call.toolName !== 'web_search') continue;
      const supplemental = takeDeepSeekWebSearchResult(call.toolCallId);
      if (supplemental === undefined) continue;
      providerOutputByCallId.set(call.toolCallId, supplemental);
      if (!supplementedProviderCalls.has(call.toolCallId)) {
        supplementedProviderCalls.add(call.toolCallId);
        await request.onProviderToolCompleted?.({ ...call, output: supplemental, providerExecuted: true });
      }
    }
    return {
      assistantMessages: assistantMessages as ModelMessage[],
      finishReason,
      inputTokens: usage.inputTokens,
      invalidToolCalls: invalidLocalCalls.map(call => ({
        error: errorMessage(call.error),
        input: call.input,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
      })),
      outputTokens: usage.outputTokens,
      providerToolCalls: providerCalls.map(call => ({
        input: call.input,
        output:
          providerOutputByCallId.get(call.toolCallId) ?? sanitizeProviderOutput(resultByCallId.get(call.toolCallId)?.output),
        providerExecuted: true,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
      })),
      text,
      toolCalls: executableLocalCalls.map(call => ({
        input: call.input,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
      })),
    };
  }
}

export class ProviderModelStepExecutor implements ModelStepExecutor {
  constructor(
    private readonly provider: ApiProvider,
    private readonly model: ApiModel,
  ) {}

  async execute(request: ModelStepRequest): Promise<ModelStepResult> {
    try {
      const modelSettings = this.model.modelSettings;
      const reasoningEffort = request.modelSettings?.reasoningEffort ?? 'auto';
      const reasoningActive = reasoningEffort !== 'off';
      const suppressSampling = this.model.compatibilityMode === 'deepseek' && reasoningActive;
      const webSearch = request.modelSettings?.webSearch === true && modelSettings.capabilities.webSearch !== 'disabled';
      return await withProviderModelRuntime(
        this.provider,
        this.model,
        runtime => new AiSdkModelStepExecutor(async () => runtime).execute({
          ...request,
          modelSettings: {
            compatibilityMode: this.model.compatibilityMode,
            interfaceType: this.provider.interfaceType,
            maxOutputTokens: modelSettings.maxOutputTokens || undefined,
            reasoningEffort,
            temperature: suppressSampling ? undefined : modelSettings.temperature,
            topP: suppressSampling ? undefined : modelSettings.topP,
            webSearch,
            webSearchMaxUses: request.modelSettings?.webSearchMaxUses,
          },
        }),
        request.modelSettings?.webSearchMaxUses ?? 10,
      );
    } catch (error) {
      throw new Error(normalizeProviderFailure(error).message, { cause: error });
    }
  }
}

export class UnavailableModelStepExecutor implements ModelStepExecutor {
  async execute(): Promise<ModelStepResult> {
    throw new Error('当前会话尚未选择可用模型。');
  }
}
