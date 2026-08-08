export type CharacterTextField =
  | 'creator_notes'
  | 'description'
  | 'mes_example'
  | 'personality'
  | 'post_history_instructions'
  | 'scenario'
  | 'system_prompt';

export type GreetingMetadata = {
  id: string;
  name: string;
};

export type CharacterWorkspaceData = {
  avatarId: string;
  bindingId: string;
  creator: string;
  extensions: Record<string, unknown>;
  fields: Record<CharacterTextField, string>;
  greetings: Array<GreetingMetadata & { content: string }>;
  name: string;
  tags: string[];
  version: string;
};

export type WorldbookKeyword = string | RegExp;

export type WorldbookEntryData = {
  content: string;
  effect: {
    cooldown: number | null;
    delay: number | null;
    sticky: number | null;
  };
  enabled: boolean;
  extra?: Record<string, unknown>;
  name: string;
  position: {
    depth: number;
    order: number;
    role: 'assistant' | 'system' | 'user';
    type:
      | 'after_author_note'
      | 'after_character_definition'
      | 'after_example_messages'
      | 'at_depth'
      | 'before_author_note'
      | 'before_character_definition'
      | 'before_example_messages'
      | 'outlet';
  };
  probability: number;
  recursion: {
    delay_until: number | null;
    prevent_incoming: boolean;
    prevent_outgoing: boolean;
  };
  resourceId: string;
  strategy: {
    keys: WorldbookKeyword[];
    keys_secondary: {
      keys: WorldbookKeyword[];
      logic: 'and_all' | 'and_any' | 'not_all' | 'not_any';
    };
    scan_depth: 'same_as_global' | number;
    type: 'constant' | 'selective' | 'vectorized';
  };
  uid: number | `temp:${string}`;
  unknownFields: Record<string, unknown>;
};

export type WorldbookData = {
  entries: WorldbookEntryData[];
  name: string;
  resourceId: string;
  roundTripSafe: boolean;
  unknownFields: Record<string, unknown>;
  writable: boolean;
};

export type WorldbookBindings = {
  additional: string[];
  chat: string | null;
  primary: string | null;
};

export type ReadonlyChatMessage = {
  hidden: boolean;
  id: number;
  name: string;
  role: 'assistant' | 'system' | 'user';
  text: string;
};

export type CardWorkspaceState = {
  bindings: WorldbookBindings;
  character: CharacterWorkspaceData;
  chat: ReadonlyChatMessage[];
  globalWorldbookNames: string[];
  worldbooks: WorldbookData[];
};

export type CardWorkspaceMaterialization = {
  state: CardWorkspaceState;
  warnings: string[];
};
