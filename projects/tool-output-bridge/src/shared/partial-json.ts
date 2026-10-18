import { outputValue, pathSegments } from './config';

type Container = { type: 'object' | 'array'; path: string[]; key: string; index: number; expectsKey: boolean };
export interface JsonTextField { path: string; text: string; seen: boolean; complete: boolean }

/** Decodes selected string fields in one pass, including unfinished JSON strings. */
export class PartialJsonFields {
  private raw = '';
  private stack: Container[] = [];
  private inString = false;
  private isKey = false;
  private target?: JsonTextField;
  private stringValue = '';
  private escaped = false;
  private unicode: string | null = null;
  private pendingSurrogate = '';
  private targets: Map<string, JsonTextField>;
  readonly fields: JsonTextField[];

  constructor(paths: string[]) {
    this.fields = paths.map(path => ({ path, text: '', seen: false, complete: false }));
    this.targets = new Map(this.fields.map(field => [JSON.stringify(pathSegments(field.path)), field]));
  }

  private valuePath(): string[] {
    const parent = this.stack.at(-1);
    return !parent ? [] : [...parent.path, parent.type === 'object' ? parent.key : String(parent.index)];
  }

  private decoded(char: string): void {
    if (this.isKey) this.stringValue += char;
    if (!this.target) return;
    if (this.pendingSurrogate) {
      this.target.text += this.pendingSurrogate + char;
      this.pendingSurrogate = '';
    } else if (char.length === 1 && /[\uD800-\uDBFF]/.test(char)) this.pendingSurrogate = char;
    else this.target.text += char;
  }

  push(fragment: string): void {
    this.raw += fragment;
    if (this.raw.length > 8 * 1024 * 1024) throw new Error('工具参数超过 8 MiB。');
    for (const char of fragment) {
      if (this.inString) {
        if (this.unicode !== null) {
          if (!/[0-9a-f]/i.test(char)) throw new Error('工具参数包含无效 Unicode 转义。');
          this.unicode += char;
          if (this.unicode.length === 4) { this.decoded(String.fromCharCode(parseInt(this.unicode, 16))); this.unicode = null; }
        } else if (this.escaped) {
          this.escaped = false;
          if (char === 'u') this.unicode = '';
          else {
            const values: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
            if (!(char in values)) throw new Error('工具参数包含无效 JSON 转义。');
            this.decoded(values[char]);
          }
        } else if (char === '\\') this.escaped = true;
        else if (char === '"') {
          this.inString = false;
          if (this.isKey) { const parent = this.stack.at(-1)!; parent.key = this.stringValue; parent.expectsKey = false; }
          if (this.target) {
            this.target.text += this.pendingSurrogate; this.pendingSurrogate = '';
            this.target.complete = true;
          }
        } else {
          if (char.charCodeAt(0) < 32) throw new Error('工具参数字符串包含未转义的控制字符。');
          this.decoded(char);
        }
        continue;
      }
      const parent = this.stack.at(-1);
      if (char === '"') {
        this.inString = true;
        this.isKey = parent?.type === 'object' && parent.expectsKey;
        this.stringValue = '';
        this.target = this.isKey ? undefined : this.targets.get(JSON.stringify(this.valuePath()));
        if (this.target) {
          if (this.target.seen) throw new Error('工具参数重复定义了正文字段。');
          this.target.seen = true;
        }
      } else if (char === '{' || char === '[') this.stack.push({ type: char === '{' ? 'object' : 'array', path: this.valuePath(), key: '', index: 0, expectsKey: char === '{' });
      else if (char === '}' || char === ']') this.stack.pop();
      else if (char === ',' && parent) { if (parent.type === 'array') parent.index++; else parent.expectsKey = true; }
    }
  }

  finish(): void {
    const args = JSON.parse(this.raw);
    for (const field of this.fields) {
      if (outputValue(args, field.path) !== field.text) throw new Error('工具正文与完整参数不一致。');
    }
  }
}

export class PartialJsonText {
  private parser: PartialJsonFields;
  constructor(readonly path: string) { this.parser = new PartialJsonFields([path]); }
  get text(): string { return this.parser.fields[0].text; }
  push(fragment: string): string {
    const before = this.text.length;
    this.parser.push(fragment);
    return this.text.slice(before);
  }
  finish(): string { this.parser.finish(); return this.text; }
}
