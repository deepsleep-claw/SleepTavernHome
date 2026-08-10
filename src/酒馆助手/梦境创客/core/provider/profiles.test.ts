import { describe, expect, it, vi } from 'vitest';
import { decryptLocalPayload, encryptLocalPayload } from './crypto';
import {
  ApiProfileRegistry,
  createApiProfile,
  listApiModels,
  normalizeApiProfile,
  normalizeProviderFailure,
  updateApiProfile,
  withApiModel,
} from './profiles';

describe('encrypted API profiles', () => {
  it('使用随机盐和AES-GCM往返Key与自定义请求头', async () => {
    const value = { apiKey: 'secret-key', headers: { 'X-Custom': 'secret-header' } };
    const first = await encryptLocalPayload(value);
    const second = await encryptLocalPayload(value);
    expect(first).toMatchObject({ algorithm: 'AES-GCM', iterations: 150_000, version: 1 });
    expect(first.ciphertext).not.toContain('secret-key');
    expect(first.salt).not.toBe(second.salt);
    expect(await decryptLocalPayload(first)).toEqual(value);
  });

  it('拒绝未知版本和被篡改密文', async () => {
    const encrypted = await encryptLocalPayload({ key: 'value' });
    await expect(decryptLocalPayload({ ...encrypted, version: 2 as 1 })).rejects.toThrow('不支持');
    await expect(decryptLocalPayload({ ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` })).rejects.toThrow(
      '无法解密',
    );
  });

  it('创建、更新并管理多套最小Profile', async () => {
    const profile = await createApiProfile({
      apiKey: 'key',
      baseURL: ' http://localhost:3000/v1 ',
      compatibilityMode: 'standard',
      headers: {},
      interfaceType: 'openai-chat',
      model: ' model ',
      name: ' 本地 ',
    });
    expect(profile).toMatchObject({ baseURL: 'http://localhost:3000/v1', model: 'model', name: '本地' });
    const updated = await updateApiProfile(profile, {
      apiKey: 'new',
      baseURL: 'https://example.test',
      compatibilityMode: 'deepseek',
      headers: { Authorization: 'custom' },
      interfaceType: 'openai-chat',
      model: 'next',
      name: '远程',
    });
    expect(updated.id).toBe(profile.id);
    const registry = new ApiProfileRegistry([profile]);
    registry.save(updated);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get(profile.id)?.name).toBe('远程');
    expect(registry.remove(profile.id)).toBe(true);
    expect(registry.get(profile.id)).toBeUndefined();
  });

  it('旧协议字段只做确定性迁移，不根据模型名猜测兼容模式', async () => {
    const current = await createApiProfile({
      apiKey: 'key',
      baseURL: 'https://example.test/v1',
      compatibilityMode: 'standard',
      interfaceType: 'openai-chat',
      model: 'deepseek-v4-flash',
      name: '旧配置',
    });
    const legacy = {
      ...current,
      compatibilityMode: undefined,
      interfaceType: undefined,
      protocol: 'openai-compatible',
    } as never;
    expect(normalizeApiProfile(legacy)).toMatchObject({
      compatibilityMode: 'standard',
      interfaceType: 'openai-chat',
      model: 'deepseek-v4-flash',
    });
    expect(normalizeApiProfile(legacy)).not.toHaveProperty('protocol');
  });

  it('编辑已有Profile时留空Key和请求头会保留原凭据', async () => {
    const profile = await createApiProfile({
      apiKey: 'keep-key',
      baseURL: 'https://example.test/v1',
      compatibilityMode: 'standard',
      headers: { 'X-Keep': 'header' },
      interfaceType: 'openai-responses',
      model: 'old-model',
      name: '旧配置',
    });
    const updated = await updateApiProfile(profile, {
      apiKey: '',
      baseURL: 'https://example.test/v2',
      compatibilityMode: 'standard',
      interfaceType: 'openai-responses',
      model: 'new-model',
      name: '新配置',
    });
    await expect(decryptLocalPayload(updated.secrets)).resolves.toEqual({
      apiKey: 'keep-key',
      headers: { 'X-Keep': 'header' },
    });
  });

  it('仅在真实请求作用域临时创建Provider模型', async () => {
    const profile = await createApiProfile({
      apiKey: 'key',
      baseURL: 'https://example.test/v1',
      compatibilityMode: 'standard',
      headers: {},
      interfaceType: 'openai-responses',
      model: 'model',
      name: 'test',
    });
    const action = vi.fn(async model => model.modelId);
    await expect(withApiModel(profile, action)).resolves.toBe('model');
    expect(action).toHaveBeenCalledOnce();
  });

  it('按接口类型显式拉取并整理模型列表', async () => {
    const profile = await createApiProfile({
      apiKey: 'key',
      baseURL: 'https://example.test/v1',
      compatibilityMode: 'standard',
      headers: { 'X-Custom': 'value' },
      interfaceType: 'openai-responses',
      model: '',
      name: 'test',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }],
    }), { status: 200 }));
    await expect(listApiModels(profile)).resolves.toEqual(['model-a', 'model-b']);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://example.test/v1/models');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer key');
    expect(headers.get('x-custom')).toBe('value');
    fetchMock.mockRestore();
  });

  it('模型地址返回HTML时提示检查API版本根路径', async () => {
    const profile = await createApiProfile({
      apiKey: 'key',
      baseURL: 'https://example.test/',
      compatibilityMode: 'standard',
      interfaceType: 'openai-responses',
      model: '',
      name: 'test',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<!doctype html>', { status: 200 }));
    await expect(listApiModels(profile)).rejects.toThrow('API版本根路径');
    fetchMock.mockRestore();
  });

  it('模型列表鉴权失败沿用友好错误归一化', async () => {
    const profile = await createApiProfile({
      apiKey: 'bad',
      baseURL: 'https://example.test/v1/',
      compatibilityMode: 'standard',
      interfaceType: 'anthropic',
      model: '',
      name: 'test',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    await expect(listApiModels(profile)).rejects.toMatchObject({ statusCode: 401 });
    fetchMock.mockRestore();
  });

  it('把鉴权、疑似CORS与普通请求失败分开呈现', () => {
    expect(normalizeProviderFailure(new TypeError('Failed to fetch'))).toMatchObject({ code: 'CORS_SUSPECTED' });
    expect(normalizeProviderFailure(new Error('401 Unauthorized'))).toMatchObject({ code: 'AUTH_REJECTED' });
    expect(normalizeProviderFailure({ lastError: { statusCode: 401 } })).toMatchObject({ code: 'AUTH_REJECTED' });
    expect(normalizeProviderFailure(new Error('500 Server Error'))).toEqual({
      code: 'REQUEST_FAILED',
      message: '500 Server Error',
    });
    expect(normalizeProviderFailure('NetworkError')).toMatchObject({ code: 'CORS_SUSPECTED' });
  });
});
