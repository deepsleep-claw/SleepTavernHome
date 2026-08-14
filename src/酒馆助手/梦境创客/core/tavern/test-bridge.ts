import { klona } from 'klona';
import { transactionEntry, transactionState } from '../transaction/test-fixture';
import type { TavernResourceScope } from '../mapping/types';
import type {
  RawCharacterData,
  RawTavernRegex,
  RawTavernScriptTree,
  TavernBridge,
  TavernWorldbookEntry,
  TavernPersonaData,
  TavernPresetData,
} from './bridge';

function tavernEntry(id: string, uid: number): TavernWorldbookEntry {
  const entry = transactionEntry(id, uid);
  return {
    content: entry.content,
    effect: klona(entry.effect),
    enabled: entry.enabled,
    extra: { ...entry.extra, card_agent: { resource_id: entry.resourceId } },
    name: entry.name,
    position: klona(entry.position),
    probability: entry.probability,
    recursion: klona(entry.recursion),
    strategy: klona(entry.strategy),
    uid,
    vendor_field: 'preserve',
  };
}

export class FakeTavernBridge implements TavernBridge {
  bindings: CharWorldbooks = { additional: [], primary: '主世界书' };
  chatWorldbook: string | null = null;
  globalWorldbooks: string[] = [];
  groupId = '';
  messages: ChatMessage[] = [
    { data: {}, extra: {}, is_hidden: false, message: 'hello', message_id: 0, name: '角色', role: 'assistant' },
  ];
  raw: RawCharacterData | null;
  readonly books = new Map<string, TavernWorldbookEntry[]>();
  readonly calls: string[] = [];
  characters: RawCharacterData[] = [];
  readonly regexes = new Map<TavernResourceScope, RawTavernRegex[]>();
  readonly scripts = new Map<TavernResourceScope, RawTavernScriptTree[]>();
  loadedPresetName = '默认预设';
  currentPersonaName: string | null = '玩家';
  readonly personas = new Map<string, TavernPersonaData>();
  readonly presets = new Map<string, TavernPresetData>();
  nextUid = 100;

  async closeCurrentChat(): Promise<void> {
    this.raw = null;
  }

  constructor() {
    const state = transactionState();
    this.raw = {
      avatar: state.character.avatarId,
      chat: 'chat.jsonl',
      create_date: '2026-01-01',
      creatorcomment: state.character.fields.creator_notes,
      data: {
        alternate_greetings: state.character.greetings.slice(1).map(item => item.content),
        character_version: state.character.version,
        creator: state.character.creator,
        creator_notes: state.character.fields.creator_notes,
        description: state.character.fields.description,
        extensions: {
          card_agent: {
            binding_id: state.character.bindingId,
            greetings: state.character.greetings.map(({ id, name }) => ({ id, name })),
            worldbooks: [{ id: state.worldbooks[0].resourceId, name: state.worldbooks[0].name }],
          },
          foreign: { keep: true },
        },
        first_mes: state.character.greetings[0].content,
        mes_example: state.character.fields.mes_example,
        name: state.character.name,
        personality: state.character.fields.personality,
        post_history_instructions: state.character.fields.post_history_instructions,
        scenario: state.character.fields.scenario,
        system_prompt: state.character.fields.system_prompt,
        tags: state.character.tags,
      },
      description: state.character.fields.description,
      first_mes: state.character.greetings[0].content,
      mes_example: state.character.fields.mes_example,
      name: state.character.name,
      personality: state.character.fields.personality,
      scenario: state.character.fields.scenario,
      tags: state.character.tags,
      unknown_server_field: { keep: true },
    };
    this.books.set('主世界书', [tavernEntry('entry-1', 1), tavernEntry('entry-2', 2)]);
    this.characters = [klona(this.raw)];
    this.regexes.set('character', []);
    this.regexes.set('global', []);
    this.regexes.set('preset-current', []);
    this.scripts.set('character', []);
    this.scripts.set('global', []);
    this.scripts.set('preset-current', []);
    this.personas.set('玩家', {
      avatar: 'player.png', avatar_id: 'player.png', connections: [], depth: 2, description: '玩家描述',
      is_default: true, lorebook: '', name: '玩家', position: 0, role: 0, title: '玩家',
    });
    const preset = {
      extensions: {},
      prompts: [{ content: '系统提示', enabled: true, id: 'main', name: '主提示', role: 'system' }],
      prompts_unused: [],
      settings: {
        allow_sending_images: 'auto', allow_sending_videos: false, character_name_prefix: 'none',
        enable_function_calling: true, enable_web_search: false, frequency_penalty: 0, max_completion_tokens: 1024,
        max_context: 8192, min_p: 0, presence_penalty: 0, reasoning_effort: 'auto', repetition_penalty: 1,
        reply_count: 1, request_images: false, request_thoughts: false, seed: -1, should_stream: true,
        squash_system_messages: false, temperature: 1, top_a: 0, top_k: 0, top_p: 1,
        wrap_user_messages_in_quotes: false,
      },
    } as TavernPresetData;
    this.presets.set(this.loadedPresetName, klona(preset));
    this.presets.set('in_use', klona(preset));
  }

  async createWorldbook(name: string): Promise<void> {
    this.calls.push(`create-book:${name}`);
    if (this.books.has(name)) throw new Error('exists');
    this.books.set(name, []);
  }

  async createWorldbookEntries(
    name: string,
    entries: Partial<TavernWorldbookEntry>[],
  ): Promise<TavernWorldbookEntry[]> {
    this.calls.push(`create-entries:${name}`);
    const book = this.books.get(name);
    if (!book) throw new Error('missing');
    const created = entries.map(input => ({ ...klona(input), uid: this.nextUid++ })) as TavernWorldbookEntry[];
    book.push(...created);
    return klona(created);
  }

  async deleteWorldbook(name: string): Promise<void> {
    this.calls.push(`delete-book:${name}`);
    if (!this.books.delete(name)) throw new Error('missing');
  }

  async ensureCharacterLoaded(): Promise<void> {
    this.calls.push('ensure-character');
  }

  getCharacterBindings(): CharWorldbooks {
    return klona(this.bindings);
  }

  getChatMessages(): ChatMessage[] {
    return klona(this.messages);
  }

  getChatWorldbook(): string | null {
    return this.chatWorldbook;
  }

  getCurrentCharacterId(): string | null {
    return this.raw?.avatar ?? null;
  }

  getCurrentCharacterName(): string | null {
    return this.raw?.name ?? null;
  }

  getGlobalWorldbooks(): string[] {
    return [...this.globalWorldbooks];
  }

  getGroupId(): string {
    return this.groupId;
  }

  getLoadedPresetName(): string {
    return this.loadedPresetName;
  }

  getPreset(name: string): TavernPresetData { const value = this.presets.get(name); if (!value) throw new Error('missing preset'); return klona(value); }
  getPresetNames(): string[] { return [...this.presets.keys()].filter(name => name !== 'in_use'); }
  getCurrentPersonaId(): string | null { return this.currentPersonaName ? this.personas.get(this.currentPersonaName)?.avatar_id ?? null : null; }
  getCurrentPersonaName(): string | null { return this.currentPersonaName; }
  getPersona(name: string): TavernPersonaData {
    const resolved = name === 'current' ? this.currentPersonaName : name;
    const value = resolved ? this.personas.get(resolved) : undefined;
    if (!value) throw new Error('missing persona');
    return klona(value);
  }
  getPersonaAvatarPath(name: string): string | null {
    const persona = this.getPersona(name);
    return `/User Avatars/${persona.avatar_id}`;
  }
  getPersonaNames(): string[] { return [...this.personas.keys()]; }
  getCharacterAvatarPath(): string | null { return this.raw ? `/characters/${this.raw.avatar}` : null; }

  getWorldbookNames(): string[] {
    return [...this.books.keys()].sort((left, right) => left.localeCompare(right));
  }

  listCharacters() {
    return this.characters.map((character, index) => ({ avatarId: character.avatar, index, name: character.name }));
  }

  getRawCharacter(): RawCharacterData | null {
    return this.raw ? klona(this.raw) : null;
  }

  getRawRegexes(scope: TavernResourceScope): RawTavernRegex[] {
    return klona(this.regexes.get(scope) ?? []);
  }

  getRawScriptTrees(scope: TavernResourceScope): RawTavernScriptTree[] {
    return klona(this.scripts.get(scope) ?? []);
  }

  async getWorldbook(name: string): Promise<TavernWorldbookEntry[]> {
    const entries = this.books.get(name);
    if (!entries) throw new Error(`missing book ${name}`);
    return klona(entries);
  }

  async saveRawCharacter(character: RawCharacterData): Promise<void> {
    this.calls.push('save-character');
    this.raw = klona(character);
  }

  async createPersona(name: string, persona?: Partial<TavernPersonaData>): Promise<void> {
    if (this.personas.has(name)) throw new Error('exists persona');
    this.personas.set(name, { avatar: `${name}.png`, avatar_id: `${name}.png`, connections: [], depth: 2,
      description: '', is_default: false, lorebook: '', position: 0, role: 0, title: name, ...klona(persona ?? {}), name } as TavernPersonaData);
  }
  async deletePersona(name: string): Promise<void> { if (!this.personas.delete(name)) throw new Error('missing persona'); if (this.currentPersonaName === name) this.currentPersonaName = null; }
  async replacePersona(name: string, persona: Partial<TavernPersonaData>): Promise<void> {
    const previous = this.personas.get(name); if (!previous) throw new Error('missing persona');
    const next = { ...previous, ...klona(persona) } as TavernPersonaData;
    this.personas.delete(name); this.personas.set(next.name, next);
    if (this.currentPersonaName === name) this.currentPersonaName = next.name;
  }
  async loadPreset(name: string): Promise<void> { const preset = this.presets.get(name); if (!preset) throw new Error('missing preset'); this.loadedPresetName = name; this.presets.set('in_use', klona(preset)); }
  async replacePreset(name: string, preset: TavernPresetData): Promise<void> { if (name !== 'in_use' && !this.presets.has(name)) throw new Error('missing preset'); this.presets.set(name, klona(preset)); }
  async createPreset(name: string, preset: TavernPresetData, overwrite = false): Promise<void> { if (this.presets.has(name) && !overwrite) throw new Error('exists preset'); this.presets.set(name, klona(preset)); }
  async setCharacterAvatar(_bytes: Uint8Array, _mediaType: string): Promise<void> { this.calls.push('set-character-avatar'); }
  async setPersonaAvatar(name: string, _bytes: Uint8Array, _mediaType: string): Promise<void> { if (!this.personas.has(name)) throw new Error('missing persona'); this.calls.push(`set-persona-avatar:${name}`); }

  async selectCharacterById(index: number): Promise<void> {
    this.calls.push(`select-character:${index}`);
    const character = this.characters[index];
    if (!character) throw new Error('missing character');
    this.raw = klona(character);
  }

  async replaceRawRegexes(scope: TavernResourceScope, regexes: RawTavernRegex[]): Promise<void> {
    this.calls.push(`replace-regexes:${scope}`);
    this.regexes.set(scope, klona(regexes));
  }

  async replaceRawScriptTrees(scope: TavernResourceScope, trees: RawTavernScriptTree[]): Promise<void> {
    this.calls.push(`replace-scripts:${scope}`);
    this.scripts.set(scope, klona(trees));
  }

  async setCharacterBindings(bindings: CharWorldbooks): Promise<void> {
    this.calls.push('bind-character');
    this.bindings = klona(bindings);
    if (this.raw) {
      this.raw.data.extensions ??= {};
      this.raw.data.extensions.world = bindings.primary ?? '';
    }
  }

  async setChatWorldbook(name: string | null): Promise<void> {
    this.calls.push('bind-chat');
    this.chatWorldbook = name;
  }

  async updateWorldbook(
    name: string,
    updater: (entries: TavernWorldbookEntry[]) => TavernWorldbookEntry[],
  ): Promise<TavernWorldbookEntry[]> {
    this.calls.push(`update-book:${name}`);
    const entries = this.books.get(name);
    if (!entries) throw new Error('missing');
    const updated = updater(klona(entries));
    this.books.set(name, klona(updated));
    return klona(updated);
  }
}
