export interface StreamReport {
  result: 'completed' | 'failed' | 'cancelled';
  responseMs: number | null;
  firstChunkMs: number | null;
  chunks: number;
  argumentEvents: number;
  firstArgumentMs: number | null;
  lastArgumentMs: number | null;
  textEvents: number;
  firstTextMs: number | null;
  elapsedMs: number;
  format: 'sse' | 'json';
}

/** Records timings and counts without retaining request or response content. */
export class StreamDiagnostics {
  private started: number;
  private ended = false;
  private values: Omit<StreamReport, 'result' | 'elapsedMs'> = {
    responseMs: null, firstChunkMs: null, chunks: 0, argumentEvents: 0,
    firstArgumentMs: null, lastArgumentMs: null, textEvents: 0, firstTextMs: null, format: 'sse',
  };

  constructor(private report: (report: StreamReport) => void, private now = () => performance.now()) {
    this.started = now();
  }

  private elapsed(): number { return Math.max(0, Math.round(this.now() - this.started)); }

  response(response: Response): void {
    this.values.responseMs ??= this.elapsed();
    this.values.format = response.headers.get('content-type')?.includes('application/json') ? 'json' : 'sse';
  }

  chunk(): void {
    this.values.firstChunkMs ??= this.elapsed();
    this.values.chunks++;
  }

  input(frame: any): void {
    const hasArguments = (value: unknown) => typeof value === 'string' ? value.length > 0
      : value != null && typeof value === 'object' && Object.keys(value).length > 0;
    const list = (value: any): any[] => Array.isArray(value) ? value : [];
    const openai = list(frame.choices).some(choice => list((choice.delta ?? choice.message)?.tool_calls).some(call => hasArguments(call.function?.arguments)));
    const candidates = frame.candidates ?? (frame.responseContent ? [{ content: frame.responseContent }] : []);
    const google = list(candidates).some(candidate => list(candidate.content?.parts).some(part => hasArguments(part.functionCall?.args) || part.functionCall?.partialArgs?.length));
    const initial = list(frame.steps ?? (frame.step ? [frame.step] : [])).some(step => step.type === 'function_call' && hasArguments(step.arguments));
    const delta = ['arguments', 'arguments_delta'].includes(frame.delta?.type) && hasArguments(frame.delta.arguments ?? frame.delta.partial_arguments);
    if (openai || google || initial || delta) {
      const elapsed = this.elapsed();
      this.values.firstArgumentMs ??= elapsed; this.values.lastArgumentMs = elapsed;
      this.values.argumentEvents++;
    }
  }

  output(frame: any): void {
    if (typeof frame === 'string') return;
    if (frame.error) { this.finish('failed'); return; }
    const list = (value: any): any[] => Array.isArray(value) ? value : [];
    const openai = list(frame.choices).some(choice => {
      const content = (choice.delta ?? choice.message)?.content;
      return typeof content === 'string' ? content.length > 0 : list(content).some(part => part.text?.length);
    });
    const google = list(frame.candidates).some(candidate => list(candidate.content?.parts).some(part => !part.thought && part.text?.length));
    if (openai || google) {
      this.values.firstTextMs ??= this.elapsed();
      this.values.textEvents++;
    }
  }

  finish(result: StreamReport['result']): void {
    if (this.ended) return;
    this.ended = true;
    this.report({ ...this.values, result, elapsedMs: this.elapsed() });
  }
}

export function logStreamReport(source: string, report: StreamReport): void {
  const ms = (value: number | null) => value === null ? '无' : `${value}ms`;
  console.info(`[基米工具] 流式诊断：来源=${source}；结果=${report.result}；格式=${report.format}；响应可读=${ms(report.responseMs)}；首批数据=${ms(report.firstChunkMs)}；数据块=${report.chunks}；参数事件=${report.argumentEvents}（${ms(report.firstArgumentMs)} → ${ms(report.lastArgumentMs)}）；首个正文=${ms(report.firstTextMs)}；正文事件=${report.textEvents}；总耗时=${report.elapsedMs}ms`);
}
