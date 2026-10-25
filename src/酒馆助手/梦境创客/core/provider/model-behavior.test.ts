import { afterEach, expect, it, vi } from 'vitest';
import { defaultModelSettings } from './model-catalog';
import { createApiModel, createApiProvider, type ApiModel } from './provider-config';
import { reasoningOptions } from './session-model-options';
import { ProviderModelStepExecutor, requestProviderOptions } from '../runner/step-executor';

afterEach(() => vi.unstubAllGlobals());

it('强制推理模型隐藏关闭选项，并拒绝保存会话遗留的关闭参数', () => {
  for (const modelId of [
    'gpt-6-astra',
    'openai/gpt-6.1-sol',
    'gemini-4-argon',
    'xai/grok-4.7',
    'k3.1-pro',
    'kimi/k3.1-pro-highspeed',
    'claude-opus-5.5',
    'claude-sonnet-5-5',
    'claude-fable-5-1',
    'claude-mythos-5',
  ]) {
    const model = {
      modelId,
      modelSettings: {
        ...defaultModelSettings(),
        reasoningEfforts: [
          { id: 'none', name: '旧关闭选项' },
          { id: 'high', name: '高' },
        ],
      },
    } as ApiModel;
    expect(
      reasoningOptions(undefined, model).map(item => item.value),
      modelId,
    ).toEqual(['auto', 'high']);
    expect(
      () =>
        requestProviderOptions({
          modelId,
          interfaceType: 'openai-responses',
          reasoningEffort: 'off',
          webSearch: false,
        }),
      modelId,
    ).toThrow('不能关闭推理');
  }
  for (const modelId of ['gpt-6-sol', 'gpt-6-luna', 'deepseek-flash', 'claude-sonnet-5', 'claude-haiku-5-5']) {
    const model = { modelId, modelSettings: defaultModelSettings() } as ApiModel;
    expect(
      reasoningOptions(undefined, model).some(item => item.value === 'off'),
      modelId,
    ).toBe(true);
  }
});

it('Gemini 4 使用思考档位，拒绝旧的 minimal 和关闭值', () => {
  const settings = {
    modelId: 'models/gemini-4-argon',
    interfaceType: 'gemini' as const,
    reasoningEffort: 'medium',
    webSearch: false,
  };
  expect(requestProviderOptions(settings)).toEqual({
    google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'medium' } },
  });
  expect(() => requestProviderOptions({ ...settings, reasoningEffort: 'minimal' })).toThrow('仅支持');
  expect(() => requestProviderOptions({ ...settings, reasoningEffort: 'off' })).toThrow('不能关闭');
});

it.each(['grok-4.7', 'k3.1-pro-highspeed', 'gpt-6.1-sol'])('%s 的 Responses 请求实际携带推理档位', async modelId => {
  let body: Record<string, unknown> | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      const events = [
        { type: 'response.created', response: { id: 'response-1', created_at: 1, model: modelId } },
        { type: 'response.output_item.added', item: { id: 'text-1', type: 'message' }, output_index: 0 },
        { type: 'response.output_text.delta', item_id: 'text-1', output_index: 0, delta: '完成' },
        { type: 'response.output_item.done', item: { id: 'text-1', type: 'message' }, output_index: 0 },
        {
          type: 'response.completed',
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 10,
              output_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 1 },
            },
          },
        },
      ];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    }),
  );
  const provider = await createApiProvider({
    name: '测试接口',
    baseURL: 'https://example.invalid/v1',
    apiKey: 'test-key',
    enabled: true,
    interfaceType: 'openai-responses',
  });
  const model = await createApiModel({ name: modelId, modelId, enabled: true, compatibilityMode: 'standard' });
  await new ProviderModelStepExecutor(provider, model).execute({
    abortSignal: new AbortController().signal,
    messages: [{ role: 'user', content: '测试' }],
    tools: [],
    modelSettings: { reasoningEffort: 'high', webSearch: false },
  });
  expect(body).toMatchObject({ model: modelId, reasoning: { effort: 'high' } });
});

it('Claude 5.5 请求忽略模型配置中遗留的采样参数', async () => {
  let body: Record<string, unknown> | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'm',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [],
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '完成' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    }),
  );
  const provider = await createApiProvider({
    name: '测试接口',
    baseURL: 'https://example.invalid/v1',
    apiKey: 'test-key',
    enabled: true,
    interfaceType: 'anthropic',
  });
  const model = await createApiModel({
    name: 'Opus',
    modelId: 'claude-opus-5-5',
    enabled: true,
    compatibilityMode: 'standard',
    modelSettings: { temperature: 0.7, topP: 0.9 },
  });
  await new ProviderModelStepExecutor(provider, model).execute({
    abortSignal: new AbortController().signal,
    messages: [{ role: 'user', content: '测试' }],
    tools: [],
    modelSettings: { reasoningEffort: 'high', webSearch: false },
  });
  expect(body).toMatchObject({ output_config: { effort: 'high' }, thinking: { type: 'adaptive' } });
  expect(body).not.toHaveProperty('temperature');
  expect(body).not.toHaveProperty('top_p');
});
