import { tool } from 'ai';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { createProviderRuntime } from '../provider-probe';
import { AiSdkModelStepExecutor } from '../runner/step-executor';
import {
  createDeepSeekResponsesFetch,
  transformDeepSeekResponsesRequest,
  translateDeepSeekResponsesEvent,
  type DeepSeekResponsesStreamState,
} from './deepseek-responses-adapter';

function state(): DeepSeekResponsesStreamState {
  return { reasoningByItemId: new Map() };
}

describe('DeepSeek Responses adapter', () => {
  it('清理无状态接口不支持的字段，并把推理正文改为明文输入', () => {
    expect(transformDeepSeekResponsesRequest({
      include: ['reasoning.encrypted_content'],
      input: [
        { encrypted_content: '完整思考', id: 'reasoning-1', summary: [], type: 'reasoning' },
        { content: '继续', role: 'user' },
      ],
      max_tool_calls: 10,
      previous_response_id: 'response-1',
      reasoning: { effort: 'high', summary: 'detailed' },
      store: false,
      temperature: 0.7,
      top_p: 0.8,
    })).toEqual({
      input: [
        { content: [{ text: '完整思考', type: 'reasoning_text' }], type: 'reasoning' },
        { content: '继续', role: 'user' },
      ],
      reasoning: { effort: 'high' },
    });
  });

  it('关闭推理时保留采样参数', () => {
    expect(transformDeepSeekResponsesRequest({
      metadata: { dream_card_agent_reasoning_effort: 'none' },
      temperature: 0.7,
      top_p: 0.8,
    })).toEqual({ reasoning: { effort: 'none' }, temperature: 0.7, top_p: 0.8 });
  });

  it('把 reasoning_text 流翻译为 AI SDK 可识别事件，并在工具后保留完整正文', () => {
    const streamState = state();
    expect(translateDeepSeekResponsesEvent({
      item: { id: 'reasoning-1', type: 'reasoning' },
      output_index: 0,
      type: 'response.output_item.added',
    }, streamState)).toMatchObject({ item: { encrypted_content: null, id: 'reasoning-1' } });
    expect(translateDeepSeekResponsesEvent({
      delta: '先检查',
      item_id: 'reasoning-1',
      output_index: 0,
      type: 'response.reasoning_text.delta',
    }, streamState)).toMatchObject({ summary_index: 0, type: 'response.reasoning_summary_text.delta' });
    translateDeepSeekResponsesEvent({
      delta: '再修改',
      item_id: 'reasoning-1',
      output_index: 0,
      type: 'response.reasoning_text.delta',
    }, streamState);
    expect(translateDeepSeekResponsesEvent({
      item: { id: 'reasoning-1', type: 'reasoning' },
      output_index: 0,
      type: 'response.output_item.done',
    }, streamState)).toMatchObject({
      item: { encrypted_content: '先检查再修改', id: 'reasoning-1', type: 'reasoning' },
    });
  });

  it('流式 fetch 保留原生 web_search 事件并翻译推理事件', async () => {
    const sse = [
      { item: { id: 'reasoning-1', type: 'reasoning' }, output_index: 0, type: 'response.output_item.added' },
      { delta: '思考', item_id: 'reasoning-1', output_index: 0, type: 'response.reasoning_text.delta' },
      { item: { id: 'search-1', status: 'in_progress', type: 'web_search_call' }, output_index: 1, type: 'response.output_item.added' },
    ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
    const baseFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
    const response = await createDeepSeekResponsesFetch(baseFetch as typeof fetch)('https://example.test/responses', {
      body: JSON.stringify({ reasoning: { effort: 'high', summary: 'detailed' }, store: false }),
      method: 'POST',
    });
    const body = await response.text();
    expect(body).toContain('response.reasoning_summary_text.delta');
    expect(body).toContain('web_search_call');
    expect(JSON.parse(String(baseFetch.mock.calls[0]?.[1]?.body))).toEqual({ reasoning: { effort: 'high' } });
  });

  it('经 AI SDK 完整呈现推理并保留工具调用前的明文推理上下文', async () => {
    const events = [
      { response: { created_at: 1, id: 'response-1', model: 'deepseek-v4-flash' }, type: 'response.created' },
      { item: { id: 'reasoning-1', type: 'reasoning' }, output_index: 0, type: 'response.output_item.added' },
      { delta: '先读取文件', item_id: 'reasoning-1', output_index: 0, type: 'response.reasoning_text.delta' },
      { item_id: 'reasoning-1', output_index: 0, text: '先读取文件', type: 'response.reasoning_text.done' },
      { item: { id: 'reasoning-1', type: 'reasoning' }, output_index: 0, type: 'response.output_item.done' },
      {
        item: { arguments: '', call_id: 'call-1', id: 'function-1', name: 'read_file', type: 'function_call' },
        output_index: 1,
        type: 'response.output_item.added',
      },
      {
        delta: '{"path":"/character/description.md"}',
        item_id: 'function-1',
        output_index: 1,
        type: 'response.function_call_arguments.delta',
      },
      {
        arguments: '{"path":"/character/description.md"}',
        item_id: 'function-1',
        output_index: 1,
        type: 'response.function_call_arguments.done',
      },
      {
        item: {
          arguments: '{"path":"/character/description.md"}',
          call_id: 'call-1',
          id: 'function-1',
          name: 'read_file',
          status: 'completed',
          type: 'function_call',
        },
        output_index: 1,
        type: 'response.output_item.done',
      },
      {
        response: {
          incomplete_details: null,
          usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 2 },
            output_tokens: 5,
            output_tokens_details: { reasoning_tokens: 3 },
          },
        },
        type: 'response.completed',
      },
    ];
    const sse = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
    const completedEvents = [
      { response: { created_at: 2, id: 'response-2', model: 'deepseek-v4-flash' }, type: 'response.created' },
      { item: { id: 'message-1', type: 'message' }, output_index: 0, type: 'response.output_item.added' },
      { delta: '已读取', item_id: 'message-1', output_index: 0, type: 'response.output_text.delta' },
      { item: { id: 'message-1', type: 'message' }, output_index: 0, type: 'response.output_item.done' },
      {
        response: {
          incomplete_details: null,
          usage: {
            input_tokens: 20,
            input_tokens_details: { cached_tokens: 10 },
            output_tokens: 2,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
        type: 'response.completed',
      },
    ];
    const completedSse = completedEvents
      .map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join('');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(sse, { headers: { 'content-type': 'text/event-stream' }, status: 200 }))
      .mockResolvedValueOnce(
        new Response(completedSse, { headers: { 'content-type': 'text/event-stream' }, status: 200 }),
      );
    try {
      const runtime = createProviderRuntime({
        apiKey: 'test-key',
        baseURL: 'https://example.test',
        compatibilityMode: 'deepseek',
        interfaceType: 'openai-responses',
        model: 'deepseek-v4-flash',
      });
      const reasoningDelta = vi.fn();
      const result = await new AiSdkModelStepExecutor(async () => runtime).execute({
        abortSignal: new AbortController().signal,
        messages: [{ content: '检查角色', role: 'user' }],
        modelSettings: {
          compatibilityMode: 'deepseek',
          interfaceType: 'openai-responses',
          reasoningEffort: 'high',
          webSearch: false,
        },
        onReasoningDelta: reasoningDelta,
        tools: [{
          definition: tool({ inputSchema: z.object({ path: z.string() }) }),
          execute: async () => ({}),
          name: 'read_file',
          readonly: true,
        }],
      });
      expect(reasoningDelta).toHaveBeenCalledWith('先读取文件');
      expect(result.toolCalls).toEqual([{
        input: { path: '/character/description.md' },
        toolCallId: 'call-1',
        toolName: 'read_file',
      }]);
      expect(JSON.stringify(result.assistantMessages)).toContain('先读取文件');
      expect(JSON.stringify(result.assistantMessages)).toContain('reasoningEncryptedContent');
      const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
      expect(firstBody).not.toHaveProperty('temperature');
      expect(firstBody).not.toHaveProperty('top_p');

      await new AiSdkModelStepExecutor(async () => runtime).execute({
        abortSignal: new AbortController().signal,
        messages: [
          { content: '检查角色', role: 'user' },
          ...result.assistantMessages,
          {
            content: [{
              output: { type: 'json', value: { content: '角色描述' } },
              toolCallId: 'call-1',
              toolName: 'read_file',
              type: 'tool-result',
            }],
            role: 'tool',
          },
        ],
        modelSettings: {
          compatibilityMode: 'deepseek',
          interfaceType: 'openai-responses',
          reasoningEffort: 'high',
          webSearch: false,
        },
        tools: [{
          definition: tool({ inputSchema: z.object({ path: z.string() }) }),
          execute: async () => ({}),
          name: 'read_file',
          readonly: true,
        }],
      });
      const replayBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { input: unknown[] };
      expect(replayBody.input).toContainEqual({
        content: [{ text: '先读取文件', type: 'reasoning_text' }],
        type: 'reasoning',
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('把 DeepSeek 原生联网事件呈现为 Provider 工具调用与结果', async () => {
    const events = [
      { response: { created_at: 1, id: 'response-web', model: 'deepseek-v4-flash' }, type: 'response.created' },
      {
        item: { id: 'search-1', status: 'in_progress', type: 'web_search_call' },
        output_index: 0,
        type: 'response.output_item.added',
      },
      {
        item: {
          action: {
            query: 'SillyTavern',
            sources: [{ type: 'url', url: 'https://example.test/result' }],
            type: 'search',
          },
          id: 'search-1',
          status: 'completed',
          type: 'web_search_call',
        },
        output_index: 0,
        type: 'response.output_item.done',
      },
      { item: { id: 'message-web', type: 'message' }, output_index: 1, type: 'response.output_item.added' },
      { delta: '搜索完成', item_id: 'message-web', output_index: 1, type: 'response.output_text.delta' },
      { item: { id: 'message-web', type: 'message' }, output_index: 1, type: 'response.output_item.done' },
      {
        response: {
          incomplete_details: null,
          usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 3,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
        type: 'response.completed',
      },
    ];
    const sse = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sse, { headers: { 'content-type': 'text/event-stream' }, status: 200 }),
    );
    try {
      const runtime = createProviderRuntime({
        apiKey: 'test-key',
        baseURL: 'https://example.test',
        compatibilityMode: 'deepseek',
        interfaceType: 'openai-responses',
        model: 'deepseek-v4-flash',
      });
      const started = vi.fn();
      const completed = vi.fn();
      const result = await new AiSdkModelStepExecutor(async () => runtime).execute({
        abortSignal: new AbortController().signal,
        messages: [{ content: '搜索资料', role: 'user' }],
        modelSettings: {
          compatibilityMode: 'deepseek',
          interfaceType: 'openai-responses',
          reasoningEffort: 'off',
          webSearch: true,
        },
        onProviderToolCompleted: completed,
        onProviderToolStarted: started,
        tools: [],
      });
      expect(started).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'search-1', toolName: 'web_search' }));
      expect(completed).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'search-1', toolName: 'web_search' }));
      expect(result.providerToolCalls).toEqual([
        expect.objectContaining({ providerExecuted: true, toolCallId: 'search-1', toolName: 'web_search' }),
      ]);
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
      expect(requestBody).toMatchObject({ reasoning: { effort: 'none' } });
    } finally {
      fetchMock.mockRestore();
    }
  });
});
