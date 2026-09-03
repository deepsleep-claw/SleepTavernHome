import { describe, expect, it } from 'vitest';
import { applyPatchText, extractLastSelfCheck, getRepairStatus, parsePatchText, reversePatchRecords } from './core';

describe('梦境自修复核心逻辑', () => {
  it('提取最后一个包含 patch 的自检块', () => {
    const message = [
      '<dream_self_check><review>旧</review></dream_self_check>',
      '<dream_self_check><review>新检查</review><patch>FIND:旧\nREPLACE: 新</patch></dream_self_check>',
    ].join('\n');

    expect(extractLastSelfCheck(message)).toMatchObject({
      review: '新检查',
      patch: 'FIND:旧\nREPLACE: 新',
    });
  });

  it('解析多组和多行 Patch，并允许空替换文本', () => {
    const result = parsePatchText('FIND:^旧句$\nREPLACE: 新句\n\nFIND:多行\\n匹配\nREPLACE:');

    expect(result.errors).toEqual([]);
    expect(result.definitions).toEqual([
      { find: '^旧句$', replace: '新句', source_index: 0 },
      { find: '多行\\n匹配', replace: '', source_index: 1 },
    ]);
  });

  it('跳过无效或未匹配项并保留成功记录', () => {
    const message = [
      '<dream_body>',
      '旧句',
      '</dream_body>',
      '<dream_parallel_event>',
      '远处旧事',
      '</dream_parallel_event>',
    ].join('\n');
    const patch = [
      'FIND:^旧句$',
      'REPLACE: 新句',
      '',
      'FIND:([',
      'REPLACE: 无效',
      '',
      'FIND:不存在',
      'REPLACE: 不会出现',
      '',
      'FIND:旧事',
      'REPLACE: 新事',
    ].join('\n');

    const result = applyPatchText(message, patch);

    expect(result.message).toContain('\n新句\n');
    expect(result.message).toContain('远处新事');
    expect(result.success_count).toBe(2);
    expect(result.skipped_count).toBe(2);
    expect(result.records).toHaveLength(2);
  });

  it('只在指定正文标签内部执行 Patch', () => {
    const message = [
      '旧句',
      '<dream_body>旧句</dream_body>',
      '<dream_self_check><patch>FIND:旧句\nREPLACE: 新句</patch></dream_self_check>',
    ].join('\n');
    const result = applyPatchText(message, 'FIND:旧句\nREPLACE: 新句');

    expect(result.message).toBe(
      [
        '旧句',
        '<dream_body>新句</dream_body>',
        '<dream_self_check><patch>FIND:旧句\nREPLACE: 新句</patch></dream_self_check>',
      ].join('\n'),
    );
  });

  it('覆盖平行事件正文但完整跳过 simple_thinking', () => {
    const message = [
      '<dream_parallel_event>',
      '<simple_thinking>角色不知道旧秘密，只用于思考。</simple_thinking>',
      '县城街道|角色看见旧路灯亮起。',
      '</dream_parallel_event>',
    ].join('\n');
    const patch = ['FIND:旧秘密', 'REPLACE: 新秘密', '', 'FIND:旧路灯', 'REPLACE: 新路灯'].join('\n');

    const applied = applyPatchText(message, patch);

    expect(applied.message).toContain('<simple_thinking>角色不知道旧秘密，只用于思考。</simple_thinking>');
    expect(applied.message).toContain('县城街道|角色看见新路灯亮起。');
    expect(applied.success_count).toBe(1);
    expect(applied.skipped_count).toBe(1);
    expect(reversePatchRecords(applied.message, applied.records).message).toBe(message);
  });

  it('反 Patch 不依赖原 FIND，并按成功记录倒序还原', () => {
    const message = '<dream_body>A B</dream_body>';
    const applied = applyPatchText(message, 'FIND:A\nREPLACE: B\n\nFIND:^B B$\nREPLACE: C');

    expect(applied.message).toBe('<dream_body>C</dream_body>');
    expect(reversePatchRecords(applied.message, applied.records)).toMatchObject({
      message,
      success_count: 2,
      skipped_count: 0,
    });
  });

  it('能够还原删除型 Patch', () => {
    const message = '<dream_body>前缀需要删除后缀</dream_body>';
    const applied = applyPatchText(message, 'FIND:需要删除\nREPLACE:');
    const reversed = reversePatchRecords(applied.message, applied.records);

    expect(applied.message).toBe('<dream_body>前缀后缀</dream_body>');
    expect(reversed.message).toBe(message);
    expect(getRepairStatus(reversed.records)).toBe('reverted');
  });

  it('能够在空正文中插入并还原内容', () => {
    const message = '<dream_body></dream_body>';
    const applied = applyPatchText(message, 'FIND:^$\nREPLACE: 新内容');

    expect(applied.message).toBe('<dream_body>新内容</dream_body>');
    expect(reversePatchRecords(applied.message, applied.records).message).toBe(message);
  });

  it('after 重复时优先使用记录上下文定位', () => {
    const message = '<dream_body>左侧目标右侧，同名目标不应还原</dream_body>';
    const applied = applyPatchText(message, 'FIND:左侧目标右侧\nREPLACE: 左侧替换右侧');
    const edited = applied.message.replace('同名目标', '同名替换');
    const reversed = reversePatchRecords(edited, applied.records);

    expect(reversed.message).toBe('<dream_body>左侧目标右侧，同名替换不应还原</dream_body>');
  });
});
