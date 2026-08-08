import { klona } from 'klona';

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
  getRawCharacter(): RawCharacterData | null;
  getWorldbook(name: string): Promise<TavernWorldbookEntry[]>;
  saveRawCharacter(character: RawCharacterData): Promise<void>;
  setCharacterBindings(bindings: CharWorldbooks): Promise<void>;
  setChatWorldbook(name: string | null): Promise<void>;
  updateWorldbook(
    name: string,
    updater: (entries: TavernWorldbookEntry[]) => TavernWorldbookEntry[],
  ): Promise<TavernWorldbookEntry[]>;
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
    getRawCharacter: () => getCharData('current') as RawCharacterData | null,
    getWorldbook: async name => (await getWorldbook(name)) as TavernWorldbookEntry[],
    saveRawCharacter,
    setCharacterBindings: async bindings => rebindCharWorldbooks('current', bindings),
    setChatWorldbook: async name => setChatLorebook(name),
    updateWorldbook: async (name, updater) =>
      (await updateWorldbookWith(name, entries => updater(entries as TavernWorldbookEntry[]))) as TavernWorldbookEntry[],
  };
}
