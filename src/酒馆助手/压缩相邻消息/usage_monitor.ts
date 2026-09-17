import { hashGreenCacheContent } from './green_cache';
import { readTokenUsage } from './token_usage';
import type { DebugTokenUsage } from './debug_types';

type PendingRecord = { id: string; signature: string; time: number };
type FetchHost = { fetch: typeof fetch; location: { href: string } };
const REQUEST_PATH = '/api/backends/chat-completions/generate';

function signature(value: unknown): string | undefined {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text === undefined ? undefined : `${text.length}:${hashGreenCacheContent(text)}`;
  } catch {
    return undefined;
  }
}

export function createTokenUsageMonitor(
  host: FetchHost,
  onUsage: (record_id: string, usage: DebugTokenUsage) => void,
  now = Date.now,
) {
  const pending = new Map<string, PendingRecord>();
  let identities = new WeakMap<object, string>();
  const requests = new Map<string, PendingRecord[]>();
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const delegate = host.fetch;
  let active = true;
  const prune = () => {
    const cutoff = now() - 120_000;
    pending.forEach((record, key) => {
      if (record.time < cutoff) pending.delete(key);
    });
    requests.forEach((records, key) => {
      if (records.every(record => record.time < cutoff)) requests.delete(key);
    });
    while (pending.size > 100) pending.delete(pending.keys().next().value!);
    while (requests.size > 100) requests.delete(requests.keys().next().value!);
  };

  const wrapped: typeof fetch = function (...args) {
    let record_id: string | undefined;
    if (active) {
      prune();
      try {
        const [input, init] = args;
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          host.location.href,
        );
        if (
          url.origin === new URL(host.location.href).origin &&
          url.pathname === REQUEST_PATH &&
          typeof init?.body === 'string'
        ) {
          const key = signature(init.body)!;
          const matches = requests.get(key) ?? [];
          requests.delete(key);
          if (matches.length === 1 && matches[0].time >= now() - 120_000) record_id = matches[0].id;
        }
      } catch {
        record_id = undefined;
      }
    }
    const result = Reflect.apply(delegate, host, args) as ReturnType<typeof fetch>;
    if (!record_id) return result;
    const id = record_id;
    return result.then(response => {
      if (!active) return response;
      try {
        void readTokenUsage(response.clone(), readers)
          .then(usage => {
            if (active && usage) onUsage(id, usage);
          })
          .catch(() => {});
      } catch {
        /* 响应的原读取路径继续运行。 */
      }
      return response;
    });
  };
  try {
    host.fetch = wrapped;
  } catch {
    active = false;
  }

  return {
    register(id: string, messages: object) {
      if (!active) return;
      prune();
      const key = signature(messages);
      if (!key) return;
      pending.set(id, { id, signature: key, time: now() });
      identities.set(messages, id);
    },
    prepare(payload: { messages?: unknown; [key: string]: unknown }) {
      if (!active || !Array.isArray(payload.messages)) return;
      prune();
      const direct = identities.get(payload.messages);
      const key = signature(payload.messages);
      const candidates =
        direct && pending.has(direct)
          ? [pending.get(direct)!]
          : [...pending.values()].filter(record => record.signature === key);
      if (candidates.length !== 1) return;
      const record = candidates[0];
      const body_key = signature(payload);
      if (!body_key) return;
      pending.delete(record.id);
      const existing = requests.get(body_key) ?? [];
      requests.set(body_key, [...existing.filter(item => item.id !== record.id), record]);
    },
    destroy() {
      active = false;
      pending.clear();
      requests.clear();
      identities = new WeakMap();
      readers.forEach(reader => {
        void reader.cancel().catch(() => {});
      });
      readers.clear();
      try {
        if (host.fetch === wrapped) host.fetch = delegate;
      } catch {
        /* 宿主可能固定了 fetch 属性。 */
      }
    },
  };
}
