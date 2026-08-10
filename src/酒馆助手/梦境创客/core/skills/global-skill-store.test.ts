import { describe, expect, it } from 'vitest';
import { MemoryTavernFileClient } from '../persistence/file-client';
import { MemoryAgentSettingsStore } from '../persistence/settings';
import { GlobalSkillStore } from './global-skill-store';
import type { AgentSkill } from './types';

function skill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    assets: {},
    body: '# 工作流程\n\n先阅读，再修改。',
    builtin: false,
    description: '跨角色复用的写作流程。',
    id: 'writer',
    loading: 'on-demand',
    name: '写作助手',
    references: {},
    ...overrides,
  };
}

describe('GlobalSkillStore', () => {
  it('正文写入酒馆文件、设置只保留全局索引，并可被另一个运行时读取', async () => {
    const files = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const first = new GlobalSkillStore(files, settings, () => 100);
    await first.save(skill());

    expect(settings.load().globalSkills.writer).toMatchObject({ revision: 1, updatedAt: 100 });
    expect(JSON.stringify(settings.load())).not.toContain('先阅读，再修改');
    expect(files.uploadedNames).toHaveLength(1);
    expect(await new GlobalSkillStore(files, settings).list()).toEqual([skill()]);
  });

  it('修改原子覆盖稳定Markdown文件，删除同时移除物理文件', async () => {
    const files = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new GlobalSkillStore(files, settings);
    await store.save(skill());
    await store.save(skill({ body: '新版' }));
    expect(settings.load().globalSkills.writer.revision).toBe(2);
    expect(files.uploadedNames).toEqual([
      'dream-card-agent--global-skill--writer.md',
      'dream-card-agent--global-skill--writer.md',
    ]);
    expect(files.urls()).toHaveLength(1);

    await store.remove('writer');
    expect(await store.list()).toEqual([]);
    expect(settings.load().globalSkills).toEqual({});
    expect(files.urls()).toEqual([]);
  });

  it('中文Skill ID映射为稳定的ASCII物理文件名', async () => {
    const files = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new GlobalSkillStore(files, settings);
    await store.save(skill({ id: '世界书写作' }));
    await store.save(skill({ body: '新版', id: '世界书写作' }));
    expect(files.uploadedNames[0]).toMatch(/^[a-zA-Z0-9_.-]+$/u);
    expect(files.uploadedNames[1]).toBe(files.uploadedNames[0]);
  });
});
