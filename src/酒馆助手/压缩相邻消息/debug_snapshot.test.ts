import { describe, expect, it } from 'vitest';
import { captureFinalPrompt } from './debug_snapshot';
import { GenerationTrace } from './generation_trace';

const context = { chat_id: 'chat', character_name: '角色', script_id: 'script' };

describe('提示词请求追踪', () => {
  it('预演与正式请求分别追踪，重复事件载荷只接受一次', () => {
    const trace = new GenerationTrace();
    trace.begin('normal', true, context);
    const payload: object[] = [];
    expect(trace.accept(payload, true, 'generate_after_data', context)?.dry_run).toBe(true);
    expect(trace.accept(payload, true, 'generate_after_data', context)).toBeUndefined();
    trace.begin('quiet', false, context);
    const request = trace.accept([], false, 'generate_after_data', context);
    expect(request).toMatchObject({ type: 'quiet', dry_run: false, skipped_previews: 1, pass: 1 });
  });

  it('明确的发送阶段标记优先于生命周期回退标记', () => {
    const trace = new GenerationTrace();
    trace.begin('normal', false, context);
    expect(trace.accept([], true, 'generate_after_data', context)?.dry_run).toBe(true);
    trace.begin('normal', true, context);
    expect(trace.accept([], undefined, 'chat_completion_settings_ready', context)?.dry_run).toBe(true);
  });

  it('最终快照保留消息身份和结构，正文使用 Unicode 字数', () => {
    const snapshot = captureFinalPrompt([
      { role: 'system', content: '设定😀' },
      { role: 'user', content: '消息\n' },
    ]);
    expect(snapshot).toMatchObject({ version: 1, stage: 'after_squash', text_chars: 6 });
    expect(snapshot.messages.map(message => message.role)).toEqual(['system', 'user']);
    expect(snapshot.messages[0].parts).toEqual([{ kind: 'text', 详细内容: '设定😀' }]);
  });
});
