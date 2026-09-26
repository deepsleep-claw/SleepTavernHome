import { PLUGIN_ID, REQUEST_KEY, injectRequest, resolveProtocol, shouldActivate, validateConfig } from '../shared/config';
import { transformResponse } from '../shared/transform';

export interface BackendStatus { id: string; version: string; transport: string; host: { name: string; version: string } }

export function bridgeFetch(delegate: typeof fetch, baseUrl: string, backend: () => BackendStatus | null): typeof fetch {
  return async (input, init) => {
    const originalUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(originalUrl, baseUrl);
    if (url.origin !== new URL(baseUrl).origin || url.pathname !== '/api/backends/chat-completions/generate') return delegate(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() !== 'POST') return delegate(input, init);
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (typeof raw !== 'string') return delegate(input, init);
    let body: any;
    try { body = JSON.parse(raw); } catch { return delegate(input, init); }
    if (!body?.[REQUEST_KEY]) return delegate(input, init);
    const config = validateConfig(body[REQUEST_KEY]);
    const active = shouldActivate(body, config);
    const useBackend = active && Boolean(backend());
    if (active && !useBackend && resolveProtocol(body.chat_completion_source, config.googleMode) === 'interactions') {
      throw new Error('Interactions 模式需要基米工具后端。请启动后端并重新检测，或选择 Google 原生模式。');
    }
    const nextBody = useBackend ? body : active ? injectRequest(body, config) : { ...body };
    if (!active) delete nextBody[REQUEST_KEY];
    const target = useBackend ? `/api/plugins/${PLUGIN_ID}/generate` : originalUrl;
    const options: RequestInit = input instanceof Request
      ? { method: input.method, headers: input.headers, signal: input.signal, credentials: input.credentials, cache: input.cache, redirect: input.redirect, ...init, body: JSON.stringify(nextBody) }
      : { ...init, body: JSON.stringify(nextBody) };
    // Delegating preserves the native bridge installed by desktop hosts.
    const response = await delegate(target, options);
    return useBackend || !active ? response : transformResponse(response, config, body.chat_completion_source, Boolean(body.stream));
  };
}
