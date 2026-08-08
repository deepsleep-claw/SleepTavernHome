import { klona } from 'klona';
import type { CardWorkspaceState, WorldbookData, WorldbookEntryData } from '../mapping/types';
import { canonicalEqual } from './canonical';

export type StateOperationKind = 'create' | 'delete' | 'modify' | 'reorder';

export type StateOperation = {
  after?: unknown;
  before?: unknown;
  highRisk: boolean;
  kind: StateOperationKind;
  label: string;
  path: string;
};

function escapePath(value: string): string {
  return value.replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function unescapePath(value: string): string {
  return value.replace(/~1/gu, '/').replace(/~0/gu, '~');
}

function operation(
  path: string,
  label: string,
  before: unknown,
  after: unknown,
  kind: StateOperationKind = before === undefined ? 'create' : after === undefined ? 'delete' : 'modify',
  highRisk = false,
): StateOperation | undefined {
  return canonicalEqual(before, after) ? undefined : { after: klona(after), before: klona(before), highRisk, kind, label, path };
}

function pushOperation(target: StateOperation[], candidate: StateOperation | undefined): void {
  if (candidate) {
    target.push(candidate);
  }
}

function diffIdentified<T>(
  before: T[],
  after: T[],
  root: string,
  identity: (item: T) => string,
  label: (item: T) => string,
  target: StateOperation[],
  highRiskDelete = false,
): void {
  const beforeById = new Map(before.map(item => [identity(item), item]));
  const afterById = new Map(after.map(item => [identity(item), item]));
  for (const item of before) {
    const id = identity(item);
    if (!afterById.has(id)) {
      pushOperation(
        target,
        operation(`${root}/${escapePath(id)}`, `删除${label(item)}`, item, undefined, 'delete', highRiskDelete),
      );
    }
  }
  for (const item of after) {
    const id = identity(item);
    const previous = beforeById.get(id);
    if (!previous) {
      pushOperation(target, operation(`${root}/${escapePath(id)}`, `新增${label(item)}`, undefined, item));
    }
  }
}

function diffWorldbook(before: WorldbookData, after: WorldbookData, target: StateOperation[]): void {
  const root = `/worldbooks/${escapePath(before.resourceId)}`;
  pushOperation(target, operation(`${root}/name`, `重命名世界书“${before.name}”`, before.name, after.name));
  pushOperation(
    target,
    operation(
      `${root}/metadata`,
      `修改世界书“${after.name}”元数据`,
      { roundTripSafe: before.roundTripSafe, unknownFields: before.unknownFields, writable: before.writable },
      { roundTripSafe: after.roundTripSafe, unknownFields: after.unknownFields, writable: after.writable },
    ),
  );
  diffIdentified(before.entries, after.entries, `${root}/entries`, item => item.resourceId, item => `条目“${item.name}”`, target);
  const beforeById = new Map(before.entries.map(item => [item.resourceId, item]));
  for (const entry of after.entries) {
    const previous = beforeById.get(entry.resourceId);
    if (previous) {
      pushOperation(
        target,
        operation(`${root}/entries/${escapePath(entry.resourceId)}`, `修改条目“${entry.name}”`, previous, entry),
      );
    }
  }
  const beforeOrder = before.entries.map(entry => entry.resourceId);
  const afterOrder = after.entries.map(entry => entry.resourceId);
  pushOperation(target, operation(`${root}/entries-order`, `调整世界书“${after.name}”条目顺序`, beforeOrder, afterOrder, 'reorder'));
}

export function diffCardStates(before: CardWorkspaceState, after: CardWorkspaceState): StateOperation[] {
  const result: StateOperation[] = [];
  for (const field of Object.keys(before.character.fields) as Array<keyof CardWorkspaceState['character']['fields']>) {
    pushOperation(
      result,
      operation(
        `/character/fields/${field}`,
        `修改角色字段 ${field}`,
        before.character.fields[field],
        after.character.fields[field],
      ),
    );
  }
  for (const field of ['creator', 'version', 'tags'] as const) {
    pushOperation(
      result,
      operation(`/character/${field}`, `修改角色${field}`, before.character[field], after.character[field]),
    );
  }
  pushOperation(
    result,
    operation(
      '/character/extensions/card_agent',
      '更新梦境创客角色元数据',
      before.character.extensions.card_agent,
      after.character.extensions.card_agent,
    ),
  );
  diffIdentified(
    before.character.greetings,
    after.character.greetings,
    '/character/greetings',
    item => item.id,
    item => `开场白“${item.name}”`,
    result,
  );
  const beforeGreetingById = new Map(before.character.greetings.map(item => [item.id, item]));
  for (const greeting of after.character.greetings) {
    const previous = beforeGreetingById.get(greeting.id);
    if (previous) {
      pushOperation(
        result,
        operation(`/character/greetings/${escapePath(greeting.id)}`, `修改开场白“${greeting.name}”`, previous, greeting),
      );
    }
  }
  const beforeGreetingOrder = before.character.greetings.map(item => item.id);
  const afterGreetingOrder = after.character.greetings.map(item => item.id);
  const clearsAllGreetings = beforeGreetingOrder.length > 0 && afterGreetingOrder.length === 0;
  pushOperation(
    result,
    operation(
      '/character/greetings-order',
      '调整开场白顺序',
      beforeGreetingOrder,
      afterGreetingOrder,
      'reorder',
      clearsAllGreetings,
    ),
  );

  diffIdentified(
    before.worldbooks,
    after.worldbooks,
    '/worldbooks',
    item => item.resourceId,
    item => `世界书“${item.name}”`,
    result,
    true,
  );
  const beforeBookById = new Map(before.worldbooks.map(item => [item.resourceId, item]));
  for (const book of after.worldbooks) {
    const previous = beforeBookById.get(book.resourceId);
    if (previous) {
      diffWorldbook(previous, book, result);
    }
  }
  for (const field of ['primary', 'additional', 'chat'] as const) {
    pushOperation(
      result,
      operation(`/bindings/${field}`, `修改${field}世界书绑定`, before.bindings[field], after.bindings[field], 'modify', true),
    );
  }

  const deletedEntries = result.filter(item => item.kind === 'delete' && item.path.includes('/entries/'));
  const originalEntryCount = before.worldbooks.reduce((total, book) => total + book.entries.length, 0);
  if (deletedEntries.length >= 10 || (originalEntryCount > 0 && deletedEntries.length / originalEntryCount >= 0.5)) {
    deletedEntries.forEach(item => {
      item.highRisk = true;
    });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function findBook(state: CardWorkspaceState, id: string): WorldbookData | undefined {
  return state.worldbooks.find(book => book.resourceId === id);
}

function findEntry(book: WorldbookData | undefined, id: string): WorldbookEntryData | undefined {
  return book?.entries.find(entry => entry.resourceId === id);
}

export function readStatePath(state: CardWorkspaceState, path: string): unknown {
  const segments = path.split('/').slice(1).map(unescapePath);
  if (segments[0] === 'character') {
    if (segments[1] === 'fields') return state.character.fields[segments[2] as keyof typeof state.character.fields];
    if (segments[1] === 'creator' || segments[1] === 'version' || segments[1] === 'tags') return state.character[segments[1]];
    if (segments[1] === 'extensions' && segments[2] === 'card_agent') return state.character.extensions.card_agent;
    if (segments[1] === 'greetings-order') return state.character.greetings.map(item => item.id);
    if (segments[1] === 'greetings') return state.character.greetings.find(item => item.id === segments[2]);
  }
  if (segments[0] === 'worldbooks') {
    const book = findBook(state, segments[1]);
    if (segments.length === 2) return book;
    if (segments[2] === 'name') return book?.name;
    if (segments[2] === 'metadata') {
      return book
        ? { roundTripSafe: book.roundTripSafe, unknownFields: book.unknownFields, writable: book.writable }
        : undefined;
    }
    if (segments[2] === 'entries-order') return book?.entries.map(item => item.resourceId);
    if (segments[2] === 'entries') return findEntry(book, segments[3]);
  }
  if (segments[0] === 'bindings') return state.bindings[segments[1] as keyof typeof state.bindings];
  return undefined;
}

function replaceIdentified<T>(items: T[], identity: (item: T) => string, id: string, value: T | undefined): void {
  const index = items.findIndex(item => identity(item) === id);
  if (value === undefined) {
    if (index >= 0) items.splice(index, 1);
  } else if (index >= 0) {
    items[index] = klona(value);
  } else {
    items.push(klona(value));
  }
}

function reorder<T>(items: T[], identity: (item: T) => string, order: string[]): T[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((left, right) => (positions.get(identity(left)) ?? Number.MAX_SAFE_INTEGER) - (positions.get(identity(right)) ?? Number.MAX_SAFE_INTEGER));
}

export function applyStateOperation(state: CardWorkspaceState, input: StateOperation, side: 'after' | 'before' = 'after'): void {
  const value = klona(input[side]);
  const segments = input.path.split('/').slice(1).map(unescapePath);
  if (segments[0] === 'character') {
    if (segments[1] === 'fields') state.character.fields[segments[2] as keyof typeof state.character.fields] = value as string;
    else if (segments[1] === 'creator' || segments[1] === 'version') state.character[segments[1]] = value as string;
    else if (segments[1] === 'tags') state.character.tags = value as string[];
    else if (segments[1] === 'extensions') state.character.extensions.card_agent = value;
    else if (segments[1] === 'greetings-order') {
      state.character.greetings = reorder(state.character.greetings, item => item.id, value as string[]);
    } else if (segments[1] === 'greetings') {
      replaceIdentified(state.character.greetings, item => item.id, segments[2], value as CardWorkspaceState['character']['greetings'][number]);
    }
    return;
  }
  if (segments[0] === 'worldbooks') {
    if (segments.length === 2) {
      replaceIdentified(state.worldbooks, item => item.resourceId, segments[1], value as WorldbookData | undefined);
      return;
    }
    const book = findBook(state, segments[1]);
    if (!book) return;
    if (segments[2] === 'name') book.name = value as string;
    else if (segments[2] === 'metadata') Object.assign(book, value);
    else if (segments[2] === 'entries-order') book.entries = reorder(book.entries, item => item.resourceId, value as string[]);
    else if (segments[2] === 'entries') {
      replaceIdentified(book.entries, item => item.resourceId, segments[3], value as WorldbookEntryData | undefined);
    }
    return;
  }
  if (segments[0] === 'bindings') {
    Object.assign(state.bindings, { [segments[1]]: value });
  }
}

export function applyStateOperations(state: CardWorkspaceState, operations: StateOperation[]): CardWorkspaceState {
  const next = klona(state);
  [...operations]
    .sort((left, right) => Number(left.kind === 'reorder') - Number(right.kind === 'reorder'))
    .forEach(item => applyStateOperation(next, item));
  return next;
}

export function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
