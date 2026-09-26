import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, DEFAULT_GLOBAL_CONFIG, configFromPreset, globalConfigFromSettings, modelMatches, resolveProtocol, shouldActivate } from '../src/shared/config';
import { prepareGoogleOutbound } from '../src/server/google';

test('global model gating requires an enabled switch and a case-insensitive substring match', () => {
  const settings = globalConfigFromSettings({ enabled: true, modelNameIncludes: ' Gemini ' });
  const body = { model: 'google/GEMINI-3.1-pro-preview', chat_completion_source: 'custom' };
  assert.equal(settings.modelNameIncludes, 'Gemini');
  assert.equal(shouldActivate(body, settings), true);
  assert.equal(shouldActivate(body, DEFAULT_GLOBAL_CONFIG), false);
  for (const model of ['', 'claude-test', undefined]) assert.equal(shouldActivate({ ...body, model }, settings), false);
  for (const type of ['quiet', 'impersonate']) assert.equal(shouldActivate({ ...body, type }, settings), false);
  assert.equal(shouldActivate({ ...body, chat_completion_source: 'claude' }, settings), false);
  assert.equal(modelMatches('vendor/MyModel-v2', 'mymodel'), true);
  assert.throws(() => globalConfigFromSettings({ modelNameIncludes: '  ' }), /关键词/);
  assert.equal(configFromPreset({ enabled: true }).enabled, false);
});

test('automatic protocol follows the actual provider source', () => {
  assert.equal(DEFAULT_CONFIG.googleMode, 'auto');
  for (const source of ['custom', 'openai', 'openrouter']) assert.equal(resolveProtocol(source), 'openai');
  assert.equal(resolveProtocol('makersuite'), 'gemini');
  assert.equal(resolveProtocol('vertexai'), 'vertex');
  assert.equal(resolveProtocol('makersuite', 'interactions'), 'interactions');
  assert.equal(resolveProtocol('vertexai', 'interactions'), 'vertex');
  assert.equal(resolveProtocol('claude'), null);
  const native = { tools: [{ functionDeclarations: [{ name: 'publish_story' }] }] };
  const options = { method: 'POST', body: JSON.stringify(native) };
  const url = 'https://test.invalid/v1beta/models/gemini-3.1-pro:streamGenerateContent';
  for (const source of ['custom', 'makersuite', 'vertexai']) {
    const prepared = prepareGoogleOutbound(url, options, { chat_completion_source: source, model: 'gemini-3.1-pro', stream: true }, DEFAULT_CONFIG);
    const sent = JSON.parse(prepared.options.body);
    assert.equal(prepared.url, url);
    assert.equal(sent.toolConfig?.functionCallingConfig?.streamFunctionCallArguments, source === 'vertexai' ? true : undefined);
  }
});
