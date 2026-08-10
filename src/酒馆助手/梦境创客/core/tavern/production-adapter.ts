import { klona } from 'klona';
import type { CardWorkspaceState, WorldbookData, WorldbookEntryData } from '../mapping/types';
import type { CardStateAdapter } from '../transaction/adapter';
import { applyStateOperation, type StateOperation } from '../transaction/state-diff';
import type { RawCharacterData, TavernBridge, TavernWorldbookEntry } from './bridge';
import { readTavernState } from './state-reader';
import { writeRegexScope, writeScriptScope } from './resource-reader';

function decodePath(path: string): string[] {
  return path
    .split('/')
    .slice(1)
    .map(item => item.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

function writeCharacterFields(raw: RawCharacterData, state: CardWorkspaceState, operation: StateOperation): void {
  const segments = decodePath(operation.path);
  const character = state.character;
  if (segments[1] === 'fields') {
    const key = segments[2] as keyof typeof character.fields;
    raw.data[key] = character.fields[key];
    if (key === 'description' || key === 'personality' || key === 'scenario' || key === 'mes_example') raw[key] = character.fields[key];
    if (key === 'creator_notes') raw.creatorcomment = character.fields.creator_notes;
  } else if (segments[1] === 'creator') raw.data.creator = character.creator;
  else if (segments[1] === 'version') raw.data.character_version = character.version;
  else if (segments[1] === 'tags') {
    raw.data.tags = klona(character.tags);
    raw.tags = klona(character.tags);
  } else if (segments[1] === 'extensions') raw.data.extensions = klona(character.extensions);
  else if (segments[1].startsWith('greetings')) {
    raw.data.first_mes = character.greetings[0]?.content ?? '';
    raw.first_mes = raw.data.first_mes;
    raw.data.alternate_greetings = character.greetings.slice(1).map(item => item.content);
    raw.data.extensions = klona(character.extensions);
  }
}

function withResourceId(entry: WorldbookEntryData): TavernWorldbookEntry {
  const extra = klona(entry.extra ?? {});
  const cardAgent = typeof extra.card_agent === 'object' && extra.card_agent !== null ? extra.card_agent : {};
  extra.card_agent = { ...(cardAgent as Record<string, unknown>), resource_id: entry.resourceId };
  return {
    ...klona(entry.unknownFields),
    content: entry.content,
    effect: klona(entry.effect),
    enabled: entry.enabled,
    extra,
    name: entry.name,
    position: klona(entry.position),
    probability: entry.probability,
    recursion: klona(entry.recursion),
    strategy: klona(entry.strategy),
    uid: typeof entry.uid === 'number' ? entry.uid : 0,
  };
}

function findBook(state: CardWorkspaceState, id: string): WorldbookData {
  const book = state.worldbooks.find(item => item.resourceId === id);
  if (!book) throw new Error(`世界书资源不存在：${id}`);
  return book;
}

function entryUid(entry: WorldbookEntryData): number | undefined {
  return typeof entry.uid === 'number' ? entry.uid : undefined;
}

function tavernEntryResourceId(bookId: string, entry: TavernWorldbookEntry): string {
  const extra = typeof entry.extra === 'object' && entry.extra !== null ? entry.extra : {};
  const cardAgent = typeof extra.card_agent === 'object' && extra.card_agent !== null ? extra.card_agent : {};
  return typeof cardAgent.resource_id === 'string' ? cardAgent.resource_id : `${bookId}:uid:${entry.uid}`;
}

export class ProductionCardStateAdapter implements CardStateAdapter {
  private cached?: CardWorkspaceState;
  private warnings: string[] = [];

  constructor(private readonly bridge: TavernBridge) {}

  async read(): Promise<CardWorkspaceState> {
    const result = await readTavernState(this.bridge);
    this.cached = klona(result.state);
    this.warnings = result.warnings;
    return result.state;
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  async apply(operation: StateOperation): Promise<StateOperation | void> {
    const current = this.cached ?? (await this.read());
    const next = klona(current);
    applyStateOperation(next, operation);
    const segments = decodePath(operation.path);
    let normalized: StateOperation | undefined;
    if (segments[0] === 'character') {
      const raw = this.bridge.getRawCharacter();
      if (!raw) throw new Error('写入前无法重新读取角色卡。');
      writeCharacterFields(raw, next, operation);
      await this.bridge.saveRawCharacter(raw);
    } else if (segments[0] === 'worldbooks') {
      normalized = await this.applyWorldbook(operation, current, next, segments);
      if (normalized) applyStateOperation(next, normalized);
    } else if (segments[0] === 'bindings') {
      if (segments[1] === 'chat') await this.bridge.setChatWorldbook(next.bindings.chat);
      else await this.bridge.setCharacterBindings({ additional: next.bindings.additional, primary: next.bindings.primary });
    } else if (segments[0] === 'resources') {
      const kind = segments[1] as keyof CardWorkspaceState['resources'];
      const scope = segments[2] as keyof CardWorkspaceState['resources'][typeof kind];
      const beforeTarget = current.resources[kind][scope].targetId;
      const afterTarget = next.resources[kind][scope].targetId;
      if (beforeTarget !== afterTarget) {
        throw new Error(`TARGET_SCOPE_CHANGED：${scope}作用域目标已经切换，请重新读取工作区后再修改。`);
      }
      if (kind === 'regexes') {
        await this.bridge.replaceRawRegexes(scope, writeRegexScope(next.resources.regexes[scope]));
      } else {
        await this.bridge.replaceRawScriptTrees(scope, writeScriptScope(next.resources.scripts[scope]));
      }
    }
    this.cached = next;
    return normalized;
  }

  async applyBatch(operations: StateOperation[]): Promise<Array<StateOperation | void>> {
    if (operations.length === 0) return [];
    const roots = new Set(operations.map(operation => decodePath(operation.path).slice(0, 3).join('/')));
    const [first] = operations;
    const segments = decodePath(first.path);
    if (segments[0] !== 'resources' || roots.size !== 1) {
      const result: Array<StateOperation | void> = [];
      for (const operation of operations) result.push(await this.apply(operation));
      return result;
    }
    const current = this.cached ?? (await this.read());
    const next = klona(current);
    operations.forEach(operation => applyStateOperation(next, operation));
    const kind = segments[1] as keyof CardWorkspaceState['resources'];
    const scope = segments[2] as keyof CardWorkspaceState['resources'][typeof kind];
    if (current.resources[kind][scope].targetId !== next.resources[kind][scope].targetId) {
      throw new Error(`TARGET_SCOPE_CHANGED：${scope}作用域目标已经切换，请重新读取工作区后再修改。`);
    }
    if (kind === 'regexes') await this.bridge.replaceRawRegexes(scope, writeRegexScope(next.resources.regexes[scope]));
    else await this.bridge.replaceRawScriptTrees(scope, writeScriptScope(next.resources.scripts[scope]));
    this.cached = next;
    return operations.map(() => undefined);
  }

  private async applyWorldbook(
    operation: StateOperation,
    current: CardWorkspaceState,
    next: CardWorkspaceState,
    segments: string[],
  ): Promise<StateOperation | undefined> {
    const bookId = segments[1];
    if (segments.length === 2) {
      const before = operation.before as WorldbookData | undefined;
      const after = operation.after as WorldbookData | undefined;
      if (!after && before) await this.bridge.deleteWorldbook(before.name);
      else if (after && !before) {
        await this.bridge.createWorldbook(after.name);
        if (after.entries.length > 0) {
          const created = await this.bridge.createWorldbookEntries(after.name, after.entries.map(withResourceId));
          after.entries.forEach((entry, index) => {
            entry.uid = created[index].uid;
          });
          return { ...operation, after };
        }
      }
      return undefined;
    }
    const beforeBook = findBook(current, bookId);
    const afterBook = findBook(next, bookId);
    if (segments[2] === 'name') {
      await this.bridge.createWorldbook(afterBook.name);
      if (beforeBook.entries.length > 0) {
        await this.bridge.createWorldbookEntries(afterBook.name, beforeBook.entries.map(withResourceId));
      }
      await this.bridge.deleteWorldbook(beforeBook.name);
      return undefined;
    }
    if (segments[2] === 'metadata') return undefined;
    if (segments[2] === 'entries-order') {
      const order = new Map(afterBook.entries.map((entry, index) => [entry.resourceId, index]));
      await this.bridge.updateWorldbook(afterBook.name, entries =>
        [...entries].sort((left, right) => {
          const leftId = tavernEntryResourceId(bookId, left);
          const rightId = tavernEntryResourceId(bookId, right);
          return (order.get(leftId) ?? Number.MAX_SAFE_INTEGER) - (order.get(rightId) ?? Number.MAX_SAFE_INTEGER);
        }),
      );
      return undefined;
    }
    const before = operation.before as WorldbookEntryData | undefined;
    const after = operation.after as WorldbookEntryData | undefined;
    if (!before && after) {
      const [created] = await this.bridge.createWorldbookEntries(afterBook.name, [withResourceId(after)]);
      const normalizedAfter = { ...after, uid: created.uid } as WorldbookEntryData;
      return { ...operation, after: normalizedAfter };
    }
    if (before && !after) {
      const uid = entryUid(before);
      await this.bridge.updateWorldbook(afterBook.name, entries => entries.filter(entry => entry.uid !== uid));
      return undefined;
    }
    if (before && after) {
      const uid = entryUid(before);
      await this.bridge.updateWorldbook(afterBook.name, entries =>
        entries.map(entry => (entry.uid === uid ? { ...entry, ...withResourceId(after), uid: entry.uid } : entry)),
      );
    }
    return undefined;
  }
}
