import type { PersistedSessionRuntime } from '../session/types';
import { canonicalParse, canonicalStringify } from '../transaction/canonical';

export type SessionPartField = { path: string[]; array: boolean; groups: string[][] };
export type SessionParts = { fields: SessionPartField[]; parts: Map<string, string> };

/** 固定记录边界使追加消息只改变尾部；超长记录独立分段。 */
export function splitSessionRuntime(runtime: PersistedSessionRuntime): SessionParts {
  const fields: SessionPartField[] = [];
  const parts = new Map<string, string>();
  const add = (path: string[], value: unknown) => {
    if (value === undefined) return;
    const array = Array.isArray(value);
    const values = array
      ? Array.from({ length: Math.ceil(value.length / 16) }, (_, index) => value.slice(index * 16, index * 16 + 16))
      : [value];
    const groups = values.map((value, group) => {
      const text = canonicalStringify(value);
      const keys: string[] = [];
      for (let offset = 0; offset < text.length; offset += 64 * 1024) {
        const key = `${path.map(encodeURIComponent).join('/')}/${group}/${keys.length}`;
        // 分段作为 JSON 字符串保存，跨段的 UTF-16 代理对也能原样恢复。
        parts.set(key, text.slice(offset, offset + 64 * 1024));
        keys.push(key);
      }
      return keys;
    });
    fields.push({ path, array, groups });
  };
  for (const [name, value] of Object.entries(runtime)) {
    if (name === 'operationLog' && value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) add([name, key], nested);
    } else add([name], value);
  }
  return { fields, parts };
}

export function joinSessionRuntime(
  fields: SessionPartField[],
  parts: ReadonlyMap<string, string>,
): PersistedSessionRuntime {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (
      !Array.isArray(field.path) ||
      field.path.length < 1 ||
      field.path.length > 2 ||
      field.path.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))
    )
      throw new Error('会话分块索引格式无效。');
    const values = field.groups.map(
      keys =>
        canonicalParse<unknown>(
          keys
            .map(key => {
              const text = parts.get(key);
              if (text === undefined) throw new Error(`会话分块缺失：${key}`);
              return text;
            })
            .join(''),
        ) as unknown,
    );
    if (field.array && values.some(value => !Array.isArray(value))) throw new Error('会话数组分块格式无效。');
    let target = result;
    if (field.path.length === 2) {
      target = (result[field.path[0]] ??= {}) as Record<string, unknown>;
    }
    target[field.path.at(-1)!] = field.array ? values.flat() : values[0];
  }
  if (result.version !== 3 || typeof result.sessionId !== 'string') throw new Error('会话运行记录格式无效。');
  return result as PersistedSessionRuntime;
}
