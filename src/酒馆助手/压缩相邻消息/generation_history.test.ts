import { describe, expect, it } from 'vitest';
import { generationAnchorDepth, selectGenerationHistory } from './generation_history';
import { simulateDepthInjections } from './test-helpers';

const rows = (contents: string[]) =>
  contents.map((content, message_id) => ({ message_id, swipe_id: 0, is_hidden: false, content }));
const anchor = { message_id: 1, swipe_id: 0 };

describe('生成历史与缓存深度', () => {
  it('原生深度模拟只按 D 值定位，不按锚点名称直接附加', () => {
    const messages = [
      { role: 'assistant' as const, content: '第0层' },
      { role: 'user' as const, content: '第1层' },
    ];
    expect(
      simulateDepthInjections(messages, [{ id: 'anchor', role: 'system', depth: 1, content: 'ANCHOR:1.0' }]).map(
        message => message.content,
      ),
    ).toEqual(['第0层', 'ANCHOR:1.0', '第1层']);
    expect(
      simulateDepthInjections(messages, [{ id: 'anchor', role: 'system', depth: 0, content: 'ANCHOR:1.0' }]).map(
        message => message.content,
      ),
    ).toEqual(['第0层', '第1层', 'ANCHOR:1.0']);
  });
  it('切换回复只对本次历史排除末楼，保留绝对楼层和原数组', () => {
    const raw = rows(['开场', '用户输入', '旧回复']);
    const swipe = selectGenerationHistory(raw, { type: 'swipe' });
    const normal = selectGenerationHistory(raw);
    expect(swipe.messages.map(message => message.message_id)).toEqual([0, 1]);
    expect(raw).toHaveLength(3);
    expect(generationAnchorDepth(swipe, anchor)).toBe(0);
    expect(generationAnchorDepth(normal, anchor)).toBe(1);
    expect(generationAnchorDepth(swipe, { message_id: 2, swipe_id: 0 })).toBeUndefined();
  });

  it('被删除的重生成目标不再导致上一条 AI 被重复排除', () => {
    const raw = rows(['用户', '上一条回复', '重生成目标']);
    const options = { type: 'regenerate', regenerate_target_id: 2 };
    expect(selectGenerationHistory(raw, options).messages.map(message => message.message_id)).toEqual([0, 1]);
    expect(selectGenerationHistory(raw.slice(0, -1), options).messages.map(message => message.message_id)).toEqual([
      0, 1,
    ]);
  });

  it('两种续写模式保持稳定锚点，正在续写的尾消息不成为缓存锚点', () => {
    const raw = rows(['开场', '用户输入', '待续写']);
    const normalContinue = selectGenerationHistory(raw, { type: 'continue' });
    const prefillContinue = selectGenerationHistory(raw, { type: 'continue', continue_prefill: true });
    expect(generationAnchorDepth(normalContinue, anchor)).toBe(1);
    expect(generationAnchorDepth(prefillContinue, anchor)).toBe(0);
    expect(normalContinue.anchors.at(-1)?.message_id).toBe(1);
    expect(prefillContinue.messages.map(message => message.message_id)).toEqual([0, 1, 2]);
    expect(generationAnchorDepth(normalContinue, { message_id: 2, swipe_id: 0 })).toBeUndefined();
  });

  it('隐藏、空占位和不匹配的 swipe 不成为可用锚点', () => {
    const raw = rows(['开场', '隐藏楼层', '用户输入', '']);
    raw[1].is_hidden = true;
    const history = selectGenerationHistory(raw);
    expect(history.injection_messages.map(message => message.message_id)).toEqual([0, 2, 3]);
    expect(history.anchors.map(message => message.message_id)).toEqual([0, 2]);
    expect(generationAnchorDepth(history, { message_id: 2, swipe_id: 1 })).toBeUndefined();
    expect(generationAnchorDepth(history, { message_id: 1, swipe_id: 0 })).toBeUndefined();
  });
});
