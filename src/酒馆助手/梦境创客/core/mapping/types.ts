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

export type TavernResourceScope = 'character' | 'global' | 'preset-current';

export type ResourceCapability = {
  available: boolean;
  reason?: string;
  /** 用于阻止把 preset-current 的实时文件修改写入后来切换到的另一个预设。 */
  targetId: string;
};

export type RegexMacroSubstitution = 'escaped' | 'none' | 'raw';

export type TavernRegexData = {
  destination: {
    display: boolean;
    prompt: boolean;
  };
  enabled: boolean;
  findRegex: string;
  id: string;
  maxDepth: number | null;
  minDepth: number | null;
  name: string;
  order: number;
  replaceString: string;
  resourceId: string;
  runOnEdit: boolean;
  source: {
    aiOutput: boolean;
    reasoning: boolean;
    slashCommand: boolean;
    userInput: boolean;
    worldInfo: boolean;
  };
  substituteRegex: RegexMacroSubstitution;
  trimStrings: string[];
  unknownFields: Record<string, unknown>;
  unknownPlacements: number[];
};

export type ScopedRegexData = ResourceCapability & {
  regexes: TavernRegexData[];
};

export type TavernScriptButton = {
  name: string;
  visible: boolean;
};

export type TavernScriptData = {
  button: {
    buttons: TavernScriptButton[];
    enabled: boolean;
  };
  content: string;
  data: Record<string, unknown>;
  enabled: boolean;
  exportWith: {
    button: boolean;
    data: boolean;
  };
  id: string;
  info: string;
  name: string;
  resourceId: string;
  unknownFields: Record<string, unknown>;
};

export type TavernScriptTreeReference =
  | { scriptId: string; type: 'script' }
  | {
      color: string;
      enabled: boolean;
      icon: string;
      id: string;
      name: string;
      scriptIds: string[];
      type: 'folder';
      unknownFields: Record<string, unknown>;
    };

export type ScopedScriptData = ResourceCapability & {
  scripts: TavernScriptData[];
  trees: TavernScriptTreeReference[];
};

export type TavernResourceState = {
  regexes: Record<TavernResourceScope, ScopedRegexData>;
  scripts: Record<TavernResourceScope, ScopedScriptData>;
};

export type CardWorkspaceState = {
  bindings: WorldbookBindings;
  character: CharacterWorkspaceData;
  chat: ReadonlyChatMessage[];
  globalWorldbookNames: string[];
  resources: TavernResourceState;
  worldbooks: WorldbookData[];
};

export type CardWorkspaceMaterialization = {
  state: CardWorkspaceState;
  warnings: string[];
};
