import type { PersistedSessionRuntime } from '../session/types';
import { joinSessionRuntime, splitSessionRuntime, type SessionPartField } from './session-parts';

type SessionRow = { input: { runtime: PersistedSessionRuntime } & Record<string, unknown> } & Record<string, unknown>;
type StoredSessionRow = Omit<SessionRow, 'input'> & {
  input: Omit<SessionRow['input'], 'runtime'>;
  sessionStorageFormat: 1;
  fields: SessionPartField[];
};

const partKey = (key: string, part: string) => `session-part:${encodeURIComponent(key)}:${part}`;

export function isStoredSessionRow(value: unknown): value is StoredSessionRow {
  return Boolean(value && typeof value === 'object' && (value as StoredSessionRow).sessionStorageFormat === 1);
}

export function sessionRecordParts(value: unknown): string[] {
  return isStoredSessionRow(value) ? value.fields.flatMap(field => field.groups.flat()) : [];
}

export function readSessionRecord(
  store: IDBObjectStore,
  key: string,
  raw: unknown,
  ready: (value: unknown, parts: Map<string, string>) => void,
  failed: (error: unknown) => void,
): void {
  if (!isStoredSessionRow(raw)) {
    ready(raw, new Map());
    return;
  }
  const keys = sessionRecordParts(raw);
  const parts = new Map<string, string>();
  const finish = () => {
    try {
      const { fields, sessionStorageFormat: _format, ...row } = raw;
      ready({ ...row, input: { ...row.input, runtime: joinSessionRuntime(fields, parts) } }, parts);
    } catch (error) {
      failed(error);
    }
  };
  if (!keys.length) {
    finish();
    return;
  }
  for (const part of keys) {
    const request = store.get(partKey(key, part));
    request.onsuccess = () => {
      if (typeof request.result !== 'string') {
        failed(new Error(`本机会话分块缺失：${part}`));
        return;
      }
      parts.set(part, request.result);
      if (parts.size === keys.length) finish();
    };
  }
}

export function writeSessionRecord(
  store: IDBObjectStore,
  key: string,
  value: unknown,
  previous: ReadonlyMap<string, string>,
): void {
  const row = value as SessionRow | undefined;
  if ((!key.startsWith('session:') && !key.startsWith('backup-snapshot:')) || !row?.input?.runtime) {
    if (value === undefined) store.delete(key);
    else store.put(value, key);
    for (const part of previous.keys()) store.delete(partKey(key, part));
    return;
  }
  const { fields, parts } = splitSessionRuntime(row.input.runtime);
  for (const [part, text] of parts) {
    if (text !== previous.get(part)) store.put(text, partKey(key, part));
  }
  for (const part of previous.keys()) if (!parts.has(part)) store.delete(partKey(key, part));
  const { runtime: _runtime, ...input } = row.input;
  store.put({ ...row, input, sessionStorageFormat: 1, fields } satisfies StoredSessionRow, key);
}
