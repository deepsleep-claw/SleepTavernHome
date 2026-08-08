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

export type ApiProfileInput = Omit<ApiProfile, 'id' | 'secrets'> & ApiSecrets & { id?: string };

export async function createApiProfile(input: ApiProfileInput): Promise<ApiProfile> {
  return {
    baseURL: input.baseURL.trim(),
    id: input.id ?? crypto.randomUUID(),
    model: input.model.trim(),
    name: input.name.trim(),
    protocol: input.protocol,
    secrets: await encryptLocalPayload({ apiKey: input.apiKey, headers: input.headers }),
  };
}

export async function updateApiProfile(profile: ApiProfile, input: ApiProfileInput): Promise<ApiProfile> {
  return createApiProfile({ ...input, id: profile.id });
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

export type ProviderFailure = {
  code: 'CORS_SUSPECTED' | 'REQUEST_FAILED';
  message: string;
};

export function normalizeProviderFailure(error: unknown): ProviderFailure {
  const message = error instanceof Error ? error.message : String(error);
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
