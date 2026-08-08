export type DebugLogEntry = {
  at: number;
  data?: unknown;
  level: 'debug' | 'error' | 'info' | 'warn';
  message: string;
};

const SENSITIVE_KEY = /api[-_]?key|authorization|cookie|header|prompt|content|response/iu;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '<redacted>' : redact(item)]),
    );
  }
  return value;
}

export class PageDebugLog {
  private readonly entries: DebugLogEntry[] = [];
  constructor(private readonly now: () => number = Date.now, private readonly limit = 1000) {}

  add(level: DebugLogEntry['level'], message: string, data?: unknown): void {
    this.entries.push({ at: this.now(), data, level, message });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  list(): DebugLogEntry[] {
    return structuredClone(this.entries);
  }

  diagnosticBundle(): DebugLogEntry[] {
    return this.entries.map(entry => ({ ...entry, data: redact(entry.data) }));
  }

  clear(): void {
    this.entries.length = 0;
  }
}
