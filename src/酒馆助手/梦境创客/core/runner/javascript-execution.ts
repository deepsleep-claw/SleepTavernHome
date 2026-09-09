import { prepareJavascriptBody } from './javascript-source';
import {
  createJavascriptNetwork,
  type JavascriptNetworkRequest,
  type JavascriptNetworkOptions,
} from './javascript-network';
import { callJavascriptTavernApi, javascriptTavernApiReadonly, JAVASCRIPT_TAVERN_APIS } from './javascript-tavern';

export type JavascriptRunResult = {
  cleanup: string[];
  console: Array<{ level: string; values: unknown[] }>;
  durationMs: number;
  hasResult: boolean;
  result: unknown;
};
export type JavascriptExecutionOptions = Omit<JavascriptNetworkOptions, 'signal'> & {
  code: string;
  environment: 'sandbox' | 'tavern';
  timeoutMs: number;
  signal?: AbortSignal;
};

const workerBootstrap = `
const pending = new Map(); let nextId = 0;
const send = self.postMessage.bind(self);
const safe = (value, limit = 500000) => {
  const seen = new WeakSet();
  try {
    const json = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return String(item) + 'n';
      if (typeof item === 'function') return String(item);
      if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
      if (item instanceof ArrayBuffer) return Array.from(new Uint8Array(item));
      if (ArrayBuffer.isView(item)) return Array.from(new Uint8Array(item.buffer, item.byteOffset, item.byteLength));
      if (item && typeof item === 'object') { if (seen.has(item)) return '[Circular]'; seen.add(item); }
      return item;
    });
    if (json === undefined) return null;
    if (json.length > limit) return { truncated: true, preview: json.slice(0, limit) };
    return JSON.parse(json);
  } catch { return String(value); }
};
const rpc = (kind, input, signal) => new Promise((resolve,reject) => {
  if (signal?.aborted) { reject(new DOMException('请求已取消','AbortError')); return; }
  const id = ++nextId;
  const abort = () => { pending.delete(id); reject(new DOMException('请求已取消','AbortError')); send({type:'cancel', id}); };
  pending.set(id, { resolve: value => { signal?.removeEventListener('abort',abort); resolve(value); }, reject: error => { signal?.removeEventListener('abort',abort); reject(error); } });
  signal?.addEventListener('abort',abort,{once:true});
  try { send({type:'request',id,kind,input}); } catch(error) { pending.delete(id); signal?.removeEventListener('abort',abort); reject(error); }
});
let started = false;
self.onmessage = async event => {
  const data = event.data;
  if (data.type === 'reply') {
    const task = pending.get(data.id); if (!task) return; pending.delete(data.id);
    if (data.error) task.reject(new Error(data.error)); else task.resolve(data.value);
    return;
  }
  if (data.type !== 'start' || started) return; started = true;
  let logCount = 0;
  for (const level of ['log','info','warn','error','debug']) console[level] = (...values) => {
    if (logCount++ < 100) send({type:'console',level,values:values.slice(0,5).map(value => safe(value,4096))});
  };
  const cleanups = [];
  self.onCleanup = callback => { if (typeof callback !== 'function') throw new Error('onCleanup 需要函数'); cleanups.push(callback); };
  const guardedFetch = async (input, init) => {
    if (init?.credentials === 'include') throw new Error('受控 fetch 不发送浏览器登录凭据。');
    const request = new Request(input instanceof Request ? input : new URL(String(input), data.baseUrl), init);
    const body = ['GET','HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    if (body && body.byteLength > 1048576) throw new Error('请求正文超过 1MB。');
    const value = await rpc('network', {url:request.url,method:request.method,headers:Array.from(request.headers),body}, request.signal);
    const response = new Response([101,204,205,304].includes(value.status) ? null : value.body, {status:value.status,statusText:value.statusText,headers:value.headers});
    Object.defineProperty(response,'url',{value:value.url}); return response;
  };
  Object.defineProperty(self,'fetch',{value:guardedFetch,writable:false,configurable:false});
  if (data.environment === 'tavern') {
    const call = (name,...args) => rpc('tavern',{name,args});
    self.tavern = Object.freeze({call,apis:Object.freeze(data.apis)});
    const helpers = {};
    for (const name of data.apis) {
      if (!name.includes('.')) helpers[name] = (...args) => call(name,...args);
      else { const [group,member] = name.split('.'); self[group] ||= {}; self[group][member] = (...args) => call(name,...args); }
    }
    self.TavernHelper = Object.freeze(helpers);
  }
  let result, failure, failed = false;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    result = await new AsyncFunction('"use strict";\\n' + data.code)();
  } catch(error) { failure = error; failed = true; }
  for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch(error) { console.warn('清理回调失败',String(error)); } }
  if (failed) send({type:'error',error:failure?.stack || String(failure)});
  else send({type:'result',hasResult:result !== undefined,result:safe(result)});
};
send({type:'ready'});
`;

export function javascriptFrameDocument(): string {
  const source = JSON.stringify(workerBootstrap).replaceAll('<', '\\u003c');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><script>
    try {
    const worker = new Worker(URL.createObjectURL(new Blob([${source}], {type:'text/javascript'})));
    worker.onmessage = event => parent.postMessage(event.data, '*');
    worker.onerror = event => parent.postMessage({type:'error',error:event.message}, '*');
    addEventListener('message',event => {
      if(event.source !== parent) return;
      if(event.data?.type === 'terminate') { worker.terminate(); parent.postMessage({type:'terminated',token:event.data.token}, '*'); }
      else worker.postMessage(event.data);
    });
    addEventListener('pagehide',()=>worker.terminate());
    } catch(error) { parent.postMessage({type:'error',error:String(error)}, '*'); }
  </script>`;
}

export async function executeJavascript(options: JavascriptExecutionOptions): Promise<JavascriptRunResult> {
  options.signal?.throwIfAborted();
  if (options.code.length > 500_000) throw new Error('JavaScript 源码超过 500000 字符。');
  const code = prepareJavascriptBody(options.code);
  const controller = new AbortController();
  const abort = () =>
    controller.abort(options.signal?.reason ?? new DOMException('用户已中断 JavaScript。', 'AbortError'));
  options.signal?.addEventListener('abort', abort, { once: true });
  const iframe = document.createElement('iframe');
  iframe.hidden = true;
  iframe.sandbox.add('allow-scripts');
  const logs: JavascriptRunResult['console'] = [];
  const requests = new Map<number, AbortController>();
  let requestCount = 0;
  let budget = options.timeoutMs;
  let deadlineStart = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waits = 0;
  const started = performance.now();
  const arm = () => {
    deadlineStart = performance.now();
    timer = setTimeout(
      () => controller.abort(new Error(`JavaScript 执行超过 ${options.timeoutMs}ms，已终止。`)),
      Math.max(0, budget),
    );
  };
  const waiting = (active: boolean) => {
    if (active) {
      if (waits++ === 0) {
        if (timer) clearTimeout(timer);
        budget -= performance.now() - deadlineStart;
      }
    } else if (waits > 0 && --waits === 0 && !controller.signal.aborted) arm();
  };
  const network = createJavascriptNetwork({ ...options, signal: controller.signal, waiting });
  let receive: (event: MessageEvent) => void = () => {};
  try {
    return await new Promise<JavascriptRunResult>((resolve, reject) => {
      const fail = (error: unknown) =>
        reject(
          new Error(
            `${error instanceof Error ? error.message : String(error)}${logs.length ? '\nConsole: ' + JSON.stringify(logs).slice(0, 30_000) : ''}`,
          ),
        );
      controller.signal.addEventListener('abort', () => fail(controller.signal.reason), { once: true });
      receive = event => {
        if (event.source !== iframe.contentWindow || controller.signal.aborted) return;
        const value = event.data;
        if (!value || typeof value !== 'object') return;
        if (value.type === 'ready')
          iframe.contentWindow?.postMessage(
            {
              type: 'start',
              code,
              environment: options.environment,
              baseUrl: options.baseUrl,
              apis: Object.keys(JAVASCRIPT_TAVERN_APIS),
            },
            '*',
          );
        else if (value.type === 'console' && logs.length < 100)
          logs.push({ level: String(value.level), values: Array.isArray(value.values) ? value.values : [] });
        else if (value.type === 'result')
          resolve({
            cleanup: ['隔离 Worker 与 iframe 已销毁', '未完成 fetch 请求已取消'],
            console: logs,
            durationMs: performance.now() - started,
            hasResult: value.hasResult === true,
            result: value.result ?? null,
          });
        else if (value.type === 'error') fail(value.error);
        else if (value.type === 'cancel') requests.get(value.id)?.abort();
        else if (value.type === 'request' && Number.isSafeInteger(value.id) && !requests.has(value.id)) {
          if (++requestCount > 32) {
            iframe.contentWindow?.postMessage(
              { type: 'reply', id: value.id, error: '一次 JS 执行最多调用 32 次外部请求或酒馆接口。' },
              '*',
            );
            return;
          }
          const requestController = new AbortController();
          const cancel = () => requestController.abort(controller.signal.reason);
          controller.signal.addEventListener('abort', cancel, { once: true });
          requests.set(value.id, requestController);
          const work = async () => {
            if (value.kind === 'network') {
              const broker = createJavascriptNetwork({
                ...options,
                signal: requestController.signal,
                waiting: undefined,
                requestApproval: (request, signal) =>
                  network.approve(request.description, request.intent, request.risk ?? 'ordinary', signal).then(() => {
                    signal?.throwIfAborted();
                    return true;
                  }),
              });
              return broker.request(value.input as JavascriptNetworkRequest);
            }
            if (value.kind !== 'tavern' || options.environment !== 'tavern')
              throw new Error('本次执行未开放酒馆接口桥。');
            const { name, args } = value.input ?? {};
            if (typeof name !== 'string' || !Array.isArray(args)) throw new Error('酒馆接口调用参数不正确。');
            if (!javascriptTavernApiReadonly(name) && options.approvalMode() !== 'full')
              await network.approve(
                `${options.intent ? options.intent + '\n' : ''}调用酒馆写入接口 ${name}`,
                { purpose: options.intent, name, args },
                'high',
                requestController.signal,
              );
            requestController.signal.throwIfAborted();
            return callJavascriptTavernApi(name, args);
          };
          void work()
            .then(result => iframe.contentWindow?.postMessage({ type: 'reply', id: value.id, value: result }, '*'))
            .catch(error => {
              iframe.contentWindow?.postMessage(
                { type: 'reply', id: value.id, error: error instanceof Error ? error.message : String(error) },
                '*',
              );
            })
            .finally(() => {
              requests.delete(value.id);
              controller.signal.removeEventListener('abort', cancel);
            });
        }
      };
      window.addEventListener('message', receive);
      arm();
      iframe.srcdoc = javascriptFrameDocument();
      document.body.append(iframe);
    });
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    requests.forEach(request => request.abort());
    window.removeEventListener('message', receive);
    options.signal?.removeEventListener('abort', abort);
    if (iframe.contentWindow)
      await new Promise<void>(resolve => {
        const token = crypto.randomUUID();
        const finished = () => {
          clearTimeout(fallback);
          window.removeEventListener('message', acknowledged);
          resolve();
        };
        const acknowledged = (event: MessageEvent) => {
          if (event.source === iframe.contentWindow && event.data?.type === 'terminated' && event.data?.token === token)
            finished();
        };
        const fallback = setTimeout(finished, 150);
        window.addEventListener('message', acknowledged);
        iframe.contentWindow!.postMessage({ type: 'terminate', token }, '*');
      });
    iframe.remove();
  }
}
