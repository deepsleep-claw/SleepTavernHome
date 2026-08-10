import { klona } from 'klona';
import type {
  RegexMacroSubstitution,
  ScopedRegexData,
  ScopedScriptData,
  TavernRegexData,
  TavernScriptData,
  TavernScriptTreeReference,
} from '../mapping/types';
import type { RawTavernRegex, RawTavernScriptTree } from './bridge';

const REGEX_KEYS = new Set([
  'disabled',
  'findRegex',
  'id',
  'markdownOnly',
  'maxDepth',
  'minDepth',
  'placement',
  'promptOnly',
  'replaceString',
  'runOnEdit',
  'scriptName',
  'substituteRegex',
  'trimStrings',
]);
const SCRIPT_KEYS = new Set([
  'button',
  'content',
  'data',
  'enabled',
  'export_with',
  'id',
  'info',
  'name',
  'type',
]);
const FOLDER_KEYS = new Set(['color', 'enabled', 'icon', 'id', 'name', 'scripts', 'type']);
const KNOWN_PLACEMENTS = new Set([1, 2, 3, 5, 6]);

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function unknownFields(value: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key)));
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function macroSubstitution(value: unknown): RegexMacroSubstitution {
  if (Number(value) === 1) return 'raw';
  if (Number(value) === 2) return 'escaped';
  return 'none';
}

function regexData(raw: RawTavernRegex, index: number): TavernRegexData {
  const placements = Array.isArray(raw.placement)
    ? raw.placement.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [];
  const id = text(raw.id, `regex-${index + 1}`);
  return {
    destination: { display: raw.promptOnly !== true, prompt: raw.markdownOnly !== true },
    enabled: raw.disabled !== true,
    findRegex: text(raw.findRegex),
    id,
    maxDepth: nullableNumber(raw.maxDepth),
    minDepth: nullableNumber(raw.minDepth),
    name: text(raw.scriptName, `正则 ${index + 1}`),
    order: (index + 1) * 100,
    replaceString: text(raw.replaceString),
    resourceId: `regex:${id}`,
    runOnEdit: boolean(raw.runOnEdit),
    source: {
      aiOutput: placements.includes(2),
      reasoning: placements.includes(6),
      slashCommand: placements.includes(3),
      userInput: placements.includes(1),
      worldInfo: placements.includes(5),
    },
    substituteRegex: macroSubstitution(raw.substituteRegex),
    trimStrings: Array.isArray(raw.trimStrings) ? raw.trimStrings.filter((item): item is string => typeof item === 'string') : [],
    unknownFields: klona(unknownFields(raw, REGEX_KEYS)),
    unknownPlacements: placements.filter(value => !KNOWN_PLACEMENTS.has(value)),
  };
}

export function readRegexScope(raw: RawTavernRegex[], targetId: string): ScopedRegexData {
  return { available: true, regexes: raw.map(regexData), targetId };
}

function rawMacroSubstitution(value: RegexMacroSubstitution): number {
  if (value === 'raw') return 1;
  if (value === 'escaped') return 2;
  return 0;
}

export function writeRegexScope(scope: ScopedRegexData): RawTavernRegex[] {
  return scope.regexes.map(regex => {
    const placement = [
      ...(regex.source.userInput ? [1] : []),
      ...(regex.source.aiOutput ? [2] : []),
      ...(regex.source.slashCommand ? [3] : []),
      ...(regex.source.worldInfo ? [5] : []),
      ...(regex.source.reasoning ? [6] : []),
      ...regex.unknownPlacements,
    ];
    return {
      ...klona(regex.unknownFields),
      disabled: !regex.enabled,
      findRegex: regex.findRegex,
      id: regex.id,
      markdownOnly: regex.destination.display && !regex.destination.prompt,
      maxDepth: regex.maxDepth,
      minDepth: regex.minDepth,
      placement,
      promptOnly: regex.destination.prompt && !regex.destination.display,
      replaceString: regex.replaceString,
      runOnEdit: regex.runOnEdit,
      scriptName: regex.name,
      substituteRegex: rawMacroSubstitution(regex.substituteRegex),
      trimStrings: [...regex.trimStrings],
    };
  });
}

function scriptData(raw: Record<string, unknown>, index: number): TavernScriptData {
  const id = text(raw.id, `script-${index + 1}`);
  const button = record(raw.button);
  const exportWith = record(raw.export_with);
  const buttons = Array.isArray(button.buttons) ? button.buttons : [];
  return {
    button: {
      buttons: buttons.map(item => record(item)).map(item => ({ name: text(item.name), visible: boolean(item.visible, true) })),
      enabled: boolean(button.enabled),
    },
    content: text(raw.content),
    data: klona(record(raw.data)),
    enabled: boolean(raw.enabled),
    exportWith: { button: boolean(exportWith.button, true), data: boolean(exportWith.data, true) },
    id,
    info: text(raw.info),
    name: text(raw.name, `脚本 ${index + 1}`),
    resourceId: `script:${id}`,
    unknownFields: klona(unknownFields(raw, SCRIPT_KEYS)),
  };
}

export function readScriptScope(rawTrees: RawTavernScriptTree[], targetId: string): ScopedScriptData {
  const scripts: TavernScriptData[] = [];
  const trees: TavernScriptTreeReference[] = [];
  const seen = new Set<string>();
  const addScript = (raw: Record<string, unknown>) => {
    const script = scriptData(raw, scripts.length);
    if (!seen.has(script.id)) {
      scripts.push(script);
      seen.add(script.id);
    }
    return script.id;
  };
  for (const rawTree of rawTrees) {
    const tree = record(rawTree);
    if (tree.type === 'folder') {
      const nested = Array.isArray(tree.scripts) ? tree.scripts.map(record) : [];
      const id = text(tree.id, `folder-${trees.length + 1}`);
      trees.push({
        color: text(tree.color),
        enabled: boolean(tree.enabled, true),
        icon: text(tree.icon),
        id,
        name: text(tree.name, `文件夹 ${trees.length + 1}`),
        scriptIds: nested.map(addScript),
        type: 'folder',
        unknownFields: klona(unknownFields(tree, FOLDER_KEYS)),
      });
    } else {
      trees.push({ scriptId: addScript(tree), type: 'script' });
    }
  }
  return { available: true, scripts, targetId, trees };
}


function rawScript(script: TavernScriptData): RawTavernScriptTree {
  return {
    ...klona(script.unknownFields),
    button: klona(script.button),
    content: script.content,
    data: klona(script.data),
    enabled: script.enabled,
    export_with: klona(script.exportWith),
    id: script.id,
    info: script.info,
    name: script.name,
    type: 'script',
  } as RawTavernScriptTree;
}

export function writeScriptScope(scope: ScopedScriptData): RawTavernScriptTree[] {
  const scripts = new Map(scope.scripts.map(script => [script.id, script]));
  return scope.trees.flatMap(tree => {
    if (tree.type === 'script') {
      const script = scripts.get(tree.scriptId);
      return script ? [rawScript(script)] : [];
    }
    return [
      {
        ...klona(tree.unknownFields),
        color: tree.color,
        enabled: tree.enabled,
        icon: tree.icon,
        id: tree.id,
        name: tree.name,
        scripts: tree.scriptIds.flatMap(id => {
          const script = scripts.get(id);
          return script ? [rawScript(script)] : [];
        }),
        type: 'folder',
      } as RawTavernScriptTree,
    ];
  });
}
