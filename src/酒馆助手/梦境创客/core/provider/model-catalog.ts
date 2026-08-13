import { parse } from 'yaml';
import type { ProviderCompatibilityMode, ProviderInterfaceType } from '../provider-probe';
import anthropicSource from '../../内置资源/Models/anthropic.yaml?raw';
import deepseekSource from '../../内置资源/Models/deepseek.yaml?raw';
import glmSource from '../../内置资源/Models/glm.yaml?raw';
import googleSource from '../../内置资源/Models/google.yaml?raw';
import kimiSource from '../../内置资源/Models/kimi.yaml?raw';
import minimaxSource from '../../内置资源/Models/minimax.yaml?raw';
import mimoSource from '../../内置资源/Models/mimo.yaml?raw';
import openaiSource from '../../内置资源/Models/openai.yaml?raw';
import stepfunSource from '../../内置资源/Models/stepfun.yaml?raw';
import xaiSource from '../../内置资源/Models/xai.yaml?raw';

export type CapabilitySetting = 'auto' | 'disabled' | 'enabled';
export type ModelCapabilityKey = 'reasoning' | 'toolCalling' | 'vision' | 'webSearch';
export type ModelTemplateSource = 'builtin' | 'cloud' | 'endpoint';

export type ReasoningEffort = {
  id: string;
  name: string;
};

export type ModelSettings = {
  capabilities: Record<ModelCapabilityKey, CapabilitySetting>;
  contextWindow: number;
  maxOutputTokens: number;
  reasoningEfforts: ReasoningEffort[];
  temperature?: number;
  topP?: number;
};

export type AppliedModelTemplate = {
  id: string;
  revision: string;
  source: ModelTemplateSource;
};

export type ModelTemplate = {
  aliases: string[];
  compatibilityMode?: ProviderCompatibilityMode;
  confidence: 'high' | 'low' | 'medium';
  id: string;
  interfaceType?: ProviderInterfaceType;
  name: string;
  match: ModelTemplateMatchRules;
  patterns: string[];
  provider: string;
  revision: string;
  settings: ModelSettings;
  source: ModelTemplateSource;
  sourceUrl?: string;
  status?: 'active' | 'preview' | 'unverified';
};

export type ModelTemplateMatchRules = {
  contains: string[];
  exact: string[];
  prefix: string[];
  suffix: string[];
};

export type ModelTemplateMatch = {
  score: number;
  template: ModelTemplate;
};

export type ModelTemplateScope = {
  compatibilityMode: ProviderCompatibilityMode;
  interfaceType: ProviderInterfaceType;
};

export type EndpointModel = {
  id: string;
  metadata?: unknown;
};

export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 0;
export const MODELS_DEV_CATALOG_URL = 'https://models.dev/api.json';

const DEFAULT_CAPABILITIES: ModelSettings['capabilities'] = {
  reasoning: 'auto',
  toolCalling: 'auto',
  vision: 'auto',
  webSearch: 'auto',
};

const BUILTIN_SOURCES = [
  openaiSource,
  anthropicSource,
  googleSource,
  xaiSource,
  deepseekSource,
  glmSource,
  kimiSource,
  minimaxSource,
  mimoSource,
  stepfunSource,
];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim())
    : [];
}

function modalities(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\s+/u).filter(Boolean);
  return strings(value);
}

function capability(value: unknown): CapabilitySetting {
  if (value === true || value === 'enabled' || value === 'yes') return 'enabled';
  if (value === false || value === 'disabled' || value === 'no') return 'disabled';
  return 'auto';
}

function reasoningEfforts(value: unknown): ReasoningEffort[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const parsed = record(item);
    const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
    const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
    return id && name ? [{ id, name }] : [];
  });
}

function parseMatchRules(value: unknown, id: string, aliases: string[], patterns: string[]): ModelTemplateMatchRules {
  const input = record(value);
  const result: ModelTemplateMatchRules = {
    contains: strings(input?.contains),
    exact: [id, ...aliases, ...strings(input?.exact)],
    prefix: strings(input?.prefix),
    suffix: strings(input?.suffix),
  };
  for (const pattern of patterns) {
    const starts = pattern.startsWith('*');
    const ends = pattern.endsWith('*');
    const value = pattern.replace(/^\*+/u, '').replace(/\*+$/u, '');
    if (!value || value.includes('*')) continue;
    if (starts && ends) result.contains.push(value);
    else if (starts) result.suffix.push(value);
    else if (ends) result.prefix.push(value);
    else result.exact.push(value);
  }
  return Object.fromEntries(
    Object.entries(result).map(([key, values]) => [key, [...new Set(values.map(normalizeId).filter(Boolean))]]),
  ) as ModelTemplateMatchRules;
}

function parseBuiltinSource(source: string): ModelTemplate[] {
  const root = record(parse(source));
  const revision = typeof root?.revision === 'string' ? root.revision : 'unknown';
  const rootCompatibilityMode =
    root?.compatibilityMode === 'deepseek' ? 'deepseek' : root?.compatibilityMode === 'standard' ? 'standard' : undefined;
  const rootInterfaceType =
    root?.interfaceType === 'anthropic' || root?.interfaceType === 'openai-chat' || root?.interfaceType === 'openai-responses'
      ? root.interfaceType
      : undefined;
  if (!Array.isArray(root?.models)) return [];
  return root.models.flatMap(item => {
    const value = record(item);
    if (!value) return [];
    const id = typeof value?.id === 'string' ? value.id.trim() : '';
    const name = typeof value?.name === 'string' ? value.name.trim() : '';
    const provider = typeof value?.provider === 'string' ? value.provider.trim() : '';
    if (!id || !name || !provider) return [];
    const settings = record(value.settings);
    const capabilities = record(settings?.capabilities);
    const aliases = strings(value.aliases);
    const patterns = strings(value.patterns);
    return [{
      aliases,
      compatibilityMode:
        value.compatibilityMode === 'deepseek'
          ? 'deepseek'
          : value.compatibilityMode === 'standard'
            ? 'standard'
            : rootCompatibilityMode,
      confidence: value.confidence === 'low' || value.confidence === 'medium' ? value.confidence : 'high',
      id,
      interfaceType:
        value.interfaceType === 'anthropic' || value.interfaceType === 'openai-chat' || value.interfaceType === 'openai-responses'
          ? value.interfaceType
          : rootInterfaceType,
      name,
      match: parseMatchRules(value.match, id, aliases, patterns),
      patterns,
      provider,
      revision,
      settings: {
        capabilities: {
          reasoning: capability(capabilities?.reasoning),
          toolCalling: capability(capabilities?.toolCalling),
          vision: capability(capabilities?.vision),
          webSearch: capability(capabilities?.webSearch),
        },
        contextWindow: number(settings?.contextWindow, DEFAULT_CONTEXT_WINDOW),
        maxOutputTokens: number(settings?.maxOutputTokens),
        reasoningEfforts: reasoningEfforts(settings?.reasoningEfforts),
        temperature: typeof settings?.temperature === 'number' ? settings.temperature : undefined,
        topP: typeof settings?.topP === 'number' ? settings.topP : undefined,
      },
      source: 'builtin' as const,
      sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : undefined,
      status: value.status === 'preview' || value.status === 'unverified' ? value.status : 'active',
    }];
  });
}

let builtinCache: ModelTemplate[] | undefined;

export function builtinModelTemplates(): ModelTemplate[] {
  builtinCache ??= BUILTIN_SOURCES.flatMap(parseBuiltinSource);
  return structuredClone(builtinCache);
}

export function defaultModelSettings(): ModelSettings {
  return {
    capabilities: { ...DEFAULT_CAPABILITIES },
    contextWindow: 0,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    reasoningEfforts: [],
  };
}

export function normalizeModelSettings(value?: Partial<ModelSettings>): ModelSettings {
  return {
    capabilities: {
      reasoning: capability(value?.capabilities?.reasoning),
      toolCalling: capability(value?.capabilities?.toolCalling),
      vision: capability(value?.capabilities?.vision),
      webSearch: capability(value?.capabilities?.webSearch),
    },
    contextWindow: number(value?.contextWindow),
    maxOutputTokens: number(value?.maxOutputTokens),
    reasoningEfforts: reasoningEfforts(value?.reasoningEfforts),
    temperature: typeof value?.temperature === 'number' && Number.isFinite(value.temperature) ? value.temperature : undefined,
    topP: typeof value?.topP === 'number' && Number.isFinite(value.topP) ? value.topP : undefined,
  };
}

function normalizeId(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\\_\s]+/gu, '-').replace(/-{2,}/gu, '-');
}

function matchScore(modelId: string, template: ModelTemplate): { length: number; rank: number; score: number } | undefined {
  const normalized = normalizeId(modelId);
  const candidates: Array<{ length: number; rank: number; score: number }> = [];
  for (const value of template.match.exact) if (normalized === value) candidates.push({ length: value.length, rank: 4, score: 1 });
  for (const value of template.match.prefix) if (normalized.startsWith(value)) candidates.push({ length: value.length, rank: 3, score: 0.9 });
  for (const value of template.match.suffix) if (normalized.endsWith(value)) candidates.push({ length: value.length, rank: 3, score: 0.9 });
  for (const value of template.match.contains) if (normalized.includes(value)) candidates.push({ length: value.length, rank: 2, score: 0.8 });
  return candidates.sort((left, right) => right.rank - left.rank || right.length - left.length)[0];
}

export function matchModelTemplates(
  modelId: string,
  templates: ModelTemplate[] = builtinModelTemplates(),
  limit = 20,
  scope?: ModelTemplateScope,
): ModelTemplateMatch[] {
  const available = scope ? filterModelTemplatesForScope(templates, scope) : templates;
  if (!modelId.trim()) return available.slice(0, limit).map(template => ({ score: 0, template }));
  return available
    .map((template, order) => ({ match: matchScore(modelId, template), order, template }))
    .filter((item): item is typeof item & { match: NonNullable<typeof item.match> } => Boolean(item.match))
    .sort(
      (left, right) =>
        right.match.rank - left.match.rank ||
        right.match.length - left.match.length ||
        left.order - right.order,
    )
    .map(item => ({ score: item.match.score, template: item.template }))
    .slice(0, limit);
}

export function filterModelTemplatesForScope(
  templates: ModelTemplate[],
  scope: ModelTemplateScope,
): ModelTemplate[] {
  return templates.filter(template => template.interfaceType === undefined || template.interfaceType === scope.interfaceType);
}

function modalitySupportsText(model: Record<string, unknown>): boolean {
  const modalities = record(model.modalities);
  const output = modalitiesList(modalities?.output);
  if (output.length > 0 && !output.includes('text')) return false;
  return !/(?:embedding|embed|tts|speech|transcri|whisper|image|imagen|imagine|video|veo|realtime|live|audio)/iu.test(
    String(model.id ?? model.name ?? ''),
  );
}

function modalitiesList(value: unknown): string[] {
  return modalities(value);
}

function cloudReasoningEfforts(model: Record<string, unknown>): ReasoningEffort[] {
  if (!Array.isArray(model.reasoning_options)) return [];
  const values = model.reasoning_options.flatMap(option => {
    const parsed = record(option);
    return parsed?.type === 'effort' ? modalities(parsed.values) : [];
  });
  const names: Record<string, string> = {
    high: '高',
    low: '低',
    max: '最高',
    medium: '中',
    minimal: '最低',
    none: '关闭',
    xhigh: '极高',
  };
  return [...new Set(values)].map(id => ({ id, name: names[id] ?? id }));
}

function cloudCapabilities(model: Record<string, unknown>): ModelSettings['capabilities'] {
  const modalities = record(model.modalities);
  return {
    reasoning: capability(model.reasoning),
    toolCalling: capability(model.tool_call ?? model.toolCall),
    vision: capability(modalitiesList(modalities?.input).includes('image')),
    webSearch: 'auto',
  };
}

export function parseModelsDevCatalog(payload: unknown): ModelTemplate[] {
  const root = record(payload);
  if (!root) return [];
  const result: ModelTemplate[] = [];
  for (const [providerId, providerValue] of Object.entries(root)) {
    const provider = record(providerValue);
    const models = record(provider?.models);
    if (!models) continue;
    for (const [modelId, modelValue] of Object.entries(models)) {
      const model = record(modelValue);
      if (!model || !modalitySupportsText({ ...model, id: modelId })) continue;
      const limit = record(model.limit);
      result.push({
        aliases: [modelId],
        confidence: 'medium',
        id: `models.dev:${providerId}:${modelId}`,
        name: typeof model.name === 'string' ? model.name : modelId,
        match: parseMatchRules(undefined, modelId, [modelId], []),
        patterns: [],
        provider: providerId,
        revision: typeof model.last_updated === 'string' ? model.last_updated : 'cloud',
        settings: {
          capabilities: cloudCapabilities(model),
          contextWindow: number(limit?.context, DEFAULT_CONTEXT_WINDOW),
          maxOutputTokens: number(limit?.output),
          reasoningEfforts: cloudReasoningEfforts(model),
          temperature: model.temperature === false ? undefined : undefined,
        },
        source: 'cloud',
        sourceUrl: MODELS_DEV_CATALOG_URL,
        status: typeof model.status === 'string' && model.status !== 'active' ? 'preview' : 'active',
      });
    }
  }
  return result;
}

export async function fetchModelsDevCatalog(signal?: AbortSignal): Promise<ModelTemplate[]> {
  const response = await fetch(MODELS_DEV_CATALOG_URL, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`云端模型目录获取失败（HTTP ${response.status}）。`);
  return parseModelsDevCatalog(await response.json());
}

export function templateSettings(template: ModelTemplate): ModelSettings {
  return normalizeModelSettings(template.settings);
}

/** 云端聚合目录只补充协议无关的可靠字段；不覆盖推理档位、原生联网与采样细节。 */
export function settingsForAppliedTemplate(template: ModelTemplate, current: ModelSettings): ModelSettings {
  const next = templateSettings(template);
  if (template.source !== 'cloud') return next;
  const preserved = normalizeModelSettings(current);
  return {
    ...preserved,
    capabilities: {
      ...preserved.capabilities,
      reasoning: next.capabilities.reasoning,
      toolCalling: next.capabilities.toolCalling,
      vision: next.capabilities.vision,
    },
    contextWindow: next.contextWindow,
    maxOutputTokens: next.maxOutputTokens,
  };
}
