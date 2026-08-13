import { describe, expect, it } from 'vitest';
import {
  createApiModel,
  createApiProvider,
  exportApiProviderBundle,
  findSelectedModel,
  parseApiProviderBundle,
  revealApiModel,
  revealApiProvider,
} from './provider-config';

describe('provider config', () => {
  it('Provider与Model分别加密并按两层读取请求设置', async () => {
    const model = await createApiModel({
      compatibilityMode: 'deepseek', enabled: true,
      extraParameters: { format: 'json', text: '{"metadata":{"model":true}}' },
      headers: { Authorization: 'model' }, modelId: 'deepseek-v4', name: 'DeepSeek V4',
    });
    const provider = await createApiProvider({
      apiKey: 'secret', baseURL: 'https://example.invalid/v1', enabled: true,
      extraParameters: { format: 'yaml', text: 'metadata:\n  provider: true' },
      headers: { 'X-Provider': 'yes' }, interfaceType: 'openai-responses', name: '测试渠道',
    }, [model]);
    expect(JSON.stringify(provider.secrets)).not.toContain('secret');
    expect(await revealApiProvider(provider)).toMatchObject({ apiKey: 'secret', headers: { 'X-Provider': 'yes' } });
    expect(await revealApiModel(model)).toMatchObject({ headers: { Authorization: 'model' } });
    expect(findSelectedModel([provider], { providerId: provider.id, modelId: model.id })).toMatchObject({
      model: { modelId: 'deepseek-v4' }, provider: { name: '测试渠道' },
    });
  });

  it('禁用Provider或模型后会话选择失效，但仍可在管理界面读取实体', async () => {
    const model = await createApiModel({ compatibilityMode: 'standard', enabled: false, modelId: 'm', name: 'M' });
    const provider = await createApiProvider({ apiKey: '', baseURL: '', enabled: true, interfaceType: 'openai-chat', name: 'P' }, [model]);
    const selection = { providerId: provider.id, modelId: model.id };
    expect(findSelectedModel([provider], selection)).toBeUndefined();
    expect(findSelectedModel([provider], selection, false)?.model.id).toBe(model.id);
  });

  it('导出默认排除敏感配置，显式选择后才包含，并校验导入格式', async () => {
    const model = await createApiModel({ compatibilityMode: 'standard', enabled: true, headers: { 'X-Model': 'secret' }, modelId: 'm', name: 'M' });
    const provider = await createApiProvider({ apiKey: 'key', baseURL: 'https://example.invalid', enabled: true, headers: { Authorization: 'secret' }, interfaceType: 'openai-chat', name: 'P' }, [model]);
    const safe = await exportApiProviderBundle(provider, false);
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(JSON.stringify(safe)).not.toContain('key');
    const complete = await exportApiProviderBundle(provider, true);
    expect(complete.provider.request?.apiKey).toBe('key');
    expect(complete.models[0].request?.headers).toEqual({ 'X-Model': 'secret' });
    expect(parseApiProviderBundle(JSON.stringify(complete))).toEqual(complete);
    expect(() => parseApiProviderBundle('{}')).toThrow('支持的Provider');
  });
});
