import { describe, expect, it } from 'vitest';
import { MemoryTavernFileClient } from '../persistence/file-client';
import { MemoryAgentSettingsStore } from '../persistence/settings';
import { GlobalSkillStore } from './global-skill-store';
import type { AgentSkill } from './types';

function skill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    body: '# 工作流程\n\n先阅读，再修改。',
    builtin: false,
    description: '跨角色复用的写作流程。',
    directories: [],
    id: 'writer',
    loading: 'on-demand',
    name: '写作助手',
    resources: {},
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

  it('修改使用内容寻址物理文件，清单切换后删除旧文件', async () => {
    const files = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new GlobalSkillStore(files, settings);
    await store.save(skill());
    await store.save(skill({ body: '新版' }));
    expect(settings.load().globalSkills.writer.revision).toBe(2);
    expect(files.uploadedNames).toHaveLength(2);
    expect(files.uploadedNames[0]).not.toBe(files.uploadedNames[1]);
    expect(files.urls()).toHaveLength(1);

    await store.remove('writer');
    expect(await store.list()).toEqual([]);
    expect(settings.load().globalSkills).toEqual({});
    expect(files.urls()).toEqual([]);
  });

  it('锁定状态随Skill正文和全局索引保存，设置界面仍可解锁', async () => {
    const files = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new GlobalSkillStore(files, settings);
    await store.save(skill({ locked: true }));
    expect(settings.load().globalSkills.writer.locked).toBe(true);
    expect(await store.load('writer')).toMatchObject({ locked: true });
    await store.save(skill());
    expect(settings.load().globalSkills.writer.locked).toBe(false);
    expect((await store.load('writer')).locked).toBeUndefined();
  });

  it('中文Skill ID映射为ASCII物理文件名', async () => {
    const files = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new GlobalSkillStore(files, settings);
    await store.save(skill({ id: '世界书写作' }));
    await store.save(skill({ body: '新版', id: '世界书写作' }));
    expect(files.uploadedNames[0]).toMatch(/^[a-zA-Z0-9_.-]+$/u);
    expect(files.uploadedNames[1]).toMatch(/^[a-zA-Z0-9_.-]+$/u);
  });

  it('自由资源树分文件保存，列表延迟二进制正文而编辑载入完整内容', async () => {
    const files = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new GlobalSkillStore(files, settings);
    await store.save(
      skill({
        directories: ['empty', 'guides'],
        resources: {
          'guides/style.md': { content: '轻快文风', mediaType: 'text/markdown', size: 12 },
          'images/avatar.png': { data: Uint8Array.of(1, 2, 3), mediaType: 'image/png', size: 3 },
        },
      }),
    );

    expect(files.urls()).toHaveLength(3);
    expect(settings.load().globalSkills.writer.files).toMatchObject({
      'guides/style.md': { mediaType: 'text/markdown' },
      'images/avatar.png': { mediaType: 'image/png', size: 3 },
    });
    expect((await store.list())[0].resources?.['guides/style.md']?.content).toBe('轻快文风');
    expect((await store.list())[0].resources?.['images/avatar.png']?.data).toBeUndefined();
    expect((await store.load('writer')).resources?.['images/avatar.png']?.data).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('资源上传中途失败不切换现有清单', async () => {
    class FaultClient extends MemoryTavernFileClient {
      failNext = false;
      override async upload(name: string, bytes: Uint8Array): Promise<string> {
        if (this.failNext) {
          this.failNext = false;
          throw new Error('fault');
        }
        return super.upload(name, bytes);
      }
    }
    const files = new FaultClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new GlobalSkillStore(files, settings);
    await store.save(skill());
    const before = settings.load().globalSkills.writer;
    files.failNext = true;
    await expect(store.save(skill({ body: '损坏的新版本' }))).rejects.toThrow('fault');
    expect(settings.load().globalSkills.writer).toEqual(before);
    expect((await store.list())[0].body).toContain('先阅读');
  });
});
