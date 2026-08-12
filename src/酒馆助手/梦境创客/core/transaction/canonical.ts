const TYPE_KEY = '$dream_card_agent_type';

function canonicalize(value: unknown): unknown {
  const tag = typeof value === 'object' && value !== null ? Object.prototype.toString.call(value) : '';
  if (tag === '[object URL]') {
    const href = (value as { href?: unknown }).href;
    return { [TYPE_KEY]: 'url', value: typeof href === 'string' ? href : String(value) };
  }
  if (tag === '[object RegExp]') {
    const regex = value as RegExp;
    return { [TYPE_KEY]: 'regexp', flags: regex.flags, source: regex.source };
  }
  if (tag === '[object Date]') {
    return { [TYPE_KEY]: 'date', value: (value as Date).toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalParse<T>(value: string): T {
  return JSON.parse(value, (_key, item: unknown) => {
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>)[TYPE_KEY] === 'url' &&
      typeof (item as Record<string, unknown>).value === 'string'
    ) {
      return new URL((item as Record<string, unknown>).value as string);
    }
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>)[TYPE_KEY] === 'regexp' &&
      typeof (item as Record<string, unknown>).source === 'string' &&
      typeof (item as Record<string, unknown>).flags === 'string'
    ) {
      return new RegExp(
        (item as Record<string, unknown>).source as string,
        (item as Record<string, unknown>).flags as string,
      );
    }
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>)[TYPE_KEY] === 'date' &&
      typeof (item as Record<string, unknown>).value === 'string'
    ) {
      return new Date((item as Record<string, unknown>).value as string);
    }
    return item;
  }) as T;
}

export function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
