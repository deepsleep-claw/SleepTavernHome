import {
  REQUEST_KEY,
  injectRequest,
  shouldActivate,
  validateConfig,
} from '../../../projects/tool-output-bridge/src/shared/config';
import { transformResponse } from '../../../projects/tool-output-bridge/src/shared/transform';
import { StreamDiagnostics, logStreamReport } from '../../../projects/tool-output-bridge/src/shared/stream-diagnostics';

function isRequest(value: RequestInfo | URL): value is Request {
  // The host and the helper script have different Request constructors.
  return typeof value === 'object' && value !== null && 'method' in value && 'clone' in value && 'url' in value;
}

export function createHelperFetch(delegate: typeof fetch, baseUrl: string): typeof fetch {
  return async (input, init) => {
    const request = isRequest(input) ? input : undefined;
    const url = new URL(request?.url ?? String(input), baseUrl);
    if (url.origin !== new URL(baseUrl).origin || url.pathname !== '/api/backends/chat-completions/generate')
      return delegate(input, init);
    if ((init?.method ?? request?.method ?? 'GET').toUpperCase() !== 'POST') return delegate(input, init);
    const raw = init?.body ?? (request ? await request.clone().text() : null);
    if (typeof raw !== 'string') return delegate(input, init);
    let body: Record<string, any>;
    try {
      body = JSON.parse(raw);
    } catch {
      return delegate(input, init);
    }
    if (!body?.[REQUEST_KEY]) return delegate(input, init);
    const config = validateConfig(body[REQUEST_KEY]);
    const active = shouldActivate(body, config);
    const next = active ? injectRequest(body, config) : { ...body };
    delete next[REQUEST_KEY];
    const options: RequestInit = {
      ...(request
        ? {
            method: request.method,
            headers: request.headers,
            signal: request.signal,
            credentials: request.credentials,
            cache: request.cache,
            redirect: request.redirect,
            mode: request.mode,
            integrity: request.integrity,
            referrer: request.referrer,
            referrerPolicy: request.referrerPolicy,
          }
        : {}),
      ...init,
      body: JSON.stringify(next),
    };
    const diagnostics =
      active && body.stream
        ? new StreamDiagnostics(report => logStreamReport(body.chat_completion_source, report))
        : undefined;
    try {
      const response = await delegate(input instanceof URL ? input : (request?.url ?? input), options);
      if (!active) return response;
      return await transformResponse(response, config, body.chat_completion_source, Boolean(body.stream), diagnostics);
    } catch (error) {
      diagnostics?.finish(options.signal?.aborted ? 'cancelled' : 'failed');
      throw error;
    }
  };
}
