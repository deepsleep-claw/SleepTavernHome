import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { initialize } from '../src/server/index';
import { DEFAULT_CONFIG, REQUEST_KEY, validateConfig } from '../src/shared/config';
import { encodeEvent } from '../src/shared/sse';

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
