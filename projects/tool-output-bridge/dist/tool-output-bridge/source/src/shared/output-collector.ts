import { type OutputTool, outputValue, pathSegments, toolOutputPaths } from './config';
import { PartialJsonFields } from './partial-json';

export class OutputCollector {
  private parser: PartialJsonFields;
  private hasJson = false;
  private current = 0;
  private emitted = 0;
  private started = false;

  constructor(tool: OutputTool, private separator: string) {
    this.parser = new PartialJsonFields(toolOutputPaths(tool));
  }

  push(fragment: string): void {
    if (fragment) this.hasJson = true;
    this.parser.push(fragment);
  }

  snapshot(args: unknown, final: boolean): void {
    for (const field of this.parser.fields) {
      let value: any = args;
      for (const key of pathSegments(field.path)) value = value != null && Object.hasOwn(value, key) ? value[key] : undefined;
      if (value === undefined && !final) continue;
      if (typeof value !== 'string') throw new Error(`工具正文 ${field.path} 必须是字符串。`);
      if (!value.startsWith(field.text)) throw new Error(`工具正文 ${field.path} 的分片与完整正文不一致。`);
      field.text = value; field.seen = true;
      if (final) field.complete = true;
    }
  }

  append(path: string, value: unknown, continuing: boolean): void {
    const target = JSON.stringify(pathSegments(path));
    const field = this.parser.fields.find(field => JSON.stringify(pathSegments(field.path)) === target);
    if (!field) return;
    if (typeof value !== 'string') throw new Error('正文参数片段必须是字符串。');
    field.text += value; field.seen = true; field.complete = !continuing;
  }

  finish(validate = true): void {
    if (validate) {
      if (this.hasJson) this.parser.finish();
      else for (const field of this.parser.fields) {
        if (!field.seen) outputValue({}, field.path);
      }
    }
    for (const field of this.parser.fields) field.complete = true;
  }

  drain(): string {
    let text = '';
    // Later fields wait for earlier strings to close, even if JSON keys arrive out of order.
    while (this.current < this.parser.fields.length) {
      const field = this.parser.fields[this.current];
      const delta = field.text.slice(this.emitted);
      if (delta) {
        if (!this.emitted && this.started) text += this.separator;
        text += delta; this.emitted = field.text.length; this.started = true;
      }
      if (!field.complete) break;
      this.current++; this.emitted = 0;
    }
    return text;
  }
}
