export interface SseEvent { event: string; data: string; id?: string }

export class SseDecoder {
  private decoder = new TextDecoder();
  private buffer = '';
  push(chunk: Uint8Array | string, final = false): SseEvent[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: !final });
    if (final) this.buffer += this.decoder.decode();
    if (this.buffer.length > 16 * 1024 * 1024) throw new Error('单个流事件超过 16 MiB。');
    const events: SseEvent[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer))) {
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = this.parse(block); if (event) events.push(event);
    }
    if (final && this.buffer.trim()) { const event = this.parse(this.buffer); if (event) events.push(event); this.buffer = ''; }
    return events;
  }
  private parse(block: string): SseEvent | undefined {
    const data: string[] = []; let event = ''; let id: string | undefined;
    for (const line of block.split(/\r\n|\n|\r/)) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value;
      else if (field === 'id') id = value;
    }
    return data.length ? { event, data: data.join('\n'), id } : undefined;
  }
}

export function encodeEvent(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}
