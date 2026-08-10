import { parse } from 'yaml';
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
  confidence: 'high' | 'low' | 'medium';
  id: string;
  name: string;
  patterns: string[];
  provider: string;
  revision: string;
  settings: ModelSettings;
  source: ModelTemplateSource;
  sourceUrl?: string;
  status?: 'active' | 'preview' | 'unverified';
};

export type ModelTemplateMatch = {
  score: number;
  template: ModelTemplate;
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

function parseBuiltinSource(source: string): ModelTemplate[] {
  const root = record(parse(source));
  const revision = typeof root?.revision === 'string' ? root.revision : 'unknown';
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
    return [{
      aliases: strings(value.aliases),
      confidence: value.confidence === 'low' || value.confidence === 'medium' ? value.confidence : 'high',
      id,
      name,
      patterns: strings(value.patterns),
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

function globMatches(value: string, pattern: string): boolean {
  const escaped = normalizeId(pattern).replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*');
  return new RegExp(`^${escaped}$`, 'u').test(value);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value}  `;
  return new Set(Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) => padded.slice(index, index + 3)));
}

function similarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return a.size + b.size === 0 ? 0 : (2 * intersection) / (a.size + b.size);
}

function matchScore(modelId: string, template: ModelTemplate): number {
  const normalized = normalizeId(modelId);
  const ids = [template.id, ...template.aliases].map(normalizeId);
  if (ids.includes(normalized)) return 1;
  if (template.patterns.some(pattern => globMatches(normalized, pattern))) return 0.9;
  return Math.max(...ids.map(candidate => similarity(normalized, candidate)), 0) * 0.85;
}

export function matchModelTemplates(
  modelId: string,
  templates: ModelTemplate[] = builtinModelTemplates(),
  limit = 20,
): ModelTemplateMatch[] {
  if (!modelId.trim()) return templates.slice(0, limit).map(template => ({ score: 0, template }));
  return templates
    .map(template => ({ score: matchScore(modelId, template), template }))
    .filter(match => match.score >= 0.66)
    .sort((left, right) => right.score - left.score || left.template.name.localeCompare(right.template.name, 'zh-CN'))
    .slice(0, limit);
}

function modalitySupportsText(model: Record<string, unknown>): boolean {
  const modalities = record(model.modalities);
  const output = strings(modalities?.output);
  if (output.length > 0 && !output.includes('text')) return false;
  return !/(?:embedding|embed|tts|speech|transcri|whisper|image|imagen|imagine|video|veo|realtime|live|audio)/iu.test(
    String(model.id ?? model.name ?? ''),
  );
}

function cloudCapabilities(model: Record<string, unknown>): ModelSettings['capabilities'] {
  const modalities = record(model.modalities);
  return {
    reasoning: capability(model.reasoning),
    toolCalling: capability(model.tool_call ?? model.toolCall),
    vision: capability(strings(modalities?.input).includes('image')),
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
        patterns: [],
        provider: providerId,
        revision: typeof model.last_updated === 'string' ? model.last_updated : 'cloud',
        settings: {
          capabilities: cloudCapabilities(model),
          contextWindow: number(limit?.context, DEFAULT_CONTEXT_WINDOW),
          maxOutputTokens: number(limit?.output),
          reasoningEfforts: [],
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
