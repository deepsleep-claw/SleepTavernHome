import type { WorldbookEntryMetadata } from './worldbook_analysis';

export type ScannedWorldbookEntry = { world: string; uid: number; content: string; hash?: number };
export type WorldbookScanSnapshot = {
  metadata: Map<string, WorldbookEntryMetadata>;
  worlds: Set<string>;
};
type LoadedEntry = { hash: number; raw: ScannedWorldbookEntry; metadata: WorldbookEntryMetadata };

// SillyTavern 在宏展开前，以移除装饰器后的完整条目计算 cyrb53。
export function getNativeWorldbookHash(entry: ScannedWorldbookEntry): number {
  let content = entry.content || '';
  const decorators: string[] = [];
  if (content.startsWith('@@')) {
    const lines = content.split('\n');
    let fallback = false;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.startsWith('@@')) {
        content = lines.slice(index).join('\n');
        break;
      }
      if (line.startsWith('@@@') && !fallback) continue;
      const normalized = line.startsWith('@@@') ? line.slice(1) : line;
      if (['@@activate', '@@dont_activate'].some(value => normalized.startsWith(value))) {
        decorators.push(normalized);
        fallback = false;
      } else fallback = true;
    }
  }
  const text = JSON.stringify({ ...entry, decorators, content });
  // cyrb53, bryc, public domain: https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const char = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const keyOf = (entry: { world: string; uid: number }) => `${entry.world}.${entry.uid}`;
const fingerprint = (metadata: WorldbookEntryMetadata) =>
  JSON.stringify([
    metadata.content,
    metadata.is_disabled,
    metadata.rule_context.trigger,
    [...metadata.rule_context.sources].sort(),
  ]);

export class WorldbookScanLedger {
  private loads: Map<string, LoadedEntry>[] = [];
  private empty_scans: WorldbookScanSnapshot[] = [];
  private entry_scopes = new WeakMap<object, WorldbookScanSnapshot>();

  begin() {
    this.loads = [];
    this.empty_scans = [];
    this.entry_scopes = new WeakMap();
  }

  loaded(entries: ScannedWorldbookEntry[], metadata: Map<string, WorldbookEntryMetadata>) {
    this.loads.push(
      new Map(
        entries.flatMap(raw => {
          const value = metadata.get(keyOf(raw));
          return value
            ? [
                [
                  keyOf(raw),
                  { raw: structuredClone(raw), hash: getNativeWorldbookHash(raw), metadata: structuredClone(value) },
                ],
              ]
            : [];
        }),
      ),
    );
    if (this.loads.length > 12) this.loads.shift();
    if (entries.length === 0) {
      this.empty_scans.push({ metadata: new Map(), worlds: new Set() });
      if (this.empty_scans.length > 12) this.empty_scans.shift();
    }
  }

  private original(entry: ScannedWorldbookEntry): WorldbookEntryMetadata | undefined {
    const candidates = this.loads.flatMap(load => {
      const candidate = load.get(keyOf(entry));
      if (!candidate) return [];
      const matches =
        typeof entry.hash === 'number' ? candidate.hash === entry.hash : candidate.raw.content === entry.content;
      return matches ? [candidate.metadata] : [];
    });
    if (!candidates.length || candidates.some(value => fingerprint(value) !== fingerprint(candidates[0])))
      return undefined;
    return structuredClone(candidates[0]);
  }

  scanned(sorted: ScannedWorldbookEntry[], activated: ScannedWorldbookEntry[]) {
    const metadata = new Map<string, WorldbookEntryMetadata>();
    const worlds = new Set<string>();
    for (const entry of sorted) {
      worlds.add(entry.world);
      const original = this.original(entry);
      if (original) metadata.set(keyOf(entry), original);
    }
    // 未能关联的原文不能用于删除或回放旧缓存。
    for (const entry of sorted) if (!metadata.has(keyOf(entry))) worlds.delete(entry.world);
    const snapshot = { metadata, worlds };
    for (const entry of [...sorted, ...activated]) this.entry_scopes.set(entry, snapshot);
    if (!activated.length) {
      this.empty_scans.push(snapshot);
      if (this.empty_scans.length > 12) this.empty_scans.shift();
    }
  }

  activated(entries: object[]): WorldbookScanSnapshot | undefined {
    const scopes = new Set(entries.map(entry => this.entry_scopes.get(entry)));
    if (scopes.size === 1 && !scopes.has(undefined)) return structuredClone([...scopes][0]);
    if (!entries.length) return undefined;
    const candidates = this.loads.filter(load =>
      entries.every(value => {
        const entry = value as ScannedWorldbookEntry;
        const original = load.get(keyOf(entry));
        return (
          original &&
          (typeof entry.hash === 'number' ? original.hash === entry.hash : original.raw.content === entry.content)
        );
      }),
    );
    if (!candidates.length) return undefined;
    return this.intersection(candidates.map(load => this.snapshotFromLoad(load)));
  }

  private snapshotFromLoad(load: Map<string, LoadedEntry>): WorldbookScanSnapshot {
    return {
      metadata: new Map([...load].map(([key, value]) => [key, value.metadata])),
      worlds: new Set([...load.values()].map(value => value.raw.world)),
    };
  }

  private intersection(snapshots: WorldbookScanSnapshot[]): WorldbookScanSnapshot {
    const first = snapshots[0];
    if (!first) return { metadata: new Map(), worlds: new Set() };
    const result = structuredClone(first);
    for (const snapshot of snapshots.slice(1)) {
      for (const world of result.worlds) if (!snapshot.worlds.has(world)) result.worlds.delete(world);
      for (const [key, metadata] of result.metadata) {
        const other = snapshot.metadata.get(key);
        if (!other || fingerprint(metadata) !== fingerprint(other)) {
          result.metadata.delete(key);
          result.worlds.delete(metadata.world);
        }
      }
    }
    return result;
  }

  cacheSnapshot(): WorldbookScanSnapshot {
    return this.intersection(
      this.empty_scans.length ? this.empty_scans : this.loads.map(load => this.snapshotFromLoad(load)),
    );
  }
}
