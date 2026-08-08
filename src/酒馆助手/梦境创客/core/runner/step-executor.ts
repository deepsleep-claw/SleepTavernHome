import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
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
    const result = streamText({
      abortSignal: request.abortSignal,
      allowSystemInMessages: true,
      messages: request.messages,
      model,
      onChunk: chunk => {
        if (chunk.chunk.type === 'text-delta') request.onTextDelta?.(chunk.chunk.text);
      },
      telemetry: { isEnabled: false },
      toolChoice: request.forceTool ? { toolName: request.forceTool, type: 'tool' } : 'auto',
      toolOrder: request.tools.map(item => item.name),
      tools,
    });
    const [assistantMessages, toolCalls, text, usage, finishReason] = await Promise.all([
      result.responseMessages,
      result.toolCalls,
      result.text,
      result.usage,
      result.finishReason,
    ]);
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
