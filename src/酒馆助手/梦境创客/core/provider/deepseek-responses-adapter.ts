type JsonRecord = Record<string, unknown>;

export type DeepSeekResponsesStreamState = {
  reasoningByItemId: Map<string, string>;
};

const UNSUPPORTED_REQUEST_FIELDS = [
  'background',
  'context_management',
  'conversation',
  'include',
  'max_tool_calls',
  'metadata',
  'parallel_tool_calls',
  'previous_response_id',
  'prompt',
  'prompt_cache_key',
  'prompt_cache_options',
  'prompt_cache_retention',
  'safety_identifier',
  'service_tier',
  'store',
  'stream_options',
  'truncation',
] as const;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map(item => {
      const part = record(item);
      return typeof part?.text === 'string' ? part.text : typeof part?.content === 'string' ? part.content : '';
    })
    .join('');
}

function reasoningInput(item: JsonRecord): JsonRecord {
  const summary = Array.isArray(item.summary) ? contentText(item.summary) : '';
  const text =
    typeof item.encrypted_content === 'string'
      ? item.encrypted_content
      : contentText(item.content) || summary;
  // DeepSeek Responses 接受明文 reasoning，但 content 的 wire schema 是内容块数组。
  // AI SDK 会把完整思考暂存在 encrypted_content；不能直接把该字符串塞回 content，
  // 否则工具调用后的下一轮会被服务端以“expected a sequence”拒绝。
  return { content: [{ text, type: 'reasoning_text' }], type: 'reasoning' };
}

/** 把 OpenAI Provider 生成的请求缩减为 DeepSeek Responses 的无状态子集。 */
export function transformDeepSeekResponsesRequest(input: unknown): unknown {
  const source = record(input);
  if (!source) return input;
  const body = structuredClone(source);
  const metadata = record(body.metadata);
  const forcedReasoningEffort =
    typeof metadata?.dream_card_agent_reasoning_effort === 'string'
      ? metadata.dream_card_agent_reasoning_effort
      : undefined;
  UNSUPPORTED_REQUEST_FIELDS.forEach(field => delete body[field]);

  if (Array.isArray(body.input)) {
    body.input = body.input.map(item => {
      const value = record(item);
      return value?.type === 'reasoning' ? reasoningInput(value) : item;
    });
  }

  const reasoning = record(body.reasoning) ?? (forcedReasoningEffort ? { effort: forcedReasoningEffort } : undefined);
  if (reasoning) {
    delete reasoning.summary;
    delete reasoning.context;
    body.reasoning = reasoning;
  }

  const reasoningEnabled = reasoning?.effort !== 'none';
  if (reasoningEnabled) {
    delete body.temperature;
    delete body.top_p;
    delete body.presence_penalty;
    delete body.frequency_penalty;
  }

  if (Array.isArray(body.tools)) {
    body.tools = body.tools.map(tool => {
      const value = record(tool);
      if (value?.type !== 'web_search_preview') return tool;
      return { ...value, type: 'web_search' };
    });
  }
  return body;
}

function itemId(event: JsonRecord): string | undefined {
  if (typeof event.item_id === 'string') return event.item_id;
  const item = record(event.item);
  return typeof item?.id === 'string' ? item.id : undefined;
}

/** 将 DeepSeek 的 reasoning_text 事件翻译为当前 AI SDK OpenAI Provider 可识别的 reasoning summary 事件。 */
export function translateDeepSeekResponsesEvent(
  input: unknown,
  state: DeepSeekResponsesStreamState,
): unknown {
  const source = record(input);
  if (!source || typeof source.type !== 'string') return input;
  const event = structuredClone(source);
  const id = itemId(event);

  if (event.type === 'response.output_item.added') {
    const item = record(event.item);
    if (item?.type === 'reasoning' && typeof item.id === 'string') {
      state.reasoningByItemId.set(item.id, contentText(item.content));
      item.encrypted_content = null;
      event.item = item;
    }
    return event;
  }

  if (event.type === 'response.reasoning_text.delta') {
    const delta = typeof event.delta === 'string' ? event.delta : '';
    if (id) state.reasoningByItemId.set(id, `${state.reasoningByItemId.get(id) ?? ''}${delta}`);
    return { ...event, summary_index: 0, type: 'response.reasoning_summary_text.delta' };
  }

  if (event.type === 'response.reasoning_text.done') {
    const text = typeof event.text === 'string' ? event.text : typeof event.content === 'string' ? event.content : '';
    if (id && text) state.reasoningByItemId.set(id, text);
    return { ...event, summary_index: 0, type: 'response.reasoning_summary_part.done' };
  }

  if (event.type === 'response.output_item.done') {
    const item = record(event.item);
    if (item?.type === 'reasoning' && typeof item.id === 'string') {
      const reasoning = state.reasoningByItemId.get(item.id) ?? contentText(item.content);
      item.encrypted_content = reasoning || null;
      delete item.content;
      delete item.summary;
      event.item = item;
      state.reasoningByItemId.delete(item.id);
    }
    return event;
  }

  return event;
}

function translateSseBlock(block: string, state: DeepSeekResponsesStreamState): string {
  const lines = block.split(/\r?\n/gu);
  const dataLines = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());
  if (dataLines.length === 0) return `${block}\n\n`;
  const data = dataLines.join('\n');
  if (data === '[DONE]') return `${block}\n\n`;
  try {
    const translated = translateDeepSeekResponsesEvent(JSON.parse(data) as unknown, state);
    const type = record(translated)?.type;
    return `${typeof type === 'string' ? `event: ${type}\n` : ''}data: ${JSON.stringify(translated)}\n\n`;
  } catch {
    return `${block}\n\n`;
  }
}

export function createDeepSeekResponsesFetch(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  return async (input, init) => {
    let nextInit = init;
    if (typeof init?.body === 'string') {
      try {
        nextInit = {
          ...init,
          body: JSON.stringify(transformDeepSeekResponsesRequest(JSON.parse(init.body) as unknown)),
        };
      } catch {
        // 非 JSON 请求原样交给底层 fetch。
      }
    }

    const response = await fetchImpl(input, nextInit);
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;

    const state: DeepSeekResponsesStreamState = { reasoningByItemId: new Map() };
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = '';
    const stream = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        flush(controller) {
          pending += decoder.decode();
          if (pending.trim()) controller.enqueue(encoder.encode(translateSseBlock(pending, state)));
        },
        transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true });
          const blocks = pending.split(/\r?\n\r?\n/gu);
          pending = blocks.pop() ?? '';
          blocks.forEach(block => controller.enqueue(encoder.encode(translateSseBlock(block, state))));
        },
      }),
    );
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(stream, { headers, status: response.status, statusText: response.statusText });
  };
}
