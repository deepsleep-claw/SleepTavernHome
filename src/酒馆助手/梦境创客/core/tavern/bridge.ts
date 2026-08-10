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
  getRawCharacter(): RawCharacterData | null;
  getRawRegexes(scope: TavernResourceScope): RawTavernRegex[];
  getRawScriptTrees(scope: TavernResourceScope): RawTavernScriptTree[];
  getWorldbook(name: string): Promise<TavernWorldbookEntry[]>;
  saveRawCharacter(character: RawCharacterData): Promise<void>;
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
  append(form, 'world', data.extensions?.world);
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
      (await createWorldbookEntries(name, entries as TypeFest.PartialDeep<WorldbookEntry>[])).new_entries as TavernWorldbookEntry[],
    deleteWorldbook: async name => {
      if (!(await deleteWorldbook(name))) throw new Error(`世界书删除失败：${name}`);
    },
    ensureCharacterLoaded: async () => {
      await getCharacter('current');
    },
    getCharacterBindings: () => getCharWorldbookNames('current'),
    getChatMessages: () => getChatMessages('0-{{lastMessageId}}'),
    getChatWorldbook: () => getChatWorldbookName('current'),
    getCurrentCharacterId: () => getCurrentCharacterId(),
    getCurrentCharacterName: () => getCurrentCharacterName(),
    getGlobalWorldbooks: () => getGlobalWorldbookNames(),
    getGroupId: () => SillyTavern.groupId,
    getLoadedPresetName: () => getLoadedPresetName(),
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
    setCharacterBindings: async bindings => rebindCharWorldbooks('current', bindings),
    setChatWorldbook: async name => setChatLorebook(name),
    updateWorldbook: async (name, updater) =>
      (await updateWorldbookWith(name, entries => updater(entries as TavernWorldbookEntry[]))) as TavernWorldbookEntry[],
  };
}
