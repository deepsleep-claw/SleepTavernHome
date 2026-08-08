import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, type LanguageModel, type ModelMessage } from 'ai';

export type ProviderProtocol = 'anthropic' | 'openai-chat' | 'openai-compatible' | 'openai-responses';

export type ProviderProbeProfile = {
  apiKey: string;
  baseURL: string;
  headers?: Record<string, string>;
  model: string;
  protocol: ProviderProtocol;
};

/**
 * 阶段 A 的浏览器打包探针，也是后续 Provider Registry 的最小稳定边界。
 * 这里只创建模型对象，不发起任何请求。
 */
export function createProbeModel(profile: ProviderProbeProfile): LanguageModel {
  const options = {
    apiKey: profile.apiKey,
    baseURL: profile.baseURL,
    headers: profile.headers,
  };

  switch (profile.protocol) {
    case 'anthropic':
      return createAnthropic(options)(profile.model);
    case 'openai-chat':
      return createOpenAI(options).chat(profile.model);
    case 'openai-compatible':
      return createOpenAICompatible({ ...options, name: 'dream-card-agent-compatible' })(profile.model);
    case 'openai-responses':
      return createOpenAI(options).responses(profile.model);
  }
}

/**
 * 让正式浏览器构建真实包含 AI SDK 的流式调用链；调用者负责消费流与取消请求。
 */
export function createProbeStream(profile: ProviderProbeProfile, messages: ModelMessage[], abortSignal?: AbortSignal) {
  return streamText({
    abortSignal,
    messages,
    model: createProbeModel(profile),
    telemetry: { isEnabled: false },
  });
}
