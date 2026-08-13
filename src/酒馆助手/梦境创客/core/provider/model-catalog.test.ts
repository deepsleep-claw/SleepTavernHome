import { describe, expect, it } from 'vitest';
import {
  builtinModelTemplates,
  defaultModelSettings,
  matchModelTemplates,
  parseModelsDevCatalog,
  settingsForAppliedTemplate,
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

  it('支持由旧Glob迁移出的显式前后缀规则，但不会为无关ID硬匹配', () => {
    expect(matchModelTemplates('openai/gpt-5.6-sol-2026-08-01')[0]?.template.id).toBe('openai:gpt-5.6-sol');
    expect(matchModelTemplates('totally-unrelated-model')).toEqual([]);
  });

  it('先按接口格式过滤，兼容模式由命中的模型模板提供', () => {
    const templates = builtinModelTemplates();
    expect(matchModelTemplates('deepseek-v4-flash', templates, 1, {
      compatibilityMode: 'deepseek',
      interfaceType: 'openai-responses',
    })[0]?.template.id).toBe('deepseek:responses:v4-flash');
    expect(matchModelTemplates('deepseek-v4-flash', templates, 1, {
      compatibilityMode: 'deepseek',
      interfaceType: 'anthropic',
    })[0]?.template.id).toBe('deepseek:anthropic:v4-flash');
    expect(matchModelTemplates('deepseek-v4-flash', templates, 1, {
      compatibilityMode: 'standard',
      interfaceType: 'openai-chat',
    })[0]?.template).toMatchObject({ compatibilityMode: 'deepseek', id: 'deepseek:chat:v4-flash' });
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

  it('云端补充应用可靠能力字段，但不覆盖推理档位、联网与采样设置', () => {
    const cloud = parseModelsDevCatalog({
      vendor: {
        models: {
          model: {
            limit: { context: 200_000, output: 16_000 },
            modalities: { input: ['text', 'image'], output: ['text'] },
            reasoning: true,
            reasoning_options: [{ type: 'effort', values: ['low'] }],
            tool_call: true,
          },
        },
      },
    })[0];
    const applied = settingsForAppliedTemplate(cloud, {
      capabilities: { reasoning: 'disabled', toolCalling: 'auto', vision: 'auto', webSearch: 'enabled' },
      contextWindow: 0,
      maxOutputTokens: 0,
      reasoningEfforts: [{ id: 'custom', name: '自定义' }],
      temperature: 0.7,
      topP: 0.8,
    });
    expect(applied).toMatchObject({
      capabilities: { reasoning: 'enabled', toolCalling: 'enabled', vision: 'enabled', webSearch: 'enabled' },
      contextWindow: 200_000,
      maxOutputTokens: 16_000,
      reasoningEfforts: [{ id: 'custom', name: '自定义' }],
      temperature: 0.7,
      topP: 0.8,
    });
  });
});
