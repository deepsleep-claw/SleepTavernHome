import { captureFinalPrompt } from '../压缩相邻消息/debug_snapshot';
import type { SquashDebugRecord } from '../压缩相邻消息/debug_types';
import { textCharacters } from './debug_compare';

export function debugRecord(
  id: string,
  texts: string[],
  role: 'user' | 'assistant' | 'system' = 'user',
): SquashDebugRecord {
  return {
    id,
    created_at: `2026-09-14T12:00:0${id === 'a' ? 0 : 1}.000Z`,
    title: '诊断记录',
    summary: {
      error_count: 0,
      failed: 0,
      green_cache_insertions: 0,
      loaded_total: 2,
      total_rows: texts.length,
      triggered_rows: 1,
      wrapper_orphan: 0,
      wrapper_paired: 0,
      prompt_chars: texts.reduce((total, text) => total + textCharacters(text), 0),
    },
    state: {
      final_prompt: captureFinalPrompt(texts.map(content => ({ role, content }))),
      total_rows: texts.map((text, index) => ({
        名称: `条目${index + 1}`,
        类型: '预设用户输入',
        来源: '设定',
        详细内容: text,
      })),
      triggered_rows: [],
      error_logs: [],
    },
  };
}
