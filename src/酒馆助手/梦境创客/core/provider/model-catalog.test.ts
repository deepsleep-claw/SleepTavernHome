import { describe, expect, it } from 'vitest';
import {
  builtinModelTemplates,
  defaultModelSettings,
  matchModelTemplates,
  parseModelsDevCatalog,
  templateSettings,
} from './model-catalog';

describe('model catalog', () => {
  it('加载内置目录并优先精确匹配模型ID', () => {
    const templates = builtinModelTemplates();
    expect(templates.length).toBeGreaterThan(15);
    const [match] = matchModelTemplates('gpt-5.6-sol', templates);
    expect(match).toMatchObject({ score: 1, template: { id: 'openai:gpt-5.6-sol' } });
    expect(match.template.settings.contextWindow).toBe(1_050_000);
  });

  it('支持显式Glob和低门槛模糊候选，但不会为无关ID硬匹配', () => {
    expect(matchModelTemplates('openai/gpt-5.6-sol-2026-08-01')[0]?.template.id).toBe('openai:gpt-5.6-sol');
    expect(matchModelTemplates('totally-unrelated-model')).toEqual([]);
  });

  it('解析models.dev目录并排除非文本生成模型', () => {
    const templates = parseModelsDevCatalog({
      openai: {
        models: {
          'gpt-test': {
            limit: { context: 200_000, output: 32_000 },
            modalities: { input: ['text', 'image'], output: ['text'] },
            name: 'GPT Test',
            reasoning: true,
            reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
            tool_call: true,
          },
          'text-embedding-test': {
            modalities: { input: ['text'], output: ['embedding'] },
          },
        },
      },
    });
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      id: 'models.dev:openai:gpt-test',
      settings: {
        capabilities: { reasoning: 'enabled', toolCalling: 'enabled', vision: 'enabled' },
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
        reasoningEfforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }, { id: 'max', name: '最高' }],
      },
      source: 'cloud',
    });
  });

  it('复制模板设置，默认0表示交给模板或回退值决定', () => {
    const defaults = defaultModelSettings();
    expect(defaults.contextWindow).toBe(0);
    const template = builtinModelTemplates()[0];
    expect(templateSettings(template)).not.toBe(template.settings);
  });
});
