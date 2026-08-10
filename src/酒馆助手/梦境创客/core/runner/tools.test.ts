import { describe, expect, it } from 'vitest';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { createWorkspaceRunnerTools } from './tools';

describe('workspace runner tools', () => {
  it('把通用文件读写、Patch、移动、删除和搜索映射到Repository', async () => {
    const repository = new MemoryWorkspaceRepository({
      files: [
        {
          content: 'hello\nworld',
          mediaType: 'text/markdown',
          path: '/character/description.md',
          readonly: false,
          resourceId: 'description',
        },
      ],
    });
    const tools = new Map(createWorkspaceRunnerTools(repository).map(item => [item.name, item]));
    expect(await tools.get('list_directory')!.execute({ path: '/character' }, 'list')).toMatchObject([
      { name: 'description.md' },
    ]);
    expect(await tools.get('read_file')!.execute({ path: '/character/description.md' }, 'read')).toMatchObject({
      endLine: 2,
      lineNumbering: { prefixesAreFileContent: false },
      startLine: 1,
      totalLines: 2,
      view: '1 | hello\n2 | world',
    });
    expect(
      await tools.get('read_file')!.execute({ limit: 1, offset: 2, path: '/character/description.md' }, 'read-page'),
    ).toMatchObject({ endLine: 2, startLine: 2, totalLines: 2, truncated: false, view: '2 | world' });
    await tools.get('apply_patch')!.execute(
      { patch: '@@ -1,2 +1,2 @@\n-hello\n+HELLO\n world', path: '/character/description.md' },
      'patch',
    );
    await tools.get('write_file')!.execute({ content: 'new', path: '/character/new.md' }, 'write');
    await tools.get('move_path')!.execute({ from: '/character/new.md', to: '/character/moved.md' }, 'move');
    expect(await tools.get('search_files')!.execute({ pattern: 'HELLO' }, 'search')).toMatchObject({ returnedMatches: 1 });
    await tools.get('delete_path')!.execute({ path: '/character/moved.md' }, 'delete');
    await expect(repository.read('/character/moved.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('内置Skill禁止改写，已有用户Skill需要确认，新Skill无需确认', () => {
    const repository = new MemoryWorkspaceRepository();
    const tools = new Map(createWorkspaceRunnerTools(repository, ['old']).map(item => [item.name, item]));
    expect(() =>
      tools.get('write_file')!.confirmation?.({ path: '/skills/builtin/card-workspace-io/SKILL.md' }, 'call'),
    ).toThrow('不可修改');
    expect(tools.get('apply_patch')!.confirmation?.({ path: '/skills/user/old/SKILL.md' }, 'call')).toMatchObject({
      toolName: 'apply_patch',
    });
    expect(tools.get('write_file')!.confirmation?.({ path: '/skills/user/new/SKILL.md' }, 'call')).toBeUndefined();
    expect(
      tools.get('move_path')!.confirmation?.({ from: '/skills/user/old', to: '/skills/user/renamed' }, 'call'),
    ).toBeDefined();
    expect(
      tools.get('move_path')!.confirmation?.({ from: '/skills/user/new', to: '/skills/user/old', }, 'call'),
    ).toBeDefined();
    expect(tools.get('delete_path')!.confirmation?.({ path: '/character/description.md' }, 'call')).toBeUndefined();
  });
});
