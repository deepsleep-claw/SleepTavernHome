import { describe, expect, it } from 'vitest';
import { parseYamlObject, serializeFrontmatter, serializeYaml } from '../mapping/serde';
import { FakeTavernBridge } from '../tavern/test-bridge';
import { LiveWorkspaceRepository } from './live-repository';
import { TavernWorkspaceLiveSource } from './tavern-workspace-source';

function createRepository(bridge = new FakeTavernBridge()) {
  const source = new TavernWorkspaceLiveSource({
    bridge,
    mountedPresets: new Set(),
    readBinary: async () => Uint8Array.of(1, 2, 3),
  });
  return { bridge, repository: new LiveWorkspaceRepository({ source }) };
}

describe('TavernWorkspaceLiveSource', () => {
  it('把全部User投影为可新建、修改、重命名和删除的Markdown文件', async () => {
    const { bridge, repository } = createRepository();
    await repository.initialize();
    expect((await repository.read('/users/玩家.md')).content).toContain('玩家描述');

    const player = await repository.read('/users/玩家.md');
    await repository.write('/users/玩家.md', player.content.replace('玩家描述', '新的玩家描述'), 'user:edit', {
      overwrite: true,
    });
    expect(bridge.getPersona('玩家').description).toBe('新的玩家描述');

    await repository.write(
      '/users/旅行者.md',
      serializeFrontmatter({ depth: 3, role: 0, title: '旅人' }, '新建的User描述'),
      'user:create',
    );
    expect(bridge.getPersona('旅行者')).toMatchObject({ description: '新建的User描述', depth: 3, title: '旅人' });
    await repository.move('/users/旅行者.md', '/users/远行者.md', 'user:rename');
    expect(bridge.getPersonaNames()).toContain('远行者');
    expect(bridge.getPersonaNames()).not.toContain('旅行者');
    await repository.remove('/users/远行者.md', 'user:delete');
    expect(bridge.getPersonaNames()).not.toContain('远行者');
  });

  it('当前酒馆预设可按索引拆分编辑，挂载库保持只读', async () => {
    const bridge = new FakeTavernBridge();
    bridge.presets.set('资料预设', bridge.getPreset('in_use'));
    const source = new TavernWorkspaceLiveSource({
      bridge,
      mountedPresets: new Set(['资料预设']),
      readBinary: async () => Uint8Array.of(),
    });
    const repository = new LiveWorkspaceRepository({ source });
    await repository.initialize();
    const currentPrompt = (await repository.list('/presets/current/prompts'))[0];
    await repository.write(currentPrompt.path, '更新后的系统提示', 'preset:edit', { overwrite: true });
    expect(bridge.getPreset('in_use').prompts[0].content).toBe('更新后的系统提示');

    const libraryPrompt = (await repository.list('/presets/library/资料预设/prompts'))[0];
    await expect(repository.write(libraryPrompt.path, '不能写', 'preset:readonly', { overwrite: true }))
      .rejects.toMatchObject({ code: 'READ_ONLY_PATH' });

    const index = await repository.read('/presets/current/index.yaml');
    const metadata = parseYamlObject(index.content, index.path);
    const extra = {
      enabled: true,
      file: '002-补充.md',
      id: 'extra',
      name: '补充',
      role: 'system',
    };
    (metadata.prompts as unknown[]).push(extra);
    await repository.write(index.path, serializeYaml(metadata), 'preset:add-index', { overwrite: true });
    expect((await repository.read('/presets/current/prompts/002-补充.md')).content).toBe('');
    await repository.write('/presets/current/prompts/002-补充.md', '补充内容', 'preset:add-content', { overwrite: true });
    expect(bridge.getPreset('in_use').prompts.find(prompt => prompt.id === 'extra')?.content).toBe('补充内容');

    await expect(repository.remove('/presets/current/prompts/002-补充.md', 'preset:bad-delete'))
      .rejects.toThrow('仍被/presets/current/index.yaml引用');
    const latestIndex = await repository.read(index.path);
    const latest = parseYamlObject(latestIndex.content, latestIndex.path);
    latest.prompts = (latest.prompts as Array<{ id?: string }>).filter(prompt => prompt.id !== 'extra');
    await repository.write(index.path, serializeYaml(latest), 'preset:remove-index', { overwrite: true });
    await expect(repository.read('/presets/current/prompts/002-补充.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
