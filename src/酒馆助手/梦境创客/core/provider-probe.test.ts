import { describe, expect, it } from 'vitest';
import {
  createProbeModel,
  type ProviderCompatibilityMode,
  type ProviderInterfaceType,
} from './provider-probe';

describe('AI SDK 浏览器打包探针', () => {
  it.each<[ProviderInterfaceType, ProviderCompatibilityMode]>([
    ['anthropic', 'standard'],
    ['anthropic', 'deepseek'],
    ['openai-chat', 'standard'],
    ['openai-chat', 'deepseek'],
    ['openai-responses', 'standard'],
    ['openai-responses', 'deepseek'],
  ])('可以创建 %s/%s 模型而不发起网络请求', (interfaceType, compatibilityMode) => {
      const model = createProbeModel({
        apiKey: 'test-key',
        baseURL: 'https://example.invalid/v1',
        compatibilityMode,
        interfaceType,
        model: 'test-model',
      });

      expect(model).toBeDefined();
      expect(typeof model).toBe('object');
  });
});
