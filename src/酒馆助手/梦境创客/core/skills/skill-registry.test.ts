import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../mapping/serde';
import { BUILTIN_CARD_WORKSPACE_SKILL } from './builtin-card-workspace';
import {
  assessSkillMutation,
  compileFullSkillInstructions,
  materializeUserSkills,
  projectSkills,
} from './skill-registry';
import type { AgentSkill } from './types';

function userSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    body: '# 写作步骤\n\n先理解需求，再修改文件。',
    builtin: false,
    description: '辅助编写学院角色。',
    directories: [],
    id: 'academy-writer',
    loading: 'on-demand',
    name: '学院写作',
    resources: {
      'materials/template.txt': { content: '模板', mediaType: 'text/plain', size: 6 },
      'notes/style.md': { content: '保持轻快文风。', mediaType: 'text/markdown', size: 21 },
    },
    ...overrides,
  };
}

describe('agent skills', () => {
  it('投影摘要索引、内置只读Skill和用户资源', () => {
    const files = projectSkills([BUILTIN_CARD_WORKSPACE_SKILL, userSkill()]);
    expect(files.find(file => file.path === '/skills/index.md')).toMatchObject({ readonly: true });
    expect(files.find(file => file.path.endsWith('/builtin/card-workspace-io/SKILL.md'))).toMatchObject({
      readonly: true,
    });
    expect(files.find(file => file.path.endsWith('/builtin/card-workspace-io/references/worldbooks.md'))).toMatchObject(
      {
        readonly: true,
      },
    );
    expect(
      files.find(file => file.path.endsWith('/builtin/card-workspace-io/references/worldbooks.md'))?.content,
    ).toContain('position`、`strategy`、`recursion`、`effect` 都是对象');
    expect(files.find(file => file.path === '/skills/user/academy-writer/notes/style.md')?.content).toBe(
      '保持轻快文风。',
    );
    expect(files.find(file => file.path === '/skills/index.md')?.content).toContain(
      '/skills/user/academy-writer/SKILL.md',
    );
  });

  it('从文件无损读取用户Skill，但忽略内置Skill', () => {
    const skills = materializeUserSkills(projectSkills([userSkill()]));
    expect(skills).toEqual([userSkill()]);
    const skillFile = projectSkills([userSkill()]).find(file => file.path.endsWith('/academy-writer/SKILL.md'))!;
    expect(parseFrontmatter(skillFile.content, skillFile.path).metadata).toMatchObject({
      description: '辅助编写学院角色。',
      loading: 'on-demand',
      name: '学院写作',
    });
  });

  it('全量提示只包含当前Agent启用且设置为full的Skill', () => {
    const prompt = compileFullSkillInstructions([
      BUILTIN_CARD_WORKSPACE_SKILL,
      userSkill({ loading: 'full' }),
      userSkill({ id: 'on-demand', name: '按需', loading: 'on-demand' }),
    ]);
    expect(prompt).toContain(BUILTIN_CARD_WORKSPACE_SKILL.body);
    expect(prompt).toContain('学院写作');
    expect(prompt).not.toContain('Skill：按需');
  });

  it('设置中锁定的用户Skill对Agent保持只读', () => {
    const locked = userSkill({ locked: true });
    const files = projectSkills([locked]);
    expect(files.find(file => file.path === '/skills/user/academy-writer/SKILL.md')).toMatchObject({ readonly: true });
    expect(materializeUserSkills(files)).toEqual([locked]);
    expect(
      assessSkillMutation('patch', '/skills/user/academy-writer/SKILL.md', ['academy-writer'], ['academy-writer']),
    ).toMatchObject({ allowed: false, confirmationRequired: false, reason: expect.stringContaining('SKILL_LOCKED') });
    expect(
      assessSkillMutation('write', '/skills/user/academy-writer/new.md', ['academy-writer'], ['academy-writer']),
    ).toMatchObject({ allowed: false });
  });
});
