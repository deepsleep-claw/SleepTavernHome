import { describe, expect, it } from 'vitest';
import { applyPatches, parsePatches, reversePatches } from './patch';

describe('段落与跨行补丁', () => {
  it('容忍首尾空白、保留缩进，并替换全部相同段落', () => {
    const source = '  旧句。  \r\n\r\n\t旧句。\r\n';
    const result = applyPatches(source, 'FIND:  旧句。 \nREPLACE: 新句。');
    expect(result.message).toBe('  新句。  \r\n\r\n\t新句。\r\n');
    expect(result.success_count).toBe(2);
    expect(reversePatches(result.message, result.records).message).toBe(source);
  });
  it('按字面匹配符号，不把匹配文本作为正则', () => {
    expect(applyPatches('[A].*\nAAAA', 'FIND: [A].*\nREPLACE: B').message).toBe('B\nAAAA');
  });
  it('首尾相同的多段均替换整段', () => {
    const result = applyPatches(
      '他推门，一片黑暗。\n他推门，四周安静。',
      'HEAD: 他推门，\nTAIL: 。\nREPLACE: 他推门看了一眼。',
    );
    expect(result.message).toBe('他推门看了一眼。\n他推门看了一眼。');
    expect(result.success_count).toBe(2);
  });
  it('普通定位不跨行，并能处理与正文同一行的容器标签', () => {
    expect(applyPatches('开头\n结尾', 'HEAD: 开头\nTAIL: 结尾\nREPLACE: 新段').success_count).toBe(0);
    expect(applyPatches('<dream_body>旧句</dream_body>', 'FIND: 旧句\nREPLACE: 新句').message).toBe(
      '<dream_body>新句</dream_body>',
    );
  });
  it('跨行替换变量更新内容，保留块内部缩进', () => {
    const source =
      '<UpdateVariable>\n<JsonPatch>\n[{\n  "path": "/money",\n  "value": 20\n}]\n</JsonPatch>\n</UpdateVariable>';
    const patch =
      'HEAD: "path": "/money",\nTAIL: "value": 20\n<REPLACE_BLOCK>\n"path": "/money",\n  "value": 30\n</REPLACE_BLOCK>';
    const result = applyPatches(source, patch);
    expect(result.message).toContain('  "path": "/money",\n  "value": 30');
    expect(result.success_count).toBe(1);
    expect(reversePatches(result.message, result.records).message).toBe(source);
  });
  it('重复跨行块全部替换', () => {
    const source = '开始 A\n结束 B\n其他\n开始 A\n结束 B';
    const result = applyPatches(source, 'HEAD: 开始 A\nTAIL: 结束 B\n<REPLACE_BLOCK>\n新块\n</REPLACE_BLOCK>');
    expect(result.message).toBe('新块\n其他\n新块');
    expect(result.success_count).toBe(2);
  });
  it('首尾配对有歧义时保留原文', () => {
    const source = '开始\n结束\n结束';
    const result = applyPatches(source, 'HEAD: 开始\nTAIL: 结束\n<REPLACE_BLOCK>\n新块\n</REPLACE_BLOCK>');
    expect(result.message).toBe(source);
    expect(result.errors.join()).toContain('歧义');
  });
  it('报告中引用的尾部不干扰跨行块定位', () => {
    const report = '<dream_self_check>引用：结束 B</dream_self_check>';
    const result = applyPatches(
      '开始 A\n结束 B\n' + report,
      'HEAD: 开始 A\nTAIL: 结束 B\n<REPLACE_BLOCK>\n新块\n</REPLACE_BLOCK>',
    );
    expect(result.message).toBe('新块\n' + report);
    expect(result.errors).toEqual([]);
  });
  it('FIND 可以替换为多行文本和空块', () => {
    expect(applyPatches('旧句', 'FIND: 旧句\n<REPLACE_BLOCK>\n第一行\n  第二行\n</REPLACE_BLOCK>').message).toBe(
      '第一行\n  第二行',
    );
    const result = applyPatches('前\n旧句\n后', 'FIND: 旧句\n<REPLACE_BLOCK>\n</REPLACE_BLOCK>');
    expect(result.message).toBe('前\n\n后');
    expect(reversePatches(result.message, result.records).message).toBe('前\n旧句\n后');
  });
  it('全部基于原文定位，后续补丁不消费前一条的结果', () => {
    const result = applyPatches('A', 'FIND: A\nREPLACE: B\n\nFIND: B\nREPLACE: C');
    expect(result.message).toBe('B');
    expect(result.success_count).toBe(1);
  });
  it('不同补丁冲突时跳过冲突范围，其他位置仍可修复', () => {
    const result = applyPatches('A\nD', 'FIND: A\nREPLACE: B\n\nFIND: A\nREPLACE: C\n\nFIND: D\nREPLACE: E');
    expect(result.message).toBe('A\nE');
    expect(result.errors.join()).toContain('重叠');
  });
  it('同一范围的相同替换只执行一次', () => {
    expect(applyPatches('A', 'FIND: A\nREPLACE: B\n\nFIND: A\nREPLACE: B').success_count).toBe(1);
  });
  it('报告中的原文和替换内容不再次参与匹配', () => {
    const report = '<dream_self_check>\nA\n</dream_self_check>';
    expect(applyPatches('A\n' + report, 'FIND: A\nREPLACE: B').message).toBe('B\n' + report);
  });
  it('拒绝未闭合的块和普通替换中的多行正文', () => {
    expect(parsePatches('FIND: A\n<REPLACE_BLOCK>\nB').patches).toHaveLength(0);
    expect(parsePatches('FIND: A\nREPLACE: B\nC').patches).toHaveLength(0);
    expect(parsePatches('').errors).toEqual([]);
  });
  it('还原时不覆盖已被用户改动的替换内容', () => {
    const result = applyPatches('A', 'FIND: A\nREPLACE: B');
    const reverse = reversePatches('用户的新内容', result.records);
    expect(reverse.message).toBe('用户的新内容');
    expect(reverse.success_count).toBe(0);
  });
});
