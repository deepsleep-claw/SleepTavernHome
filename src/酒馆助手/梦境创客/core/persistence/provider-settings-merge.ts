import type { ApiModel, ApiProvider } from '../provider/provider-config';

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function mergeAtomic<T>(base: T, incoming: T, latest: T, label: string): T {
  if (equal(base, incoming)) return structuredClone(latest);
  if (equal(base, latest) || equal(incoming, latest)) return structuredClone(incoming);
  throw new Error(`${label}在保存期间发生了冲突，请重新读取配置后再保存。`);
}

function mergeValue(base: unknown, incoming: unknown, latest: unknown, label: string): unknown {
  if (equal(base, incoming)) return structuredClone(latest);
  if (equal(base, latest) || equal(incoming, latest)) return structuredClone(incoming);
  if (isRecord(base) && isRecord(incoming) && isRecord(latest)) {
    const result = { ...latest };
    for (const key of new Set([...Object.keys(base), ...Object.keys(incoming)])) {
      const value = mergeValue(base[key], incoming[key], latest[key], label);
      if (value === undefined) delete result[key];
      else result[key] = value;
    }
    return result;
  }
  throw new Error(`${label}在保存期间发生了冲突，请重新读取配置后再保存。`);
}

function mergeRows<T extends { id: string; name: string }>(
  base: T[],
  incoming: T[],
  latest: T[],
  merge: (base: T, incoming: T, latest: T) => T,
): T[] {
  const before = new Map(base.map(item => [item.id, item]));
  const next = new Map(incoming.map(item => [item.id, item]));
  const result = new Map(latest.map(item => [item.id, structuredClone(item)]));
  for (const item of base) {
    if (!next.has(item.id)) result.delete(item.id);
  }
  for (const item of incoming) {
    const original = before.get(item.id);
    if (original && equal(original, item)) continue;
    const current = result.get(item.id);
    if (original && !current) throw new Error(`“${item.name}”已被删除，请重新读取配置。`);
    if (original && current) result.set(item.id, merge(original, item, current));
    else if (!current || equal(current, item)) result.set(item.id, structuredClone(item));
    else throw new Error(`“${item.name}”的配置标识已存在，请重新读取配置。`);
  }
  const names = new Set<string>();
  for (const item of result.values()) {
    const name = item.name.trim().normalize('NFC');
    if (names.has(name)) throw new Error(`配置名称已存在：${item.name}`);
    names.add(name);
  }
  return [...result.values()];
}

function mergeModel(base: ApiModel, incoming: ApiModel, latest: ApiModel): ApiModel {
  // 加密信封必须整体选择，不能把不同次加密的密文和 IV 拼在一起。
  const requestSecrets = mergeAtomic(
    base.requestSecrets,
    incoming.requestSecrets,
    latest.requestSecrets,
    `模型“${incoming.name}”的请求配置`,
  );
  return {
    ...(mergeValue(
      { ...base, requestSecrets: undefined },
      { ...incoming, requestSecrets: undefined },
      { ...latest, requestSecrets: undefined },
      `模型“${incoming.name}”`,
    ) as ApiModel),
    requestSecrets: structuredClone(requestSecrets),
  };
}

export function mergeProviderSettings(
  base: ApiProvider[],
  incoming: ApiProvider[],
  latest: ApiProvider[],
): ApiProvider[] {
  return mergeRows(base, incoming, latest, (before, next, current) => {
    const secrets = mergeAtomic(before.secrets, next.secrets, current.secrets, `Provider“${next.name}”的连接配置`);
    return {
      ...(mergeValue(
        { ...before, models: undefined, secrets: undefined },
        { ...next, models: undefined, secrets: undefined },
        { ...current, models: undefined, secrets: undefined },
        `Provider“${next.name}”`,
      ) as ApiProvider),
      secrets: structuredClone(secrets),
      models: mergeRows(before.models, next.models, current.models, mergeModel),
    };
  });
}
