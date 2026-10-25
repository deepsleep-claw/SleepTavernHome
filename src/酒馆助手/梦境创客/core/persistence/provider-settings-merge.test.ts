import { describe, expect, it } from 'vitest';
import type { ApiProvider } from '../provider/provider-config';
import { defaultModelSettings } from '../provider/model-catalog';
import { mergeProviderSettings } from './provider-settings-merge';

function provider(id: string): ApiProvider {
  return {
    id,
    name: id,
    baseURL: 'https://example.test',
    enabled: true,
    interfaceType: 'openai-chat',
    secrets: { algorithm: 'AES-GCM', ciphertext: '', iterations: 1, iv: '', salt: '', version: 1 },
    models: [
      {
        id: 'one',
        name: 'one',
        modelId: 'one',
        enabled: true,
        compatibilityMode: 'standard',
        modelSettings: defaultModelSettings(),
      },
      {
        id: 'two',
        name: 'two',
        modelId: 'two',
        enabled: true,
        compatibilityMode: 'standard',
        modelSettings: defaultModelSettings(),
      },
    ],
  };
}

describe('Provider settings merge', () => {
  it('两个 Provider 分别修改时保留双方修改与新增记录', () => {
    const base = [provider('a'), provider('b')];
    const first = structuredClone(base);
    const second = structuredClone(base);
    first[0].name = 'A edited';
    second[1].name = 'B edited';
    second.push(provider('c'));
    expect(mergeProviderSettings(base, first, second).map(item => item.name)).toEqual(['A edited', 'B edited', 'c']);
  });

  it('同一 Provider 的字段和不同模型分别合并', () => {
    const base = [provider('a')];
    const first = structuredClone(base);
    const second = structuredClone(base);
    first[0].name = 'A edited';
    first[0].models[0].name = 'One edited';
    second[0].baseURL = 'https://new.example.test';
    second[0].models[1].enabled = false;
    const merged = mergeProviderSettings(base, first, second)[0];
    expect(merged).toMatchObject({ name: 'A edited', baseURL: 'https://new.example.test' });
    expect(merged.models).toEqual([first[0].models[0], second[0].models[1]]);
  });

  it('同一模型的独立设置字段可以合并', () => {
    const base = [provider('a')];
    const first = structuredClone(base);
    const second = structuredClone(base);
    first[0].models[0].modelSettings.contextWindow = 123000;
    second[0].models[0].modelSettings.maxOutputTokens = 4000;
    expect(mergeProviderSettings(base, first, second)[0].models[0].modelSettings).toMatchObject({
      contextWindow: 123000,
      maxOutputTokens: 4000,
    });
  });

  it('显式删除不影响其它记录，旧编辑不能复活已删除的模型', () => {
    const base = [provider('a')];
    const first = structuredClone(base);
    first[0].models.splice(0, 1);
    const second = structuredClone(base);
    second[0].models[1].name = 'new name';
    expect(mergeProviderSettings(base, first, second)[0].models).toEqual([second[0].models[1]]);
    second[0].models[0].name = 'stale';
    expect(() => mergeProviderSettings(base, second, first)).toThrow('已被删除');
  });

  it('同一字段冲突会拒绝写入且不改变原始数据', () => {
    const base = [provider('a')];
    const first = structuredClone(base);
    const second = structuredClone(base);
    first[0].name = 'first';
    second[0].name = 'second';
    expect(() => mergeProviderSettings(base, first, second)).toThrow('冲突');
    expect(second[0].name).toBe('second');
  });

  it('加密信封整体合并，不拼接两个写入的密文和 IV', () => {
    const base = [provider('a')];
    const first = structuredClone(base);
    const second = structuredClone(base);
    first[0].secrets.ciphertext = 'first';
    second[0].secrets.iv = 'second';
    expect(() => mergeProviderSettings(base, first, second)).toThrow('连接配置');
  });
});
