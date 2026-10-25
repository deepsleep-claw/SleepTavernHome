import { describe, expect, it } from 'vitest';
import type { SessionView } from '../../core/session/types';
import { createComposerSuggestionSource } from './composer-catalog';

describe('分类引用候选缓存', () => {
  it('正文流式更新复用候选，资源变化与会话切换重新解析', () => {
    const suggest = createComposerSuggestionSource();
    const shortcut = { kind: 'reference' as const, start: 0, end: 1, query: '' };
    let active = {
      sessionId: 'a',
      workingFiles: [{ path: '/files/notes.md', content: '初始内容' }],
      skills: [],
    } as unknown as SessionView;
    const first = suggest(shortcut, { active });
    active = { ...active, workingFiles: active.workingFiles.map(file => ({ ...file, content: '更新内容' })) };
    expect(suggest(shortcut, { active })).toBe(first);
    expect(suggest({ ...shortcut, query: 'not' }, { active })).toHaveLength(1);
    expect(suggest({ ...shortcut, query: '无匹配' }, { active })).toHaveLength(0);
    active = { ...active, workingFiles: active.workingFiles.map(file => ({ ...file, path: '/files/new.md' })) };
    expect(suggest(shortcut, { active })[0].description).toBe('/files/new.md');
    const updated = suggest(shortcut, { active });
    active = { ...active, sessionId: 'b' };
    expect(suggest(shortcut, { active })).not.toBe(updated);
    expect(suggest(shortcut, { active: undefined })).toHaveLength(0);
  });

  it('Skill 元信息变化后更新搜索与引用，删除挂载不会残留', () => {
    const suggest = createComposerSuggestionSource();
    const shortcut = { kind: 'reference' as const, start: 0, end: 1, query: '' };
    let active = {
      sessionId: 'a',
      workingFiles: [],
      skills: [
        { id: 'check', name: '旧名称', description: '旧说明', body: '内容', loading: 'on-demand', builtin: false },
      ],
    } as unknown as SessionView;
    const first = suggest(shortcut, { active });
    active = { ...active, skills: active.skills.map(skill => ({ ...skill, body: '更新正文' })) };
    expect(suggest(shortcut, { active })).toBe(first);
    active = { ...active, skills: active.skills.map(skill => ({ ...skill, name: '新名称', description: '新说明' })) };
    const updated = suggest(shortcut, { active });
    expect(updated[0]).toMatchObject({ label: '新名称', value: '[新名称](/skills/user/check/SKILL.md)' });
    expect(updated[0].description).toContain('新说明');
    expect(suggest(shortcut, { active: { ...active, skills: [] } })).toHaveLength(0);
  });
});
