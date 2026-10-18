import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import compression from 'compression';
import { initialize } from '../src/server/index';
import { DEFAULT_CONFIG, REQUEST_KEY, validateConfig } from '../src/shared/config';
import { SseDecoder, encodeEvent } from '../src/shared/sse';

test('HTTP plugin route streams converted text before upstream completion and forwards later errors', async () => {
  const config = validateConfig({ ...DEFAULT_CONFIG, enabled: true });
  const handlers = new Map<string, Function>();
  const router = { get: (path: string, cb: Function) => handlers.set(path, cb), post: (path: string, cb: Function) => handlers.set(path, cb) };
  let finish: () => void = () => {};
  let cancelled = false;
  await initialize(router, { chat: { router: { handle(req: any, res: any) {
    assert.equal(req.body.tools[0].function.name, 'publish_story');
    assert.equal(req.body[REQUEST_KEY], undefined);
    req.socket.on('close', () => { cancelled = true; });
    res.setHeader('content-type', 'text/event-stream');
    res.write(Buffer.from(encodeEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'publish_story', arguments: '{"text":"首段' } }] } }] })));
    finish = () => res.end(Buffer.from(encodeEvent({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })));
  } } } }, { name: 'SillyTavern', version: '1.18.0' });
  const server = createServer(async (req: any, res: ServerResponse & any) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); req.body = JSON.parse(Buffer.concat(chunks).toString());
    res.status = (status: number) => { res.statusCode = status; return res; };
    res.json = (body: any) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    await handlers.get('/generate')!(req, res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/generate`, { method: 'POST', body: JSON.stringify({ [REQUEST_KEY]: config, model: 'gemini-test', chat_completion_source: 'custom', messages: [], stream: true }) });
    const reader = response.body!.getReader();
    const first = await reader.read(); const initialText = new TextDecoder().decode(first.value);
    assert.match(initialText, /首段/); assert.doesNotMatch(initialText, /tool_calls/);
    finish();
    let final = ''; while (true) { const next = await reader.read(); if (next.done) break; final += new TextDecoder().decode(next.value); }
    assert.match(final, /"error"/); assert.equal(cancelled, true);
    reader.releaseLock();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const delivery of ['incremental', 'buffered'] as const) test(`real HTTP upstream ${delivery} delivery passes through the host pipe and compression`, async t => {
  const logs: string[] = [];
  t.mock.method(console, 'info', (message: string) => { logs.push(message); });
  const config = validateConfig({ ...DEFAULT_CONFIG, enabled: true });
  const firstFrame = encodeEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'publish_story', arguments: '{"text":"首段' } }] } }] });
  const lastFrame = encodeEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '末段"}' } }] }, finish_reason: 'tool_calls' }] });
  let advance = () => {};
  let accepted = () => {};
  const upstreamReady = new Promise<void>(resolve => { accepted = resolve; });
  let upstreamFinished = false;
  let hostFinished = false;
  const upstream = createServer((_req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    if (delivery === 'incremental') res.write(firstFrame);
    advance = () => {
      upstreamFinished = true;
      res.end(delivery === 'incremental' ? lastFrame : Buffer.concat([firstFrame, lastFrame]));
    };
    accepted();
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const upstreamPort = (upstream.address() as { port: number }).port;
  const handlers = new Map<string, Function>();
  const router = { get: (path: string, cb: Function) => handlers.set(path, cb), post: (path: string, cb: Function) => handlers.set(path, cb) };
  await initialize(router, { chat: { router: { handle(req: any, res: any) {
    // Match the host's Node readable pipe, including its completion and socket handlers.
    const remote = get(`http://127.0.0.1:${upstreamPort}`, from => {
      res.statusCode = from.statusCode;
      from.pipe(res);
      res.socket.on('close', () => { from.destroy(); res.end(); });
      from.on('end', () => { hostFinished = true; res.end(); });
      from.on('error', error => res.destroy(error));
    });
    remote.on('error', error => res.destroy(error));
    req.socket.on('close', () => remote.destroy());
  } } } }, { name: 'SillyTavern', version: '1.18.0' });
  const compress = compression({ threshold: 0 });
  const server = createServer((req: any, res: ServerResponse & any) => {
    compress(req, res, () => { void (async () => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); req.body = JSON.parse(Buffer.concat(chunks).toString());
      res.status = (status: number) => { res.statusCode = status; return res; };
      res.json = (body: any) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
      await handlers.get('/generate')!(req, res);
    })(); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = (server.address() as { port: number }).port;
    const pending = fetch(`http://127.0.0.1:${port}/generate`, { method: 'POST', headers: { 'accept-encoding': 'gzip' }, signal: AbortSignal.timeout(5000), body: JSON.stringify({ [REQUEST_KEY]: config, model: 'gemini-test', chat_completion_source: 'custom', messages: [], stream: true }) });
    await upstreamReady;
    if (delivery === 'buffered') advance();
    const response = await pending;
    const reader = response.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /首段/);
    if (delivery === 'incremental') {
      assert.equal(upstreamFinished, false);
      assert.equal(hostFinished, false);
      assert.doesNotMatch(initial, /末段/);
      advance();
    }
    let output = initial;
    while (true) { const next = await reader.read(); if (next.done) break; output += new TextDecoder().decode(next.value); }
    assert.equal(hostFinished, true);
    const frames = new SseDecoder().push(output, true).filter(event => event.data !== '[DONE]').map(event => JSON.parse(event.data));
    assert.equal(frames.flatMap(frame => frame.choices ?? []).map(choice => choice.delta?.content ?? '').join(''), '首段末段');
    assert.equal(response.headers.get('content-encoding'), null);
    const diagnostic = logs.find(message => message.includes('流式诊断'));
    assert.ok(diagnostic); assert.match(diagnostic, /结果=completed/); assert.match(diagnostic, /参数事件=2/);
    assert.doesNotMatch(diagnostic, /首段|末段|publish_story/);
    reader.releaseLock();
  } finally {
    advance(); server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
  }
});

for (const mode of ['openai', 'interactions', 'native'] as const) test(`HTTP ${mode} output reaches clients before completion under response compression`, async () => {
  const source = mode === 'openai' ? 'custom' : 'makersuite';
  const config = validateConfig({ ...DEFAULT_CONFIG, enabled: true, googleMode: mode === 'interactions' ? 'interactions' : 'auto', tools: [{ ...DEFAULT_CONFIG.tools[0], outputPaths: ['thinking', 'text'] }] });
  const handlers = new Map<string, Function>();
  const router = { get: (path: string, cb: Function) => handlers.set(path, cb), post: (path: string, cb: Function) => handlers.set(path, cb) };
  let finish = () => {};
  const modules = {
    chat: { router: { handle(req: any, res: any) {
      assert.match(req.body.messages[0].content, /publish_story.thinking、publish_story.text/);
      res.write(Buffer.from(encodeEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'publish_story', arguments: '{"thinking":"前言' } }] } }] })));
      finish = () => { if (!res.destroyed) res.end(Buffer.from(encodeEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '","text":"正文"}' } }] }, finish_reason: 'tool_calls' }] }))); };
    } } },
    converters: {
      getPromptNames: () => ({}), calculateGoogleBudgetTokens: () => 'HIGH',
      convertGooglePrompt: (messages: any[]) => ({ contents: [{ role: 'user', parts: [{ text: '问题' }] }], system_instruction: { parts: [{ text: messages.filter(message => message.role === 'system').map(message => message.content).join('\n') }] } }),
    },
    constants: { GEMINI_SAFETY: [] }, google: {},
    secrets: { SECRET_KEYS: { MAKERSUITE: 'studio' }, readSecret: () => 'test-secret' },
    util: { getConfigValue: () => 'v1beta' },
    fetch: async (_url: string, options: any) => {
      const sent = JSON.parse(options.body);
      assert.match(mode === 'interactions' ? sent.system_instruction : sent.systemInstruction.parts[0].text, /publish_story.thinking、publish_story.text/);
      return new Response(new ReadableStream({ start(controller) {
        let closed = false;
        if (mode === 'interactions') {
          controller.enqueue(encodeEvent({ event_type: 'step.start', index: 0, step: { type: 'function_call', name: 'publish_story', arguments: '{"thinking":"前言' } }));
        } else {
          controller.enqueue(encodeEvent({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'publish_story', args: { thinking: '前言', text: '正文' } } }] } }] }));
        }
        finish = () => {
          if (closed) return; closed = true;
          if (mode === 'interactions') {
            controller.enqueue(encodeEvent({ event_type: 'step.delta', index: 0, delta: { type: 'arguments', partial_arguments: '","text":"正文"}' } }));
            controller.enqueue(encodeEvent({ event_type: 'step.stop', index: 0 }));
            controller.enqueue(encodeEvent({ event_type: 'interaction.completed', interaction: { status: 'requires_action' } }));
          } else controller.enqueue(encodeEvent({ candidates: [{ finishReason: 'STOP' }] }));
          controller.close();
        };
      } }), { headers: { 'content-type': 'text/event-stream' } });
    },
  };
  await initialize(router, modules, { name: 'SillyTavern', version: '1.18.0' });
  const compress = compression({ threshold: 0 });
  const server = createServer((req: any, res: ServerResponse & any) => {
    compress(req, res, () => { void (async () => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); req.body = JSON.parse(Buffer.concat(chunks).toString());
      req.user = { directories: {} };
      res.status = (status: number) => { res.statusCode = status; return res; };
      res.json = (body: any) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
      await handlers.get('/generate')!(req, res);
    })(); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/generate`, { method: 'POST', headers: { 'accept-encoding': 'gzip' }, signal: AbortSignal.timeout(5000), body: JSON.stringify({ [REQUEST_KEY]: config, model: 'gemini-test', chat_completion_source: source, messages: [{ role: 'user', content: '问题' }], use_sysprompt: true, stream: true }) });
    assert.equal(response.status, 200, response.ok ? undefined : await response.text());
    assert.match(response.headers.get('cache-control')!, /no-transform/);
    assert.equal(response.headers.get('content-encoding'), null);
    const reader = response.body!.getReader();
    const first = await reader.read();
    const initial = new TextDecoder().decode(first.value);
    assert.match(initial, /前言/); assert.doesNotMatch(initial, /tool_calls|functionCall/);
    finish();
    let output = initial;
    while (true) { const next = await reader.read(); if (next.done) break; output += new TextDecoder().decode(next.value); }
    const frames = new SseDecoder().push(output, true).filter(event => event.data !== '[DONE]').map(event => JSON.parse(event.data));
    const text = frames.flatMap(frame => mode === 'openai' ? frame.choices?.map((choice: any) => choice.delta?.content ?? '') ?? [] : frame.candidates?.flatMap((candidate: any) => candidate.content?.parts?.map((part: any) => part.text ?? '') ?? []) ?? []).join('');
    assert.equal(text, '前言\n\n正文');
    reader.releaseLock();
  } finally { finish(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
