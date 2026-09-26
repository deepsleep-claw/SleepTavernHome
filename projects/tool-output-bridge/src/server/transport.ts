import { PassThrough, Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { encodeEvent } from '../shared/sse';

export function webResponse(response: any): Response {
  if (response instanceof Response) return response;
  const headers = new Headers();
  response.headers?.forEach((value: string, key: string) => headers.set(key, value));
  const body = response.body?.getReader ? response.body : response.body ? Readable.toWeb(response.body) : null;
  return new Response(body as ReadableStream | null, { status: response.status, statusText: response.statusText, headers });
}

/** Runs the host router with a request-local socket and a backpressured response. */
export function captureRoute(router: any, request: any, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const socket = new EventEmitter();
    const incoming = Object.create(request);
    incoming.url = '/generate'; incoming.baseUrl = ''; incoming.body = request.body;
    Object.defineProperty(incoming, 'socket', { value: socket });
    Object.defineProperty(incoming, 'connection', { value: socket });
    let resolved = false;
    class CapturedResponse extends PassThrough {
      statusCode = 200;
      statusMessage = '';
      headersSent = false;
      headers = new Headers();
      socket = socket;
      locals = {};
      status(code: number) { this.statusCode = code; return this; }
      setHeader(key: string, value: any) { this.headers.set(key, String(value)); return this; }
      getHeader(key: string) { return this.headers.get(key); }
      removeHeader(key: string) { this.headers.delete(key); }
      set(key: string | Record<string, string>, value?: string) {
        if (typeof key === 'string') this.setHeader(key, value);
        else for (const [name, entry] of Object.entries(key)) this.setHeader(name, entry);
        return this;
      }
      json(value: any) { this.setHeader('content-type', 'application/json'); this.end(JSON.stringify(value)); return this; }
      send(value: any) { return typeof value === 'object' ? this.json(value) : (this.end(String(value ?? '')), this); }
      sendStatus(code: number) { return this.status(code).send(String(code)); }
      flushHeaders() { this.publish(); }
      publish() {
        if (resolved) return;
        resolved = true; this.headersSent = true;
        resolve(new Response(Readable.toWeb(this) as ReadableStream, { status: this.statusCode, headers: this.headers }));
      }
      override _transform(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.publish(); super._transform(chunk, encoding, callback);
      }
      override _final(callback: (error?: Error | null) => void) { this.publish(); callback(); }
    }
    const response = new CapturedResponse();
    const abort = () => { socket.emit('close'); response.destroy(new Error('生成已取消。')); };
    response.on('error', reject);
    response.once('close', () => { signal.removeEventListener('abort', abort); socket.emit('close'); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      router.handle(incoming, response, (error?: Error) => {
        response.destroy(error ?? new Error('酒馆没有匹配的聊天生成接口。'));
      });
    } catch (error) { response.destroy(error as Error); }
  });
}

export async function forwardResponse(upstream: Response, response: any): Promise<void> {
  response.status(upstream.status);
  for (const key of ['content-type', 'cache-control', 'retry-after']) {
    const value = upstream.headers.get(key); if (value) response.setHeader(key, value);
  }
  response.setHeader('x-accel-buffering', 'no');
  if (!upstream.body) { response.end(); return; }
  const reader = upstream.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  response.once('close', cancel);
  try {
    while (!response.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) {
        await new Promise<void>((resolve, reject) => {
          const clean = () => { response.off('drain', drained); response.off('close', drained); response.off('error', failed); };
          const drained = () => { clean(); resolve(); };
          const failed = (error: Error) => { clean(); reject(error); };
          response.once('drain', drained); response.once('close', drained); response.once('error', failed);
        });
      }
    }
    if (!response.destroyed) response.end();
  } catch (error) {
    if (!response.destroyed) {
      const message = error instanceof Error ? error.message : '正文转换失败。';
      if (response.headersSent && upstream.headers.get('content-type')?.includes('text/event-stream')) {
        response.end(Buffer.from(encodeEvent({ error: { message } })));
      } else throw error;
    }
  } finally { response.off('close', cancel); reader.releaseLock(); }
}
