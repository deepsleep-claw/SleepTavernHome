import { klona } from 'klona';
import { transactionEntry, transactionState } from '../transaction/test-fixture';
import type { TavernResourceScope } from '../mapping/types';
import type {
  RawCharacterData,
  RawTavernRegex,
  RawTavernScriptTree,
  TavernBridge,
  TavernWorldbookEntry,
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
  nextUid = 100;

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
