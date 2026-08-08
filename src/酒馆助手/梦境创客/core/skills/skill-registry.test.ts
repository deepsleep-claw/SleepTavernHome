import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../mapping/serde';
import { BUILTIN_CARD_WORKSPACE_SKILL } from './builtin-card-workspace';
import {
  assessSkillMutation,
  compileFullSkillInstructions,
  createSkillTemplate,
  materializeUserSkills,
  projectSkills,
} from './skill-registry';
import type { AgentSkill } from './types';

function userSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    assets: { 'template.txt': '模板' },
    body: '# 写作步骤\n\n先理解需求，再修改文件。',
    builtin: false,
    description: '辅助编写学院角色。',
    enabled: true,
    id: 'academy-writer',
    loading: 'on-demand',
    name: '学院写作',
    references: { 'style.md': '保持轻快文风。' },
    ...overrides,
  };
}

describe('agent skills', () => {
  it('投影摘要索引、内置只读Skill和用户资源', () => {
    const files = projectSkills([userSkill()]);
    expect(files.find(file => file.path === '/skills/index.md')).toMatchObject({ readonly: true });
    expect(files.find(file => file.path.endsWith('/builtin/card-workspace-io/SKILL.md'))).toMatchObject({ readonly: true });
    expect(files.find(file => file.path === '/skills/user/academy-writer/references/style.md')?.content).toBe('保持轻快文风。');
    expect(files.find(file => file.path === '/skills/index.md')?.content).toContain('/skills/user/academy-writer/SKILL.md');
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

  it('全量提示只包含启用的full Skill，并始终包含内置读写Skill', () => {
    const prompt = compileFullSkillInstructions([
      userSkill({ loading: 'full' }),
      userSkill({ enabled: false, id: 'disabled', name: '禁用' }),
      userSkill({ id: 'on-demand', name: '按需', loading: 'on-demand' }),
    ]);
    expect(prompt).toContain(BUILTIN_CARD_WORKSPACE_SKILL.body);
    expect(prompt).toContain('学院写作');
    expect(prompt).not.toContain('禁用');
    expect(prompt).not.toContain('Skill：按需');
  });

  it('创建规范化模板并校验Skill文件字段', () => {
    expect(createSkillTemplate('My New Skill', 'description', 'full')).toMatchObject({
      id: 'my-new-skill',
      loading: 'full',
    });
    const files = projectSkills([userSkill()]);
    files.find(file => file.path.endsWith('/academy-writer/SKILL.md'))!.content = '---\nname: x\ndescription: y\nloading: invalid\nenabled: true\n---\nbody';
    expect(() => materializeUserSkills(files)).toThrowError(expect.objectContaining({ code: 'INVALID_PATCH' }));
  });

  it('新建用户Skill无需确认，修改和删除已有Skill强制确认', () => {
    expect(assessSkillMutation('write', '/skills/user/new/SKILL.md', ['old'])).toEqual({
      allowed: true,
      confirmationRequired: false,
    });
    expect(assessSkillMutation('patch', '/skills/user/old/SKILL.md', ['old'])).toEqual({
      allowed: true,
      confirmationRequired: true,
    });
    expect(assessSkillMutation('delete', '/skills/user/old', ['old'])).toEqual({
      allowed: true,
      confirmationRequired: true,
    });
    expect(assessSkillMutation('write', '/skills/builtin/card-workspace-io/SKILL.md', ['old'])).toMatchObject({
      allowed: false,
    });
    expect(assessSkillMutation('write', '/character/description.md', ['old'])).toMatchObject({ allowed: false });
  });
});
