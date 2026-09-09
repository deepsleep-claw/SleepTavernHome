import type { ToolConfirmation } from './tools';

export const MAX_NETWORK_BYTES = 8 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 1024 * 1024;
export type JavascriptNetworkRequest = {
  url: string;
  method?: string;
  headers?: [string, string][];
  body?: ArrayBuffer;
};
export type JavascriptNetworkResponse = {
  url: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
};
export type JavascriptNetworkOptions = {
  intent?: string;
  allowNetwork: boolean;
  approvalMode: () => 'full' | 'manual' | 'yolo';
  baseUrl: string;
  toolCallId: string;
  signal: AbortSignal;
  requestApproval?: (request: ToolConfirmation, signal?: AbortSignal) => Promise<boolean>;
  waiting?: (active: boolean) => void;
  fetch?: typeof fetch;
};

export function createJavascriptNetwork(options: JavascriptNetworkOptions) {
  let approvalTail = Promise.resolve();
  const approve = async (description: string, intent: unknown, risk: 'high' | 'ordinary', signal = options.signal) => {
    const before = approvalTail;
    let release!: () => void;
    approvalTail = new Promise<void>(resolve => {
      release = resolve;
    });
    await before;
    try {
      signal.throwIfAborted();
      if (!options.requestApproval) throw new Error('当前环境无法请求审批。');
      options.waiting?.(true);
      const accepted = await options.requestApproval(
        { description, intent, risk, toolCallId: options.toolCallId, toolName: 'run_javascript' },
        signal,
      );
      signal.throwIfAborted();
      if (!accepted) throw new Error('用户拒绝了本次请求，未执行。');
    } finally {
      options.waiting?.(false);
      release();
    }
  };

  return {
    approve,
    async request(input: JavascriptNetworkRequest): Promise<JavascriptNetworkResponse> {
      options.signal.throwIfAborted();
      if (options.allowNetwork !== true) throw new Error('本次 JavaScript 未开启 allowNetwork，网络请求已阻止。');
      if (!input || typeof input.url !== 'string') throw new Error('网络请求缺少 URL。');
      const url = new URL(input.url, options.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('只允许不含用户名密码的 HTTP(S) 地址。');
      const method = (input.method ?? 'GET').toUpperCase();
      if (!/^[A-Z]{1,20}$/u.test(method) || ['CONNECT', 'TRACE', 'TRACK'].includes(method))
        throw new Error(`不支持的请求方法：${method}`);
      if (input.body && (!(input.body instanceof ArrayBuffer) || input.body.byteLength > MAX_REQUEST_BYTES))
        throw new Error('请求正文超过 1MB 或类型不受支持。');
      if (input.body?.byteLength && ['GET', 'HEAD'].includes(method)) throw new Error(`${method} 请求不能携带正文。`);
      if (input.headers && (!Array.isArray(input.headers) || input.headers.length > 100))
        throw new Error('请求标头过多。');
      const headers = new Headers(input.headers);
      if ([...headers].some(([name, value]) => name.length + value.length > 8192)) throw new Error('请求标头过长。');
      const mode = options.approvalMode();
      if (mode !== 'full' && (mode === 'manual' || method !== 'GET')) {
        const redactedHeaders = [...headers].map(([name, value]) => [
          name,
          /authorization|cookie|key|token|secret/iu.test(name) ? '[已隐藏]' : value,
        ]);
        await approve(
          `${options.intent ? options.intent + '\n' : ''}${method} ${url.href}`,
          {
            purpose: options.intent,
            method,
            url: url.href,
            headers: redactedHeaders,
            bodyBytes: input.body?.byteLength ?? 0,
            bodyPreview: input.body ? new TextDecoder().decode(input.body.slice(0, 2000)) : undefined,
          },
          method === 'GET' ? 'ordinary' : 'high',
        );
      }
      options.signal.throwIfAborted();
      const response = await (options.fetch ?? fetch)(url.href, {
        method,
        headers,
        body: input.body,
        signal: options.signal,
        credentials: 'omit',
        mode: 'cors',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      if (Number(response.headers.get('content-length')) > MAX_NETWORK_BYTES) {
        await response.body?.cancel();
        throw new Error('响应超过 8MB。');
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            options.signal.throwIfAborted();
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_NETWORK_BYTES) {
              await reader.cancel();
              throw new Error('响应超过 8MB。');
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        url: response.url || url.href,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers],
        body: body.buffer,
      };
    },
  };
}
