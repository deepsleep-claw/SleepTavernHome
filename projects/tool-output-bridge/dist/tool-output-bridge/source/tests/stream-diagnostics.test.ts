import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig } from '../src/shared/config';
import { encodeEvent } from '../src/shared/sse';
import { StreamDiagnostics, type StreamReport } from '../src/shared/stream-diagnostics';
import { transformResponse } from '../src/shared/transform';

const config = validateConfig({ ...DEFAULT_CONFIG, enabled: true });

test('diagnostics distinguish first arguments from delayed text caused by field order', async () => {
  const reports: StreamReport[] = [];
  let time = 0;
  const diagnostics = new StreamDiagnostics(report => reports.push(report), () => time);
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } });
  const ordered = validateConfig({ ...config, tools: [{ ...config.tools[0], outputPaths: ['thinking', 'text'] }] });
  time = 5;
  const response = await transformResponse(new Response(body), ordered, 'custom', true, diagnostics);
  const reader = response.body!.getReader();
  time = 10;
  upstream.enqueue(encodeEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'publish_story', arguments: '{"text":"private-response-value"' } }] } }] }));
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.doesNotMatch(first, /private-response-value/);
  time = 40;
  upstream.enqueue(encodeEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ',"thinking":"前言"}' } }] }, finish_reason: 'tool_calls' }] }));
  upstream.close();
  let rest = ''; while (true) { const next = await reader.read(); if (next.done) break; rest += new TextDecoder().decode(next.value); }
  assert.match(rest, /前言/); assert.match(rest, /private-response-value/);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], { result: 'completed', responseMs: 5, firstChunkMs: 10, chunks: 2, argumentEvents: 2, firstArgumentMs: 10, lastArgumentMs: 40, textEvents: 1, firstTextMs: 40, elapsedMs: 40, format: 'sse' });
  assert.doesNotMatch(JSON.stringify(reports), /private-response-value|publish_story|前言/);
  reader.releaseLock();
});

for (const protocol of ['native', 'interactions'] as const) test(`${protocol} diagnostics count payload events without counting reasoning as text`, async () => {
  const reports: StreamReport[] = [];
  const diagnostics = new StreamDiagnostics(report => reports.push(report));
  const frames = protocol === 'native' ? [
    { candidates: [{ content: { parts: [{ thought: true, text: '思考' }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: 'publish_story', args: { text: '正文' } } }] }, finishReason: 'STOP' }] },
  ] : [
    { event_type: 'step.start', index: 0, step: { type: 'function_call', name: 'publish_story', arguments: '' } },
    { event_type: 'step.delta', index: 0, delta: { type: 'arguments', partial_arguments: '{"text":"正' } },
    { event_type: 'step.delta', index: 0, delta: { type: 'arguments', partial_arguments: '文"}' } },
    { event_type: 'step.stop', index: 0 },
  ];
  const response = await transformResponse(new Response(new ReadableStream({ start(controller) { for (const frame of frames) controller.enqueue(encodeEvent(frame)); controller.close(); } })), config, 'makersuite', true, diagnostics);
  await response.text();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].argumentEvents, protocol === 'native' ? 1 : 2);
  assert.equal(reports[0].textEvents, protocol === 'native' ? 1 : 2);
});

for (const result of ['failed', 'cancelled'] as const) test(`diagnostics report ${result} exactly once and preserve stream termination`, async () => {
  const reports: StreamReport[] = [];
  const diagnostics = new StreamDiagnostics(report => reports.push(report));
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; }, cancel() { cancelled = true; } });
  const response = await transformResponse(new Response(body), config, 'custom', true, diagnostics);
  const reader = response.body!.getReader();
  if (result === 'failed') {
    upstream.error(new Error('upstream disconnected'));
    await assert.rejects(reader.read(), /upstream disconnected/);
  } else { await reader.cancel(); assert.equal(cancelled, true); }
  diagnostics.finish('completed');
  assert.equal(reports.length, 1); assert.equal(reports[0].result, result);
  reader.releaseLock();
});

test('diagnostics identify JSON fallback and preserve upstream error events', async () => {
  const reports: StreamReport[] = [];
  const diagnostics = new StreamDiagnostics(report => reports.push(report));
  const response = await transformResponse(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'publish_story', arguments: '{"text":"正文"}' } }] } }] }), config, 'custom', true, diagnostics);
  assert.match(await response.text(), /正文/);
  assert.equal(reports[0].format, 'json'); assert.equal(reports[0].argumentEvents, 1); assert.equal(reports[0].textEvents, 1);
  const errors: StreamReport[] = [];
  const failed = await transformResponse(new Response(new ReadableStream({ start(controller) { controller.enqueue(encodeEvent({ error: { message: 'upstream error' } })); controller.close(); } })), config, 'custom', true, new StreamDiagnostics(report => errors.push(report)));
  assert.match(await failed.text(), /upstream error/);
  assert.equal(errors.length, 1); assert.equal(errors[0].result, 'failed');
});
