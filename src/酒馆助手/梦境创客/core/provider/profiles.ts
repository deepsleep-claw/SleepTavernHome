import type { LanguageModel } from 'ai';
import { createProbeModel, type ProviderProtocol } from '../provider-probe';
import { decryptLocalPayload, encryptLocalPayload, type EncryptedPayload } from './crypto';

export type ApiSecrets = {
  apiKey: string;
  headers: Record<string, string>;
};

export type ApiProfile = {
  baseURL: string;
  id: string;
  model: string;
  name: string;
  protocol: ProviderProtocol;
  secrets: EncryptedPayload;
};

export type ApiProfileInput = Omit<ApiProfile, 'id' | 'secrets'> & {
  apiKey?: string;
  headers?: Record<string, string>;
  id?: string;
};

export async function createApiProfile(input: ApiProfileInput): Promise<ApiProfile> {
  return {
    baseURL: input.baseURL.trim(),
    id: input.id ?? crypto.randomUUID(),
    model: input.model.trim(),
    name: input.name.trim(),
    protocol: input.protocol,
    secrets: await encryptLocalPayload({ apiKey: input.apiKey ?? '', headers: input.headers ?? {} }),
  };
}

export async function updateApiProfile(profile: ApiProfile, input: ApiProfileInput): Promise<ApiProfile> {
  const previous = await decryptLocalPayload<ApiSecrets>(profile.secrets);
  try {
    return await createApiProfile({
      ...input,
      apiKey: input.apiKey || previous.apiKey,
      headers: input.headers ?? previous.headers,
      id: profile.id,
    });
  } finally {
    previous.apiKey = '';
    Object.keys(previous.headers).forEach(key => {
      previous.headers[key] = '';
      delete previous.headers[key];
    });
  }
}

export async function withApiModel<T>(profile: ApiProfile, action: (model: LanguageModel) => Promise<T>): Promise<T> {
  const secrets = await decryptLocalPayload<ApiSecrets>(profile.secrets);
  try {
    const model = createProbeModel({
      apiKey: secrets.apiKey,
      baseURL: profile.baseURL,
      headers: secrets.headers,
      model: profile.model,
      protocol: profile.protocol,
    });
    return await action(model);
  } finally {
    secrets.apiKey = '';
    Object.keys(secrets.headers).forEach(key => {
      secrets.headers[key] = '';
      delete secrets.headers[key];
    });
  }
}

export async function listApiModels(profile: ApiProfile): Promise<string[]> {
  const secrets = await decryptLocalPayload<ApiSecrets>(profile.secrets);
  try {
    const headers = new Headers(secrets.headers);
    if (profile.protocol === 'anthropic') {
      if (!headers.has('x-api-key')) headers.set('x-api-key', secrets.apiKey);
      if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    } else if (!headers.has('authorization')) {
      headers.set('authorization', `Bearer ${secrets.apiKey}`);
    }
    const root = `${profile.baseURL.replace(/\/+$/u, '')}/`;
    const response = await fetch(new URL('models', root), { headers, method: 'GET' });
    if (!response.ok) {
      const error = new Error(`获取模型失败（HTTP ${response.status}）。`) as Error & { statusCode: number };
      error.statusCode = response.status;
      throw error;
    }
    const raw = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error('模型接口没有返回JSON。请确认Base URL填写的是API版本根路径（常见为“/v1”），而不是服务首页。', { cause: error });
    }
    const values = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object'
        ? ((payload as { data?: unknown; models?: unknown }).data ?? (payload as { models?: unknown }).models)
        : undefined;
    if (!Array.isArray(values)) throw new Error('接口返回的模型列表格式无法识别。');
    return [...new Set(values
      .map(item => (typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.length > 0))]
      .sort((left, right) => left.localeCompare(right));
  } finally {
    secrets.apiKey = '';
    Object.keys(secrets.headers).forEach(key => {
      secrets.headers[key] = '';
      delete secrets.headers[key];
    });
  }
}

export type ProviderFailure = {
  code: 'AUTH_REJECTED' | 'CORS_SUSPECTED' | 'REQUEST_FAILED';
  message: string;
};

function providerStatusCode(error: unknown, seen = new Set<unknown>()): number | undefined {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);
  const value = error as { cause?: unknown; errors?: unknown[]; lastError?: unknown; statusCode?: unknown };
  if (typeof value.statusCode === 'number') return value.statusCode;
  return (
    providerStatusCode(value.lastError, seen) ??
    value.errors?.map(item => providerStatusCode(item, seen)).find(status => status !== undefined) ??
    providerStatusCode(value.cause, seen)
  );
}

export function normalizeProviderFailure(error: unknown): ProviderFailure {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = providerStatusCode(error);
  if (statusCode === 401 || /\b401\b|invalid (?:api )?(?:key|token)|unauthori[sz]ed/iu.test(message)) {
    return {
      code: 'AUTH_REJECTED',
      message: 'API Key被接口拒绝（HTTP 401）。请在API页保存可用的Key，然后从中断处继续。',
    };
  }
  const cors =
    error instanceof TypeError ||
    /failed to fetch|load failed|networkerror|cors|access-control-allow-origin/iu.test(message);
  return cors
    ? {
        code: 'CORS_SUSPECTED',
        message: '浏览器无法访问该接口。请改用允许浏览器跨域访问的地址，或配置本地反向代理。',
      }
    : { code: 'REQUEST_FAILED', message };
}

export class ApiProfileRegistry {
  private readonly profiles = new Map<string, ApiProfile>();

  constructor(profiles: ApiProfile[] = []) {
    profiles.forEach(profile => this.profiles.set(profile.id, profile));
  }

  get(id: string): ApiProfile | undefined {
    const profile = this.profiles.get(id);
    return profile ? structuredClone(profile) : undefined;
  }

  list(): ApiProfile[] {
    return [...this.profiles.values()].map(profile => structuredClone(profile));
  }

  remove(id: string): boolean {
    return this.profiles.delete(id);
  }

  save(profile: ApiProfile): void {
    this.profiles.set(profile.id, structuredClone(profile));
  }
}
