import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, injectRequest, validateConfig, type BridgeConfig } from '../src/shared/config';
import { PartialJsonText } from '../src/shared/partial-json';
import { SseDecoder, encodeEvent } from '../src/shared/sse';
import { OutputTransformer, transformResponse } from '../src/shared/transform';

const config = (extra: Partial<BridgeConfig> = {}) => validateConfig({ ...structuredClone(DEFAULT_CONFIG), enabled: true, ...extra });
const event = (value: any) => ({ data: JSON.stringify(value), event: '', id: '' });
const textOf = (frames: any[]) => frames.filter(frame => typeof frame !== 'string').flatMap(frame => frame.choices ?? []).map(choice => choice.delta?.content ?? choice.message?.content ?? '').join('');
const nativeText = (frame: any) => (frame.candidates ?? []).flatMap((candidate: any) => candidate.content?.parts ?? []).filter((part: any) => !part.thought).map((part: any) => part.text ?? '').join('');

test('request injection snapshots configuration and preserves unrelated tools', () => {
  const original = { messages: [{ role: 'user', content: '你好' }], tools: [{ type: 'function', function: { name: 'weather' } }] };
  const result = injectRequest(original, config());
  assert.equal(result.tools.length, 2); assert.equal(original.tools.length, 1);
  assert.equal(result.tool_choice.function.name, 'publish_story');
  assert.match(result.messages[0].content, /publish_story.text/);
});

test('configuration rejects ambiguous tools and unsafe paths', () => {
  assert.throws(() => config({ tools: [...DEFAULT_CONFIG.tools, ...DEFAULT_CONFIG.tools] }), /重复/);
  assert.throws(() => config({ tools: [{ ...DEFAULT_CONFIG.tools[0], outputPath: '__proto__.x' }] }), /路径/);
  assert.throws(() => config({ forcedTool: 'missing' }), /启用/);
  assert.throws(() => config({ version: 2 as any }), /版本/);
});

for (const path of ['story.text', '/story/text', '$.story.text']) test(`incremental JSON preserves escapes and Unicode at ${path}`, () => {
  const expected = '中文\n"quote" \\ slash /\t😀\u0000';
  const raw = JSON.stringify({ ignored: 'text', story: { text: expected, other: true } }).replace('😀', '\\ud83d\\ude00');
  for (const size of [1, 2, 5, 100]) {
    const parser = new PartialJsonText(path); let text = '';
    for (let index = 0; index < raw.length; index += size) text += parser.push(raw.slice(index, index + size));
    assert.equal(text, expected); assert.equal(parser.finish(), expected);
  }
});

test('array paths, incomplete JSON and duplicate targets', () => {
  const parser = new PartialJsonText('chapters[1].text');
  assert.equal(parser.push('{"chapters":[{"text":"忽略"},{"text":"展示"}]}'), '展示');
  parser.finish();
  const incomplete = new PartialJsonText('text');
  assert.equal(incomplete.push('{"text":"已出现'), '已出现');
  assert.throws(() => incomplete.finish());
  const duplicate = new PartialJsonText('text');
  assert.throws(() => duplicate.push('{"text":"一","text":"二"}'), /重复/);
});

test('SSE decodes byte boundaries, comments, CRLF and multiline data', () => {
  const decoder = new SseDecoder(); const frames: any[] = [];
  const raw = new TextEncoder().encode(': ping\r\nevent: step.delta\r\nid: 7\r\ndata: {"字":\r\ndata: "文"}\r\n\r\n');
  for (const byte of raw) frames.push(...decoder.push(Uint8Array.of(byte)));
  frames.push(...decoder.push(new Uint8Array(), true));
  assert.equal(frames.length, 1); assert.equal(frames[0].event, 'step.delta');
  assert.deepEqual(JSON.parse(frames[0].data), { 字: '文' });
});

test('OpenAI content is visible before arguments finish and consumed calls disappear', () => {
  const transformer = new OutputTransformer(config(), 'custom');
  const start = transformer.event(event({ choices: [{ index: 0, delta: { role: 'assistant', content: '隐藏', tool_calls: [{ index: 0, id: 'abc', type: 'function', function: { name: 'publish_story', arguments: '{"text":"开头' } }] } }] }));
  assert.equal(textOf(start), '开头'); assert.equal(start[0].choices[0].delta.tool_calls, undefined);
  const end = transformer.event(event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '\\n结尾"}' } }] }, finish_reason: 'tool_calls' }], usage: { total_tokens: 8 } }));
  assert.equal(textOf(end), '\n结尾'); assert.equal(end[0].choices[0].finish_reason, 'stop'); assert.equal(end[0].usage.total_tokens, 8);
  assert.deepEqual(transformer.finish(), ['[DONE]']);
});

test('interleaved parallel tool calls are emitted in call order', () => {
  const transformer = new OutputTransformer(config(), 'openai'); const frames: any[] = [];
  frames.push(...transformer.event(event({ choices: [{ delta: { tool_calls: [
    { index: 0, function: { name: 'publish_story', arguments: '{"text":"一' } },
    { index: 1, function: { name: 'publish_story', arguments: '{"text":"三"}' } },
  ] } }] })));
  assert.equal(textOf(frames), '一');
  frames.push(...transformer.event(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '二"}' } }] }, finish_reason: 'tool_calls' }] })));
  assert.equal(textOf(frames), '一二\n\n三');
});

test('unrelated calls and reasoning remain available to the host', () => {
  const transformer = new OutputTransformer(config({ keepOriginalText: true }), 'custom');
  const frames = transformer.event(event({ choices: [{ delta: { content: '前言', reasoning_content: '思考', tool_calls: [
    { index: 0, function: { name: 'weather', arguments: '{"city":"北京"}' } },
    { index: 1, function: { name: 'publish_story', arguments: '{"text":"正文"}' } },
  ] }, finish_reason: 'tool_calls' }] }));
  assert.equal(textOf(frames), '前言\n\n正文');
  assert.equal(frames[0].choices[0].delta.tool_calls[0].function.name, 'weather');
  assert.equal(frames[0].choices[0].delta.reasoning_content, '思考');
  assert.equal(frames[0].choices[0].finish_reason, 'tool_calls');
});

test('native Gemini combines text parts and preserves thoughts while removing owned signatures', () => {
  const transformer = new OutputTransformer(config({ keepOriginalText: true }), 'makersuite');
  const frame = transformer.event(event({ candidates: [{ content: { parts: [
    { text: '原文一' }, { text: '思考', thought: true, thoughtSignature: 'opaque' }, { text: '原文二' },
    { functionCall: { name: 'publish_story', args: { text: '工具正文' } }, thoughtSignature: 'call-only' },
  ] }, finishReason: 'STOP' }] }))[0];
  assert.equal(nativeText(frame), '原文一原文二\n\n工具正文');
  assert.equal(frame.candidates[0].content.parts[1].thoughtSignature, 'opaque');
  assert.doesNotMatch(JSON.stringify(frame), /call-only|functionCall/);
});

test('Vertex partialArgs stream text and reconcile a final complete object', () => {
  const transformer = new OutputTransformer(config(), 'vertexai');
  const frame = (fc: any) => transformer.event(event({ candidates: [{ content: { parts: [{ functionCall: fc }] } }] }))[0];
  assert.equal(nativeText(frame({ name: 'publish_story', args: {}, willContinue: true, partialArgs: [{ jsonPath: '$.text', stringValue: '前半' }] })), '前半');
  assert.equal(nativeText(frame({ willContinue: true, partialArgs: [{ jsonPath: '$.text', stringValue: '后半' }] })), '后半');
  assert.equal(nativeText(frame({ args: { text: '前半后半' }, willContinue: false })), '');
  transformer.finish();
});

test('Interactions steps become native Gemini text with usage', () => {
  const transformer = new OutputTransformer(config(), 'makersuite');
  transformer.event(event({ event_type: 'step.start', index: 2, step: { type: 'function_call', name: 'publish_story', id: 'f1', arguments: {} } }));
  const frames = transformer.event(event({ event_type: 'step.delta', index: 2, delta: { type: 'arguments_delta', arguments: '{"text":"逐段' } }));
  assert.equal(nativeText(frames[0]), '逐段');
  transformer.event(event({ event_type: 'step.delta', index: 2, delta: { type: 'arguments_delta', arguments: '返回"}' } }));
  transformer.event(event({ event_type: 'step.stop', index: 2 }));
  const completed = transformer.event(event({ event_type: 'interaction.completed', interaction: { status: 'requires_action', usage: { total_tokens: 23 } } }));
  assert.equal(completed[0].usageMetadata.totalTokenCount, 23);
  transformer.finish();
});

test('non-streaming adapters produce message content and preserve unrelated tools', () => {
  const transformer = new OutputTransformer(config(), 'custom');
  const result = transformer.json({ choices: [{ message: { content: '隐藏', tool_calls: [
    { function: { name: 'publish_story', arguments: '{"text":"正文"}' } }, { function: { name: 'weather', arguments: '{}' } },
  ] }, finish_reason: 'tool_calls' }] });
  assert.equal(result.choices[0].message.content, '正文'); assert.equal(result.choices[0].message.tool_calls.length, 1);
  const native = new OutputTransformer(config(), 'makersuite').json({ steps: [{ type: 'function_call', name: 'publish_story', arguments: { text: '原生' } }] });
  assert.equal(native.choices[0].message.content, '原生');
});

test('upstream errors survive incomplete tool output', () => {
  const transformer = new OutputTransformer(config(), 'custom');
  transformer.event(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'publish_story', arguments: '{"text":"断' } }] } }] }));
  const error = { error: { message: 'rate limit' } };
  assert.deepEqual(transformer.event(event(error)), [error]); assert.deepEqual(transformer.finish(), []);
});

test('fragmented function names and empty argument fragments are buffered', () => {
  const transformer = new OutputTransformer(config(), 'custom');
  const first = transformer.event(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'publish_', arguments: '' } }] } }] }));
  assert.equal(first[0].choices[0].delta.tool_calls, undefined);
  const last = transformer.event(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'story', arguments: '{"text":"正文"}' } }] }, finish_reason: 'tool_calls' }] }));
  assert.equal(textOf(last), '正文'); assert.equal(last[0].choices[0].delta.tool_calls, undefined);
});

test('hidden ordinary-only replies report missing tool output', () => {
  const transformer = new OutputTransformer(config(), 'custom');
  transformer.event(event({ choices: [{ delta: { content: '没有遵循工具' } }] }));
  assert.throws(() => transformer.finish(), /没有调用正文工具/);
  assert.throws(() => new OutputTransformer(config(), 'custom').json({ choices: [{ message: { content: '普通正文' } }] }), /没有调用正文工具/);
});

test('a buffered JSON reply can satisfy a streaming request', async () => {
  const response = await transformResponse(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'publish_story', arguments: '{"text":"整块"}' } }] } }] }), config(), 'custom', true);
  assert.match(response.headers.get('content-type')!, /event-stream/);
  assert.match(await response.text(), /"delta":\{"content":"整块"\}/);
});

test('transport preserves UTF-8 under arbitrary byte fragmentation and propagates cancellation', async () => {
  const frames = [
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'publish_story', arguments: '{"text":"中文😀"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]',
  ];
  const bytes = new TextEncoder().encode(frames.map(frame => new TextDecoder().decode(encodeEvent(frame))).join(''));
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
  const transformed = await transformResponse(response, config(), 'custom', true);
  const decoder = new SseDecoder();
  const output = decoder.push(new Uint8Array(await transformed.arrayBuffer()), true).filter(item => item.data !== '[DONE]').map(item => JSON.parse(item.data));
  assert.equal(textOf(output), '中文😀');
  let cancelled = false;
  const pending = await transformResponse(new Response(new ReadableStream({ cancel() { cancelled = true; } })), config(), 'custom', true);
  await pending.body!.cancel();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});
