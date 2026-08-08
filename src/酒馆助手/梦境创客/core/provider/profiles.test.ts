import { describe, expect, it, vi } from 'vitest';
import { decryptLocalPayload, encryptLocalPayload } from './crypto';
import {
  ApiProfileRegistry,
  createApiProfile,
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
      headers: {},
      model: ' model ',
      name: ' 本地 ',
      protocol: 'openai-compatible',
    });
    expect(profile).toMatchObject({ baseURL: 'http://localhost:3000/v1', model: 'model', name: '本地' });
    const updated = await updateApiProfile(profile, {
      apiKey: 'new',
      baseURL: 'https://example.test',
      headers: { Authorization: 'custom' },
      model: 'next',
      name: '远程',
      protocol: 'openai-chat',
    });
    expect(updated.id).toBe(profile.id);
    const registry = new ApiProfileRegistry([profile]);
    registry.save(updated);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get(profile.id)?.name).toBe('远程');
    expect(registry.remove(profile.id)).toBe(true);
    expect(registry.get(profile.id)).toBeUndefined();
  });

  it('仅在真实请求作用域临时创建Provider模型', async () => {
    const profile = await createApiProfile({
      apiKey: 'key',
      baseURL: 'https://example.test/v1',
      headers: {},
      model: 'model',
      name: 'test',
      protocol: 'openai-responses',
    });
    const action = vi.fn(async model => model.modelId);
    await expect(withApiModel(profile, action)).resolves.toBe('model');
    expect(action).toHaveBeenCalledOnce();
  });

  it('把疑似CORS与普通请求失败分开呈现', () => {
    expect(normalizeProviderFailure(new TypeError('Failed to fetch'))).toMatchObject({ code: 'CORS_SUSPECTED' });
    expect(normalizeProviderFailure(new Error('401 Unauthorized'))).toEqual({
      code: 'REQUEST_FAILED',
      message: '401 Unauthorized',
    });
    expect(normalizeProviderFailure('NetworkError')).toMatchObject({ code: 'CORS_SUSPECTED' });
  });
});
