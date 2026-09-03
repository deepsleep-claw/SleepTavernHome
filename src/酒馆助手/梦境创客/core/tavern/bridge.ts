import { klona } from 'klona';
import type { PartialDeep } from 'type-fest';
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

export type TavernPersonaData = Persona;
export type TavernPresetData = Preset;

export interface TavernBridge {
  closeCurrentChat(): Promise<void>;
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
  getPreset(name: 'in_use' | string): TavernPresetData;
  getPresetNames(): string[];
  getCurrentPersonaId(): string | null;
  getCurrentPersonaName(): string | null;
  getPersona(name: 'current' | string): TavernPersonaData;
  getPersonaAvatarPath(name: 'current' | string): string | null;
  getPersonaNames(): string[];
  getCharacterAvatarPath(): string | null;
  getWorldbookNames(): string[];
  listCharacters(): TavernCharacterSummary[];
  getRawCharacter(): RawCharacterData | null;
  getRawRegexes(scope: TavernResourceScope): RawTavernRegex[];
  getRawScriptTrees(scope: TavernResourceScope): RawTavernScriptTree[];
  getWorldbook(name: string): Promise<TavernWorldbookEntry[]>;
  saveRawCharacter(character: RawCharacterData): Promise<void>;
  createPersona(name: string, persona?: Partial<TavernPersonaData>): Promise<void>;
  deletePersona(name: string): Promise<void>;
  replacePersona(name: string, persona: Partial<TavernPersonaData>): Promise<void>;
  loadPreset(name: string): Promise<void>;
  replacePreset(name: 'in_use' | string, preset: TavernPresetData): Promise<void>;
  createPreset(name: string, preset: TavernPresetData, overwrite?: boolean): Promise<void>;
  setCharacterAvatar(bytes: Uint8Array, mediaType: string): Promise<void>;
  setPersonaAvatar(name: string, bytes: Uint8Array, mediaType: string): Promise<void>;
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

function allowCurrentCharacterRegexes(): void {
  const context = SillyTavern;
  const avatar = (getCharData('current') as RawCharacterData | null)?.avatar;
  if (!avatar) return;

  const settings = context.extensionSettings as typeof context.extensionSettings & {
    character_allowed_regex?: string[];
  };
  settings.character_allowed_regex ??= [];
  if (!settings.character_allowed_regex.includes(avatar)) {
    settings.character_allowed_regex.push(avatar);
  }
}

async function saveRawCharacter(character: RawCharacterData): Promise<void> {
  const raw = klona(character);
  delete raw.json_data;
  const current = getCharData('current') as RawCharacterData | null;
  if (current?.data.character_book !== undefined && raw.data.character_book === undefined) {
    // merge-attributes 使用显式哨兵删除字段；这用于清理由旧的 primary 绑定流程生成的内嵌镜像。
    raw.data.character_book = '__@@UNSET@@__';
  }

  // /api/characters/edit 会根据缺省表单字段重置 world/depth_prompt，并在携带 world 时
  // 额外生成 character_book 镜像。部分合并接口可以原样保存完整角色数据，避免这两种副作用。
  const response = await fetch('/api/characters/merge-attributes', {
    body: JSON.stringify(raw),
    cache: 'no-cache',
    headers: SillyTavern.getRequestHeaders(),
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`角色卡写入失败：(${response.status}) ${await response.text()}`);
  }
  await SillyTavern.getCharacters();
}

export function createGlobalTavernBridge(): TavernBridge {
  return {
    closeCurrentChat: async () => {
      if (typeof document === 'undefined') throw new Error('当前环境无法关闭酒馆聊天。');
      const button = [...document.querySelectorAll<HTMLElement>('#option_close_chat')].find(
        item => item.offsetParent !== null,
      );
      if (!button) throw new Error('酒馆没有提供可用的关闭聊天入口。');
      button.click();
      const started = Date.now();
      while (getCurrentCharacterId() !== null && Date.now() - started < 5_000) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (getCurrentCharacterId() !== null) throw new Error('酒馆未能关闭当前聊天；请先停止正在进行的生成。');
    },
    createWorldbook: async name => {
      if (!(await createWorldbook(name))) throw new Error(`世界书已存在：${name}`);
    },
    createWorldbookEntries: async (name, entries) =>
      (await createWorldbookEntries(name, entries as PartialDeep<WorldbookEntry>[]))
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
    getLoadedPresetName: () => (typeof getLoadedPresetName === 'function' ? getLoadedPresetName() : ''),
    getPreset: name => {
      if (typeof getPreset !== 'function') throw new Error('当前酒馆助手版本不提供预设读取接口。');
      return klona(getPreset(name));
    },
    getPresetNames: () => (typeof getPresetNames === 'function' ? getPresetNames() : []),
    getCurrentPersonaId: () => (typeof getCurrentPersonaId === 'function' ? getCurrentPersonaId() : null),
    getCurrentPersonaName: () => (typeof getCurrentPersonaName === 'function' ? getCurrentPersonaName() : null),
    getPersona: name => {
      if (typeof getPersona !== 'function') throw new Error('当前酒馆助手版本不提供User Persona读取接口。');
      return klona(getPersona(name));
    },
    getPersonaAvatarPath: name =>
      typeof getPersonaAvatarPath === 'function' ? getPersonaAvatarPath(name) : null,
    getPersonaNames: () => (typeof getPersonaNames === 'function' ? getPersonaNames() : []),
    getCharacterAvatarPath: () => (typeof getCharAvatarPath === 'function' ? getCharAvatarPath('current') : null),
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
    createPersona: async (name, persona) => {
      if (typeof createPersona !== 'function') throw new Error('当前酒馆助手版本不提供User Persona写入接口。');
      if (!(await createPersona(name, persona, { render: 'immediate' }))) throw new Error(`User已存在：${name}`);
    },
    deletePersona: async name => {
      if (typeof deletePersona !== 'function') throw new Error('当前酒馆助手版本不提供User Persona删除接口。');
      if (!(await deletePersona(name))) throw new Error(`删除User失败：${name}`);
    },
    replacePersona: async (name, persona) => {
      if (typeof replacePersona !== 'function') throw new Error('当前酒馆助手版本不提供User Persona写入接口。');
      await replacePersona(name, persona, { render: 'immediate' });
    },
    loadPreset: async name => {
      if (typeof loadPreset !== 'function') throw new Error('当前酒馆助手版本不提供预设切换接口。');
      if (!loadPreset(name)) throw new Error(`切换预设失败：${name}`);
    },
    replacePreset: async (name, preset) => {
      if (typeof replacePreset !== 'function') throw new Error('当前酒馆助手版本不提供预设写入接口。');
      await replacePreset(name, klona(preset), { render: name === 'in_use' ? 'immediate' : 'none' });
    },
    createPreset: async (name, preset, overwrite = false) => {
      if (typeof createPreset !== 'function') throw new Error('当前酒馆助手版本不提供预设创建接口。');
      if (overwrite) {
        if (typeof createOrReplacePreset !== 'function') throw new Error('当前酒馆助手版本不提供预设覆盖接口。');
        await createOrReplacePreset(name, klona(preset), { render: 'none' });
      } else if (!(await createPreset(name, klona(preset)))) {
        throw new Error(`预设已存在：${name}`);
      }
    },
    setCharacterAvatar: async (bytes, mediaType) => {
      await updateCharacterWith('current', character => ({
        ...character,
        avatar: new Blob([bytes.slice().buffer as ArrayBuffer], { type: mediaType }),
      }));
    },
    setPersonaAvatar: async (name, bytes, mediaType) => {
      await updatePersonaWith(name, persona => ({
        ...persona,
        avatar: new Blob([bytes.slice().buffer as ArrayBuffer], { type: mediaType }),
      }), { render: 'immediate' });
    },
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
        if (value.length > 0) allowCurrentCharacterRegexes();
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
        if (mirroredEmbeddedBook) raw.data.character_book = '__@@UNSET@@__';
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
