import type { CardWorkspaceState, WorldbookEntryData } from '../mapping/types';

export function transactionEntry(id = 'entry-1', uid = 1): WorldbookEntryData {
  return {
    content: `正文 ${id}`,
    effect: { cooldown: null, delay: null, sticky: null },
    enabled: true,
    extra: { keep: true },
    name: id,
    position: { depth: 4, order: uid * 10, role: 'system', type: 'before_character_definition' },
    probability: 100,
    recursion: { delay_until: null, prevent_incoming: false, prevent_outgoing: false },
    resourceId: id,
    strategy: {
      keys: [id, new RegExp(id, 'iu')],
      keys_secondary: { keys: [], logic: 'and_any' },
      scan_depth: 'same_as_global',
      type: 'selective',
    },
    uid,
    unknownFields: { future: true },
  };
}

export function transactionState(entryCount = 2): CardWorkspaceState {
  const emptyResourceScope = (targetId: string) => ({ available: true, targetId });
  return {
    bindings: { additional: [], chat: null, primary: '主世界书' },
    character: {
      avatarId: 'avatar.png',
      bindingId: 'binding-1',
      creator: '作者',
      extensions: { card_agent: { binding_id: 'binding-1' }, other: { keep: true } },
      fields: {
        creator_notes: 'notes',
        description: 'base description',
        mes_example: 'example',
        personality: 'base personality',
        post_history_instructions: 'phi',
        scenario: 'scenario',
        system_prompt: 'system',
      },
      greetings: [
        { content: 'hello', id: 'greeting/1', name: '初见' },
        { content: 'again', id: 'greeting-2', name: '重逢' },
      ],
      name: '角色',
      tags: ['tag'],
      version: '1',
    },
    chat: [{ hidden: false, id: 0, name: '角色', role: 'assistant', text: 'hello' }],
    globalWorldbookNames: [],
    resources: {
      regexes: {
        character: { ...emptyResourceScope('binding-1'), regexes: [] },
        global: { ...emptyResourceScope('global'), regexes: [] },
        'preset-current': { ...emptyResourceScope('preset:default'), regexes: [] },
      },
      scripts: {
        character: { ...emptyResourceScope('binding-1'), scripts: [], trees: [] },
        global: { ...emptyResourceScope('global'), scripts: [], trees: [] },
        'preset-current': { ...emptyResourceScope('preset:default'), scripts: [], trees: [] },
      },
    },
    worldbooks: [
      {
        entries: Array.from({ length: entryCount }, (_, index) => transactionEntry(`entry-${index + 1}`, index + 1)),
        name: '主世界书',
        resourceId: 'book/1',
        roundTripSafe: true,
        unknownFields: { keep: true },
        writable: true,
      },
    ],
  };
}
