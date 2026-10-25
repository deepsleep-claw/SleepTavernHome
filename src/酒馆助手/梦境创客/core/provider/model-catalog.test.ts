import { describe, expect, it } from 'vitest';
import {
  builtinModelTemplates,
  matchModelTemplates,
  parseModelsDevCatalog,
  settingsForAppliedTemplate,
} from './model-catalog';

describe('model catalog', () => {
  it('新增系列按实际 ID、渠道前缀和快照后缀匹配具体模板', () => {
    const cases = [
      ['gpt-6-astra', 'openai:gpt-6-astra', 'openai-responses', 1050000],
      ['openai/gpt-6.1-sol-2026-10-14', 'openai:gpt-6.1-sol', 'openai-responses', 1050000],
      ['GPT_6_SOL', 'openai:gpt-6-sol', 'openai-responses', 1050000],
      ['gateway/openai/gpt-6-luna', 'openai:gpt-6-luna', 'openai-responses', 1050000],
      ['models/gemini-4-argon', 'google:gemini-4-argon:gemini', 'gemini', 1048576],
      ['google/gemini-4-argon', 'google:gemini-4-argon', 'openai-chat', 1048576],
      ['xai/grok-4.7-latest', 'xai:chat:grok-4.7', 'openai-chat', 500000],
      ['grok-4.6', 'xai:responses:grok-4.6', 'openai-responses', 500000],
      ['grok-4.5-latest', 'xai:chat:grok-4.5', 'openai-chat', 500000],
      ['k3.1-pro', 'kimi-code:chat:k3.1-pro', 'openai-chat', 1048576],
      ['kimi/k3.1-pro-highspeed', 'kimi-code:responses:k3.1-pro-highspeed', 'openai-responses', 1048576],
      ['kimi-k3.1-pro-highspeed', 'kimi-code:anthropic:k3.1-pro-highspeed', 'anthropic', 1048576],
    ] as const;
    for (const [modelId, templateId, interfaceType, contextWindow] of cases) {
      const matched = matchModelTemplates(modelId, undefined, 1, { interfaceType, compatibilityMode: 'standard' })[0]
        ?.template;
      expect(matched, modelId).toMatchObject({ id: templateId, settings: { contextWindow } });
    }
  });

  it('Claude 5 和 5.5 的完整型号优先于通用系列，点号与横线版本一致', () => {
    for (const id of [
      'opus-5',
      'sonnet-5',
      'fable-5',
      'mythos-5',
      'fable-5-1',
      'mythos-5-1',
      'opus-5-5',
      'sonnet-5-5',
      'haiku-5-5',
    ]) {
      for (const query of [
        `claude-${id}`,
        `anthropic/claude-${id}-20261001`,
        `claude-${id.replace('-5-5', '-5.5').replace('-5-1', '-5.1')}`,
      ]) {
        const matched = matchModelTemplates(query, undefined, 1, {
          interfaceType: 'anthropic',
          compatibilityMode: 'standard',
        })[0]?.template;
        expect(matched?.id, query).toBe(`anthropic:claude-${id}`);
        expect(matched?.settings.contextWindow).toBe(1000000);
        expect(matched?.settings.maxOutputTokens).toBe(128000);
      }
    }
  });

  it('含中间星号的旧规则可以匹配，实际小数点仍按字面解释', () => {
    expect(matchModelTemplates('vendor/claude-sonnet-4-6-20260217')[0]?.template.id).toBe('anthropic:claude-4.6');
    expect(matchModelTemplates('anthropic/claude-haiku-4-5-20251001')[0]?.template.id).toBe('anthropic:claude-4.5');
    expect(matchModelTemplates('gpt-6x1-sol')).toEqual([]);
    expect(matchModelTemplates('gpt-60-sol')).toEqual([]);
    expect(matchModelTemplates('not-gpt-6-astra')).toEqual([]);
    expect(matchModelTemplates('claude-haiku-50')).toEqual([]);
  });

  it('最新 DeepSeek 与历史别名在三种接口下使用同一能力规格', () => {
    for (const interfaceType of ['openai-chat', 'openai-responses', 'anthropic'] as const) {
      for (const id of [
        'deepseek-flash',
        'deepseek/deepseek-v4-flash',
        'deepseek-v4-flash-vision-exp',
        'DeepSeek-V4.1-Flash-1017',
      ]) {
        const matched = matchModelTemplates(id, undefined, 1, { interfaceType, compatibilityMode: 'standard' })[0]
          ?.template;
        expect(matched, `${interfaceType}/${id}`).toMatchObject({
          compatibilityMode: 'deepseek',
          settings: { contextWindow: 1048576, maxOutputTokens: 393216, capabilities: { vision: 'enabled' } },
        });
      }
    }
  });

  it('新模板只暴露已支持的推理档位，Gemini 单次输出不套用长解码上限', () => {
    const templates = builtinModelTemplates();
    for (const id of ['gpt-6-astra', 'gpt-6.1-sol'])
      expect(matchModelTemplates(id, templates)[0].template.settings.reasoningEfforts.map(item => item.id)).toEqual([
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]);
    expect(matchModelTemplates('gpt-6-luna', templates)[0].template.settings.reasoningEfforts[0].id).toBe('none');
    expect(matchModelTemplates('gemini-4-argon', templates)[0].template.settings).toMatchObject({
      maxOutputTokens: 65536,
      reasoningEfforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
    });
    expect(new Set(templates.map(item => item.id)).size).toBe(templates.length);
  });
  it('当前DeepSeek名称匹配1M视觉模板，Gemini原生接口有独立模板', () => {
    const templates = builtinModelTemplates();
    for (const interfaceType of ['openai-chat', 'openai-responses', 'anthropic'] as const) {
      const deepseek = matchModelTemplates('deepseek-flash', templates, 1, {
        compatibilityMode: 'standard',
        interfaceType,
      })[0]?.template;
      expect(deepseek?.settings).toMatchObject({ contextWindow: 1_048_576, capabilities: { vision: 'enabled' } });
      expect(deepseek?.compatibilityMode).toBe('deepseek');
    }
    const google = matchModelTemplates('gemini-3.1-pro', templates, 1, {
      compatibilityMode: 'standard',
      interfaceType: 'gemini',
    })[0]?.template;
    expect(google?.interfaceType).toBe('gemini');
    expect(google?.settings.contextWindow).toBe(1_048_576);
  });
  it('支持由旧Glob迁移出的显式前后缀规则，但不会为无关ID硬匹配', () => {
    expect(matchModelTemplates('openai/gpt-5.6-sol-2026-08-01')[0]?.template.id).toBe('openai:gpt-5.6-sol');
    expect(matchModelTemplates('totally-unrelated-model')).toEqual([]);
  });

  it('先按接口格式过滤，兼容模式由命中的模型模板提供', () => {
    const templates = builtinModelTemplates();
    expect(
      matchModelTemplates('deepseek-v4-flash', templates, 1, {
        compatibilityMode: 'deepseek',
        interfaceType: 'openai-responses',
      })[0]?.template.id,
    ).toBe('deepseek:responses:v4-flash');
    expect(
      matchModelTemplates('deepseek-v4-flash', templates, 1, {
        compatibilityMode: 'deepseek',
        interfaceType: 'anthropic',
      })[0]?.template.id,
    ).toBe('deepseek:anthropic:v4-flash');
    expect(
      matchModelTemplates('deepseek-v4-flash', templates, 1, {
        compatibilityMode: 'standard',
        interfaceType: 'openai-chat',
      })[0]?.template,
    ).toMatchObject({ compatibilityMode: 'deepseek', id: 'deepseek:chat:v4-flash' });
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
        reasoningEfforts: [
          { id: 'low', name: '低' },
          { id: 'high', name: '高' },
          { id: 'max', name: '最高' },
        ],
      },
      source: 'cloud',
    });
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
