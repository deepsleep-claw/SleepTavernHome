import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, injectRequest, validateConfig } from '../src/shared/config';
import { OutputTransformer } from '../src/shared/transform';

const config = () => validateConfig({ ...structuredClone(DEFAULT_CONFIG), enabled: true, tools: [{ ...DEFAULT_CONFIG.tools[0], outputPaths: ['thinking', 'text'], parameters: {
  type: 'object', properties: { thinking: { type: 'string' }, text: { type: 'string' } }, required: ['thinking', 'text'],
} }] });
const event = (frame: any) => ({ event: '', data: JSON.stringify(frame) });
const textOf = (frames: any[]) => frames.filter(frame => typeof frame !== 'string').flatMap(frame => frame.choices ?? []).map(choice => choice.delta?.content ?? '').join('');
const nativeText = (frames: any[]) => frames.filter(frame => typeof frame !== 'string').flatMap(frame => frame.candidates ?? []).flatMap(candidate => candidate.content?.parts ?? []).map(part => part.text ?? '').join('');

test('output paths preserve single-field presets and reject duplicate field aliases', () => {
  const legacy = validateConfig(DEFAULT_CONFIG);
  assert.equal(legacy.tools[0].outputPath, 'text');
  assert.equal(config().tools[0].outputPath, 'thinking');
  for (const paths of [[], ['text', '$.text'], ['__proto__.value'], [4]]) {
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, tools: [{ ...DEFAULT_CONFIG.tools[0], outputPaths: paths }] }));
  }
});

test('request preparation includes every selected field and injects one system message across layers', () => {
  const original = { messages: [{ role: 'system', content: '上下文' }, { role: 'user', content: '继续' }] };
  const prepared = injectRequest(injectRequest(original, config()), config());
  assert.equal(prepared.messages.length, 3);
  assert.match(prepared.messages[0].content, /publish_story.thinking、publish_story.text/);
  assert.equal(prepared.tools.length, 1);
  assert.equal(original.messages.length, 2);
  const merged = { ...prepared, messages: [{ role: 'system', content: prepared.messages.filter((message: any) => message.role === 'system').map((message: any) => message.content).join('\n\n') }, { role: 'user', content: '继续' }] };
  assert.equal(injectRequest(merged, config()).messages.length, 2);
});

test('OpenAI streams each field before the next field or call has finished', () => {
  const transformer = new OutputTransformer(config(), 'custom');
  const push = (args: string, first = false, finished = false) => textOf(transformer.event(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { ...(first ? { name: 'publish_story' } : {}), arguments: args } }] }, ...(finished ? { finish_reason: 'tool_calls' } : {}) }] })));
  assert.equal(push('{"thinking":"<analysis>前', true), '<analysis>前');
  assert.equal(push('半</analysis>","text":"<story>后'), '半</analysis>\n\n<story>后');
  assert.equal(push('半\\n\\ud83d\\ude00</story>"}', false, true), '半\n😀</story>');
  assert.deepEqual(transformer.finish(), ['[DONE]']);
});

test('configured output order survives reversed JSON keys under single-character fragments', () => {
  const transformer = new OutputTransformer(config(), 'custom');
  const args = JSON.stringify({ text: '末尾\\"\n😀', thinking: '开头\n<analysis>完整</analysis>' });
  let output = '';
  for (let i = 0; i < args.length; i++) output += textOf(transformer.event(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { ...(i === 0 ? { name: 'publish_story' } : {}), arguments: args[i] } }] } }] })));
  output += textOf(transformer.finish());
  assert.equal(output, '开头\n<analysis>完整</analysis>\n\n末尾\\"\n😀');
});

test('non-streaming providers collect nested fields in the same order and skip empty strings', () => {
  const settings = config(); settings.tools[0].outputPaths = ['sections[1].text', '/sections/0/text'];
  const args = { sections: [{ text: '正文' }, { text: '' }] };
  const openai = new OutputTransformer(settings, 'custom').json({ choices: [{ message: { tool_calls: [{ function: { name: 'publish_story', arguments: JSON.stringify(args) } }] } }] });
  const google = new OutputTransformer(settings, 'makersuite').json({ candidates: [{ content: { parts: [{ functionCall: { name: 'publish_story', args } }] } }] });
  assert.equal(openai.choices[0].message.content, '正文');
  assert.equal(google.choices[0].message.content, '正文');
  assert.throws(() => new OutputTransformer(config(), 'custom').json({ choices: [{ message: { tool_calls: [{ function: { name: 'publish_story', arguments: '{"text":"正文"}' } }] } }] }), /thinking/);
});

test('Vertex streams multiple paths and reconciles final arguments without replaying either field', () => {
  const transformer = new OutputTransformer(config(), 'vertexai');
  const push = (functionCall: any) => nativeText(transformer.event(event({ candidates: [{ content: { parts: [{ functionCall }] } }] })));
  assert.equal(push({ name: 'publish_story', partialArgs: [{ jsonPath: '$.text', stringValue: '后文', willContinue: false }], willContinue: true }), '');
  assert.equal(push({ partialArgs: [{ jsonPath: '$.thinking', stringValue: '前', willContinue: true }], willContinue: true }), '前');
  assert.equal(push({ partialArgs: [{ jsonPath: '$.thinking', stringValue: '言', willContinue: false }], willContinue: true }), '言\n\n后文');
  assert.equal(push({ args: { thinking: '前言', text: '后文' }, willContinue: false }), '');
  transformer.finish();
});

test('Interactions includes initial argument fragments and emits complete initial objects immediately', () => {
  const transformer = new OutputTransformer(config(), 'makersuite');
  const initial = transformer.event(event({ event_type: 'step.start', index: 0, step: { type: 'function_call', name: 'publish_story', arguments: '{"thinking":"开头' } }));
  assert.equal(nativeText(initial), '开头');
  const rest = transformer.event(event({ event_type: 'step.delta', index: 0, delta: { type: 'arguments', partial_arguments: '完整","text":"正文"}' } }));
  assert.equal(nativeText(rest), '完整\n\n正文');
  transformer.event(event({ event_type: 'step.stop', index: 0 })); transformer.finish();
  const complete = new OutputTransformer(config(), 'makersuite');
  assert.equal(nativeText(complete.event(event({ event_type: 'step.start', index: 0, step: { type: 'function_call', name: 'publish_story', arguments: { thinking: '前言', text: '正文' } } }))), '前言\n\n正文');
  assert.equal(nativeText(complete.event(event({ event_type: 'step.stop', index: 0 }))), '');
  complete.finish();
});

test('length-limited calls retain the available text without requiring later fields', () => {
  const transformer = new OutputTransformer(config(), 'custom');
  const frames = transformer.event(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'publish_story', arguments: '{"thinking":"未完成' } }] }, finish_reason: 'length' }] }));
  assert.equal(textOf(frames), '未完成');
  assert.deepEqual(transformer.finish(), ['[DONE]']);
});
