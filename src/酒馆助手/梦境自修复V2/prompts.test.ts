import { describe, expect, it } from 'vitest';
import {
  appendResults,
  buildTask,
  combinePrompts,
  extractOutput,
  inspectMvu,
  NO_MVU,
  removeMvuBlocks,
} from './prompts';
import { DEFAULT_SETTINGS } from './settings';

const inline = { ...NO_MVU, available: true, enabled: true, version: 1 };
describe('提示词组合和 MVU 补全', () => {
  it('发送给模型的补丁示例保留字段换行', () => {
    const task = buildTask(DEFAULT_SETTINGS, '正文', NO_MVU);
    expect(task).toMatch(/FIND: [^\r\n]+\r?\nREPLACE:/);
    expect(task).toMatch(/HEAD: [^\r\n]+\r?\nTAIL: [^\r\n]+\r?\n<REPLACE_BLOCK>/);
  });
  it('保持前缀和消息顺序，只替换定位点后的尾部', () => {
    const prompts: RolePrompt[] = [
      { role: 'system', content: '固定前缀' },
      { role: 'user', content: '设定\n</dream_dx_setting>\n旧任务' },
    ];
    expect(combinePrompts(prompts, '新任务', DEFAULT_SETTINGS)).toEqual([
      { role: 'system', content: '固定前缀' },
      { role: 'user', content: '设定\n</dream_dx_setting>\n\n新任务' },
    ]);
    expect(prompts[1].content).toContain('旧任务');
  });
  it('定位失败时不退回原写作任务', () => {
    expect(() => combinePrompts([{ role: 'user', content: '没有定位点' }], '新任务', DEFAULT_SETTINGS)).toThrow(
      '定位点',
    );
  });
  it('关闭的模块不进入组合要求，变量宏保持未展开', () => {
    const task = buildTask(
      { ...DEFAULT_SETTINGS, format: false, format_prompt: '独有格式要求', review_prompt: '{{getvar::文风}}' },
      '正文原文',
      NO_MVU,
    );
    expect(task).not.toContain('独有格式要求');
    expect(task).toContain('{{getvar::文风}}');
    expect(task).toContain('正文原文');
  });
  it('完整、残缺及报告中引用的 MVU 标签分别识别', () => {
    expect(inspectMvu('<UpdateVariable>x</UpdateVariable>')).toEqual({ complete: true, incomplete: false });
    expect(inspectMvu('<UpdateVariable>x')).toEqual({ complete: false, incomplete: true });
    expect(inspectMvu('<dream_self_check><UpdateVariable>x</UpdateVariable></dream_self_check>')).toEqual({
      complete: false,
      incomplete: false,
    });
    expect(inspectMvu('<UpdateVariable>x<UpdateVariable>y</UpdateVariable>')).toEqual({
      complete: true,
      incomplete: true,
    });
  });
  it('完整更新块不重复生成，允许补丁修改', () => {
    expect(buildTask(DEFAULT_SETTINGS, '<UpdateVariable>x</UpdateVariable>', inline)).toContain('无需重复生成');
    expect(buildTask(DEFAULT_SETTINGS, '<UpdateVariable>x', inline)).toContain('缺失或不完整');
    expect(buildTask(DEFAULT_SETTINGS, '正文', { ...inline, mode: 'extra' })).toContain('独立模型解析');
  });
  it('空格式结果和空补丁是有效结果', () => {
    expect(
      extractOutput(
        '<dream_append_format></dream_append_format><dream_self_check><review>通过</review><patch></patch></dream_self_check>',
        DEFAULT_SETTINGS,
      ).patch,
    ).toBe('');
    expect(() => extractOutput('<dream_self_check>', DEFAULT_SETTINGS)).toThrow();
  });
  it('补全残缺更新块时保留后面的状态栏及报告', () => {
    const base = '正文\n<UpdateVariable>半段\n<StatusPlaceHolderImpl/>';
    const result = appendResults(
      base,
      '<UpdateVariable>完整</UpdateVariable>',
      '<dream_self_check>报告</dream_self_check>',
      DEFAULT_SETTINGS,
      inline,
    );
    expect(result).not.toContain('半段');
    expect(result).toContain('正文');
    expect(result).toContain('<StatusPlaceHolderImpl/>');
    expect(result.match(/<UpdateVariable>/g)).toHaveLength(1);
  });
  it('已有完整更新块时丢弃补全结果中的重复更新块', () => {
    const result = appendResults(
      '正文\n<UpdateVariable>原更新</UpdateVariable>',
      '选项\n<UpdateVariable>重复更新</UpdateVariable>',
      '',
      DEFAULT_SETTINGS,
      inline,
    );
    expect(result).toContain('原更新');
    expect(result).toContain('选项');
    expect(result).not.toContain('重复更新');
  });
  it('删除更新块不会修改报告引用', () => {
    const report = '<dream_self_check><UpdateVariable>引用</UpdateVariable></dream_self_check>';
    expect(removeMvuBlocks('<UpdateVariable>命令</UpdateVariable>' + report)).toBe(report);
    expect(removeMvuBlocks('<UpdateVariable><Analysis>说明</Analysis>半段<dream_options>选项</dream_options>')).toBe(
      '<dream_options>选项</dream_options>',
    );
  });
});
