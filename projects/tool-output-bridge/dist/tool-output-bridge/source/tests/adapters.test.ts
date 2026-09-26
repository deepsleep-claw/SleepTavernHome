import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DEFAULT_CONFIG, REQUEST_KEY, validateConfig } from '../src/shared/config';
import { bridgeFetch } from '../src/frontend/fetch';
import { captureRoute } from '../src/server/transport';
import { wrapDispatch, initialize } from '../src/server/index';
import { enableArgumentStreaming, toInteractions, interactionsUrl, legacyGoogleRequest } from '../src/server/google';

const config = validateConfig({ ...DEFAULT_CONFIG, enabled: true });

test('frontend delegates untouched requests and preserves host fetch, headers and abort', async () => {
  const abort = new AbortController(); const calls: any[] = [];
  const delegate: typeof fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'publish_story', arguments: '{"text":"正文"}' } }] } }] }); };
  const wrapped = bridgeFetch(delegate, 'http://localhost:8000/', () => null);
  const body = { model: 'gemini-test', chat_completion_source: 'custom', stream: false, messages: [], [REQUEST_KEY]: config };
  const response = await wrapped('/api/backends/chat-completions/generate', { method: 'POST', headers: { 'x-csrf-token': 'test' }, body: JSON.stringify(body), signal: abort.signal });
  assert.equal((await response.json()).choices[0].message.content, '正文');
  assert.equal(calls[0].init.signal, abort.signal);
  assert.equal(calls[0].init.headers['x-csrf-token'], 'test');
  const sent = JSON.parse(calls[0].init.body); assert.equal(sent[REQUEST_KEY], undefined); assert.equal(sent.tools[0].function.name, 'publish_story');
  await wrapped('/different', { method: 'POST', body: 'untouched' }); assert.equal(calls[1].init.body, 'untouched');
});

test('frontend passes Luker job envelopes through unchanged', async () => {
  let url: any;
  const delegate: typeof fetch = async target => { url = target; return Response.json({}, { headers: { 'x-luker-generation-id': 'job1' } }); };
  const wrapped = bridgeFetch(delegate, 'http://localhost/', () => ({ id: 'tool-output-bridge', version: '0.1.0', transport: 'luker-job', host: { name: 'luker', version: '2.7' } }));
  const result = await wrapped('/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify({ [REQUEST_KEY]: config, model: 'gemini-test', chat_completion_source: 'custom', messages: [], stream: true }) });
  assert.equal(url, '/api/plugins/tool-output-bridge/generate'); assert.equal(result.headers.get('x-luker-generation-id'), 'job1'); assert.deepEqual(await result.json(), {});
});

test('frontend leaves a nonmatching model on the native route with its original content', async () => {
  let sent: any; let target: any;
  const response = Response.json({ choices: [{ message: { content: '原始正文' } }] });
  const wrapped = bridgeFetch(async (url, options) => { target = url; sent = JSON.parse(String(options?.body)); return response; }, 'http://localhost/', () => ({ id: 'tool-output-bridge', version: '0.1.0', transport: 'http', host: { name: 'SillyTavern', version: '1.18' } }));
  const body = { [REQUEST_KEY]: config, model: 'another-model', chat_completion_source: 'custom', messages: [{ role: 'user', content: '问题' }] };
  const actual = await wrapped('/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(actual, response); assert.equal(target, '/api/backends/chat-completions/generate');
  assert.deepEqual(sent.messages, body.messages); assert.equal(sent.tools, undefined); assert.equal(sent[REQUEST_KEY], undefined);
});

test('frontend refuses Interactions when the backend is unavailable', async () => {
  const wrapped = bridgeFetch(async () => { throw new Error('should not fetch'); }, 'http://localhost/', () => null);
  await assert.rejects(wrapped('/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify({ [REQUEST_KEY]: { ...config, googleMode: 'interactions' }, model: 'gemini-test', chat_completion_source: 'makersuite' }) }), /需要基米工具后端/);
});

test('Vertex argument streaming only applies to eligible models', () => {
  const body: any = {}; enableArgumentStreaming(body, 'gemini-3.1-pro-preview', true);
  assert.equal(body.toolConfig.functionCallingConfig.streamFunctionCallArguments, true);
  for (const model of ['gemini-2.5-pro', 'gemini-3.1-flash-lite']) { const other = {}; enableArgumentStreaming(other, model, true); assert.deepEqual(other, {}); }
});

test('Interactions request preserves history roles, media and selected tool', () => {
  const body = toInteractions({ contents: [{ role: 'user', parts: [{ text: '问' }, { inlineData: { mimeType: 'image/png', data: 'AA==' } }] }, { role: 'model', parts: [{ text: '答' }] }], systemInstruction: { parts: [{ text: '系统' }] }, tools: [{ functionDeclarations: [{ name: 'publish_story', parameters: DEFAULT_CONFIG.tools[0].parameters }] }], generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }, toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['publish_story'] } } }, 'gemini-test', true);
  assert.equal(body.store, false); assert.equal(body.input[0].type, 'user_input'); assert.equal(body.input[1].type, 'model_output');
  assert.equal(body.input[0].content[1].mime_type, 'image/png'); assert.equal(body.generation_config.tool_choice.allowed_tools.tools[0], 'publish_story');
  assert.equal(body.generation_config.temperature, undefined);
  assert.equal(interactionsUrl('https://proxy.test/google/v1beta/models/gemini-test:streamGenerateContent?alt=sse&key=abc'), 'https://proxy.test/google/v1beta/interactions?key=abc');
});

test('legacy Google selects the requested server secret and never sends it to the browser', async () => {
  let outbound: any; let secretId: any;
  const modules = {
    converters: { getPromptNames: () => ({}), convertGooglePrompt: () => ({ contents: [{ role: 'user', parts: [{ text: '问' }] }] }), calculateGoogleBudgetTokens: () => 'HIGH' }, constants: { GEMINI_SAFETY: [] }, google: {},
    secrets: { SECRET_KEYS: { MAKERSUITE: 'studio' }, readSecret: (_dir: any, _key: any, id: string) => { secretId = id; return 'test-secret'; } },
    util: { getConfigValue: () => 'v1beta' }, fetch: async (url: string, options: any) => { outbound = { url, options }; return Response.json({}); },
  };
  await legacyGoogleRequest({ user: { directories: {} }, body: { chat_completion_source: 'makersuite', model: 'gemini-3.1-pro', messages: [], tools: [{ type: 'function', function: { name: 'publish_story' } }], tool_choice: 'required', stream: true, secret_id: 'chosen' } }, modules, config, new AbortController().signal);
  assert.equal(secretId, 'chosen'); assert.equal(outbound.options.headers['x-goog-api-key'], 'test-secret'); assert.doesNotMatch(outbound.url, /test-secret/);
});

test('captured host route preserves JSON status and isolates socket listeners', async () => {
  const socket = new EventEmitter(); const listener = () => {}; socket.on('close', listener);
  const router = { handle(req: any, res: any) { req.socket.removeAllListeners('close'); assert.equal(req.body.model, 'test'); res.status(429).json({ error: 'limited' }); } };
  const response = await captureRoute(router, { method: 'POST', socket, body: { model: 'test' } }, new AbortController().signal);
  assert.equal(response.status, 429); assert.deepEqual(await response.json(), { error: 'limited' }); assert.deepEqual(socket.listeners('close'), [listener]);
});

test('captured host request cancels without waiting for first token', async () => {
  const controller = new AbortController(); let aborted = false;
  const promise = captureRoute({ handle(req: any) { req.socket.on('close', () => { aborted = true; }); } }, { body: {}, socket: new EventEmitter() }, controller.signal);
  controller.abort(); await assert.rejects(promise, /取消/); assert.equal(aborted, true);
});

test('Luker dispatcher receives transformed data before persistence and preserves cancellation signal', async () => {
  let stored = ''; const signal = new AbortController().signal;
  const dispatch = wrapDispatch(async ctx => {
    const response = await ctx.fetch('https://gateway.test/chat/completions', { method: 'POST', body: '{}' });
    stored = (await response.json()).choices[0].message.content;
    assert.equal(ctx.signal, signal);
  }, config);
  await dispatch({ body: { model: 'gemini-test', chat_completion_source: 'custom', stream: false }, signal, fetch: async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'publish_story', arguments: '{"text":"持久化正文"}' } }] } }] }) });
  assert.equal(stored, '持久化正文');
});

test('server uses the Luker job runner with injected tools', async () => {
  const routes = new Map<string, any>(); let selected = false;
  const router = { get: (path: string, cb: any) => routes.set(path, cb), post: (path: string, cb: any) => routes.set(path, cb) };
  const modules = { chat: { selectChatCompletionDispatch: (body: any) => { selected = body.tools[0].function.name === 'publish_story'; return async () => {}; } }, runner: { runLukerDispatch: async (req: any, res: any, options: any) => { options.select(req.body); res.job = true; } } };
  await initialize(router, modules, { name: 'luker', version: '2.7.0' });
  const response = Object.assign(new EventEmitter(), { job: false, headersSent: false, destroyed: false });
  await routes.get('/generate')({ body: { [REQUEST_KEY]: config, model: 'gemini-test', chat_completion_source: 'custom', messages: [] } }, response);
  assert.equal(response.job, true); assert.equal(selected, true);
});
