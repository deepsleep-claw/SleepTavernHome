import { tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { afterEach, expect, it, vi } from 'vitest';
import { createProviderRuntime } from '../provider-probe';
import { AiSdkModelStepExecutor } from '../runner/step-executor';
import { createApiProvider, listProviderModels } from './provider-config';

afterEach(() => vi.unstubAllGlobals());

it('Gemini模型列表使用原生鉴权和分页，只列出文本生成模型', async () => {
  const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-key');
    return Response.json(
      url.searchParams.has('pageToken')
        ? { models: [{ name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] }] }
        : {
            models: [{ name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }],
            nextPageToken: 'next',
          },
    );
  });
  vi.stubGlobal('fetch', fetch);
  const provider = await createApiProvider({
    name: 'Gemini',
    apiKey: 'test-key',
    baseURL: '',
    interfaceType: 'gemini',
    enabled: true,
  });
  expect(await listProviderModels(provider)).toEqual(['gemini-3.1-pro-preview']);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('Gemini原生流式工具调用往返保留思考签名和工具结果', async () => {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      const parts =
        requests.length === 1
          ? [{ functionCall: { name: 'read_file', args: { path: '/files/note.md' } }, thoughtSignature: 'signature-1' }]
          : [{ text: '已读取文件' }];
      return new Response(
        `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 } })}\n\n`,
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    }),
  );
  const runtime = createProviderRuntime({
    apiKey: 'test-key',
    baseURL: 'https://example.invalid/v1beta',
    interfaceType: 'gemini',
    model: 'gemini-3.1-pro-preview',
  });
  const executor = new AiSdkModelStepExecutor(async () => runtime);
  const definition = tool({ description: '读取文件', inputSchema: z.object({ path: z.string() }) });
  const tools = [{ name: 'read_file', definition, execute: async () => 'note', readonly: true }];
  const messages: ModelMessage[] = [{ role: 'user', content: '读取笔记' }];
  const settings = {
    interfaceType: 'gemini' as const,
    modelId: 'gemini-3.1-pro-preview',
    reasoningEffort: 'low',
    webSearch: false,
  };
  const first = await executor.execute({
    abortSignal: new AbortController().signal,
    messages,
    modelSettings: settings,
    tools,
    forceTool: 'read_file',
  });
  expect(first.toolCalls).toHaveLength(1);
  expect(JSON.stringify(first.assistantMessages)).toContain('signature-1');
  messages.push(...first.assistantMessages, {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: first.toolCalls[0].toolCallId,
        toolName: 'read_file',
        output: { type: 'text', value: '笔记正文' },
      },
    ],
  });
  const second = await executor.execute({
    abortSignal: new AbortController().signal,
    messages,
    modelSettings: settings,
    tools,
  });
  expect(second.text).toBe('已读取文件');
  expect(JSON.stringify(requests[0])).toContain('functionDeclarations');
  expect(requests[0].generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' } });
  expect(JSON.stringify(requests[1])).toContain('signature-1');
  expect(JSON.stringify(requests[1])).toContain('functionResponse');
  expect(JSON.stringify(requests[1])).toContain('笔记正文');
});
