import { klona } from 'klona';
import type {
  CardWorkspaceState,
  GreetingMetadata,
  WorldbookData,
  WorldbookEntryData,
  WorldbookKeyword,
} from '../mapping/types';
import { sha256 } from '../transaction/canonical';
import type { RawCharacterData, TavernBridge, TavernWorldbookEntry } from './bridge';
import { readRegexScope, readScriptScope } from './resource-reader';

type CardAgentExtension = {
  binding_id?: unknown;
  greetings?: unknown;
  worldbooks?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cardAgentExtension(raw: RawCharacterData): CardAgentExtension {
  return record(raw.data.extensions?.card_agent);
}

async function shortHash(value: string): Promise<string> {
  return (await sha256(value)).slice(0, 20);
}

function parseGreetingMetadata(value: unknown): GreetingMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const candidate = record(item);
    return typeof candidate.id === 'string' && typeof candidate.name === 'string'
      ? [{ id: candidate.id, name: candidate.name }]
      : [];
  });
}

function parseWorldbookIds(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) return new Map();
  return new Map(
    value.flatMap(item => {
      const candidate = record(item);
      return typeof candidate.id === 'string' && typeof candidate.name === 'string'
        ? [[candidate.name, candidate.id] as const]
        : [];
    }),
  );
}

function keyword(value: string | RegExp): WorldbookKeyword {
  // 酒馆助手函数运行在父窗口，返回的 RegExp 属于另一个 JavaScript realm，
  // 因此不能使用 instanceof RegExp 判断。复制到当前窗口后，快照与最终校验才能稳定识别它。
  return Object.prototype.toString.call(value) === '[object RegExp]'
    ? new RegExp((value as RegExp).source, (value as RegExp).flags)
    : value;
}

const ENTRY_KEYS = new Set([
  'content',
  'effect',
  'enabled',
  'extra',
  'name',
  'position',
  'probability',
  'recursion',
  'strategy',
  'uid',
]);

function worldbookEntry(bookId: string, input: TavernWorldbookEntry): WorldbookEntryData {
  const rawExtra = record(input.extra);
  const extension = record(rawExtra.card_agent);
  const resourceId = typeof extension.resource_id === 'string' ? extension.resource_id : `${bookId}:uid:${input.uid}`;
  const extra = klona(rawExtra);
  const extraCardAgent = record(extra.card_agent);
  delete extraCardAgent.resource_id;
  if (Object.keys(extraCardAgent).length > 0) extra.card_agent = extraCardAgent;
  else delete extra.card_agent;
  return {
    content: input.content,
    effect: klona(input.effect),
    enabled: input.enabled,
    extra,
    name: input.name,
    position: klona(input.position),
    probability: input.probability,
    recursion: klona(input.recursion),
    resourceId,
    strategy: {
      ...klona(input.strategy),
      keys: input.strategy.keys.map(keyword),
      keys_secondary: {
        ...klona(input.strategy.keys_secondary),
        keys: input.strategy.keys_secondary.keys.map(keyword),
      },
    },
    uid: input.uid,
    unknownFields: Object.fromEntries(Object.entries(input).filter(([key]) => !ENTRY_KEYS.has(key))),
  };
}

export async function readStandaloneWorldbook(
  bridge: TavernBridge,
  name: string,
  options: { resourceId?: string; writable?: boolean } = {},
): Promise<WorldbookData> {
  const id = options.resourceId ?? `worldbook:${await shortHash(name)}`;
  const writable = options.writable ?? true;
  try {
    const entries = await bridge.getWorldbook(name);
    return {
      entries: entries.map(entry => worldbookEntry(id, entry)),
      name,
      resourceId: id,
      roundTripSafe: true,
      unknownFields: {},
      writable,
    };
  } catch (error) {
    return {
      entries: [],
      name,
      resourceId: id,
      roundTripSafe: false,
      unknownFields: { mapping_error: error instanceof Error ? error.message : String(error) },
      writable: false,
    };
  }
}

export type TavernStateReadResult = {
  state: CardWorkspaceState;
  warnings: string[];
};

export async function readTavernState(bridge: TavernBridge): Promise<TavernStateReadResult> {
  if (bridge.getGroupId()) {
    throw new Error('梦境创客首版不支持群聊。');
  }
  const name = bridge.getCurrentCharacterName();
  const avatarId = bridge.getCurrentCharacterId();
  if (!name || !avatarId) {
    throw new Error('请先打开一张角色卡。');
  }
  await bridge.ensureCharacterLoaded();
  const raw = bridge.getRawCharacter();
  if (!raw) throw new Error('无法读取当前角色卡。');
  const extension = cardAgentExtension(raw);
  const bindingId =
    typeof extension.binding_id === 'string' ? extension.binding_id : `binding:${await shortHash(`${avatarId}:${name}`)}`;
  const greetingMetadata = parseGreetingMetadata(extension.greetings);
  const storedGreetings = [raw.data.first_mes ?? raw.first_mes ?? '', ...(raw.data.alternate_greetings ?? [])];
  const contents = Array.isArray(extension.greetings) && greetingMetadata.length === 0 && storedGreetings.every(item => item === '')
    ? []
    : storedGreetings;
  const greetings = await Promise.all(
    contents.map(async (content, index) => ({
      content,
      id: greetingMetadata[index]?.id ?? `greeting:${await shortHash(`${bindingId}:${index}:${content}`)}`,
      name: greetingMetadata[index]?.name ?? (index === 0 ? '默认开场白' : `开场白 ${index + 1}`),
    })),
  );
  const bindings = bridge.getCharacterBindings();
  const chat = bridge.getChatWorldbook();
  const globalNames = bridge.getGlobalWorldbooks();
  const storedBookIds = parseWorldbookIds(extension.worldbooks);
  const availableNames = new Set(bridge.getWorldbookNames());
  const storedNames = [...storedBookIds.keys()].filter(worldbookName => availableNames.has(worldbookName));
  const allNames = [
    ...new Set(
      [bindings.primary, ...bindings.additional, chat, ...storedNames, ...globalNames].filter(
        (item): item is string => Boolean(item),
      ),
    ),
  ];
  const worldbooks = await Promise.all(
    allNames.map(async worldbookName => {
      const id = storedBookIds.get(worldbookName) ?? `worldbook:${await shortHash(worldbookName)}`;
      return readStandaloneWorldbook(bridge, worldbookName, {
        resourceId: id,
        writable: !globalNames.includes(worldbookName),
      });
    }),
  );
  const warnings = worldbooks
    .filter(book => !book.roundTripSafe)
    .map(book => `世界书“${book.name}”无法无损读取，已降级为只读。`);
  const presetName = bridge.getLoadedPresetName();
  const resourceTargets = {
    character: bindingId,
    global: 'global',
    'preset-current': `preset:${presetName}`,
  } as const;
  const readResource = <T>(reader: () => T, fallback: T, label: string): T => {
    try {
      return reader();
    } catch (error) {
      warnings.push(`${label}读取失败，已降级为不可用：${error instanceof Error ? error.message : String(error)}`);
      return fallback;
    }
  };
  const resources: CardWorkspaceState['resources'] = {
    regexes: {
      character: readResource(
        () => readRegexScope(bridge.getRawRegexes('character'), resourceTargets.character),
        { available: false, reason: '角色正则读取失败。', regexes: [], targetId: resourceTargets.character },
        '角色正则',
      ),
      global: readResource(
        () => readRegexScope(bridge.getRawRegexes('global'), resourceTargets.global),
        { available: false, reason: '全局正则读取失败。', regexes: [], targetId: resourceTargets.global },
        '全局正则',
      ),
      'preset-current': readResource(
        () => readRegexScope(bridge.getRawRegexes('preset-current'), resourceTargets['preset-current']),
        { available: false, reason: '当前预设正则读取失败。', regexes: [], targetId: resourceTargets['preset-current'] },
        '当前预设正则',
      ),
    },
    scripts: {
      character: readResource(
        () => readScriptScope(bridge.getRawScriptTrees('character'), resourceTargets.character),
        { available: false, reason: '角色脚本读取失败。', scripts: [], targetId: resourceTargets.character, trees: [] },
        '角色脚本',
      ),
      global: readResource(
        () => readScriptScope(bridge.getRawScriptTrees('global'), resourceTargets.global),
        { available: false, reason: '全局脚本读取失败。', scripts: [], targetId: resourceTargets.global, trees: [] },
        '全局脚本',
      ),
      'preset-current': readResource(
        () => readScriptScope(bridge.getRawScriptTrees('preset-current'), resourceTargets['preset-current']),
        { available: false, reason: '当前预设脚本读取失败。', scripts: [], targetId: resourceTargets['preset-current'], trees: [] },
        '当前预设脚本',
      ),
    },
  };
  return {
    state: {
      bindings: { additional: bindings.additional, chat, primary: bindings.primary },
      character: {
        avatarId,
        bindingId,
        creator: raw.data.creator ?? '',
        extensions: klona(raw.data.extensions ?? {}),
        fields: {
          creator_notes: raw.data.creator_notes ?? raw.creatorcomment ?? '',
          description: raw.data.description ?? raw.description ?? '',
          mes_example: raw.data.mes_example ?? raw.mes_example ?? '',
          personality: raw.data.personality ?? raw.personality ?? '',
          post_history_instructions: raw.data.post_history_instructions ?? '',
          scenario: raw.data.scenario ?? raw.scenario ?? '',
          system_prompt: raw.data.system_prompt ?? '',
        },
        greetings,
        name,
        tags: klona(raw.data.tags ?? raw.tags ?? []),
        version: raw.data.character_version ?? '',
      },
      chat: bridge.getChatMessages().map(message => ({
        hidden: message.is_hidden,
        id: message.message_id,
        name: message.name,
        role: message.role,
        text: message.message,
      })),
      globalWorldbookNames: globalNames,
      resources,
      worldbooks,
    },
    warnings,
  };
}
