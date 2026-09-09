import { describe, expect, it } from 'vitest';
import { javascriptFrameDocument } from './javascript-execution';
import { prepareJavascriptBody } from './javascript-source';

const vmModule = 'node:vm';
const { runInNewContext } = (await import(vmModule)) as {
  runInNewContext: (source: string, context: Record<string, unknown>) => unknown;
};

async function workerResult(code: string) {
  const html = javascriptFrameDocument();
  const match = /new Blob\(\[("(?:\\.|[^"\\])*")\]/u.exec(html);
  if (!match) throw new Error('Worker source missing');
  const source = JSON.parse(match[1]) as string;
  const messages: Array<Record<string, unknown>> = [];
  const scope: Record<string, unknown> = {
    console: {},
    URL,
    Request,
    Response,
    DOMException,
    setTimeout,
    clearTimeout,
    postMessage: (value: Record<string, unknown>) => messages.push(value),
  };
  scope.self = scope;
  runInNewContext(source, scope);
  await (scope.onmessage as (event: unknown) => Promise<void>)({
    data: {
      type: 'start',
      code: prepareJavascriptBody(code),
      environment: 'sandbox',
      baseUrl: 'https://example.test/',
      apis: [],
    },
  });
  return messages;
}

describe('isolated JavaScript worker', () => {
  it('实际 Worker 包装返回异步 IIFE 的值并保留日志', async () => {
    const events = await workerResult(
      '(async () => { await Promise.resolve(); console.log("ready"); return { answer: 42 }; })()',
    );
    expect(events).toContainEqual({ type: 'console', level: 'log', values: ['ready'] });
    expect(events.at(-1)).toEqual({ type: 'result', hasResult: true, result: { answer: 42 } });
  });
  it('异步异常仍执行清理并返回错误', async () => {
    const events = await workerResult(
      'onCleanup(async () => { await Promise.resolve(); console.info("cleaned"); }); throw new Error("failure");',
    );
    expect(events).toContainEqual({ type: 'console', level: 'info', values: ['cleaned'] });
    expect(events.at(-1)?.type).toBe('error');
    expect(events.at(-1)?.error).toContain('failure');
  });
  it('不可直接传输的值得到稳定表示', async () => {
    const events = await workerResult('const value = { n: 2n }; value.self = value; return value;');
    expect(events.at(-1)).toEqual({ type: 'result', hasResult: true, result: { n: '2n', self: '[Circular]' } });
  });
  it('控制文档以 CSP 禁止原生联网和子页面载入', () => {
    expect(javascriptFrameDocument()).toContain("connect-src 'none'");
    expect(javascriptFrameDocument()).toContain("frame-src 'none'");
    expect(javascriptFrameDocument()).toContain("default-src 'none'");
  });
});
