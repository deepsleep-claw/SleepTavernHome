import _ from 'lodash';
import type { WorldbookRuleContext } from './worldbook_rules';

export type SplitGetwiExtractionPart = {
  has_dynamic_content: boolean;
  content_candidates: string[];
  wrapper_id?: string;
  source?: string;
  target_key?: string;
  target_name?: string;
};

export type WorldbookEntryMetadata = {
  rule_context: WorldbookRuleContext;
  key: string;
  world: string;
  uid: number;
  name: string;
  is_constant: boolean;
  is_disabled: boolean;
  position?: number;
  depth?: number;
  content: string;
  content_candidates: string[];
  split_getwi_parts: SplitGetwiExtractionPart[];
  wrapper_id?: string;
  content_hash: string;
  has_dynamic_macro: boolean;
};

function removeStableIdentityMacros(content: string): string {
  return content
    .replace(/<USER>/gi, '')
    .replace(/<BOT>/gi, '')
    .replace(/<CHAR>/gi, '')
    .replace(/\{\{\s*user\s*\}\}/gi, '')
    .replace(/\{\{\s*char\s*\}\}/gi, '');
}

const MAX_GETWI_RECURSION_DEPTH = 3;

const SAFE_GETWI_ARGUMENT = String.raw`(null|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?)`;

export const SAFE_GETWI_TEMPLATE_REGEX = new RegExp(
  String.raw`<%[-=]\s*await\s+(?:getwi|getWorldInfo)\s*\(\s*${SAFE_GETWI_ARGUMENT}(?:\s*,\s*${SAFE_GETWI_ARGUMENT})?\s*\)\s*[-_]?%>`,
  'g',
);

type SafeGetwiArgument = string | number | null;

type SafeGetwiTemplateCall = {
  raw: string;
  first_argument: SafeGetwiArgument;
  second_argument: SafeGetwiArgument | undefined;
};

type AnalyzedGetwiCall = {
  has_dynamic_macro: boolean;
  content_candidates: string[];
  source?: string;
  target_key?: string;
  target_name?: string;
};

type WorldbookContentAnalysis = {
  has_dynamic_macro: boolean;
  content_candidates: string[];
  is_pure_getwi: boolean;
  getwi_calls: AnalyzedGetwiCall[];
};

function removeSafeGetwiTemplateMacros(content: string): string {
  return content.replace(SAFE_GETWI_TEMPLATE_REGEX, '');
}

function parseSafeGetwiArgument(argument: string): SafeGetwiArgument {
  const trimmed = argument.trim();
  if (trimmed === 'null') {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

export function getSafeGetwiTemplateCalls(content: string): SafeGetwiTemplateCall[] {
  return [...content.matchAll(SAFE_GETWI_TEMPLATE_REGEX)].map(match => ({
    raw: match[0],
    first_argument: parseSafeGetwiArgument(match[1]),
    second_argument: match[2] === undefined ? undefined : parseSafeGetwiArgument(match[2]),
  }));
}

export function hasDynamicPromptMacro(content: string): boolean {
  const checked_content = removeSafeGetwiTemplateMacros(removeStableIdentityMacros(content));
  return /\{\{[\s\S]*?\}\}/.test(checked_content) || /<%(?:[-_=#_%])?[\s\S]*?(?:[-_]?%>)/.test(checked_content);
}

export function hasDynamicPromptMacroOrGetwi(content: string): boolean {
  return hasDynamicPromptMacro(content) || getSafeGetwiTemplateCalls(content).length > 0;
}

function isPureGetwiAggregation(content: string): boolean {
  return getSafeGetwiTemplateCalls(content).length > 0 && removeSafeGetwiTemplateMacros(content).trim() === '';
}

function resolveSafeGetwiTarget(
  call: SafeGetwiTemplateCall,
  worldbook_entry_metadata: Map<string, WorldbookEntryMetadata>,
  loaded_worldbook_names: Set<string>,
): WorldbookEntryMetadata | undefined {
  let target_world: string | undefined;
  let target_identifier: string | number | null | undefined;

  if (call.second_argument === undefined) {
    target_identifier = call.first_argument;
  } else {
    if (call.first_argument !== null && typeof call.first_argument !== 'string') {
      return undefined;
    }
    target_world = call.first_argument ?? undefined;
    target_identifier = call.second_argument;
  }

  if (target_identifier === null || target_identifier === undefined) {
    return undefined;
  }
  if (target_world !== undefined && !loaded_worldbook_names.has(target_world)) {
    return undefined;
  }

  const candidates = [...worldbook_entry_metadata.values()].filter(metadata => {
    if (target_world !== undefined && metadata.world !== target_world) {
      return false;
    }
    return typeof target_identifier === 'number'
      ? metadata.uid === target_identifier
      : metadata.name === target_identifier;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function getKnownExpandedContent(content: string, analyzed_calls: AnalyzedGetwiCall[]): string {
  let call_index = 0;
  return content.replace(SAFE_GETWI_TEMPLATE_REGEX, () => analyzed_calls[call_index++]?.content_candidates[0] ?? '');
}

export function analyzeWorldbookContent(
  content: string,
  worldbook_entry_metadata: Map<string, WorldbookEntryMetadata>,
  loaded_worldbook_names: Set<string>,
  depth: number,
  visiting_entry_keys: Set<string>,
): WorldbookContentAnalysis {
  const getwi_calls = getSafeGetwiTemplateCalls(content);
  const has_other_dynamic_macro = hasDynamicPromptMacro(content);
  const is_pure_getwi = isPureGetwiAggregation(content);

  if (getwi_calls.length === 0) {
    return {
      has_dynamic_macro: has_other_dynamic_macro,
      content_candidates: [content],
      is_pure_getwi,
      getwi_calls: [],
    };
  }

  if (depth >= MAX_GETWI_RECURSION_DEPTH) {
    return {
      has_dynamic_macro: true,
      content_candidates: [content],
      is_pure_getwi,
      getwi_calls: getwi_calls.map(call => ({
        has_dynamic_macro: true,
        content_candidates: [call.raw],
        source: call.raw,
      })),
    };
  }

  const analyzed_calls = getwi_calls.map(call => {
    const target = resolveSafeGetwiTarget(call, worldbook_entry_metadata, loaded_worldbook_names);
    if (!target || visiting_entry_keys.has(target.key)) {
      return {
        has_dynamic_macro: true,
        content_candidates: [call.raw],
        source: call.raw,
      };
    }

    const nested_visiting_entry_keys = new Set(visiting_entry_keys).add(target.key);
    const target_analysis = analyzeWorldbookContent(
      target.content,
      worldbook_entry_metadata,
      loaded_worldbook_names,
      depth + 1,
      nested_visiting_entry_keys,
    );
    return {
      has_dynamic_macro: target_analysis.has_dynamic_macro,
      content_candidates: target_analysis.content_candidates,
      source: call.raw,
      target_key: target.key,
      target_name: target.name,
    };
  });

  const has_dynamic_getwi = analyzed_calls.some(call => call.has_dynamic_macro);
  const has_dynamic_macro = has_other_dynamic_macro || has_dynamic_getwi;
  const content_candidates =
    !has_dynamic_macro || (is_pure_getwi && getwi_calls.length === 1)
      ? [getKnownExpandedContent(content, analyzed_calls)]
      : [content];

  return {
    has_dynamic_macro,
    content_candidates,
    is_pure_getwi,
    getwi_calls: analyzed_calls,
  };
}

export function applyWorldbookEntryMetadataAnalysis(
  metadata: WorldbookEntryMetadata,
  worldbook_entry_metadata: Map<string, WorldbookEntryMetadata>,
  loaded_worldbook_names: Set<string>,
) {
  if (!metadata.is_constant) {
    metadata.has_dynamic_macro = hasDynamicPromptMacroOrGetwi(metadata.content);
    metadata.content_candidates = [metadata.content];
    metadata.split_getwi_parts = [];
    return;
  }

  const analysis = analyzeWorldbookContent(
    metadata.content,
    worldbook_entry_metadata,
    loaded_worldbook_names,
    0,
    new Set([metadata.key]),
  );
  metadata.has_dynamic_macro = analysis.has_dynamic_macro;
  metadata.content_candidates = _.uniq([metadata.content, ...analysis.content_candidates]);
  metadata.split_getwi_parts =
    analysis.is_pure_getwi && analysis.getwi_calls.length > 1 && analysis.has_dynamic_macro
      ? analysis.getwi_calls.map(call => ({
          has_dynamic_content: call.has_dynamic_macro,
          content_candidates: call.content_candidates,
          source: call.source,
          target_key: call.target_key,
          target_name: call.target_name,
        }))
      : [];
}
