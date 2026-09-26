import { resolveProtocol, type BridgeConfig } from '../shared/config';

type Modules = Record<string, any>;

export function enableArgumentStreaming(body: any, model: string, enabled: boolean): void {
  if (!enabled || !/^gemini-3(?:[.\d]*-)/.test(model) || /3\.1-flash-lite/.test(model)) return;
  body.toolConfig ??= {};
  body.toolConfig.functionCallingConfig ??= { mode: 'AUTO' };
  body.toolConfig.functionCallingConfig.streamFunctionCallArguments = true;
}

/** Converts the current complete prompt into the stateless Interactions timeline. */
export function toInteractions(body: any, model: string, stream: boolean): any {
  const input: any[] = [];
  const pendingCalls = new Map<string, string[]>();
  let serial = 0;
  for (const message of body.contents ?? []) {
    let content: any[] = [];
    const flush = () => {
      if (content.length) input.push({ type: message.role === 'model' ? 'model_output' : 'user_input', content });
      content = [];
    };
    for (const part of message.parts ?? []) {
      if (part.thought) {
        flush(); input.push({ type: 'thought', ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}), ...(part.text ? { summary: [{ type: 'text', text: part.text }] } : {}) }); continue;
      }
      if (typeof part.text === 'string') content.push({ type: 'text', text: part.text });
      else if (part.inlineData || part.inline_data || part.fileData || part.file_data) {
        const media = part.inlineData ?? part.inline_data ?? part.fileData ?? part.file_data;
        const mime = media.mimeType ?? media.mime_type;
        const type = mime?.startsWith('image/') ? 'image' : mime?.startsWith('audio/') ? 'audio' : mime?.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'document' : null;
        if (!type) throw new Error('Interactions 暂不支持此附件类型，请使用 Google 原生模式。');
        content.push({ type, mime_type: mime, ...(media.data ? { data: media.data } : { uri: media.fileUri ?? media.file_uri }) });
      } else if (part.functionCall) {
        flush();
        if (part.thoughtSignature) input.push({ type: 'thought', signature: part.thoughtSignature });
        const fc = part.functionCall;
        const id = fc.id || `history_call_${++serial}`;
        const ids = pendingCalls.get(fc.name) ?? []; ids.push(id); pendingCalls.set(fc.name, ids);
        input.push({ type: 'function_call', id, name: fc.name, arguments: fc.args ?? {} });
      } else if (part.functionResponse) {
        flush();
        const fr = part.functionResponse;
        const id = fr.id || pendingCalls.get(fr.name)?.shift();
        if (!id) throw new Error('Interactions 工具历史缺少对应调用，请使用 Google 原生模式。');
        input.push({ type: 'function_result', name: fr.name, call_id: id, result: fr.response });
      } else throw new Error('Interactions 暂不支持此消息内容，请使用 Google 原生模式。');
    }
    flush();
  }
  const generation = body.generationConfig ?? {};
  const config: any = {};
  for (const [source, target] of Object.entries({ maxOutputTokens: 'max_output_tokens', seed: 'seed', stopSequences: 'stop_sequences' })) {
    if (generation[source] !== undefined) config[target] = generation[source];
  }
  if (generation.thinkingConfig?.thinkingLevel) config.thinking_level = String(generation.thinkingConfig.thinkingLevel).toLowerCase();
  config.thinking_summaries = generation.thinkingConfig?.includeThoughts ? 'auto' : 'none';
  const choice = body.toolConfig?.functionCallingConfig;
  if (choice) config.tool_choice = choice.allowedFunctionNames?.length
    ? { allowed_tools: { mode: choice.mode.toLowerCase(), tools: choice.allowedFunctionNames } }
    : choice.mode.toLowerCase();
  const tools: any[] = [];
  for (const tool of body.tools ?? []) {
    const declarations = tool.functionDeclarations ?? tool.function_declarations;
    if (declarations) tools.push(...declarations.map((fn: any) => ({ type: 'function', ...fn })));
    else if (tool.googleSearch || tool.google_search) tools.push({ type: 'google_search' });
    else throw new Error('Interactions 暂不支持此工具类型，请使用 Google 原生模式。');
  }
  return { model, input, stream, store: false, generation_config: config, tools,
    system_instruction: (body.systemInstruction ?? body.system_instruction)?.parts?.map((p: any) => p.text ?? '').join('\n') || undefined };
}

export function interactionsUrl(original: string): string {
  const url = new URL(original);
  if (!/\/v1(?:beta)?\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/.test(url.pathname)) {
    throw new Error('此代理的 URL 无法转换为 Interactions 接口，请使用 Google 原生模式。');
  }
  url.pathname = url.pathname.replace(/\/v1(?:beta)?\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/, '/v1beta/interactions');
  url.searchParams.delete('alt');
  return url.href;
}

export function prepareGoogleOutbound(url: string, options: any, body: any, config: BridgeConfig): { url: string; options: any } {
  const protocol = resolveProtocol(body.chat_completion_source, config.googleMode);
  if (!protocol || protocol === 'openai') return { url, options };
  const native = JSON.parse(options.body);
  if (protocol === 'interactions') {
    return { url: interactionsUrl(url), options: { ...options, body: JSON.stringify(toInteractions(native, body.model, Boolean(body.stream))) } };
  }
  if (protocol === 'vertex' && body.stream) enableArgumentStreaming(native, body.model, config.streamArguments);
  return { url, options: { ...options, body: JSON.stringify(native) } };
}

export async function legacyGoogleRequest(request: any, modules: Modules, config: BridgeConfig, signal: AbortSignal): Promise<any> {
  const body = request.body;
  const { converters, constants, google, secrets, util, fetch } = modules;
  const vertex = body.chat_completion_source === 'vertexai';
  const model = String(body.model ?? '');
  if (!model) throw new Error('请先选择 Gemini 模型。');
  if (body.request_images || /^gemma/.test(model)) throw new Error('正文工具需要支持函数调用的聊天模型。');
  const names = converters.getPromptNames(request);
  const messages = body.custom_prompt_post_processing ? converters.postProcessPrompt(body.messages, body.custom_prompt_post_processing, names) : body.messages;
  const prompt = converters.convertGooglePrompt(messages, model, Boolean(body.use_sysprompt), names);
  const generation: any = { maxOutputTokens: body.max_tokens, temperature: body.temperature, topP: body.top_p, topK: body.top_k || undefined, seed: body.seed, candidateCount: 1 };
  if (body.stop?.length) generation.stopSequences = body.stop;
  if (/^gemini-(2\.5|3)/.test(model)) {
    const budget = converters.calculateGoogleBudgetTokens(body.max_tokens, body.reasoning_effort, model);
    generation.thinkingConfig = { includeThoughts: Boolean(body.include_reasoning) && !(vertex && budget === 0),
      ...(typeof budget === 'number' ? { thinkingBudget: budget } : typeof budget === 'string' ? { thinkingLevel: budget } : {}) };
  }
  const functions = body.tools.filter((tool: any) => tool.type === 'function').map((tool: any) => {
    const fn = structuredClone(tool.function); if (fn.parameters) delete fn.parameters.$schema; return fn;
  });
  const choice = body.tool_choice;
  const native: any = {
    contents: prompt.contents, generationConfig: generation,
    safetySettings: [...(constants.GEMINI_SAFETY ?? []), ...(vertex ? constants.VERTEX_SAFETY ?? [] : [])],
    tools: [{ functionDeclarations: functions }],
    toolConfig: { functionCallingConfig: typeof choice === 'object'
      ? { mode: 'ANY', allowedFunctionNames: [choice.function.name] }
      : { mode: choice === 'required' ? 'ANY' : 'AUTO' } },
  };
  if (body.use_sysprompt && prompt.system_instruction?.parts?.length) native.systemInstruction = prompt.system_instruction;
  const read = (key: string) => secrets.readProviderSecret
    ? secrets.readProviderSecret(request, key) : secrets.readSecret(request.user.directories, key, body.secret_id ?? null);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const endpoint = body.stream ? 'streamGenerateContent' : 'generateContent';
  let base: string;
  if (vertex) {
    const region = String(body.vertexai_region || 'us-central1');
    if (!/^[a-z0-9-]+$/.test(region)) throw new Error('Vertex 区域格式无效。');
    if (body.reverse_proxy) {
      base = `${String(body.reverse_proxy).replace(/\/$/, '')}/v1/publishers/google`;
      headers.authorization = `Bearer ${body.proxy_password || ''}`;
    } else {
      const host = region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform.googleapis.com`;
      if (body.vertexai_auth_mode === 'full') {
        const account = JSON.parse(read(secrets.SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT) || '{}');
        const project = google.getProjectIdFromServiceAccount(account);
        headers.authorization = `Bearer ${await google.getAccessToken(await google.generateJWTToken(account))}`;
        base = `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${region}/publishers/google`;
      } else {
        headers['x-goog-api-key'] = read(secrets.SECRET_KEYS.VERTEXAI) || '';
        base = `https://${host}/v1${body.vertexai_express_project_id ? `/projects/${encodeURIComponent(body.vertexai_express_project_id)}/locations/${region}` : ''}/publishers/google`;
      }
    }
  } else {
    base = `${String(body.reverse_proxy || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')}/${util.getConfigValue('gemini.apiVersion', 'v1beta')}`;
    headers['x-goog-api-key'] = body.reverse_proxy ? body.proxy_password || '' : read(secrets.SECRET_KEYS.MAKERSUITE) || '';
  }
  const url = `${base}/models/${encodeURIComponent(model)}:${endpoint}${body.stream ? '?alt=sse' : ''}`;
  const prepared = prepareGoogleOutbound(url, { method: 'POST', headers, signal, body: JSON.stringify(native) }, body, config);
  return fetch(prepared.url, prepared.options);
}
