import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, type LanguageModel, type ModelMessage, type Tool } from 'ai';
import { createAdvancedRequestFetch } from './provider/advanced-request';
import { createDeepSeekResponsesFetch } from './provider/deepseek-responses-adapter';

export type ProviderInterfaceType = 'anthropic' | 'openai-chat' | 'openai-responses';
export type ProviderCompatibilityMode = 'deepseek' | 'standard';
export type LegacyProviderProtocol = ProviderInterfaceType | 'openai-compatible';

export type ProviderAdapterCapabilities = {
  nativeWebSearch: boolean;
  samplingIgnoredWhenReasoning: boolean;
};

export const CHAT_PROVIDER_OPTIONS_KEY = 'dreamCardAgentChat';

const ADAPTER_CAPABILITIES: Record<
  ProviderInterfaceType,
  Record<ProviderCompatibilityMode, ProviderAdapterCapabilities>
> = {
  anthropic: {
    deepseek: { nativeWebSearch: true, samplingIgnoredWhenReasoning: true },
    standard: { nativeWebSearch: true, samplingIgnoredWhenReasoning: false },
  },
  'openai-chat': {
    deepseek: { nativeWebSearch: false, samplingIgnoredWhenReasoning: true },
    standard: { nativeWebSearch: false, samplingIgnoredWhenReasoning: false },
  },
  'openai-responses': {
    deepseek: { nativeWebSearch: true, samplingIgnoredWhenReasoning: true },
    standard: { nativeWebSearch: true, samplingIgnoredWhenReasoning: false },
  },
};

export function providerAdapterCapabilities(
  interfaceType: ProviderInterfaceType,
  compatibilityMode: ProviderCompatibilityMode,
): ProviderAdapterCapabilities {
  return { ...ADAPTER_CAPABILITIES[interfaceType][compatibilityMode] };
}

export type ProviderProbeProfile = {
  apiKey: string;
  baseURL: string;
  compatibilityMode?: ProviderCompatibilityMode;
  extraParameters?: Record<string, unknown>;
  headers?: Record<string, string>;
  interfaceType: ProviderInterfaceType;
  model: string;
};

export type ProviderRuntime = {
  capabilities: ProviderAdapterCapabilities;
  model: LanguageModel;
  webSearchTool?: Tool;
};

export function createProviderRuntime(profile: ProviderProbeProfile, webSearchMaxUses = 10): ProviderRuntime {
  const compatibilityMode = profile.compatibilityMode ?? 'standard';
  const capabilities = providerAdapterCapabilities(profile.interfaceType, compatibilityMode);
  const options = {
    apiKey: profile.apiKey,
    baseURL: profile.baseURL,
    fetch:
      profile.interfaceType === 'openai-responses' && compatibilityMode === 'deepseek'
        ? createAdvancedRequestFetch(profile.extraParameters ?? {}, createDeepSeekResponsesFetch())
        : createAdvancedRequestFetch(profile.extraParameters ?? {}),
    headers: profile.headers,
  };

  switch (profile.interfaceType) {
    case 'anthropic': {
      const provider = createAnthropic(options);
      return {
        capabilities,
        model: provider(profile.model),
        webSearchTool: capabilities.nativeWebSearch
          ? provider.tools.webSearch_20260209({ maxUses: webSearchMaxUses })
          : undefined,
      };
    }
    case 'openai-chat': {
      const provider = createOpenAICompatible({ ...options, name: 'dream-card-agent-chat' });
      return { capabilities, model: provider(profile.model) };
    }
    case 'openai-responses': {
      const provider = createOpenAI({
        ...options,
      });
      return {
        capabilities,
        model: provider.responses(profile.model),
        webSearchTool: capabilities.nativeWebSearch ? provider.tools.webSearch() : undefined,
      };
    }
  }
}

/**
 * 阶段 A 的浏览器打包探针，也是后续 Provider Registry 的最小稳定边界。
 * 这里只创建模型对象，不发起任何请求。
 */
export function createProbeModel(profile: ProviderProbeProfile): LanguageModel {
  return createProviderRuntime(profile).model;
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
