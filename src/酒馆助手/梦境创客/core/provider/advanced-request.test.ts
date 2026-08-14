import { describe, expect, it, vi } from 'vitest';
import {
  applyAdvancedRequestToBody,
  createAdvancedRequestFetch,
  mergeBodyParameterLayers,
  mergeRequestHeaders,
  parseBodyParameters,
  parseExcludedBodyParameters,
  parseRequestHeaders,
} from './advanced-request';

describe('advanced request', () => {
  it('请求标头按名称大小写不敏感覆盖，保留最后一层的拼写', () => {
    expect(mergeRequestHeaders(
      { Authorization: 'provider', 'X-Source': 'provider' },
      { authorization: 'model', 'x-extra': 'yes' },
    )).toEqual({ authorization: 'model', 'X-Source': 'provider', 'x-extra': 'yes' });
  });

  it('模型附加参数递归覆盖Provider，null删除继承字段', () => {
    expect(mergeBodyParameterLayers(
      { metadata: { keep: true, remove: 1 }, tags: ['provider'], value: 1 },
      { metadata: { remove: null, add: true }, tags: ['model'], value: 2 },
    )).toEqual({ metadata: { keep: true, add: true }, tags: ['model'], value: 2 });
  });

  it('受保护的模型消息与工具字段不能通过附加参数覆盖', () => {
    expect(applyAdvancedRequestToBody(
      { messages: ['real'], model: 'real-model', temperature: 0.5 },
      { messages: ['fake'], model: 'fake-model', temperature: 0.8, metadata: { source: 'test' } },
      [],
    )).toEqual({ messages: ['real'], model: 'real-model', temperature: 0.8, metadata: { source: 'test' } });
  });

  it('在请求发出前合并YAML解析出的正文参数', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(init?.body));
    const wrapped = createAdvancedRequestFetch({ metadata: { source: 'test' } }, fetchImpl as typeof fetch);
    const response = await wrapped('https://example.invalid', { body: JSON.stringify({ model: 'real' }), method: 'POST' });
    expect(await response.json()).toEqual({ model: 'real', metadata: { source: 'test' } });
  });

  it('三段YAML分别包含参数、排除参数和请求标头', () => {
    expect(parseBodyParameters({ text: 'metadata:\n  source: model\ntemperature: 0.7' })).toEqual({
      metadata: { source: 'model' },
      temperature: 0.7,
    });
    expect(parseExcludedBodyParameters({ text: '- frequency_penalty\n- presence_penalty' })).toEqual([
      'frequency_penalty',
      'presence_penalty',
    ]);
    expect(parseRequestHeaders({ text: 'X-Test: value\nAuthorization: token' })).toEqual({
      Authorization: 'token',
      'X-Test': 'value',
    });
  });

  it('先合并包含参数再删除排除参数，核心字段始终受保护', () => {
    expect(applyAdvancedRequestToBody(
      { frequency_penalty: 0.2, messages: ['real'], model: 'real' },
      { messages: ['fake'], metadata: { source: 'test' }, temperature: 0.8 },
      ['frequency_penalty', 'messages'],
    )).toEqual({ messages: ['real'], model: 'real', metadata: { source: 'test' }, temperature: 0.8 });
  });
});
