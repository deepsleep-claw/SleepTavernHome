import type { CardWorkspaceState, TavernResourceScope, TavernResourceState } from '../mapping/types';
import { readRegexScope, readScriptScope } from './resource-reader';
import type { TavernBridge } from './bridge';
import { readStandaloneWorldbook, readTavernState, type TavernStateReadResult } from './state-reader';

export const GLOBAL_SESSION_BINDING_ID = 'global';

function mountedWorldbookResourceId(state: CardWorkspaceState, name: string): string | undefined {
  const extension = state.character.extensions.card_agent;
  if (typeof extension !== 'object' || extension === null || Array.isArray(extension)) return undefined;
  const worldbooks = (extension as Record<string, unknown>).worldbooks;
  if (!Array.isArray(worldbooks)) return undefined;
  const match = worldbooks.find(item => {
    return typeof item === 'object' && item !== null && !Array.isArray(item) &&
      (item as Record<string, unknown>).name === name;
  }) as Record<string, unknown> | undefined;
  return typeof match?.id === 'string' ? match.id : undefined;
}

function emptyFields(): CardWorkspaceState['character']['fields'] {
  return {
    creator_notes: '',
    description: '',
    mes_example: '',
    personality: '',
    post_history_instructions: '',
    scenario: '',
    system_prompt: '',
  };
}

function resources(bridge: TavernBridge, hasCharacter: boolean): TavernResourceState {
  const scopes: TavernResourceScope[] = ['character', 'global', 'preset-current'];
  const regexes = {} as TavernResourceState['regexes'];
  const scripts = {} as TavernResourceState['scripts'];
  for (const scope of scopes) {
    const targetId = scope === 'global' ? 'global' : scope === 'preset-current' ? bridge.getLoadedPresetName() : 'character';
    if (scope === 'character' && !hasCharacter) {
      regexes[scope] = { available: false, reason: '当前没有打开角色。', regexes: [], targetId };
      scripts[scope] = { available: false, reason: '当前没有打开角色。', scripts: [], targetId, trees: [] };
      continue;
    }
    try {
      regexes[scope] = readRegexScope(bridge.getRawRegexes(scope), targetId);
    } catch (error) {
      regexes[scope] = {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
        regexes: [],
        targetId,
      };
    }
    try {
      scripts[scope] = readScriptScope(bridge.getRawScriptTrees(scope), targetId);
    } catch (error) {
      scripts[scope] = {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
        scripts: [],
        targetId,
        trees: [],
      };
    }
  }
  return { regexes, scripts };
}

export async function readGlobalTavernState(
  bridge: TavernBridge,
  mountedWorldbooks: Iterable<string> = [],
): Promise<TavernStateReadResult> {
  let state: CardWorkspaceState;
  const warnings: string[] = [];
  const hasCharacter = Boolean(bridge.getCurrentCharacterId() && bridge.getCurrentCharacterName() && !bridge.getGroupId());
  if (hasCharacter) {
    const result = await readTavernState(bridge);
    state = result.state;
    warnings.push(...result.warnings);
    state.character.bindingId = GLOBAL_SESSION_BINDING_ID;
  } else {
    state = {
      bindings: { additional: [], chat: null, primary: null },
      character: {
        avatarId: '',
        bindingId: GLOBAL_SESSION_BINDING_ID,
        creator: '',
        extensions: {},
        fields: emptyFields(),
        greetings: [],
        name: '未打开角色',
        tags: [],
        version: '',
      },
      chat: [],
      globalWorldbookNames: bridge.getGlobalWorldbooks(),
      resources: resources(bridge, false),
      worldbooks: [],
    };
  }
  const existing = new Set(state.worldbooks.map(book => book.name));
  for (const name of mountedWorldbooks) {
    if (existing.has(name)) continue;
    const book = await readStandaloneWorldbook(bridge, name, {
      resourceId: mountedWorldbookResourceId(state, name),
      writable: true,
    });
    state.worldbooks.push(book);
    existing.add(name);
    if (!book.roundTripSafe) warnings.push(`世界书“${name}”无法无损读取，已降级为只读。`);
  }
  state.worldbooks.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  return { state, warnings };
}

export async function readCharacterTavernState(
  bridge: TavernBridge,
  mountedWorldbooks: Iterable<string> = [],
): Promise<TavernStateReadResult> {
  const result = await readTavernState(bridge);
  const existing = new Set(result.state.worldbooks.map(book => book.name));
  for (const name of mountedWorldbooks) {
    if (existing.has(name)) continue;
    const book = await readStandaloneWorldbook(bridge, name, {
      resourceId: mountedWorldbookResourceId(result.state, name),
      writable: true,
    });
    result.state.worldbooks.push(book);
    existing.add(name);
    if (!book.roundTripSafe) result.warnings.push(`世界书“${name}”无法无损读取，已降级为只读。`);
  }
  result.state.worldbooks.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  return result;
}
