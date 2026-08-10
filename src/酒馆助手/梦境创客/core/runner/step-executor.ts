import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { normalizeProviderFailure, withApiModel, type ApiProfile } from '../provider/profiles';
import type { RunnerTool } from './tools';

export type RunnerToolCall = {
  input: unknown;
  toolCallId: string;
  toolName: string;
};

export type ModelStepRequest = {
  abortSignal: AbortSignal;
  forceTool?: string;
  messages: ModelMessage[];
  onReasoningDelta?: (delta: string) => void;
  onTextDelta?: (delta: string) => void;
  tools: RunnerTool[];
};

export type ModelStepResult = {
  assistantMessages: ModelMessage[];
  finishReason: string;
  inputTokens?: number;
  outputTokens?: number;
  text: string;
  toolCalls: RunnerToolCall[];
};

export interface ModelStepExecutor {
  execute(request: ModelStepRequest): Promise<ModelStepResult>;
}

export class AiSdkModelStepExecutor implements ModelStepExecutor {
  constructor(private readonly getModel: () => Promise<LanguageModel>) {}

  async execute(request: ModelStepRequest): Promise<ModelStepResult> {
    const model = await this.getModel();
    const tools = Object.fromEntries(request.tools.map(item => [item.name, item.definition])) as ToolSet;
    let streamError: unknown;
    const result = streamText({
      abortSignal: request.abortSignal,
      allowSystemInMessages: true,
      messages: request.messages,
      model,
      onChunk: chunk => {
        if (chunk.chunk.type === 'text-delta') request.onTextDelta?.(chunk.chunk.text);
        if (chunk.chunk.type === 'reasoning-delta') request.onReasoningDelta?.(chunk.chunk.text);
      },
      onError: event => {
        streamError = event.error;
      },
      telemetry: { isEnabled: false },
      toolChoice: request.forceTool ? { toolName: request.forceTool, type: 'tool' } : 'auto',
      toolOrder: request.tools.map(item => item.name),
      tools,
    });
    let resolved: Awaited<
      ReturnType<
        typeof Promise.all<
          [
            typeof result.responseMessages,
            typeof result.toolCalls,
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
        result.text,
        result.usage,
        result.finishReason,
        result.rawFinishReason,
      ]);
    } catch (error) {
      throw streamError ?? error;
    }
    const [assistantMessages, toolCalls, text, usage, finishReason, rawFinishReason] = resolved;
    if (streamError) throw streamError;
    if (assistantMessages.length === 0 && toolCalls.length === 0 && !text.trim()) {
      const reason = rawFinishReason ? `${finishReason}/${rawFinishReason}` : finishReason;
      throw new Error(
        `模型返回了空响应（finishReason: ${reason}）。接口可能与所选协议不兼容；若使用OpenAI Responses，请确认Base URL填写到API版本根路径（常见形式为https://服务地址/v1），而不是站点根地址。`,
      );
    }
    return {
      assistantMessages: assistantMessages as ModelMessage[],
      finishReason,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      text,
      toolCalls: toolCalls.map(call => ({ input: call.input, toolCallId: call.toolCallId, toolName: call.toolName })),
    };
  }
}

export class ProfileModelStepExecutor implements ModelStepExecutor {
  constructor(private readonly profile: ApiProfile) {}

  async execute(request: ModelStepRequest): Promise<ModelStepResult> {
    try {
      return await withApiModel(this.profile, model => new AiSdkModelStepExecutor(async () => model).execute(request));
    } catch (error) {
      throw new Error(normalizeProviderFailure(error).message, { cause: error });
    }
  }
}
