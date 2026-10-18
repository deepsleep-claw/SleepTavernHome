import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, injectRequest, validateConfig, type BridgeConfig } from '../src/shared/config';

const settings = (extra: Partial<BridgeConfig> = {}) => validateConfig({ ...structuredClone(DEFAULT_CONFIG), enabled: true, prompt: '输出格式约定', ...extra });
const history = () => [
  { role: 'system', content: '背景' }, { role: 'user', content: '问题一' }, { role: 'assistant', content: '回答一' },
  { role: 'tool', content: '工具结果' }, { role: 'system', content: '补充背景' },
  { role: 'user', content: '问题二' }, { role: 'assistant', content: '回答二' },
  { role: 'user', content: '问题三' }, { role: 'assistant', content: '回答三' }, { role: 'system', content: '最终背景' },
];

test('disabled prompt injection preserves messages while keeping output tools active', () => {
  const original = { messages: history() }; const warnings: string[] = [];
  const result = injectRequest(original, settings({ promptMode: 'none' }), message => warnings.push(message));
  assert.deepEqual(result.messages, original.messages); assert.equal(result.tools.length, 1); assert.deepEqual(warnings, []);
});

test('system prompt mode creates one leading system message independently of role depth', () => {
  const original = { messages: [{ role: 'user', content: '问题' }] };
  const config = settings({ promptMode: 'system_prompt', promptDepth: 100 });
  const prepared = injectRequest(original, config);
  assert.deepEqual(prepared.messages, [{ role: 'system', content: '输出格式约定' }, ...original.messages]);
  assert.deepEqual(injectRequest(prepared, config).messages, prepared.messages);
});

for (const role of ['user', 'assistant', 'system'] as const) {
  test(`${role} injection counts only matching messages in both directions`, () => {
    for (const depth of [0, 1, 2, -1, -2, -3]) {
      const original = { messages: history() }; const config = settings({ promptMode: role, promptDepth: depth });
      const matching = original.messages.map((message, index) => ({ message, index })).filter(item => item.message.role === role);
      const target = matching[depth < 0 ? matching.length + depth : depth].index;
      const warnings: string[] = []; const result = injectRequest(original, config, message => warnings.push(message));
      const expected = structuredClone(original.messages); expected[target].content += '\n\n输出格式约定';
      assert.deepEqual(result.messages, expected, `${role} ${depth}`);
      assert.deepEqual(original.messages, history()); assert.deepEqual(warnings, []);
      assert.deepEqual(injectRequest(result, config).messages, expected);
    }
  });

  test(`${role} injection skips missing targets and reports their role and depth`, () => {
    for (const depth of [3, -4]) {
      const original = { messages: history() }; const warnings: string[] = [];
      const result = injectRequest(original, settings({ promptMode: role, promptDepth: depth }), message => warnings.push(message));
      assert.deepEqual(result.messages, original.messages); assert.equal(warnings.length, 1);
      assert.ok(warnings[0].toLowerCase().includes(role)); assert.ok(warnings[0].includes(String(depth)));
    }
    const warnings: string[] = [];
    const result = injectRequest({ messages: [] }, settings({ promptMode: role }), message => warnings.push(message));
    assert.deepEqual(result.messages, []); assert.equal(warnings.length, 1);
  });
}

test('role injection preserves multimodal content and remains idempotent across request serialization', () => {
  const original = { messages: [{ role: 'user', content: [{ type: 'text', text: '观察图片' }, { type: 'image_url', image_url: { url: 'https://example.invalid/image.png' } }], name: 'reader' }] };
  const config = settings({ promptMode: 'user', promptDepth: -1 });
  const result = injectRequest(original, config);
  assert.deepEqual(result.messages[0].content, [...original.messages[0].content, { type: 'text', text: '输出格式约定' }]);
  assert.equal(result.messages[0].name, 'reader');
  assert.deepEqual(injectRequest(JSON.parse(JSON.stringify(result)), config).messages, result.messages);
  assert.deepEqual(original.messages[0].content.length, 2);
});

test('role injection can fill an assistant message with empty content', () => {
  const result = injectRequest({ messages: [{ role: 'assistant', content: null, tool_calls: [] }] }, settings({ promptMode: 'assistant' }));
  assert.equal(result.messages[0].content, '输出格式约定'); assert.deepEqual(result.messages[0].tool_calls, []);
});

test('legacy prompt switches migrate to explicit modes and depth accepts only safe integers', () => {
  const { promptMode: _mode, promptDepth: _depth, ...legacy } = structuredClone(DEFAULT_CONFIG);
  assert.equal(validateConfig({ ...legacy, promptEnabled: false }).promptMode, 'none');
  assert.equal(validateConfig({ ...legacy, promptEnabled: true }).promptMode, 'system_prompt');
  const modern = validateConfig({ ...legacy, promptEnabled: false, promptMode: 'user', promptDepth: -1 });
  assert.equal(modern.promptMode, 'user'); assert.equal(modern.promptDepth, -1); assert.equal('promptEnabled' in modern, false);
  for (const value of [0.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, promptDepth: value }), /深度/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, promptMode: 'other' }), /注入方式/);
});
