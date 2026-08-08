import { klona } from 'klona';
import { normalizeWorkspacePath, parentWorkspacePath, workspaceBasename } from '../workspace/path';
import { WorkspaceError, type WorkspaceFile } from '../workspace/types';
import {
  decodeWorkspaceSegment,
  encodeWorkspaceSegment,
  parseFrontmatter,
  parseKeyword,
  parseYamlObject,
  serializeFrontmatter,
  serializeKeyword,
  serializeYaml,
  slugifyFileName,
} from './serde';
import type {
  CardWorkspaceMaterialization,
  CardWorkspaceState,
  CharacterWorkspaceData,
  CharacterTextField,
  ReadonlyChatMessage,
  WorldbookData,
  WorldbookEntryData,
} from './types';

const CHARACTER_FILES: Record<CharacterTextField, string> = {
  creator_notes: '/character/creator-notes.md',
  description: '/character/description.md',
  mes_example: '/character/example-dialogue.md',
  personality: '/character/personality.md',
  post_history_instructions: '/character/post-history-instructions.md',
  scenario: '/character/scenario.md',
  system_prompt: '/character/system-prompt.md',
};

type GreetingIndexItem = { file: string; id: string; name: string };

function file(
  path: string,
  content: string,
  resourceId: string,
  readonly = false,
  mediaType: WorkspaceFile['mediaType'] = 'text/markdown',
): WorkspaceFile {
  return { content, mediaType, path: normalizeWorkspacePath(path), readonly, resourceId };
}

function worldbookDirectory(name: string, readonly: boolean): string {
  return `${readonly ? '/worldbooks-global-readonly' : '/worldbooks'}/${encodeWorkspaceSegment(name)}`;
}

function entryFileName(entry: WorldbookEntryData, index: number): string {
  const identity = typeof entry.uid === 'number' ? String(entry.uid) : entry.uid.slice(5, 13);
  return `${String(index + 1).padStart(4, '0')}-${identity}-${slugifyFileName(entry.name, 'entry')}.md`;
}

function entryMetadata(entry: WorldbookEntryData): Record<string, unknown> {
  return {
    effect: entry.effect,
    enabled: entry.enabled,
    extra: entry.extra ?? {},
    name: entry.name,
    position: entry.position,
    probability: entry.probability,
    recursion: entry.recursion,
    strategy: {
      ...entry.strategy,
      keys: entry.strategy.keys.map(serializeKeyword),
      keys_secondary: {
        ...entry.strategy.keys_secondary,
        keys: entry.strategy.keys_secondary.keys.map(serializeKeyword),
      },
    },
    uid: entry.uid,
    unknown_fields: entry.unknownFields,
  };
}

function projectWorldbook(book: WorldbookData, readonly: boolean): WorkspaceFile[] {
  const directory = worldbookDirectory(book.name, readonly);
  const files = [
    file(
      `${directory}/book.yaml`,
      serializeYaml({
        name: book.name,
        resource_id: book.resourceId,
        round_trip_safe: book.roundTripSafe,
        unknown_fields: book.unknownFields,
      }),
      `worldbook:${book.resourceId}:metadata`,
      readonly,
      'text/yaml',
    ),
  ];
  for (const [index, entry] of book.entries.entries()) {
    files.push(
      file(
        `${directory}/entries/${entryFileName(entry, index)}`,
        serializeFrontmatter(entryMetadata(entry), entry.content),
        entry.resourceId,
        readonly,
      ),
    );
  }
  return files;
}

function projectChat(messages: ReadonlyChatMessage[], pageSize: number): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  for (let offset = 0; offset < messages.length; offset += pageSize) {
    const page = messages.slice(offset, offset + pageSize);
    const first = page[0]!;
    const last = page.at(-1)!;
    const content = page
      .map(message =>
        serializeFrontmatter(
          { hidden: message.hidden, id: message.id, name: message.name, role: message.role },
          message.text,
        ),
      )
      .join('\n');
    files.push(
      file(
        `/context/chat/messages-${String(offset / pageSize + 1).padStart(4, '0')}.md`,
        content,
        `chat:${first.id}-${last.id}`,
        true,
      ),
    );
  }
  return files;
}

export function projectCardWorkspace(state: CardWorkspaceState, chatPageSize = 100): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  files.push(
    file(
      '/character/identity.yaml',
      serializeYaml({
        avatar_id: state.character.avatarId,
        binding_id: state.character.bindingId,
        name: state.character.name,
      }),
      'character:identity',
      true,
      'text/yaml',
    ),
  );
  for (const [field, path] of Object.entries(CHARACTER_FILES) as Array<[CharacterTextField, string]>) {
    files.push(file(path, state.character.fields[field], `character:${field}`));
  }
  files.push(
    file('/character/creator.md', state.character.creator, 'character:creator'),
    file('/character/version.md', state.character.version, 'character:version'),
    file('/character/tags.yaml', serializeYaml({ tags: state.character.tags }), 'character:tags', false, 'text/yaml'),
  );

  const greetingIndex: GreetingIndexItem[] = [];
  for (const [index, greeting] of state.character.greetings.entries()) {
    const name = `${String(index + 1).padStart(3, '0')}-${slugifyFileName(greeting.name, 'greeting')}.md`;
    greetingIndex.push({ file: name, id: greeting.id, name: greeting.name });
    files.push(file(`/greetings/${name}`, greeting.content, greeting.id));
  }
  files.push(
    file(
      '/greetings/index.yaml',
      serializeYaml({ greetings: greetingIndex }),
      'greetings:index',
      false,
      'text/yaml',
    ),
  );

  files.push(
    file(
      '/worldbooks/bindings.yaml',
      serializeYaml(state.bindings),
      'worldbooks:bindings',
      false,
      'text/yaml',
    ),
  );
  const globalNames = new Set(state.globalWorldbookNames);
  for (const book of state.worldbooks) {
    const readonly = !book.writable || !book.roundTripSafe || globalNames.has(book.name);
    files.push(...projectWorldbook(book, readonly));
  }
  files.push(...projectChat(state.chat, chatPageSize));
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function requiredString(value: unknown, label: string, path: string): string {
  if (typeof value !== 'string') {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是字符串：${path}`, path);
  }
  return value;
}

function requiredBoolean(value: unknown, label: string, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是布尔值：${path}`, path);
  }
  return value;
}

function requiredNumber(value: unknown, label: string, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是有限数字：${path}`, path);
  }
  return value;
}

function requiredRange(value: unknown, label: string, path: string, minimum: number, maximum: number): number {
  const number = requiredNumber(value, label, path);
  if (number < minimum || number > maximum) {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须在${minimum}到${maximum}之间：${path}`, path);
  }
  return number;
}

function requiredOneOf<const T extends string>(
  value: unknown,
  label: string,
  path: string,
  choices: readonly T[],
): T {
  const text = requiredString(value, label, path);
  if (!choices.includes(text as T)) {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是${choices.join('、')}之一：${path}`, path);
  }
  return text as T;
}

function optionalNullableNumber(value: unknown, label: string, path: string): number | null {
  return value === null ? null : requiredNumber(value, label, path);
}

function asRecord(value: unknown, label: string, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是对象：${path}`, path);
  }
  return value as Record<string, unknown>;
}

function findBaseEntry(base: CardWorkspaceState, resourceId: string): WorldbookEntryData | undefined {
  return base.worldbooks.flatMap(book => book.entries).find(entry => entry.resourceId === resourceId);
}

function parseEntry(input: WorkspaceFile, base: CardWorkspaceState): WorldbookEntryData {
  const { body, metadata } = parseFrontmatter(input.content, input.path);
  const strategy = asRecord(metadata.strategy, 'strategy', input.path);
  const secondary = asRecord(strategy.keys_secondary, 'strategy.keys_secondary', input.path);
  const position = asRecord(metadata.position, 'position', input.path);
  const recursion = asRecord(metadata.recursion, 'recursion', input.path);
  const effect = asRecord(metadata.effect, 'effect', input.path);
  const keys = Array.isArray(strategy.keys) ? strategy.keys.map(value => parseKeyword(value, input.path)) : undefined;
  const secondaryKeys = Array.isArray(secondary.keys)
    ? secondary.keys.map(value => parseKeyword(value, input.path))
    : undefined;
  if (!keys || !secondaryKeys) {
    throw new WorkspaceError('INVALID_PATCH', `世界书关键字必须是数组：${input.path}`, input.path);
  }
  const baseEntry = findBaseEntry(base, input.resourceId);
  const rawUid = metadata.uid;
  const uid = typeof rawUid === 'number' ? rawUid : `temp:${input.resourceId}` as const;
  return {
    ...(baseEntry ? klona(baseEntry) : {}),
    content: body,
    effect: {
      cooldown: optionalNullableNumber(effect.cooldown, 'effect.cooldown', input.path),
      delay: optionalNullableNumber(effect.delay, 'effect.delay', input.path),
      sticky: optionalNullableNumber(effect.sticky, 'effect.sticky', input.path),
    },
    enabled: requiredBoolean(metadata.enabled, 'enabled', input.path),
    extra: asRecord(metadata.extra ?? {}, 'extra', input.path),
    name: requiredString(metadata.name, 'name', input.path),
    position: {
      depth: requiredNumber(position.depth, 'position.depth', input.path),
      order: requiredNumber(position.order, 'position.order', input.path),
      role: requiredOneOf(position.role, 'position.role', input.path, ['assistant', 'system', 'user']),
      type: requiredOneOf(position.type, 'position.type', input.path, [
        'after_author_note',
        'after_character_definition',
        'after_example_messages',
        'at_depth',
        'before_author_note',
        'before_character_definition',
        'before_example_messages',
        'outlet',
      ]),
    },
    probability: requiredRange(metadata.probability, 'probability', input.path, 0, 100),
    recursion: {
      delay_until: optionalNullableNumber(recursion.delay_until, 'recursion.delay_until', input.path),
      prevent_incoming: requiredBoolean(recursion.prevent_incoming, 'recursion.prevent_incoming', input.path),
      prevent_outgoing: requiredBoolean(recursion.prevent_outgoing, 'recursion.prevent_outgoing', input.path),
    },
    resourceId: input.resourceId,
    strategy: {
      keys,
      keys_secondary: {
        keys: secondaryKeys,
        logic: requiredOneOf(secondary.logic, 'strategy.keys_secondary.logic', input.path, [
          'and_all',
          'and_any',
          'not_all',
          'not_any',
        ]),
      },
      scan_depth:
        strategy.scan_depth === 'same_as_global'
          ? 'same_as_global'
          : requiredNumber(strategy.scan_depth, 'strategy.scan_depth', input.path),
      type: requiredOneOf(strategy.type, 'strategy.type', input.path, ['constant', 'selective', 'vectorized']),
    },
    uid,
    unknownFields: asRecord(metadata.unknown_fields ?? baseEntry?.unknownFields ?? {}, 'unknown_fields', input.path),
  };
}

function materializeGreetings(
  base: CardWorkspaceState,
  files: Map<string, WorkspaceFile>,
  warnings: string[],
): CharacterWorkspaceData['greetings'] {
  const greetingFiles = [...files.values()].filter(
    item => parentWorkspacePath(item.path) === '/greetings' && item.path.endsWith('.md'),
  );
  const byId = new Map(greetingFiles.map(item => [item.resourceId, item]));
  const byName = new Map(greetingFiles.map(item => [workspaceBasename(item.path), item]));
  const indexFile = files.get('/greetings/index.yaml');
  const rawIndex = indexFile ? parseYamlObject(indexFile.content, indexFile.path).greetings : [];
  if (!Array.isArray(rawIndex)) {
    throw new WorkspaceError('INVALID_PATCH', 'greetings/index.yaml中的greetings必须是数组。', '/greetings/index.yaml');
  }
  const result: CharacterWorkspaceData['greetings'] = [];
  const used = new Set<string>();
  for (const rawItem of rawIndex) {
    const item = asRecord(rawItem, 'greeting index item', '/greetings/index.yaml');
    const id = requiredString(item.id, 'greeting.id', '/greetings/index.yaml');
    const indexedName = requiredString(item.name, 'greeting.name', '/greetings/index.yaml');
    const indexedFile = requiredString(item.file, 'greeting.file', '/greetings/index.yaml');
    const greeting = byId.get(id) ?? byName.get(indexedFile);
    if (!greeting) {
      warnings.push(`开场白索引引用了不存在的文件：${indexedFile}`);
      continue;
    }
    if (used.has(greeting.resourceId)) {
      throw new WorkspaceError('INVALID_PATCH', `开场白索引包含重复项：${indexedFile}`, '/greetings/index.yaml');
    }
    used.add(greeting.resourceId);
    result.push({ content: greeting.content, id: greeting.resourceId, name: indexedName });
  }
  for (const greeting of greetingFiles.sort((left, right) => left.path.localeCompare(right.path))) {
    if (!used.has(greeting.resourceId)) {
      const baseGreeting = base.character.greetings.find(item => item.id === greeting.resourceId);
      result.push({
        content: greeting.content,
        id: greeting.resourceId,
        name: baseGreeting?.name ?? workspaceBasename(greeting.path).replace(/^\d+-|\.md$/gu, ''),
      });
    }
  }
  return result;
}

function materializeBooks(base: CardWorkspaceState, files: Map<string, WorkspaceFile>): WorldbookData[] {
  const metadataFiles = [...files.values()].filter(
    item => item.path.startsWith('/worldbooks/') && item.path.endsWith('/book.yaml'),
  );
  const result: WorldbookData[] = [];
  for (const metadataFile of metadataFiles) {
    const metadata = parseYamlObject(metadataFile.content, metadataFile.path);
    const directory = parentWorkspacePath(metadataFile.path);
    const resourceId = requiredString(metadata.resource_id, 'resource_id', metadataFile.path);
    const baseBook = base.worldbooks.find(book => book.resourceId === resourceId);
    const name = decodeWorkspaceSegment(workspaceBasename(directory));
    const entries = [...files.values()]
      .filter(item => parentWorkspacePath(item.path) === `${directory}/entries` && item.path.endsWith('.md'))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(item => parseEntry(item, base));
    result.push({
      entries,
      name,
      resourceId,
      roundTripSafe: requiredBoolean(metadata.round_trip_safe ?? true, 'round_trip_safe', metadataFile.path),
      unknownFields: asRecord(metadata.unknown_fields ?? baseBook?.unknownFields ?? {}, 'unknown_fields', metadataFile.path),
      writable: true,
    });
  }
  for (const book of base.worldbooks.filter(item => !item.writable || !item.roundTripSafe)) {
    if (!result.some(item => item.resourceId === book.resourceId)) {
      result.push(klona(book));
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

function rewriteBindingNames(
  bindings: CardWorkspaceState['bindings'],
  base: CardWorkspaceState,
  books: WorldbookData[],
): CardWorkspaceState['bindings'] {
  const renames = new Map<string, string>();
  for (const book of books) {
    const before = base.worldbooks.find(item => item.resourceId === book.resourceId);
    if (before && before.name !== book.name) {
      renames.set(before.name, book.name);
    }
  }
  return {
    additional: bindings.additional.map(name => renames.get(name) ?? name),
    chat: bindings.chat === null ? null : renames.get(bindings.chat) ?? bindings.chat,
    primary: bindings.primary === null ? null : renames.get(bindings.primary) ?? bindings.primary,
  };
}

function removeDanglingBindings(
  bindings: CardWorkspaceState['bindings'],
  books: WorldbookData[],
  warnings: string[],
): CardWorkspaceState['bindings'] {
  const names = new Set(books.map(book => book.name));
  const missing = [bindings.primary, ...bindings.additional, bindings.chat].filter(
    (name): name is string => name !== null && !names.has(name),
  );
  if (missing.length > 0) {
    warnings.push(`已移除不存在世界书的绑定：${[...new Set(missing)].join('、')}`);
  }
  return {
    additional: bindings.additional.filter(name => names.has(name)),
    chat: bindings.chat !== null && names.has(bindings.chat) ? bindings.chat : null,
    primary: bindings.primary !== null && names.has(bindings.primary) ? bindings.primary : null,
  };
}

export function materializeCardWorkspace(
  base: CardWorkspaceState,
  inputs: Iterable<WorkspaceFile>,
): CardWorkspaceMaterialization {
  const files = new Map([...inputs].map(item => [normalizeWorkspacePath(item.path), item]));
  const state = klona(base);
  const warnings: string[] = [];
  for (const [field, path] of Object.entries(CHARACTER_FILES) as Array<[CharacterTextField, string]>) {
    const input = files.get(path);
    if (!input) {
      throw new WorkspaceError('NOT_FOUND', `角色字段文件不能删除：${path}`, path);
    }
    state.character.fields[field] = input.content;
  }
  state.character.creator = files.get('/character/creator.md')?.content ?? state.character.creator;
  state.character.version = files.get('/character/version.md')?.content ?? state.character.version;
  const tagsFile = files.get('/character/tags.yaml');
  if (tagsFile) {
    const tags = parseYamlObject(tagsFile.content, tagsFile.path).tags;
    if (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string')) {
      throw new WorkspaceError('INVALID_PATCH', 'character/tags.yaml中的tags必须是字符串数组。', tagsFile.path);
    }
    state.character.tags = tags;
  }
  state.character.greetings = materializeGreetings(base, files, warnings);
  state.character.extensions = klona(base.character.extensions);
  const books = materializeBooks(base, files);
  state.character.extensions.card_agent = {
    ...asRecord(state.character.extensions.card_agent ?? {}, 'extensions.card_agent', '/character'),
    binding_id: state.character.bindingId,
    greetings: state.character.greetings.map(({ id, name }) => ({ id, name })),
    worldbooks: books.map(({ name, resourceId }) => ({ id: resourceId, name })),
  };
  const bindingsFile = files.get('/worldbooks/bindings.yaml');
  if (!bindingsFile) {
    throw new WorkspaceError('NOT_FOUND', 'worldbooks/bindings.yaml不能删除。', '/worldbooks/bindings.yaml');
  }
  const rawBindings = parseYamlObject(bindingsFile.content, bindingsFile.path);
  const additional = rawBindings.additional;
  if (!Array.isArray(additional) || !additional.every(item => typeof item === 'string')) {
    throw new WorkspaceError('INVALID_PATCH', 'additional必须是字符串数组。', bindingsFile.path);
  }
  const parsedBindings = {
    additional,
    chat: rawBindings.chat === null ? null : requiredString(rawBindings.chat, 'chat', bindingsFile.path),
    primary: rawBindings.primary === null ? null : requiredString(rawBindings.primary, 'primary', bindingsFile.path),
  };
  state.bindings = removeDanglingBindings(rewriteBindingNames(parsedBindings, base, books), books, warnings);
  state.worldbooks = books;
  return { state, warnings };
}
