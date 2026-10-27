import { tool } from 'ai';
import { z } from 'zod';
import { afterEach, expect, it, vi } from 'vitest';
import { createApiModel, createApiProvider } from './provider-config';
import { AgentRunner, MemoryRunnerJournal } from '../runner/agent-runner';
import { ProviderModelStepExecutor } from '../runner/step-executor';
import { richToolOutput } from '../runner/tool-output';

afterEach(() => vi.unstubAllGlobals());

it('Gemini 兼容接口读取大图片后继续请求，API 输入不会被图片编码放大', async () => {
  const image = 'A'.repeat(4_200_000);
  const requests: Array<{ messages: Array<{ role: string; tool_call_id?: string; content: unknown }> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      const first = requests.length === 1;
      const chunk = {
        id: `response-${requests.length}`,
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gemini-4-argon',
        choices: [
          {
            index: 0,
            finish_reason: first ? 'tool_calls' : 'stop',
            delta: first
              ? {
                  tool_calls: [
                    { index: 0, id: 'read-image', type: 'function', function: { name: 'read_file', arguments: '{}' } },
                  ],
                }
              : { content: '已检查图片' },
          },
        ],
        usage: { prompt_tokens: 20_000, completion_tokens: 20, total_tokens: 20_020 },
      };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }),
  );
  const provider = await createApiProvider({
    apiKey: 'test-key',
    baseURL: 'https://example.invalid/v1',
    interfaceType: 'openai-chat',
    name: 'Gemini',
    enabled: true,
  });
  const model = await createApiModel({
    name: 'Gemini',
    modelId: 'gemini-4-argon',
    compatibilityMode: 'standard',
    enabled: true,
  });
  const journal = new MemoryRunnerJournal();
  const runner = new AgentRunner({
    contextWindow: 1_048_576,
    executor: new ProviderModelStepExecutor(provider, model),
    journal,
    tools: [
      {
        name: 'read_file',
        readonly: true,
        definition: tool({ description: '读取图片', inputSchema: z.object({}) }),
        execute: async () =>
          richToolOutput(
            {
              type: 'content',
              value: [
                { type: 'text', text: '已读取角色头像。' },
                { type: 'file', mediaType: 'image/png', data: { type: 'data', data: image } },
              ],
            },
            { binary: true },
          ),
      },
    ],
  });
  const state = await runner.start('请读取并检查角色头像');
  expect(state.failure).toBeUndefined();
  expect(state.status).toBe('completed');
  expect(requests).toHaveLength(2);
  const textResult = requests[1].messages.find(message => message.role === 'tool');
  expect(textResult).toMatchObject({ tool_call_id: 'read-image', content: '已读取角色头像。' });
  const attachments = requests[1].messages.at(-1)?.content as Array<{ type: string; image_url?: { url: string } }>;
  expect(requests[1].messages.at(-1)?.role).toBe('user');
  const imageUrl = attachments.find(part => part.type === 'image_url')?.image_url?.url;
  expect(imageUrl?.startsWith('data:image/png;base64,')).toBe(true);
  expect(imageUrl?.length).toBe(image.length + 'data:image/png;base64,'.length);
  expect(state.contextUsage.apiInputTokens).toBe(20_000);
  expect(state.contextUsage.totalTokens).toBeGreaterThanOrEqual(20_000);
  expect(state.contextUsage.totalTokens).toBeLessThan(22_000);
  expect(journal.events.some(event => event.type === 'context-compaction-started')).toBe(false);
});
