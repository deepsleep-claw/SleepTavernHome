import { klona } from 'klona';
import type { TavernResourceScope } from '../mapping/types';

export type RawCharacterData = {
  avatar: string;
  chat?: string;
  create_date?: string;
  creatorcomment?: string;
  data: {
    alternate_greetings?: string[];
    character_version?: string;
    creator?: string;
    creator_notes?: string;
    description?: string;
    extensions?: Record<string, unknown>;
    first_mes?: string;
    mes_example?: string;
    name?: string;
    personality?: string;
    post_history_instructions?: string;
    scenario?: string;
    system_prompt?: string;
    tags?: string[];
    [key: string]: unknown;
  };
  description?: string;
  fav?: boolean | string;
  first_mes?: string;
  json_data?: string;
  mes_example?: string;
  name: string;
  personality?: string;
  scenario?: string;
  tags?: string[];
  talkativeness?: number;
  [key: string]: unknown;
};

export type TavernWorldbookEntry = WorldbookEntry & Record<string, unknown>;

export type RawTavernRegex = {
  disabled?: boolean;
  findRegex?: string;
  id?: string;
  markdownOnly?: boolean;
  maxDepth?: number | null;
  minDepth?: number | null;
  placement?: number[] | null;
  promptOnly?: boolean;
  replaceString?: string;
  runOnEdit?: boolean;
  scriptName?: string;
  substituteRegex?: number;
  trimStrings?: string[];
  [key: string]: unknown;
};

export type RawTavernScriptTree = ScriptTree & Record<string, unknown>;

export type TavernCharacterSummary = {
  avatarId: string;
  index: number;
  name: string;
};

export interface TavernBridge {
  createWorldbook(name: string): Promise<void>;
  createWorldbookEntries(name: string, entries: Partial<TavernWorldbookEntry>[]): Promise<TavernWorldbookEntry[]>;
  deleteWorldbook(name: string): Promise<void>;
  ensureCharacterLoaded(): Promise<void>;
  getCharacterBindings(): CharWorldbooks;
  getChatMessages(): ChatMessage[];
  getChatWorldbook(): string | null;
  getCurrentCharacterId(): string | null;
  getCurrentCharacterName(): string | null;
  getGlobalWorldbooks(): string[];
  getGroupId(): string;
  getLoadedPresetName(): string;
  getWorldbookNames(): string[];
  listCharacters(): TavernCharacterSummary[];
  getRawCharacter(): RawCharacterData | null;
  getRawRegexes(scope: TavernResourceScope): RawTavernRegex[];
  getRawScriptTrees(scope: TavernResourceScope): RawTavernScriptTree[];
  getWorldbook(name: string): Promise<TavernWorldbookEntry[]>;
  saveRawCharacter(character: RawCharacterData): Promise<void>;
  selectCharacterById(index: number): Promise<void>;
  replaceRawRegexes(scope: TavernResourceScope, regexes: RawTavernRegex[]): Promise<void>;
  replaceRawScriptTrees(scope: TavernResourceScope, trees: RawTavernScriptTree[]): Promise<void>;
  setCharacterBindings(bindings: CharWorldbooks): Promise<void>;
  setChatWorldbook(name: string | null): Promise<void>;
  updateWorldbook(
    name: string,
    updater: (entries: TavernWorldbookEntry[]) => TavernWorldbookEntry[],
  ): Promise<TavernWorldbookEntry[]>;
}

function scriptScope(scope: TavernResourceScope): ScriptTreesOptions['type'] {
  return scope === 'preset-current' ? 'preset' : scope;
}

async function refreshRegexDisplay(): Promise<void> {
  const context = SillyTavern;
  await context.saveSettingsDebounced();
  await context.eventSource.emit(context.eventTypes.CHAT_CHANGED, context.chatId);
}

function append(form: FormData, key: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    form.append(key, typeof value === 'string' ? value : String(value));
  }
}

async function saveRawCharacter(character: RawCharacterData): Promise<void> {
  const raw = klona(character);
  delete raw.json_data;
  const data = raw.data;
  const form = new FormData();
  append(form, 'ch_name', raw.name);
  append(form, 'avatar_url', raw.avatar);
  append(form, 'chat', raw.chat);
  append(form, 'create_date', raw.create_date);
  append(form, 'description', data.description ?? raw.description ?? '');
  append(form, 'personality', data.personality ?? raw.personality ?? '');
  append(form, 'scenario', data.scenario ?? raw.scenario ?? '');
  append(form, 'first_mes', data.first_mes ?? raw.first_mes ?? '');
  append(form, 'mes_example', data.mes_example ?? raw.mes_example ?? '');
  append(form, 'creator_notes', data.creator_notes ?? raw.creatorcomment ?? '');
  append(form, 'system_prompt', data.system_prompt ?? '');
  append(form, 'post_history_instructions', data.post_history_instructions ?? '');
  append(form, 'creator', data.creator ?? '');
  append(form, 'character_version', data.character_version ?? '');
  append(form, 'talkativeness', raw.talkativeness ?? (data.extensions?.talkativeness as number | undefined));
  append(form, 'fav', raw.fav ?? data.extensions?.fav);
  append(form, 'tags', (data.tags ?? raw.tags ?? []).join(','));
  append(form, 'extensions', JSON.stringify(data.extensions ?? {}));
  append(form, 'json_data', JSON.stringify(raw));
  for (const greeting of data.alternate_greetings ?? []) {
    form.append('alternate_greetings', greeting);
  }
  const headers = { ...SillyTavern.getRequestHeaders() } as Record<string, string>;
  delete headers['Content-Type'];
  const response = await fetch('/api/characters/edit', { body: form, cache: 'no-cache', headers, method: 'POST' });
  if (!response.ok) {
    throw new Error(`角色卡写入失败：(${response.status}) ${await response.text()}`);
  }
  await SillyTavern.getCharacters();
}

export function createGlobalTavernBridge(): TavernBridge {
  return {
    createWorldbook: async name => {
      if (!(await createWorldbook(name))) throw new Error(`世界书已存在：${name}`);
    },
    createWorldbookEntries: async (name, entries) =>
      (await createWorldbookEntries(name, entries as TypeFest.PartialDeep<WorldbookEntry>[]))
        .new_entries as TavernWorldbookEntry[],
    deleteWorldbook: async name => {
      if (!(await deleteWorldbook(name))) throw new Error(`世界书删除失败：${name}`);
    },
    ensureCharacterLoaded: async () => {
      await getCharacter('current');
    },
    getCharacterBindings: () => getCharWorldbookNames('current'),
    getChatMessages: () => getChatMessages('0-{{lastMessageId}}'),
    getChatWorldbook: () => getChatWorldbookName('current'),
    getCurrentCharacterId: () => (typeof getCurrentCharacterId === 'function' ? getCurrentCharacterId() : null),
    getCurrentCharacterName: () => (typeof getCurrentCharacterName === 'function' ? getCurrentCharacterName() : null),
    getGlobalWorldbooks: () => getGlobalWorldbookNames(),
    getGroupId: () => (typeof SillyTavern === 'undefined' ? '' : SillyTavern.groupId),
    getLoadedPresetName: () => getLoadedPresetName(),
    getWorldbookNames: () => getWorldbookNames(),
    listCharacters: () =>
      (typeof SillyTavern === 'undefined' ? [] : (SillyTavern.characters ?? [])).map((character, index) => ({
        avatarId: String(character.avatar ?? ''),
        index,
        name: String(character.name ?? ''),
      })),
    getRawCharacter: () => getCharData('current') as RawCharacterData | null,
    getRawRegexes: scope => {
      const context = SillyTavern;
      if (scope === 'character') {
        const raw = getCharData('current') as RawCharacterData | null;
        const value = raw?.data.extensions?.regex_scripts;
        return klona(Array.isArray(value) ? value : []) as RawTavernRegex[];
      }
      const value =
        scope === 'global'
          ? context.extensionSettings.regex
          : context.chatCompletionSettings?.extensions?.regex_scripts;
      return klona(Array.isArray(value) ? value : []) as RawTavernRegex[];
    },
    getRawScriptTrees: scope => {
      if (typeof getScriptTrees !== 'function') throw new Error('当前酒馆助手不提供脚本树接口。');
      return klona(getScriptTrees({ type: scriptScope(scope) })) as RawTavernScriptTree[];
    },
    getWorldbook: async name => (await getWorldbook(name)) as TavernWorldbookEntry[],
    saveRawCharacter,
    selectCharacterById: async index => {
      await SillyTavern.selectCharacterById(index, { switchMenu: false });
    },
    replaceRawRegexes: async (scope, regexes) => {
      const context = SillyTavern;
      const value = klona(regexes);
      if (scope === 'character') {
        const raw = getCharData('current') as RawCharacterData | null;
        if (!raw) throw new Error('写入角色正则前无法重新读取角色卡。');
        raw.data.extensions ??= {};
        raw.data.extensions.regex_scripts = value;
        await saveRawCharacter(raw);
      } else if (scope === 'global') {
        context.extensionSettings.regex = value;
      } else {
        context.chatCompletionSettings.extensions ??= {};
        context.chatCompletionSettings.extensions.regex_scripts = value;
      }
      await refreshRegexDisplay();
    },
    replaceRawScriptTrees: async (scope, trees) => {
      if (typeof replaceScriptTrees !== 'function') throw new Error('当前酒馆助手不提供脚本树接口。');
      replaceScriptTrees(klona(trees), { type: scriptScope(scope) });
      await SillyTavern.saveSettingsDebounced();
    },
    setCharacterBindings: async bindings => {
      const available = new Set(getWorldbookNames());
      const missing = [bindings.primary, ...bindings.additional].filter(
        (name): name is string => typeof name === 'string' && !available.has(name),
      );
      if (missing.length > 0) throw new Error(`无法绑定不存在的世界书：${missing.join('、')}`);

      const current = getCharWorldbookNames('current');
      const raw = getCharData('current') as RawCharacterData | null;
      if (!raw) throw new Error('绑定世界书前无法重新读取角色卡。');
      const embedded = raw.data.character_book;
      const embeddedName =
        typeof embedded === 'object' && embedded !== null && 'name' in embedded
          ? (embedded as { name?: unknown }).name
          : undefined;
      const mirroredEmbeddedBook = Boolean(bindings.primary && embeddedName === bindings.primary);

      if (current.primary !== bindings.primary || mirroredEmbeddedBook) {
        raw.data.extensions ??= {};
        raw.data.extensions.world = bindings.primary ?? '';
        // SillyTavern 会在角色编辑表单携带 `world` 时生成同名 character_book 副本。
        // 梦境创客绑定的是外部世界书；若发现这种同名镜像则一并清掉，避免再次提示导入并覆盖外部书。
        if (mirroredEmbeddedBook) delete raw.data.character_book;
        await saveRawCharacter(raw);
      }

      if (JSON.stringify(current.additional) !== JSON.stringify(bindings.additional)) {
        // 酒馆助手的实现运行时接受 Partial<CharWorldbooks>；只交给它维护附加绑定，
        // 避免其 primary 分支再次走会自动嵌入世界书的角色编辑表单。
        await rebindCharWorldbooks('current', { additional: bindings.additional } as CharWorldbooks);
      }
    },
    setChatWorldbook: async name => setChatLorebook(name),
    updateWorldbook: async (name, updater) =>
      (await updateWorldbookWith(name, entries =>
        updater(entries as TavernWorldbookEntry[]),
      )) as TavernWorldbookEntry[],
  };
}
