import { klona } from 'klona';
import type { CardWorkspaceState, WorldbookData, WorldbookEntryData } from '../mapping/types';
import type { CardStateAdapter } from '../transaction/adapter';
import { canonicalEqual } from '../transaction/canonical';
import { applyStateOperation, readStatePath, type StateOperation } from '../transaction/state-diff';
import type { RawCharacterData, TavernBridge, TavernWorldbookEntry } from './bridge';
import { readStandaloneWorldbook, readTavernState } from './state-reader';
import { readRegexScope, readScriptScope, writeRegexScope, writeScriptScope } from './resource-reader';

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
  } else if (segments[1] === 'extensions') {
    // 事务当前只允许写入梦境创客自己的 card_agent 扩展。必须保持最小 Patch：
    // 若整份替换 extensions，会把前一步刚写入的 extensions.world 绑定用 Base 中的旧值覆盖掉。
    raw.data.extensions ??= {};
    const cardAgent = character.extensions.card_agent;
    if (cardAgent === undefined) delete raw.data.extensions.card_agent;
    else raw.data.extensions.card_agent = klona(cardAgent);
  }
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

function acceptHostNormalizedEntry(
  expected: WorldbookEntryData,
  actual: WorldbookEntryData,
  action: string,
): WorldbookEntryData {
  const expectedSemantic = { ...expected, extra: expected.extra ?? {}, uid: undefined, unknownFields: undefined };
  const actualSemantic = { ...actual, extra: actual.extra ?? {}, uid: undefined, unknownFields: undefined };
  if (!canonicalEqual(expectedSemantic, actualSemantic)) {
    throw new Error(`${action}后酒馆返回的条目语义不一致：${expected.name}`);
  }
  return actual;
}

function acceptHostNormalizedBook(expected: WorldbookData, actual: WorldbookData, action: string): WorldbookData {
  if (expected.name !== actual.name || expected.resourceId !== actual.resourceId || expected.entries.length !== actual.entries.length) {
    throw new Error(`${action}后酒馆返回的世界书结构不一致：${expected.name}`);
  }
  for (const expectedEntry of expected.entries) {
    const actualEntry = actual.entries.find(entry => entry.resourceId === expectedEntry.resourceId);
    if (!actualEntry) throw new Error(`${action}后酒馆缺少条目：${expected.name}/${expectedEntry.name}`);
    acceptHostNormalizedEntry(expectedEntry, actualEntry, action);
  }
  return actual;
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
        next.resources.regexes[scope] = readRegexScope(this.bridge.getRawRegexes(scope), afterTarget);
      } else {
        await this.bridge.replaceRawScriptTrees(scope, writeScriptScope(next.resources.scripts[scope]));
        next.resources.scripts[scope] = readScriptScope(this.bridge.getRawScriptTrees(scope), afterTarget);
      }
      normalized = { ...operation, after: klona(readStatePath(next, operation.path)) };
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
    if (kind === 'regexes') {
      await this.bridge.replaceRawRegexes(scope, writeRegexScope(next.resources.regexes[scope]));
      next.resources.regexes[scope] = readRegexScope(this.bridge.getRawRegexes(scope), next.resources.regexes[scope].targetId);
    } else {
      await this.bridge.replaceRawScriptTrees(scope, writeScriptScope(next.resources.scripts[scope]));
      next.resources.scripts[scope] = readScriptScope(this.bridge.getRawScriptTrees(scope), next.resources.scripts[scope].targetId);
    }
    this.cached = next;
    return operations.map(operation => ({ ...operation, after: klona(readStatePath(next, operation.path)) }));
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
          await this.bridge.createWorldbookEntries(after.name, after.entries.map(withResourceId));
        }
        // 酒馆会为新条目补齐 UID 和若干隐式默认字段。直接回读并把真实结果反馈给事务，
        // 否则整书创建会因为“期望值仍是临时结构”而在最终校验阶段被误判为失败。
        const normalized = await readStandaloneWorldbook(this.bridge, after.name, {
          resourceId: after.resourceId,
          writable: after.writable,
        });
        if (!normalized.roundTripSafe) {
          throw new Error(`创建世界书后无法重新读取：${after.name}`);
        }
        return { ...operation, after: acceptHostNormalizedBook(after, normalized, '创建世界书') };
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
      const normalizedBook = await readStandaloneWorldbook(this.bridge, afterBook.name, {
        resourceId: afterBook.resourceId,
        writable: afterBook.writable,
      });
      if (!normalizedBook.roundTripSafe) throw new Error(`重命名世界书后无法重新读取：${afterBook.name}`);
      for (const beforeEntry of beforeBook.entries) {
        const copiedEntry = normalizedBook.entries.find(entry => entry.resourceId === beforeEntry.resourceId);
        if (
          !copiedEntry ||
          !canonicalEqual({ ...beforeEntry, uid: undefined }, { ...copiedEntry, uid: undefined })
        ) {
          throw new Error(`重命名世界书后条目复制不完整：${afterBook.name}/${beforeEntry.name}`);
        }
      }
      afterBook.entries = normalizedBook.entries;
      afterBook.unknownFields = normalizedBook.unknownFields;
      return undefined;
    }
    if (segments[2] === 'metadata') {
      throw new Error('世界书book.yaml的内部元数据只读；重命名世界书请移动整个目录。');
    }
    if (segments[2] === 'entries-order') {
      const order = new Map(afterBook.entries.map((entry, index) => [entry.resourceId, index]));
      await this.bridge.updateWorldbook(afterBook.name, entries =>
        [...entries].sort((left, right) => {
          const leftId = tavernEntryResourceId(bookId, left);
          const rightId = tavernEntryResourceId(bookId, right);
          return (order.get(leftId) ?? Number.MAX_SAFE_INTEGER) - (order.get(rightId) ?? Number.MAX_SAFE_INTEGER);
        }),
      );
      const normalizedBook = await readStandaloneWorldbook(this.bridge, afterBook.name, {
        resourceId: afterBook.resourceId,
        writable: afterBook.writable,
      });
      if (!normalizedBook.roundTripSafe) throw new Error(`调整世界书条目顺序后无法重新读取：${afterBook.name}`);
      afterBook.entries = normalizedBook.entries;
      return undefined;
    }
    const before = operation.before as WorldbookEntryData | undefined;
    const after = operation.after as WorldbookEntryData | undefined;
    if (!before && after) {
      await this.bridge.createWorldbookEntries(afterBook.name, [withResourceId(after)]);
      // createWorldbookEntries 不只分配 UID，还会补齐酒馆自身的隐式字段。
      // 必须使用完整回读结果规范化本次操作；若只替换 UID，最终校验会把这些合法默认值误判为写入漂移。
      const normalizedBook = await readStandaloneWorldbook(this.bridge, afterBook.name, {
        resourceId: afterBook.resourceId,
        writable: afterBook.writable,
      });
      const normalizedAfter = normalizedBook.entries.find(entry => entry.resourceId === after.resourceId);
      if (!normalizedBook.roundTripSafe || !normalizedAfter) {
        throw new Error(`创建世界书条目后无法重新读取：${afterBook.name}/${after.name}`);
      }
      return { ...operation, after: acceptHostNormalizedEntry(after, normalizedAfter, '创建世界书条目') };
    }
    if (before && !after) {
      const uid = entryUid(beforeBook.entries.find(entry => entry.resourceId === before.resourceId) ?? before);
      await this.bridge.updateWorldbook(afterBook.name, entries => entries.filter(entry => entry.uid !== uid));
      const normalizedBook = await readStandaloneWorldbook(this.bridge, afterBook.name, {
        resourceId: afterBook.resourceId,
        writable: afterBook.writable,
      });
      if (!normalizedBook.roundTripSafe) throw new Error(`删除世界书条目后无法重新读取：${afterBook.name}`);
      if (normalizedBook.entries.some(entry => entry.resourceId === before.resourceId)) {
        throw new Error(`删除世界书条目后目标仍然存在：${afterBook.name}/${before.name}`);
      }
      afterBook.entries = normalizedBook.entries;
      return undefined;
    }
    if (before && after) {
      const uid = entryUid(beforeBook.entries.find(entry => entry.resourceId === before.resourceId) ?? before);
      await this.bridge.updateWorldbook(afterBook.name, entries =>
        entries.map(entry => (entry.uid === uid ? { ...entry, ...withResourceId(after), uid: entry.uid } : entry)),
      );
      const normalizedBook = await readStandaloneWorldbook(this.bridge, afterBook.name, {
        resourceId: afterBook.resourceId,
        writable: afterBook.writable,
      });
      const normalizedAfter = normalizedBook.entries.find(entry => entry.resourceId === after.resourceId);
      if (!normalizedBook.roundTripSafe || !normalizedAfter) {
        throw new Error(`修改世界书条目后无法重新读取：${afterBook.name}/${after.name}`);
      }
      return { ...operation, after: acceptHostNormalizedEntry(after, normalizedAfter, '修改世界书条目') };
    }
    return undefined;
  }
}
