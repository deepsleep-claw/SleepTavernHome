import { describe, expect, it, vi } from 'vitest';
import { compareDebugRecords, comparisonForRecord, comparisonRowState, loadDebugText } from './debug_compare';
import { debugRecord } from './debug_test_helpers';

const read = async () => undefined;
describe('连续前缀字数对比', () => {
  it('打开任一侧时以自己的字数为分母', async () => {
    const comparison = await compareDebugRecords(
      debugRecord('a', ['共同', '前甲', '尾巴']),
      debugRecord('b', ['共同', '前乙变长', '尾巴']),
      read,
    );
    expect(comparisonForRecord(comparison, 'a')).toMatchObject({ prefix_chars: 3, missed_chars: 3, ratio: 0.5 });
    expect(comparisonForRecord(comparison, 'b')).toMatchObject({ prefix_chars: 3, missed_chars: 5, ratio: 0.375 });
  });
  it('只标完整命中条目和首差条目', async () => {
    const comparison = await compareDebugRecords(
      debugRecord('a', ['相同', '前甲', '仍相同']),
      debugRecord('b', ['相同', '前乙', '仍相同']),
      read,
    );
    const view = comparisonForRecord(comparison, 'b')!;
    expect([0, 1, 2].map(index => comparisonRowState(view, index))).toEqual(['hit', 'miss', undefined]);
    expect(view.difference).toEqual({ current_text: '前乙', other_text: '前甲', prefix_units: 1 });
    expect(view.missed_chars).toBe(4);
  });
  it('条目划分不改变连续正文前缀', async () => {
    const result = await compareDebugRecords(debugRecord('a', ['甲乙', '丙']), debugRecord('b', ['甲', '乙丙']), read);
    expect(result.prefix_chars).toBe(3);
    const view = comparisonForRecord(result, 'b')!;
    expect(view.ratio).toBe(1);
    expect(view.first_difference_message).toBeNull();
    expect([0, 1].map(index => comparisonRowState(view, index))).toEqual(['hit', 'hit']);
  });
  it('首差窗口保留同一全局前缀，即使条目边界不同', async () => {
    const result = await compareDebugRecords(debugRecord('a', ['ab', 'cde']), debugRecord('b', ['abcd', 'xx']), read);
    expect(result.difference).toEqual({ left_text: 'cde', right_text: 'cdxx', prefix_units: 2 });
  });
  it('追加正文仅在较长记录中产生首差', async () => {
    const result = await compareDebugRecords(debugRecord('a', ['甲']), debugRecord('b', ['甲', '新增']), read);
    expect(comparisonForRecord(result, 'a')).toMatchObject({
      missed_chars: 0,
      ratio: 1,
      first_difference_message: null,
    });
    expect(comparisonForRecord(result, 'b')).toMatchObject({ missed_chars: 2, first_difference_message: 2 });
    expect(result.difference).toEqual({ left_text: '', right_text: '新增', prefix_units: 0 });
  });
  it('Unicode 字数与绿色框选偏移分别计算', async () => {
    const result = await compareDebugRecords(debugRecord('a', ['😀甲\n']), debugRecord('b', ['😀乙\n']), read);
    expect(result.prefix_chars).toBe(1);
    expect(result.left.chars).toBe(3);
    expect(result.difference?.prefix_units).toBe(2);
  });
  it('读取完整正文并检测缺失或截断内容', async () => {
    const a = debugRecord('a', ['预览']);
    const b = debugRecord('b', ['预览']);
    a.state.total_rows[0].详细内容缓存键 = 'c1';
    b.state.total_rows[0].详细内容缓存键 = 'c1';
    const loader = vi.fn(async (id: string) => (id === 'a' ? '正文甲' : '正文乙'));
    expect((await compareDebugRecords(a, b, loader)).prefix_chars).toBe(2);
    expect(loader).toHaveBeenCalledWith('a', 'c1');
    expect(loader).toHaveBeenCalledWith('b', 'c1');
    await expect(compareDebugRecords(a, b, read)).rejects.toThrow('完整正文已不可用');
    await expect(loadDebugText('a', { 详细内容: '预览', 详细内容长度: 1000 }, read)).rejects.toThrow('正文预览');
    await expect(loadDebugText('a', { 详细内容: '含省略标识的预览', 详细内容长度: 2 }, read)).rejects.toThrow(
      '正文预览',
    );
  });
  it('空正文没有百分比，首差后的长文本只计入总量', async () => {
    const empty = await compareDebugRecords(debugRecord('a', []), debugRecord('b', []), read);
    expect(comparisonForRecord(empty, 'a')?.ratio).toBeNull();
    const result = await compareDebugRecords(
      debugRecord('a', ['前甲', 'x'.repeat(100_000)]),
      debugRecord('b', ['前乙', 'y'.repeat(100_000)]),
      read,
    );
    expect(result.prefix_chars).toBe(1);
    expect(result.difference?.left_text).toBe('前甲');
    expect(comparisonForRecord(result, 'a')?.missed_chars).toBe(100_001);
  });
});
