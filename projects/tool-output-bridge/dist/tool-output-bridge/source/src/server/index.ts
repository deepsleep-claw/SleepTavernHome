import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PLUGIN_ID, VERSION, REQUEST_KEY, injectRequest, shouldActivate, resolveProtocol, validateConfig, type BridgeConfig } from '../shared/config';
import { transformResponse } from '../shared/transform';
import { captureRoute, forwardResponse, webResponse } from './transport';
import { legacyGoogleRequest, prepareGoogleOutbound } from './google';

export const info = { id: PLUGIN_ID, name: '基米工具', description: '将模型工具参数转换为聊天正文。' };

export function wrapDispatch(dispatch: (context: any) => Promise<void>, config: BridgeConfig): (context: any) => Promise<void> {
  return context => dispatch({ ...context, fetch: async (url: string, options: any) => {
    const prepared = prepareGoogleOutbound(url, options, context.body, config);
    const upstream = await context.fetch(prepared.url, prepared.options);
    return transformResponse(webResponse(upstream), config, context.body.chat_completion_source, Boolean(context.body.stream));
  } });
}

export async function initialize(router: any, modules: any, host: { name: string; version: string }): Promise<void> {
  const luker = typeof modules.chat.selectChatCompletionDispatch === 'function' && typeof modules.runner?.runLukerDispatch === 'function';
  router.get('/status', (_request: any, response: any) => response.json({ id: PLUGIN_ID, version: VERSION, host, transport: luker ? 'luker-job' : 'http', interactions: true, vertexArgumentStreaming: true }));
  router.post('/generate', async (request: any, response: any) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    try {
      const config = validateConfig(request.body?.[REQUEST_KEY]);
      if (!shouldActivate(request.body, config)) throw new Error('当前请求未满足基米工具的全局开关、模型名称或接口条件。');
      if (!Array.isArray(request.body.messages)) throw new Error('聊天请求缺少消息列表。');
      request.body = injectRequest(request.body, config);
      if (luker) {
        if (request.body.custom_prompt_post_processing) request.body.messages = modules.converters.postProcessPrompt(request.body.messages, request.body.custom_prompt_post_processing, modules.converters.getPromptNames(request));
        if (request.body.json_schema?.value) request.body.json_schema.value = modules.util.flattenSchema(request.body.json_schema.value, request.body.chat_completion_source);
        // Transform before job accumulation so persistence and reconnect replay share the same text.
        await modules.runner.runLukerDispatch(request, response, { endpoint: 'chat-completions', select: (body: any) => wrapDispatch(modules.chat.selectChatCompletionDispatch(body), config) });
        return;
      }
      response.once('close', cancel);
      const source = request.body.chat_completion_source;
      const upstream = resolveProtocol(source, config.googleMode) !== 'openai'
        ? webResponse(await legacyGoogleRequest(request, modules, config, controller.signal))
        : await captureRoute(modules.chat.router, request, controller.signal);
      await forwardResponse(await transformResponse(upstream, config, source, Boolean(request.body.stream)), response);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) response.status(400).json({ error: { message: error instanceof Error ? error.message : '工具正文请求失败。' } });
      else if (!response.destroyed && !response.writableEnded) response.end();
    } finally { response.off('close', cancel); }
  });
}

export async function init(router: any): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const load = (path: string) => import(pathToFileURL(resolve(root, path)).href);
  const [chat, converters, util, google, secrets, constants] = await Promise.all([
    load('src/endpoints/backends/chat-completions.js'), load('src/prompt-converters.js'), load('src/util.js'),
    load('src/endpoints/google.js'), load('src/endpoints/secrets.js'), load('src/constants.js'),
  ]);
  const runner = chat.selectChatCompletionDispatch ? await load('src/luker-dispatch/runner.js') : null;
  const require = createRequire(resolve(root, 'package.json'));
  const fetchModule = await import(pathToFileURL(require.resolve('node-fetch')).href);
  await initialize(router, { chat, converters, util, google, secrets, constants, runner, fetch: fetchModule.default }, { name: manifest.name, version: manifest.version });
  console.info(`[${PLUGIN_ID}] ${VERSION} 已加载 (${manifest.name} ${manifest.version})`);
}
