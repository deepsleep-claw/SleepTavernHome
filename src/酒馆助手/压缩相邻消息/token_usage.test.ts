import { describe, expect, it } from 'vitest';
import { normalizeTokenUsage, readTokenUsage, TokenUsageDecoder } from './token_usage';

describe('接口 Token 统计', () => {
  it.each([
    { usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 70, prompt_cache_miss_tokens: 30 } },
    { usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 70 } } },
    { usage: { prompt_tokens: 100, cached_tokens: 70 } },
    { usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 70 } },
    { response: { usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 70 } } } },
  ])('统一读取缓存命中与输入总量 %#', value => {
    expect(normalizeTokenUsage(value)).toMatchObject({
      input_tokens: 100,
      cached_input_tokens: 70,
      uncached_input_tokens: 30,
    });
  });

  it('区分显式零命中与没有缓存字段', () => {
    expect(normalizeTokenUsage({ usage: { prompt_tokens: 100, cached_tokens: 0 } })).toMatchObject({
      cached_input_tokens: 0,
      uncached_input_tokens: 100,
    });
    expect(normalizeTokenUsage({ usage: { prompt_tokens: 100 } })?.cached_input_tokens).toBeUndefined();
    expect(normalizeTokenUsage({ choices: [{ delta: { content: '正文' } }] })).toBeUndefined();
    expect(normalizeTokenUsage({ usage: { cached_tokens: -1, prompt_tokens: null } })).toBeUndefined();
  });

  it('保留输出、思考与响应标识，并正确处理缓存读写分项', () => {
    expect(
      normalizeTokenUsage({
        id: 'response-1',
        model: 'model',
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 70,
          cache_creation_input_tokens: 20,
          output_tokens: 30,
        },
      }),
    ).toMatchObject({
      input_tokens: 100,
      cached_input_tokens: 70,
      uncached_input_tokens: 30,
      cache_write_tokens: 20,
      output_tokens: 30,
      response_id: 'response-1',
    });
    expect(
      normalizeTokenUsage({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2 } }),
    ).toMatchObject({ output_tokens: 3, reasoning_tokens: 2 });
  });

  it('流式跨分片解析累计值，保留最后返回的统计', () => {
    const decoder = new TokenUsageDecoder();
    const stream =
      'data: {"usage":{"prompt_tokens":100,"cached_tokens":70,"completion_tokens":1}}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"你好😀"}}]}\n\n' +
      'data: {"usage":{"prompt_tokens":100,"cached_tokens":70,"completion_tokens":9}}\n\n' +
      'data: [DONE]\n\n';
    for (let index = 0; index < stream.length; index += 7) decoder.push(stream.slice(index, index + 7));
    decoder.finish();
    expect(decoder.result(true)).toMatchObject({
      input_tokens: 100,
      cached_input_tokens: 70,
      output_tokens: 9,
      complete: true,
    });
  });

  it('读取 JSON 和嵌套 choice 中的 usage', async () => {
    expect(
      await readTokenUsage(
        new Response(JSON.stringify({ choices: [{ usage: { prompt_tokens: 10, cached_tokens: 3 } }] })),
      ),
    ).toMatchObject({ input_tokens: 10, cached_input_tokens: 3 });
  });

  it('保留接口明确返回的未命中计数', () => {
    const decoder = new TokenUsageDecoder();
    decoder.push(
      'data: {"usage":{"prompt_tokens":100,"prompt_cache_hit_tokens":70,"prompt_cache_miss_tokens":31}}\n\n',
    );
    decoder.push('data: {"usage":{"completion_tokens":10}}\n\n');
    decoder.finish();
    expect(decoder.result(true)?.uncached_input_tokens).toBe(31);
  });

  it('中断后保留已收到的统计并标明部分结果', async () => {
    let count = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (count++ === 0)
            controller.enqueue(new TextEncoder().encode('data: {"usage":{"prompt_tokens":10,"cached_tokens":3}}\n\n'));
          else controller.error(Error('断开'));
        },
      }),
    );
    expect(await readTokenUsage(response)).toMatchObject({ input_tokens: 10, cached_input_tokens: 3, complete: false });
  });

  it('拒绝超大未完成片段', () => {
    const decoder = new TokenUsageDecoder(32);
    expect(() => decoder.push('data: ' + 'x'.repeat(100))).toThrow('过大');
  });
});
