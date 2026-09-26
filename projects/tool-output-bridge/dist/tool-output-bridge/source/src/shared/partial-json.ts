import { outputValue, pathSegments } from './config';

type Container = { type: 'object' | 'array'; path: string[]; key: string; index: number; expectsKey: boolean };

/** Incrementally decodes a single string field without repairing incomplete JSON. */
export class PartialJsonText {
  private raw = '';
  private stack: Container[] = [];
  private inString = false;
  private isKey = false;
  private targetString = false;
  private stringValue = '';
  private escaped = false;
  private unicode: string | null = null;
  private pendingSurrogate = '';
  private seenTarget = false;
  private readonly target: string[];
  text = '';

  constructor(readonly path: string) { this.target = pathSegments(path); }

  private valuePath(): string[] {
    const parent = this.stack.at(-1);
    return !parent ? [] : [...parent.path, parent.type === 'object' ? parent.key : String(parent.index)];
  }

  private decoded(char: string): void {
    this.stringValue += char;
    if (!this.targetString) return;
    if (this.pendingSurrogate) {
      this.text += this.pendingSurrogate + char;
      this.pendingSurrogate = '';
    } else if (char.length === 1 && /[\uD800-\uDBFF]/.test(char)) this.pendingSurrogate = char;
    else this.text += char;
  }

  push(fragment: string): string {
    const before = this.text.length;
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
          if (this.targetString && this.pendingSurrogate) { this.text += this.pendingSurrogate; this.pendingSurrogate = ''; }
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
        const path = this.valuePath();
        this.targetString = !this.isKey && path.length === this.target.length && path.every((part, index) => part === this.target[index]);
        if (this.targetString) {
          if (this.seenTarget) throw new Error('工具参数重复定义了正文字段。');
          this.seenTarget = true;
        }
      } else if (char === '{' || char === '[') this.stack.push({ type: char === '{' ? 'object' : 'array', path: this.valuePath(), key: '', index: 0, expectsKey: char === '{' });
      else if (char === '}' || char === ']') this.stack.pop();
      else if (char === ',' && parent) { if (parent.type === 'array') parent.index++; else parent.expectsKey = true; }
    }
    return this.text.slice(before);
  }

  finish(): string {
    const value = outputValue(JSON.parse(this.raw), this.path);
    if (value !== this.text) throw new Error('工具正文与完整参数不一致。');
    return value;
  }
}
