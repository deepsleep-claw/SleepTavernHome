import type { EncryptedPayload } from './crypto';
import { decryptLocalPayload, encryptLocalPayload } from './crypto';
import type { ProviderCompatibilityMode, ProviderInterfaceType, ProviderRuntime } from '../provider-probe';
import { createProviderRuntime } from '../provider-probe';
import {
  EMPTY_ADVANCED_REQUEST,
  mergeExtraParameterLayers,
  mergeRequestHeaders,
  normalizeAdvancedRequestDocument,
  normalizeRequestHeaders,
  parseAdvancedRequestDocument,
  type AdvancedRequestDocument,
  type AdvancedRequestValues,
} from './advanced-request';
import {
  defaultModelSettings,
  normalizeModelSettings,
  type AppliedModelTemplate,
  type ModelSettings,
} from './model-catalog';
import type { ApiProfile } from './profiles';

export type ApiModel = {
  appliedModelTemplate?: AppliedModelTemplate;
  compatibilityMode: ProviderCompatibilityMode;
  enabled: boolean;
  id: string;
  modelId: string;
  modelSettings: ModelSettings;
  name: string;
  requestSecrets?: EncryptedPayload;
};

export type ApiProvider = {
  baseURL: string;
  enabled: boolean;
  id: string;
  interfaceType: ProviderInterfaceType;
  models: ApiModel[];
  name: string;
  secrets: EncryptedPayload;
};

export type ModelSelection = {
  modelId: string;
  providerId: string;
};

export type ApiProviderSecretValues = AdvancedRequestValues & { apiKey: string };
export type ApiModelSecretValues = AdvancedRequestValues;

export type ApiProviderInput = {
  apiKey?: string;
  baseURL: string;
  enabled: boolean;
  extraParameters?: AdvancedRequestDocument;
  headers?: Record<string, string>;
  id?: string;
  interfaceType: ProviderInterfaceType;
  name: string;
};

export type ApiModelInput = {
  appliedModelTemplate?: AppliedModelTemplate | null;
  compatibilityMode: ProviderCompatibilityMode;
  enabled: boolean;
  extraParameters?: AdvancedRequestDocument;
  headers?: Record<string, string>;
  id?: string;
  modelId: string;
  modelSettings?: Partial<ModelSettings>;
  name: string;
};

export type ApiProviderBundle = {
  models: Array<Omit<ApiModelInput, 'id'> & { request?: ApiModelSecretValues }>;
  provider: Omit<ApiProviderInput, 'id'> & { request?: ApiProviderSecretValues };
  type: 'dream-card-agent-provider';
  version: 1;
};

function emptyModelSecrets(): ApiModelSecretValues {
  return structuredClone(EMPTY_ADVANCED_REQUEST);
}

function normalizeModel(model: ApiModel): ApiModel {
  return {
    ...structuredClone(model),
    appliedModelTemplate: model.appliedModelTemplate ? structuredClone(model.appliedModelTemplate) : undefined,
    compatibilityMode: model.compatibilityMode === 'deepseek' ? 'deepseek' : 'standard',
    enabled: model.enabled !== false,
    modelId: String(model.modelId ?? '').trim(),
    modelSettings: normalizeModelSettings(model.modelSettings),
    name: String(model.name ?? '').trim() || String(model.modelId ?? '').trim() || '未命名模型',
  };
}

export function normalizeApiProvider(provider: ApiProvider): ApiProvider {
  const seen = new Set<string>();
  return {
    ...structuredClone(provider),
    baseURL: String(provider.baseURL ?? '').trim(),
    enabled: provider.enabled !== false,
    interfaceType:
      provider.interfaceType === 'anthropic' || provider.interfaceType === 'openai-responses'
        ? provider.interfaceType
        : 'openai-chat',
    models: (provider.models ?? []).map(normalizeModel).filter(model => {
      if (!model.id || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    }),
    name: String(provider.name ?? '').trim() || '未命名渠道',
  };
}

function normalizeAdvancedValues(value: Partial<AdvancedRequestValues> | undefined): AdvancedRequestValues {
  return {
    extraParameters: normalizeAdvancedRequestDocument(value?.extraParameters),
    headers: normalizeRequestHeaders(value?.headers),
  };
}

async function providerSecretValues(provider: ApiProvider): Promise<ApiProviderSecretValues> {
  const value = await decryptLocalPayload<Partial<ApiProviderSecretValues>>(provider.secrets);
  return {
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    ...normalizeAdvancedValues(value),
  };
}

async function modelSecretValues(model: ApiModel): Promise<ApiModelSecretValues> {
  if (!model.requestSecrets) return emptyModelSecrets();
  return normalizeAdvancedValues(await decryptLocalPayload<Partial<ApiModelSecretValues>>(model.requestSecrets));
}

export async function revealApiProvider(provider: ApiProvider): Promise<ApiProviderSecretValues> {
  return providerSecretValues(provider);
}

export async function revealApiModel(model: ApiModel): Promise<ApiModelSecretValues> {
  return modelSecretValues(model);
}

export async function createApiProvider(input: ApiProviderInput, models: ApiModel[] = []): Promise<ApiProvider> {
  const values = normalizeAdvancedValues(input);
  // 保存时同步校验附加参数，避免把无法执行的配置留在设置里。
  parseAdvancedRequestDocument(values.extraParameters);
  return normalizeApiProvider({
    baseURL: input.baseURL,
    enabled: input.enabled,
    id: input.id ?? crypto.randomUUID(),
    interfaceType: input.interfaceType,
    models,
    name: input.name,
    secrets: await encryptLocalPayload({ apiKey: input.apiKey ?? '', ...values }),
  });
}

export async function updateApiProvider(provider: ApiProvider, input: ApiProviderInput): Promise<ApiProvider> {
  const previous = await providerSecretValues(provider);
  try {
    return await createApiProvider(
      {
        ...input,
        apiKey: input.apiKey || previous.apiKey,
        extraParameters: input.extraParameters ?? previous.extraParameters,
        headers: input.headers ?? previous.headers,
        id: provider.id,
      },
      provider.models,
    );
  } finally {
    previous.apiKey = '';
    Object.keys(previous.headers).forEach(key => delete previous.headers[key]);
    previous.extraParameters.text = '';
  }
}

export async function createApiModel(input: ApiModelInput): Promise<ApiModel> {
  const values = normalizeAdvancedValues(input);
  parseAdvancedRequestDocument(values.extraParameters);
  return normalizeModel({
    appliedModelTemplate: input.appliedModelTemplate ? structuredClone(input.appliedModelTemplate) : undefined,
    compatibilityMode: input.compatibilityMode,
    enabled: input.enabled,
    id: input.id ?? crypto.randomUUID(),
    modelId: input.modelId,
    modelSettings: normalizeModelSettings(input.modelSettings ?? defaultModelSettings()),
    name: input.name,
    requestSecrets: await encryptLocalPayload(values),
  });
}

export async function updateApiModel(model: ApiModel, input: ApiModelInput): Promise<ApiModel> {
  const previous = await modelSecretValues(model);
  try {
    return await createApiModel({
      ...input,
      appliedModelTemplate:
        input.appliedModelTemplate === undefined
          ? structuredClone(model.appliedModelTemplate)
          : input.appliedModelTemplate ?? undefined,
      extraParameters: input.extraParameters ?? previous.extraParameters,
      headers: input.headers ?? previous.headers,
      id: model.id,
      modelSettings: input.modelSettings ?? model.modelSettings,
    });
  } finally {
    Object.keys(previous.headers).forEach(key => delete previous.headers[key]);
    previous.extraParameters.text = '';
  }
}

export function findSelectedModel(
  providers: ApiProvider[],
  selection?: Partial<ModelSelection>,
  requireEnabled = true,
): { model: ApiModel; provider: ApiProvider } | undefined {
  if (!selection?.providerId || !selection.modelId) return undefined;
  const provider = providers.find(item => item.id === selection.providerId);
  const model = provider?.models.find(item => item.id === selection.modelId);
  if (!provider || !model || (requireEnabled && (!provider.enabled || !model.enabled))) return undefined;
  return { model: structuredClone(model), provider: structuredClone(provider) };
}

export async function withProviderModelRuntime<T>(
  provider: ApiProvider,
  model: ApiModel,
  action: (runtime: ProviderRuntime) => Promise<T>,
  webSearchMaxUses = 10,
): Promise<T> {
  const providerValues = await providerSecretValues(provider);
  const modelValues = await modelSecretValues(model);
  try {
    const extraParameters = mergeExtraParameterLayers(
      parseAdvancedRequestDocument(providerValues.extraParameters),
      parseAdvancedRequestDocument(modelValues.extraParameters),
    );
    return await action(
      createProviderRuntime(
        {
          apiKey: providerValues.apiKey,
          baseURL: provider.baseURL,
          compatibilityMode: model.compatibilityMode,
          extraParameters,
          headers: mergeRequestHeaders(providerValues.headers, modelValues.headers),
          interfaceType: provider.interfaceType,
          model: model.modelId,
        },
        webSearchMaxUses,
      ),
    );
  } finally {
    providerValues.apiKey = '';
    Object.keys(providerValues.headers).forEach(key => delete providerValues.headers[key]);
    Object.keys(modelValues.headers).forEach(key => delete modelValues.headers[key]);
    providerValues.extraParameters.text = '';
    modelValues.extraParameters.text = '';
  }
}

export async function listProviderModels(provider: ApiProvider): Promise<string[]> {
  const values = await providerSecretValues(provider);
  try {
    const headers = new Headers(values.headers);
    if (provider.interfaceType === 'anthropic') {
      if (!headers.has('x-api-key')) headers.set('x-api-key', values.apiKey);
      if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    } else if (!headers.has('authorization')) {
      headers.set('authorization', `Bearer ${values.apiKey}`);
    }
    const response = await fetch(new URL('models', `${provider.baseURL.replace(/\/+$/u, '')}/`), {
      headers,
      method: 'GET',
    });
    if (!response.ok) {
      const error = new Error(`获取模型失败（HTTP ${response.status}）。`) as Error & { statusCode: number };
      error.statusCode = response.status;
      throw error;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await response.text()) as unknown;
    } catch (error) {
      throw new Error('模型接口没有返回JSON。请确认Base URL填写的是API版本根路径。', { cause: error });
    }
    const valuesList = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object'
        ? ((payload as { data?: unknown; models?: unknown }).data ?? (payload as { models?: unknown }).models)
        : undefined;
    if (!Array.isArray(valuesList)) throw new Error('接口返回的模型列表格式无法识别。');
    return [...new Set(valuesList.flatMap(item => {
      const id = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
      return typeof id === 'string' && id ? [id] : [];
    }))].sort((left, right) => left.localeCompare(right));
  } finally {
    values.apiKey = '';
    Object.keys(values.headers).forEach(key => delete values.headers[key]);
    values.extraParameters.text = '';
  }
}

export async function exportApiProviderBundle(provider: ApiProvider, includeSecrets = false): Promise<ApiProviderBundle> {
  const providerRequest = includeSecrets ? await providerSecretValues(provider) : undefined;
  const models = await Promise.all(provider.models.map(async model => ({
    appliedModelTemplate: model.appliedModelTemplate,
    compatibilityMode: model.compatibilityMode,
    enabled: model.enabled,
    modelId: model.modelId,
    modelSettings: model.modelSettings,
    name: model.name,
    request: includeSecrets ? await modelSecretValues(model) : undefined,
  })));
  return {
    models,
    provider: {
      apiKey: providerRequest?.apiKey ?? '',
      baseURL: provider.baseURL,
      enabled: provider.enabled,
      extraParameters: providerRequest?.extraParameters,
      headers: providerRequest?.headers,
      interfaceType: provider.interfaceType,
      name: provider.name,
      request: providerRequest,
    },
    type: 'dream-card-agent-provider',
    version: 1,
  };
}

export function parseApiProviderBundle(source: string): ApiProviderBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error('Provider导入文件不是有效的JSON。', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Provider导入文件格式无效。');
  const value = parsed as Partial<ApiProviderBundle>;
  if (value.type !== 'dream-card-agent-provider' || value.version !== 1 || !value.provider || !Array.isArray(value.models)) {
    throw new Error('这不是梦境创客支持的Provider导出文件。');
  }
  return structuredClone(value as ApiProviderBundle);
}

/** 旧Profile只用于一次性设置迁移；Model沿用旧ID，方便旧引用确定性映射。 */
export function migrateLegacyProfiles(profiles: ApiProfile[]): ApiProvider[] {
  return profiles.map(profile => normalizeApiProvider({
    baseURL: profile.baseURL,
    enabled: true,
    id: `provider:${profile.id}`,
    interfaceType: profile.interfaceType,
    models: [{
      appliedModelTemplate: profile.appliedModelTemplate,
      compatibilityMode: profile.compatibilityMode,
      enabled: true,
      id: profile.id,
      modelId: profile.model,
      modelSettings: profile.modelSettings,
      name: profile.model || profile.name,
    }],
    name: profile.name,
    secrets: profile.secrets,
  }));
}

export function legacySelectionForProfile(profileId?: string): ModelSelection | undefined {
  return profileId ? { modelId: profileId, providerId: `provider:${profileId}` } : undefined;
}
