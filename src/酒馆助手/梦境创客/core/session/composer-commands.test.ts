import { describe, expect, it } from 'vitest';
import {
  assertCommandArguments,
  commandDisabledReason,
  COMPOSER_COMMANDS,
  findComposerCommand,
  parseComposerCommand,
  suggestionScore,
} from './composer-commands';
import { composerReferences, fileReference, resolveCommandSkill } from './composer-references';
import { createApiModel, createApiProvider } from '../provider/provider-config';
import { modelCommandValue, reasoningOptions, resolveCommandModel } from '../provider/session-model-options';
import type { AgentSkill } from '../skills/types';

const skill: AgentSkill = {
  id: '检查角色',
  name: '角色检查',
  description: '检查设定一致性',
  builtin: false,
  body: 'Skill 正文',
  loading: 'on-demand',
};
const context = {
  status: 'completed',
  busy: false,
  hasModels: true,
  supportsReasoning: true,
  skillCount: 1,
  compactionEnabled: true,
};

describe('输入指令注册表', () => {
  it('规范命令与别名唯一，帮助用法来自同一注册表', () => {
    const names = COMPOSER_COMMANDS.flatMap(item => [item.id, ...item.aliases]);
    expect(new Set(names).size).toBe(names.length);
    for (const command of COMPOSER_COMMANDS) {
      expect(command.usage.startsWith(`/${command.id}`)).toBe(true);
      for (const alias of [command.id, ...command.aliases])
        expect(parseComposerCommand(`/${alias}`)?.command).toBe(command);
    }
  });

  it('参数保留换行与正文，文件路径和普通段落不解释为命令', () => {
    expect(parseComposerCommand('/COMPACT 保留人物关系\n  与待办')?.args).toBe('保留人物关系\n  与待办');
    expect(parseComposerCommand('/character/definition/description.md')).toBeUndefined();
    expect(parseComposerCommand('请参考\n/compact')).toBeUndefined();
    expect(parseComposerCommand('```\n/stop\n```')).toBeUndefined();
    expect(parseComposerCommand('/不存在')?.command).toBeUndefined();
    expect(() => assertCommandArguments(findComposerCommand('stop')!, '别的会话')).toThrow('不接受参数');
    expect(() => assertCommandArguments(findComposerCommand('compact')!, 'x'.repeat(4001))).toThrow('过长');
  });

  it('运行中允许查看和停止，配置及压缩操作给出禁用原因', () => {
    const running = { ...context, status: 'running', busy: true };
    for (const name of ['help', 'context', 'stop'])
      expect(commandDisabledReason(findComposerCommand(name)!, running)).toBeUndefined();
    for (const name of ['compact', 'model', 'effort', 'skill', 'resume'])
      expect(commandDisabledReason(findComposerCommand(name)!, running)).toContain('先停止');
    expect(commandDisabledReason(findComposerCommand('resume')!, context)).toContain('没有可继续');
    expect(commandDisabledReason(findComposerCommand('compact')!, { ...context, compactionEnabled: false })).toContain(
      '未启用',
    );
    expect(commandDisabledReason(findComposerCommand('model')!, { ...context, hasModels: false })).toContain('API');
  });

  it('支持中文和不连续字符搜索，完整名称排在描述匹配前', () => {
    expect(suggestionScore('角色描述', '角描')).toBeDefined();
    expect(suggestionScore('compact', 'cmp')).toBeDefined();
    expect(suggestionScore('model', 'mod')).toBeLessThan(suggestionScore('switch model', 'mod')!);
    expect(suggestionScore('model', '不存在')).toBeUndefined();
  });
});

describe('分类资源引用', () => {
  it('区分角色、世界书、预设、聊天、Skill 和文件，Skill 主文件只出现一次', () => {
    const refs = composerReferences(
      [
        { path: '/character/definition/description.md' },
        { path: '/worldbooks/城市/entries/0001.md' },
        { path: '/presets/current/prompts/规则.md' },
        { path: '/character/chats/c1/messages/0001.md' },
        { path: '/skills/user/检查角色/SKILL.md' },
        { path: '/files/参考.md' },
      ],
      [skill],
    );
    expect(refs.map(item => item.category)).toEqual(['character', 'worldbook', 'preset', 'chat', 'skill', 'file']);
    expect(refs[0].label).toBe('角色描述');
    expect(refs.filter(item => item.category === 'skill')).toHaveLength(1);
    expect(refs[4].label).toBe('角色检查');
    expect(refs[4].insertion).not.toContain('Skill 正文');
  });

  it('链接转义括号、方括号、空格与 URL 分隔符', () => {
    expect(fileReference('/files/a b(1)#x?.md', '[说明]')).toBe('[\\[说明\\]](/files/a%20b%281%29%23x%3F.md)');
    expect(fileReference('/files/x.md', 'a\nb')).toBe('[a b](/files/x.md)');
  });

  it('Skill 使用稳定标识，并要求任务与当前挂载匹配', () => {
    expect(resolveCommandSkill([skill], `${encodeURIComponent(skill.id)} 检查第一章\n人物关系`)).toMatchObject({
      skill,
      task: '检查第一章\n人物关系',
    });
    expect(() => resolveCommandSkill([], `${skill.id} 检查`)).toThrow('未在当前会话挂载');
    expect(() => resolveCommandSkill([skill], skill.id)).toThrow('填写任务');
    expect(() => resolveCommandSkill([skill], '%ZZ 检查')).toThrow('标识无效');
  });
});

describe('模型与推理参数', () => {
  it('模型重名不自动猜测，完整渠道或稳定标识可精确选择，禁用模型不可选', async () => {
    const first = await createApiProvider({
      name: '渠道一',
      baseURL: 'https://example.invalid/v1',
      interfaceType: 'openai-chat',
      apiKey: '',
      enabled: true,
    });
    const second = await createApiProvider({
      name: '渠道二',
      baseURL: 'https://example.invalid/v1',
      interfaceType: 'openai-chat',
      apiKey: '',
      enabled: true,
    });
    first.models = [
      await createApiModel({ name: '共同名称', modelId: 'm', enabled: true, compatibilityMode: 'standard' }),
    ];
    second.models = [
      await createApiModel({ name: '共同名称', modelId: 'm', enabled: true, compatibilityMode: 'standard' }),
    ];
    expect(() => resolveCommandModel([first, second], '共同名称')).toThrow('重名');
    expect(resolveCommandModel([first, second], '渠道二/共同名称').provider.id).toBe(second.id);
    expect(resolveCommandModel([first, second], modelCommandValue(first.id, first.models[0].id)).provider.id).toBe(
      first.id,
    );
    first.models[0].enabled = false;
    expect(() => resolveCommandModel([first], '共同名称')).toThrow('已禁用');
  });

  it('推理候选遵循模型能力和 Gemini 的关闭限制', async () => {
    const provider = await createApiProvider({
      name: 'G',
      baseURL: 'https://example.invalid',
      interfaceType: 'gemini',
      apiKey: '',
      enabled: true,
    });
    const model = await createApiModel({
      name: 'G3',
      modelId: 'gemini-3-pro',
      enabled: true,
      compatibilityMode: 'standard',
      modelSettings: { reasoningEfforts: [{ id: 'high', name: '高' }] },
    });
    expect(reasoningOptions(provider, model).map(item => item.value)).toEqual(['auto', 'high']);
    model.modelSettings.capabilities.reasoning = 'disabled';
    expect(reasoningOptions(provider, model)).toEqual([]);
  });
});
