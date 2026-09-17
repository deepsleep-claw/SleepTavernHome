import type { DebugTokenUsage } from './debug_types';

type UsageValues = Omit<DebugTokenUsage, 'complete' | 'received_at'>;
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
}
function tokens(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
  );
}
function nonempty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 256) : undefined;
}

export function normalizeTokenUsage(value: unknown): UsageValues | undefined {
  const root = object(value);
  if (!root) return undefined;
  const nested = [root, object(root.response), object(root.data)].filter((item): item is JsonObject => !!item);
  if (Array.isArray(root.choices))
    nested.push(...root.choices.map(object).filter((item): item is JsonObject => !!item));
  for (const envelope of nested) {
    const usage = object(envelope.usage) ?? object(envelope.usageMetadata) ?? object(envelope.usage_metadata);
    if (!usage) continue;
    const details = object(usage.prompt_tokens_details) ?? object(usage.input_tokens_details) ?? {};
    const cached = tokens(
      usage.prompt_cache_hit_tokens,
      details.cached_tokens,
      usage.cached_tokens,
      usage.cachedContentTokenCount,
      usage.cached_content_token_count,
      usage.cache_read_input_tokens,
    );
    const writes = tokens(details.cache_write_tokens, usage.cache_creation_input_tokens);
    let input = tokens(usage.prompt_tokens, usage.promptTokenCount, usage.prompt_token_count, usage.input_tokens);
    if (input !== undefined && ('cache_read_input_tokens' in usage || 'cache_creation_input_tokens' in usage)) {
      input += (cached ?? 0) + (writes ?? 0);
    }
    const missed =
      tokens(usage.prompt_cache_miss_tokens, details.uncached_tokens) ??
      (input !== undefined && cached !== undefined && cached <= input ? input - cached : undefined);
    const output = tokens(
      usage.completion_tokens,
      usage.output_tokens,
      usage.candidatesTokenCount,
      usage.candidates_token_count,
    );
    const total = tokens(usage.total_tokens, usage.totalTokenCount, usage.total_token_count);
    const reasoning = tokens(
      object(usage.completion_tokens_details)?.reasoning_tokens,
      usage.thoughtsTokenCount,
      usage.thoughts_token_count,
    );
    if ([input, cached, missed, output, total, reasoning, writes].every(item => item === undefined)) continue;
    return {
      input_tokens: input,
      cached_input_tokens: cached,
      uncached_input_tokens: missed,
      output_tokens: output,
      total_tokens: total,
      reasoning_tokens: reasoning,
      cache_write_tokens: writes,
      model: nonempty(envelope.model) ?? nonempty(root.model) ?? nonempty(root.modelVersion),
      response_id: nonempty(envelope.id) ?? nonempty(root.id) ?? nonempty(root.responseId),
    };
  }
  return undefined;
}

export class TokenUsageDecoder {
  private pending = '';
  private data: string[] = [];
  private mode?: 'json' | 'sse';
  private latest?: UsageValues;
  done = false;

  constructor(private readonly limit = 4 * 1024 * 1024) {}

  push(text: string) {
    this.pending += text;
    if (this.pending.length > this.limit) throw Error('响应片段过大');
    if (!this.mode) {
      const start = this.pending.trimStart();
      if (start.startsWith('{') || start.startsWith('[')) this.mode = 'json';
      else if (/^(data:|event:|:)/.test(start)) this.mode = 'sse';
    }
    if (this.mode !== 'sse') return;
    let newline: number;
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, newline).replace(/\r$/, '');
      this.pending = this.pending.slice(newline + 1);
      this.line(line);
    }
  }

  finish() {
    if (this.mode === 'sse') {
      if (this.pending) this.line(this.pending.replace(/\r$/, ''));
      this.flush();
    } else if (this.pending.trim()) this.parse(this.pending);
    this.pending = '';
  }

  result(complete: boolean): DebugTokenUsage | undefined {
    return this.latest ? { ...this.latest, complete, received_at: new Date().toISOString() } : undefined;
  }

  private line(line: string) {
    if (!line) this.flush();
    else if (line.startsWith('data:')) {
      this.data.push(line.slice(5).replace(/^ /, ''));
      if (this.data.reduce((length, part) => length + part.length, 0) > this.limit) throw Error('响应事件过大');
    }
  }
  private flush() {
    const text = this.data.join('\n');
    this.data = [];
    if (text.trim() === '[DONE]') this.done = true;
    else if (text) this.parse(text);
  }
  private parse(text: string) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    const values = Array.isArray(value) ? value : [value];
    values.forEach(item => {
      const next = normalizeTokenUsage(item);
      if (!next) return;
      // 流中的计数通常是累计值，按字段保留最近一次返回的数据。
      this.latest = { ...this.latest, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) };
      const { input_tokens: input, cached_input_tokens: cached } = this.latest;
      if (
        next.uncached_input_tokens === undefined &&
        (next.input_tokens !== undefined || next.cached_input_tokens !== undefined) &&
        input !== undefined &&
        cached !== undefined &&
        cached <= input
      )
        this.latest.uncached_input_tokens = input - cached;
    });
  }
}

export async function readTokenUsage(
  response: Response,
  readers?: Set<ReadableStreamDefaultReader<Uint8Array>>,
): Promise<DebugTokenUsage | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  readers?.add(reader);
  const text = new TextDecoder();
  const decoder = new TokenUsageDecoder();
  let complete = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        decoder.push(text.decode());
        decoder.finish();
        complete = true;
        break;
      }
      decoder.push(text.decode(next.value, { stream: true }));
      if (decoder.done) {
        complete = true;
        break;
      }
    }
  } catch {
    complete = decoder.done;
  } finally {
    readers?.delete(reader);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return decoder.result(complete);
}
