export const GREEN_CACHE_VARIABLE_PATH = '压缩相邻消息.绿灯缓存';
export const GREEN_CACHE_VERSION = 2;

export type GreenCacheEntry = {
  world: string;
  uid: number;
  name: string;
  content_hash: string;
  content_snapshot: string;
  fixed_at: {
    message_id: number | null;
    swipe_id: number | null;
    message_hash: string | null;
  };
  created_at: number;
};

export type GreenCache = {
  version: typeof GREEN_CACHE_VERSION;
  entries: GreenCacheEntry[];
};

const SUPPORTED_GREEN_CACHE_VERSIONS = [1, GREEN_CACHE_VERSION] as const;

export function hashGreenCacheContent(content: string): string {
  let h1 = 0xdeadbeef ^ content.length;
  let h2 = 0x41c6ce57 ^ content.length;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeGreenCacheEntry(entry: any): GreenCacheEntry | undefined {
  if (!_.isPlainObject(entry) || !_.isPlainObject(entry.fixed_at)) {
    return undefined;
  }
  if (
    typeof entry.world !== 'string' ||
    typeof entry.uid !== 'number' ||
    typeof entry.name !== 'string' ||
    typeof entry.content_hash !== 'string' ||
    typeof entry.content_snapshot !== 'string' ||
    typeof entry.created_at !== 'number'
  ) {
    return undefined;
  }

  const message_id = entry.fixed_at.message_id;
  const swipe_id = entry.fixed_at.swipe_id;
  const message_hash = entry.fixed_at.message_hash;
  if (!(message_id === null || typeof message_id === 'number') || !(swipe_id === null || typeof swipe_id === 'number')) {
    return undefined;
  }
  if (!(message_hash === undefined || message_hash === null || typeof message_hash === 'string')) {
    return undefined;
  }

  return {
    world: entry.world,
    uid: entry.uid,
    name: entry.name,
    content_hash: entry.content_hash,
    content_snapshot: entry.content_snapshot,
    fixed_at: { message_id, swipe_id, message_hash: message_hash ?? null },
    created_at: entry.created_at,
  };
}

function getGreenCacheEntryIdentity(entry: Pick<GreenCacheEntry, 'world' | 'uid' | 'content_hash'>): string {
  return `${entry.world}.${entry.uid}.${entry.content_hash}`;
}

function dedupeGreenCacheEntries(entries: GreenCacheEntry[]): GreenCacheEntry[] {
  const selected = new Map<string, GreenCacheEntry>();
  [...entries]
    .sort((lhs, rhs) => lhs.created_at - rhs.created_at)
    .forEach(entry => {
      const identity = getGreenCacheEntryIdentity(entry);
      if (!selected.has(identity)) {
        selected.set(identity, entry);
      }
    });
  return [...selected.values()];
}

export function normalizeGreenCache(raw: any): GreenCache {
  if (
    !_.isPlainObject(raw) ||
    !SUPPORTED_GREEN_CACHE_VERSIONS.includes(raw.version) ||
    !_.isArray(raw.entries)
  ) {
    return { version: GREEN_CACHE_VERSION, entries: [] };
  }
  return {
    version: GREEN_CACHE_VERSION,
    entries: dedupeGreenCacheEntries(
      raw.entries.map(normalizeGreenCacheEntry).filter((entry): entry is GreenCacheEntry => Boolean(entry)),
    ),
  };
}

function shouldWriteNormalizedGreenCache(raw: any, cache: GreenCache): boolean {
  if (
    !_.isPlainObject(raw) ||
    !SUPPORTED_GREEN_CACHE_VERSIONS.includes(raw.version) ||
    !_.isArray(raw.entries)
  ) {
    return false;
  }
  return raw.version !== GREEN_CACHE_VERSION || raw.entries.length !== cache.entries.length;
}

export function readGreenCacheVariables(): GreenCache {
  const variables = getVariables({ type: 'chat' });
  const raw = _.get(variables, GREEN_CACHE_VARIABLE_PATH);
  const cache = normalizeGreenCache(raw);
  if (shouldWriteNormalizedGreenCache(raw, cache)) {
    if (cache.entries.length === 0) {
      _.unset(variables, GREEN_CACHE_VARIABLE_PATH);
    } else {
      _.set(variables, GREEN_CACHE_VARIABLE_PATH, cache);
    }
    replaceVariables(variables, { type: 'chat' });
  }
  return cache;
}

export function writeGreenCacheVariables(cache: GreenCache) {
  const variables = getVariables({ type: 'chat' });
  if (cache.entries.length === 0) {
    _.unset(variables, GREEN_CACHE_VARIABLE_PATH);
  } else {
    _.set(variables, GREEN_CACHE_VARIABLE_PATH, cache);
  }
  replaceVariables(variables, { type: 'chat' });
}

export function clearGreenCacheVariables() {
  const variables = getVariables({ type: 'chat' });
  _.unset(variables, GREEN_CACHE_VARIABLE_PATH);
  replaceVariables(variables, { type: 'chat' });
}
