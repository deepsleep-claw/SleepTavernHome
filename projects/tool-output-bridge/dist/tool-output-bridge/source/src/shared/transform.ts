import { type BridgeConfig, type OutputTool, isRecord, outputValue, pathSegments } from './config';
import { PartialJsonText } from './partial-json';
import { SseDecoder, encodeEvent, type SseEvent } from './sse';

type Call = {
  key: string; choice: number; name: string; raw: string; text: string; emitted: number;
  done: boolean; started: boolean; tool?: OutputTool; parser?: PartialJsonText;
  decision: 'pending' | 'own' | 'other'; pending: any[]; sawText: boolean;
  id?: string;
};

export class OutputTransformer {
  private tools: Map<string, OutputTool>;
  private calls = new Map<string, Call>();
  private queues = new Map<number, Call[]>();
  private outputStarted = new Set<number>();
  private otherCalls = new Set<number>();
  private nativeActive = new Map<number, string>();
  private serial = 0;
  private ended = false;
  private suppressedText = false;
  private thoughtSignatures = new Map<number, string>();

  constructor(readonly config: BridgeConfig, readonly source: string) {
    this.tools = new Map(config.tools.filter(tool => tool.enabled).map(tool => [tool.name, tool]));
  }

  private call(key: string, choice = 0): Call {
    let call = this.calls.get(key);
    if (!call) {
      call = { key, choice, name: '', raw: '', text: '', emitted: 0, done: false, started: false, decision: 'pending', pending: [], sawText: false };
      this.calls.set(key, call);
      const queue = this.queues.get(choice) ?? []; queue.push(call); this.queues.set(choice, queue);
    }
    return call;
  }

  private decide(call: Call, final = false): void {
    if (call.decision !== 'pending') return;
    const tool = this.tools.get(call.name);
    if (tool) {
      call.decision = 'own'; call.tool = tool; call.parser = new PartialJsonText(tool.outputPath);
      if (call.raw) call.text += call.parser.push(call.raw);
      call.pending = [];
    } else if (final || (call.name && ![...this.tools.keys()].some(name => name.startsWith(call.name)))) {
      call.decision = 'other'; this.otherCalls.add(call.choice);
    }
  }

  private arguments(call: Call, fragment: string): void {
    if (call.raw.length + fragment.length > 8 * 1024 * 1024) throw new Error('工具参数超过 8 MiB。');
    this.decide(call);
    call.raw += fragment;
    if (call.decision === 'own') call.text += call.parser!.push(fragment);
  }

  private complete(call: Call, validate = true): void {
    if (call.done) return;
    this.decide(call, true);
    if (call.decision === 'own' && validate) {
      if (call.raw) call.parser!.finish();
      else if (!call.sawText) throw new Error(`工具 ${call.name} 没有返回字符串正文。`);
    }
    call.done = true;
  }

  private drain(choice: number): string {
    const queue = this.queues.get(choice) ?? [];
    let text = '';
    while (queue.length) {
      const call = queue[0];
      if (call.decision === 'pending') break;
      if (call.decision === 'other') { queue.shift(); continue; }
      const delta = call.text.slice(call.emitted);
      if (delta) {
        if (!call.started && this.outputStarted.has(choice)) text += this.config.separator;
        call.started = true; this.outputStarted.add(choice);
        text += delta; call.emitted = call.text.length;
      }
      if (!call.done) break;
      queue.shift();
    }
    return text;
  }

  private original(text: unknown, choice: number): string {
    if (Array.isArray(text)) text = text.map(part => typeof part?.text === 'string' ? part.text : '').join('');
    if (!this.config.keepOriginalText && typeof text === 'string' && text.trim()) this.suppressedText = true;
    const value = this.config.keepOriginalText && typeof text === 'string' ? text : '';
    if (value) this.outputStarted.add(choice);
    return value;
  }

  private textFrame(text: string, choice = 0, thought = false): any {
    return ['makersuite', 'vertexai'].includes(this.source)
      ? { candidates: [{ index: choice, content: { role: 'model', parts: [{ text, ...(thought ? { thought: true } : {}) }] } }] }
      : { choices: [{ index: choice, delta: thought ? { reasoning_content: text } : { content: text } }] };
  }

  private openai(frame: any): any {
    const result = structuredClone(frame);
    for (const choice of result.choices) {
      const index = choice.index ?? 0;
      const delta = choice.delta ?? {};
      let text = this.original(delta.content, index);
      if ('content' in delta) delta.content = text;
      const remaining: any[] = [];
      for (const part of delta.tool_calls ?? []) {
        const call = this.call(`openai:${index}:${part.index ?? part.id ?? 0}`, index);
        if (call.decision === 'pending') call.pending.push(structuredClone(part));
        const name = part.function?.name;
        if (typeof name === 'string' && name && call.name !== name) call.name += name;
        this.decide(call);
        if (typeof part.function?.arguments === 'string') this.arguments(call, part.function.arguments);
        if (call.decision === 'other') {
          if (call.pending.length) remaining.push(...call.pending.splice(0));
          else remaining.push(part);
        }
      }
      if (delta.tool_calls) { if (remaining.length) delta.tool_calls = remaining; else delete delta.tool_calls; }
      if (choice.finish_reason) {
        for (const call of this.calls.values()) if (call.choice === index && call.key.startsWith('openai:')) {
          this.complete(call, choice.finish_reason !== 'length');
          if (call.decision === 'other' && call.pending.length) {
            delta.tool_calls = [...(delta.tool_calls ?? []), ...call.pending.splice(0)];
          }
        }
        if (choice.finish_reason === 'tool_calls' && !this.otherCalls.has(index)) choice.finish_reason = 'stop';
      }
      text += this.drain(index);
      if (text) delta.content = text;
      choice.delta = delta;
    }
    return result;
  }

  private google(frame: any): any {
    const result = structuredClone(frame);
    for (const candidate of result.candidates) {
      if (candidate.finishReason && !['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED'].includes(candidate.finishReason)) {
        throw new Error(`Gemini 结束了生成：${candidate.finishReason}`);
      }
      const index = candidate.index ?? 0;
      const parts: any[] = [];
      let text = '';
      for (const part of candidate.content?.parts ?? []) {
        if (part.thought) { parts.push(part); continue; }
        if (typeof part.text === 'string') { text += this.original(part.text, index); continue; }
        if (!part.functionCall) { parts.push(part); continue; }
        const fc = part.functionCall;
        let key = fc.id ? `google:${index}:${fc.id}` : this.nativeActive.get(index);
        if (!key || (fc.name && this.calls.get(key)?.done)) key = `google:${index}:${++this.serial}`;
        const call = this.call(key, index);
        if (fc.name) call.name = fc.name;
        this.decide(call, true);
        this.nativeActive.set(index, key);
        if (call.decision === 'other') { parts.push(part); if (!fc.willContinue) call.done = true; continue; }
        if (isRecord(fc.args) && Object.keys(fc.args).length) {
          const whole = outputValue(fc.args, call.tool!.outputPath);
          if (!whole.startsWith(call.text)) throw new Error(`工具 ${call.name} 的正文分片与完整正文不一致。`);
          call.text = whole; call.sawText = true;
        }
        for (const arg of fc.partialArgs ?? []) {
          if (typeof arg.jsonPath !== 'string') continue;
          const path = pathSegments(arg.jsonPath);
          const target = pathSegments(call.tool!.outputPath);
          if (path.length === target.length && path.every((value, i) => value === target[i])) {
            if (arg.stringValue !== undefined) {
              if (typeof arg.stringValue !== 'string') throw new Error('正文参数片段必须是字符串。');
              call.text += arg.stringValue; call.sawText = true;
            }
          }
        }
        if (!fc.willContinue) this.complete(call);
        text += this.drain(index);
      }
      if (candidate.finishReason) {
        for (const call of this.calls.values()) if (call.choice === index && call.key.startsWith('google:')) this.complete(call, candidate.finishReason !== 'MAX_TOKENS');
        text += this.drain(index);
      }
      // The host's native Gemini reader consumes the first non-thought text part.
      if (text) parts.unshift({ text });
      if (candidate.content) candidate.content.parts = parts;
    }
    return result;
  }

  private interactions(frame: any): any[] {
    const type = frame.event_type ?? frame.type;
    const result: any[] = [];
    if (type === 'step.start' && frame.step?.type === 'function_call') {
      const call = this.call(`interaction:${frame.index}`);
      call.name = frame.step.name ?? ''; call.id = frame.step.id; this.decide(call, true);
    } else if (type === 'step.start' && frame.step?.type === 'thought' && frame.step.signature) {
      this.thoughtSignatures.set(frame.index, frame.step.signature);
    } else if (type === 'step.delta') {
      const delta = frame.delta ?? {};
      if (['arguments_delta', 'arguments'].includes(delta.type)) {
        const call = this.calls.get(`interaction:${frame.index}`);
        if (!call) throw new Error('工具参数流缺少调用起始事件。');
        this.arguments(call, delta.arguments ?? delta.partial_arguments ?? '');
        const text = this.drain(0); if (text) result.push(this.textFrame(text));
      } else if (delta.type === 'text') {
        const text = this.original(delta.text, 0); if (text) result.push(this.textFrame(text));
      } else if (delta.type === 'thought_summary') {
        const text = delta.content?.text ?? delta.text;
        if (typeof text === 'string') result.push(this.textFrame(text, 0, true));
      } else if (delta.type === 'thought_signature' && typeof delta.signature === 'string') {
        this.thoughtSignatures.set(frame.index, (this.thoughtSignatures.get(frame.index) ?? '') + delta.signature);
      }
    } else if (type === 'step.stop') {
      const call = this.calls.get(`interaction:${frame.index}`);
      if (call) {
        this.complete(call);
        const text = this.drain(0); if (text) result.push(this.textFrame(text));
        if (call.decision === 'other') {
          const signature = [...this.thoughtSignatures.entries()].filter(([index]) => index < frame.index).at(-1)?.[1];
          result.push({ candidates: [{ content: { parts: [{ functionCall: { id: call.id, name: call.name, args: JSON.parse(call.raw || '{}') }, ...(signature ? { thoughtSignature: signature } : {}) }] } }] });
        }
      }
    } else if (type === 'interaction.completed' || type === 'interaction.complete') {
      const interaction = frame.interaction ?? {};
      if (['failed', 'cancelled', 'incomplete'].includes(interaction.status)) throw new Error(`生成结束状态：${interaction.status}`);
      const usage = interaction.usage ?? {};
      result.push({ usageMetadata: this.interactionUsage(usage) });
    } else if (type === 'error' || type === 'interaction.failed') throw new Error(frame.error?.message ?? '上游流返回错误。');
    return result;
  }

  event(event: SseEvent): any[] {
    if (event.data === '[DONE]') return this.finish();
    const frame = JSON.parse(event.data);
    if (frame.error) { this.ended = true; return [frame]; }
    if (frame.promptFeedback?.blockReason) throw new Error(`Gemini 未生成正文：${frame.promptFeedback.blockReason}`);
    if (Array.isArray(frame.choices)) return [this.openai(frame)];
    if (Array.isArray(frame.candidates)) return [this.google(frame)];
    if (frame.event_type || event.event.startsWith('step.') || event.event.startsWith('interaction.')) return this.interactions({ ...frame, event_type: frame.event_type ?? event.event });
    return [frame];
  }

  finish(): any[] {
    if (this.ended) return [];
    this.ended = true;
    const result: any[] = [];
    for (const call of this.calls.values()) {
      this.complete(call);
      if (call.decision === 'other' && call.pending.length) result.push({ choices: [{ index: call.choice, delta: { tool_calls: call.pending.splice(0) } }] });
    }
    this.requireOutput();
    for (const choice of this.queues.keys()) { const text = this.drain(choice); if (text) result.push(this.textFrame(text, choice)); }
    result.push('[DONE]');
    return result;
  }

  private requireOutput(): void {
    if (this.suppressedText && !this.otherCalls.size && ![...this.calls.values()].some(call => call.decision === 'own')) {
      throw new Error('模型仅返回了普通正文，没有调用正文工具。请开启强制工具选择，或启用保留普通正文。');
    }
  }

  private interactionUsage(usage: any): any {
    return { promptTokenCount: usage.total_input_tokens, candidatesTokenCount: usage.total_output_tokens, thoughtsTokenCount: usage.total_thought_tokens, totalTokenCount: usage.total_tokens, cachedContentTokenCount: usage.total_cached_tokens };
  }

  json(input: any): any {
    const result = structuredClone(input);
    if (result.error) return result;
    if (result.promptFeedback?.blockReason) throw new Error(`Gemini 未生成正文：${result.promptFeedback.blockReason}`);
    if (Array.isArray(result.steps)) {
      const parts: any[] = [];
      let signature: string | undefined;
      for (const step of result.steps) {
        if (step.type === 'thought') {
          signature = step.signature;
          for (const content of step.summary ?? []) if (content.type === 'text') parts.push({ text: content.text, thought: true });
        }
        else if (step.type === 'function_call') parts.push({ functionCall: { id: step.id, name: step.name, args: step.arguments }, ...(signature ? { thoughtSignature: signature } : {}) });
        else if (step.type === 'model_output') for (const content of step.content ?? []) if (content.type === 'text') parts.push({ text: content.text });
      }
      if (['failed', 'cancelled', 'incomplete'].includes(result.status)) throw new Error(`生成结束状态：${result.status}`);
      return this.json({ candidates: [{ content: { role: 'model', parts } }], usageMetadata: this.interactionUsage(result.usage ?? {}) });
    }
    if (result.responseContent || result.candidates) {
      const contents = result.candidates ?? [{ content: result.responseContent }];
      const transformed = this.google({ candidates: contents });
      this.requireOutput();
      const content = transformed.candidates[0]?.content ?? { parts: [] };
      result.responseContent = content;
      if (result.candidates) result.candidates = transformed.candidates;
      result.choices = [{ message: { role: 'assistant', content: content.parts.filter((part: any) => !part.thought && typeof part.text === 'string').map((part: any) => part.text).join('') } }];
      return result;
    }
    for (const choice of result.choices ?? []) {
      const message = choice.message ?? {};
      const text = [this.original(message.content, choice.index ?? 0)];
      const remaining: any[] = [];
      let owned = false;
      for (const call of message.tool_calls ?? []) {
        const tool = this.tools.get(call.function?.name);
        if (tool) { owned = true; text.push(outputValue(typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments, tool.outputPath)); }
        else remaining.push(call);
      }
      if (!this.config.keepOriginalText && message.content && !owned && !remaining.length) throw new Error('模型仅返回了普通正文，没有调用正文工具。请开启强制工具选择，或启用保留普通正文。');
      message.content = text.filter(Boolean).join(this.config.separator);
      if (remaining.length) message.tool_calls = remaining; else delete message.tool_calls;
      if (!remaining.length && choice.finish_reason === 'tool_calls') choice.finish_reason = 'stop';
    }
    return result;
  }
}

export function transformResponse(response: Response, config: BridgeConfig, source: string, streaming: boolean): Response | Promise<Response> {
  if (!response.ok) return response;
  const transformer = new OutputTransformer(config, source);
  const headers = new Headers(response.headers);
  headers.delete('content-length'); headers.delete('content-encoding');
  if (!streaming) return response.json().then(value => new Response(JSON.stringify(transformer.json(value)), { status: response.status, headers }));
  if (headers.get('content-type')?.includes('application/json')) return response.json().then(value => {
    const frame = transformer.json(value);
    if (!frame.candidates) for (const choice of frame.choices ?? []) { choice.delta = choice.message; delete choice.message; }
    headers.set('content-type', 'text/event-stream; charset=utf-8');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encodeEvent(frame)); controller.enqueue(encodeEvent('[DONE]')); controller.close(); } }), { status: response.status, headers });
  });
  if (!response.body) throw new Error('生成响应没有数据流。');
  const decoder = new SseDecoder();
  headers.set('content-type', 'text/event-stream; charset=utf-8');
  const transformed = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      for (const event of decoder.push(chunk)) for (const data of transformer.event(event)) controller.enqueue(encodeEvent(data));
    },
    flush(controller) {
      for (const event of decoder.push(new Uint8Array(), true)) for (const data of transformer.event(event)) controller.enqueue(encodeEvent(data));
      for (const data of transformer.finish()) controller.enqueue(encodeEvent(data));
    },
  }));
  return new Response(transformed, { status: response.status, headers });
}
