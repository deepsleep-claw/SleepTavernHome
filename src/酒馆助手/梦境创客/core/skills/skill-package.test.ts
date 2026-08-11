import { describe, expect, it } from 'vitest';
import { exportSkillZip, importSkillMarkdown, importSkillZip } from './skill-package';
import type { AgentSkill } from './types';

function packagedSkill(): AgentSkill {
  return {
    body: '# 流程\n\n读取资料。',
    builtin: false,
    description: '测试完整资源包。',
    directories: ['empty'],
    id: 'package-test',
    loading: 'on-demand',
    name: '资源包测试',
    resources: {
      'docs/guide.md': { content: '指南', mediaType: 'text/markdown', size: 6 },
      'images/a.png': { data: Uint8Array.of(1, 2, 3), mediaType: 'image/png', size: 3 },
    },
  };
}

describe('Skill MD/ZIP交换格式', () => {
  it('Markdown只导入主Skill并生成新ID', () => {
    const skill = importSkillMarkdown('---\nname: 单文件\ndescription: 摘要\nloading: full\n---\n正文');
    expect(skill).toMatchObject({ body: '正文', loading: 'full', name: '单文件', resources: {} });
    expect(skill.id).toMatch(/^单文件-|^skill-/u);
  });

  it('ZIP往返保留自由目录、文本和二进制资源', () => {
    const imported = importSkillZip(exportSkillZip(packagedSkill()), 'bundle.zip');
    expect(imported.name).toBe('资源包测试');
    expect(imported.directories).toContain('empty');
    expect(imported.resources?.['docs/guide.md']?.content).toBe('指南');
    expect(imported.resources?.['images/a.png']?.data).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('拒绝越界路径和缺失SKILL.md的ZIP', async () => {
    const { zipSync } = await import('fflate');
    expect(() => importSkillZip(zipSync({ '../evil.txt': Uint8Array.of(1) }))).toThrow('越界路径');
    expect(() => importSkillZip(zipSync({ 'notes.md': Uint8Array.of(1) }))).toThrow('一个SKILL.md');
  });
});
