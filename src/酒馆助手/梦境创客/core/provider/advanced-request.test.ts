import { describe, expect, it, vi } from 'vitest';
import {
  applyExtraParametersToBody,
  convertAdvancedRequestDocument,
  createAdvancedRequestFetch,
  mergeExtraParameterLayers,
  mergeRequestHeaders,
  parseAdvancedRequestDocument,
} from './advanced-request';

describe('advanced request', () => {
  it('请求标头按名称大小写不敏感覆盖，保留最后一层的拼写', () => {
    expect(mergeRequestHeaders(
      { Authorization: 'provider', 'X-Source': 'provider' },
      { authorization: 'model', 'x-extra': 'yes' },
    )).toEqual({ authorization: 'model', 'X-Source': 'provider', 'x-extra': 'yes' });
  });

  it('模型附加参数递归覆盖Provider，null删除继承字段', () => {
    expect(mergeExtraParameterLayers(
      { metadata: { keep: true, remove: 1 }, tags: ['provider'], value: 1 },
      { metadata: { remove: null, add: true }, tags: ['model'], value: 2 },
    )).toEqual({ metadata: { keep: true, add: true }, tags: ['model'], value: 2 });
  });

  it('受保护的模型消息与工具字段不能通过附加参数覆盖', () => {
    expect(applyExtraParametersToBody(
      { messages: ['real'], model: 'real-model', temperature: 0.5 },
      { messages: ['fake'], model: 'fake-model', temperature: 0.8, metadata: { source: 'test' } },
    )).toEqual({ messages: ['real'], model: 'real-model', temperature: 0.8, metadata: { source: 'test' } });
  });

  it('保留YAML/JSON选择并在请求发出前合并正文', async () => {
    const converted = convertAdvancedRequestDocument({ format: 'yaml', text: 'metadata:\n  source: test' }, 'json');
    expect(converted.format).toBe('json');
    expect(parseAdvancedRequestDocument(converted)).toEqual({ metadata: { source: 'test' } });

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(init?.body));
    const wrapped = createAdvancedRequestFetch({ metadata: { source: 'test' } }, fetchImpl as typeof fetch);
    const response = await wrapped('https://example.invalid', { body: JSON.stringify({ model: 'real' }), method: 'POST' });
    expect(await response.json()).toEqual({ model: 'real', metadata: { source: 'test' } });
  });
});
