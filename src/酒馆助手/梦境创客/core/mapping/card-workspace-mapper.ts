import { klona } from 'klona';
import { normalizeWorkspacePath, parentWorkspacePath, workspaceBasename } from '../workspace/path';
import { WorkspaceError, type WorkspaceFile } from '../workspace/types';
import { canonicalEqual } from '../transaction/canonical';
import {
  materializeTavernResources,
  projectTavernResources,
  type TavernResourceProjectionOptions,
} from './resource-workspace-mapper';
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

function worldbookDirectory(name: string, readonly: boolean, root?: string): string {
  const base = root ? normalizeWorkspacePath(root) : readonly ? '/worldbooks-global-readonly' : '/worldbooks';
  return `${base}/${encodeWorkspaceSegment(name)}`;
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

export function projectWorldbookFiles(
  book: WorldbookData,
  options: { readonly?: boolean; root?: string } = {},
): WorkspaceFile[] {
  const readonly = options.readonly ?? false;
  const directory = worldbookDirectory(book.name, readonly, options.root);
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

export function projectCardWorkspace(
  state: CardWorkspaceState,
  _chatPageSize = 100,
  resourceOptions: TavernResourceProjectionOptions = {},
): WorkspaceFile[] {
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
    files.push(...projectWorldbookFiles(book, { readonly }));
  }
  files.push(...projectTavernResources(state.resources, resourceOptions));
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

function optionalRecord(value: unknown, label: string, path: string): Record<string, unknown> {
  return value === undefined ? {} : asRecord(value, label, path);
}

function parseKeywordArray(
  value: unknown,
  fallback: WorldbookEntryData['strategy']['keys'],
  label: string,
  path: string,
): WorldbookEntryData['strategy']['keys'] {
  if (value === undefined) {
    return klona(fallback);
  }
  if (!Array.isArray(value)) {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是数组：${path}`, path);
  }
  return value.map(item => parseKeyword(item, path));
}

function entryNameFromPath(path: string): string {
  return workspaceBasename(path).replace(/\.md$/u, '') || '新条目';
}

function whenMissing(value: unknown, fallback: unknown): unknown {
  return value === undefined ? fallback : value;
}

/**
 * `extensions.card_agent` 是由梦境创客维护的派生索引，不属于 Agent 可编辑的工作区内容。
 * 每次只覆盖本脚本拥有的键，其余扩展字段必须原样保留。
 */
export function synchronizeCardAgentMetadata(state: CardWorkspaceState): void {
  const current = state.character.extensions.card_agent;
  const preserved = typeof current === 'object' && current !== null && !Array.isArray(current) ? klona(current) : {};
  state.character.extensions.card_agent = {
    ...preserved,
    binding_id: state.character.bindingId,
    greetings: state.character.greetings.map(({ id, name }) => ({ id, name })),
    worldbooks: state.worldbooks.map(({ name, resourceId }) => ({ id: resourceId, name })),
  };
}

function findBaseEntry(base: CardWorkspaceState, resourceId: string): WorldbookEntryData | undefined {
  return base.worldbooks.flatMap(book => book.entries).find(entry => entry.resourceId === resourceId);
}

function parseEntry(input: WorkspaceFile, base: CardWorkspaceState, entryIndex: number): WorldbookEntryData {
  const { body, metadata } = parseFrontmatter(input.content, input.path);
  const baseEntry = findBaseEntry(base, input.resourceId);
  // 投影会写出完整元数据，但 AI 新建条目时只要求 Frontmatter 存在。
  // 缺省字段对已有条目继承 Base，对新条目使用酒馆的安全常用值；显式提供的非法类型仍严格报错。
  const strategy = optionalRecord(metadata.strategy, 'strategy', input.path);
  const secondary = optionalRecord(strategy.keys_secondary, 'strategy.keys_secondary', input.path);
  const position = optionalRecord(metadata.position, 'position', input.path);
  const recursion = optionalRecord(metadata.recursion, 'recursion', input.path);
  const effect = optionalRecord(metadata.effect, 'effect', input.path);
  const keys = parseKeywordArray(strategy.keys, baseEntry?.strategy.keys ?? [], 'strategy.keys', input.path);
  const secondaryKeys = parseKeywordArray(
    secondary.keys,
    baseEntry?.strategy.keys_secondary.keys ?? [],
    'strategy.keys_secondary.keys',
    input.path,
  );
  const rawUid = metadata.uid;
  const uid = typeof rawUid === 'number' ? rawUid : (baseEntry?.uid ?? (`temp:${input.resourceId}` as const));
  return {
    ...(baseEntry ? klona(baseEntry) : {}),
    content: body,
    effect: {
      cooldown: optionalNullableNumber(
        whenMissing(effect.cooldown, baseEntry?.effect.cooldown ?? null),
        'effect.cooldown',
        input.path,
      ),
      delay: optionalNullableNumber(
        whenMissing(effect.delay, baseEntry?.effect.delay ?? null),
        'effect.delay',
        input.path,
      ),
      sticky: optionalNullableNumber(
        whenMissing(effect.sticky, baseEntry?.effect.sticky ?? null),
        'effect.sticky',
        input.path,
      ),
    },
    enabled: requiredBoolean(whenMissing(metadata.enabled, baseEntry?.enabled ?? true), 'enabled', input.path),
    extra: asRecord(whenMissing(metadata.extra, baseEntry?.extra ?? {}), 'extra', input.path),
    name: requiredString(
      whenMissing(metadata.name, baseEntry?.name ?? entryNameFromPath(input.path)),
      'name',
      input.path,
    ),
    position: {
      depth: requiredNumber(whenMissing(position.depth, baseEntry?.position.depth ?? 4), 'position.depth', input.path),
      order: requiredNumber(
        whenMissing(position.order, baseEntry?.position.order ?? 100 + entryIndex),
        'position.order',
        input.path,
      ),
      role: requiredOneOf(whenMissing(position.role, baseEntry?.position.role ?? 'system'), 'position.role', input.path, [
        'assistant',
        'system',
        'user',
      ]),
      type: requiredOneOf(
        whenMissing(position.type, baseEntry?.position.type ?? 'before_character_definition'),
        'position.type',
        input.path,
        [
          'after_author_note',
          'after_character_definition',
          'after_example_messages',
          'at_depth',
          'before_author_note',
          'before_character_definition',
          'before_example_messages',
          'outlet',
        ],
      ),
    },
    probability: requiredRange(
      whenMissing(metadata.probability, baseEntry?.probability ?? 100),
      'probability',
      input.path,
      0,
      100,
    ),
    recursion: {
      delay_until: optionalNullableNumber(
        whenMissing(recursion.delay_until, baseEntry?.recursion.delay_until ?? null),
        'recursion.delay_until',
        input.path,
      ),
      prevent_incoming: requiredBoolean(
        whenMissing(recursion.prevent_incoming, baseEntry?.recursion.prevent_incoming ?? false),
        'recursion.prevent_incoming',
        input.path,
      ),
      prevent_outgoing: requiredBoolean(
        whenMissing(recursion.prevent_outgoing, baseEntry?.recursion.prevent_outgoing ?? false),
        'recursion.prevent_outgoing',
        input.path,
      ),
    },
    resourceId: input.resourceId,
    strategy: {
      keys,
      keys_secondary: {
        keys: secondaryKeys,
        logic: requiredOneOf(
          whenMissing(secondary.logic, baseEntry?.strategy.keys_secondary.logic ?? 'and_any'),
          'strategy.keys_secondary.logic',
          input.path,
          ['and_all', 'and_any', 'not_all', 'not_any'],
        ),
      },
      scan_depth: whenMissing(strategy.scan_depth, baseEntry?.strategy.scan_depth ?? 'same_as_global') === 'same_as_global'
          ? 'same_as_global'
          : requiredNumber(
              whenMissing(strategy.scan_depth, baseEntry?.strategy.scan_depth),
              'strategy.scan_depth',
              input.path,
            ),
      type: requiredOneOf(
        whenMissing(strategy.type, baseEntry?.strategy.type ?? (keys.length > 0 ? 'selective' : 'constant')),
        'strategy.type',
        input.path,
        ['constant', 'selective', 'vectorized'],
      ),
    },
    uid,
    unknownFields: asRecord(
      whenMissing(metadata.unknown_fields, baseEntry?.unknownFields ?? {}),
      'unknown_fields',
      input.path,
    ),
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
    const projectedResourceId = metadataFile.resourceId.match(/^worldbook:(.*):metadata$/u)?.[1];
    const baseBook = base.worldbooks.find(book => book.resourceId === (projectedResourceId ?? resourceId));
    if (baseBook) {
      const changedInternalMetadata =
        resourceId !== baseBook.resourceId ||
        (metadata.name !== undefined && metadata.name !== baseBook.name) ||
        (metadata.round_trip_safe !== undefined && metadata.round_trip_safe !== baseBook.roundTripSafe) ||
        (metadata.unknown_fields !== undefined && !canonicalEqual(metadata.unknown_fields, baseBook.unknownFields));
      if (changedInternalMetadata) {
        throw new WorkspaceError(
          'READ_ONLY_PATH',
          `book.yaml中的resource_id、name、round_trip_safe和unknown_fields是只读元数据；重命名世界书请移动整个目录：${metadataFile.path}`,
          metadataFile.path,
        );
      }
    }
    const name = decodeWorkspaceSegment(workspaceBasename(directory));
    const entries = [...files.values()]
      .filter(item => parentWorkspacePath(item.path) === `${directory}/entries` && item.path.endsWith('.md'))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((item, index) => parseEntry(item, base, index));
    result.push({
      entries,
      name,
      resourceId,
      roundTripSafe: baseBook?.roundTripSafe ?? requiredBoolean(metadata.round_trip_safe ?? true, 'round_trip_safe', metadataFile.path),
      unknownFields: klona(
        baseBook?.unknownFields ?? asRecord(metadata.unknown_fields ?? {}, 'unknown_fields', metadataFile.path),
      ),
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
  state.resources = materializeTavernResources(base, files.values());
  state.worldbooks = books;
  synchronizeCardAgentMetadata(state);
  return { state, warnings };
}
