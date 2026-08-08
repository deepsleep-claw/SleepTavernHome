import { describe, expect, it } from 'vitest';
import { createProbeModel, type ProviderProtocol } from './provider-probe';

describe('AI SDK 浏览器打包探针', () => {
  it.each<ProviderProtocol>(['anthropic', 'openai-chat', 'openai-compatible', 'openai-responses'])(
    '可以创建 %s 模型而不发起网络请求',
    protocol => {
      const model = createProbeModel({
        apiKey: 'test-key',
        baseURL: 'https://example.invalid/v1',
        model: 'test-model',
        protocol,
      });

      expect(model).toBeDefined();
      expect(typeof model).toBe('object');
    },
  );
});
