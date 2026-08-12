import { describe, expect, it } from 'vitest';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { isRichToolOutput } from './tool-output';
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

  it('write_file默认拒绝覆盖，显式overwrite才整体替换', async () => {
    const repository = new MemoryWorkspaceRepository({
      files: [
        {
          content: '旧内容',
          mediaType: 'text/markdown',
          path: '/character/description.md',
          readonly: false,
          resourceId: 'description',
        },
      ],
    });
    const tools = new Map(createWorkspaceRunnerTools(repository).map(item => [item.name, item]));
    await expect(
      tools.get('write_file')!.execute({ content: '误覆盖', path: '/character/description.md' }, 'write-default'),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    await tools
      .get('write_file')!
      .execute({ content: '新内容', overwrite: true, path: '/character/description.md' }, 'write-overwrite');
    expect((await repository.read('/character/description.md')).content).toBe('新内容');
  });

  it('内置Skill禁止改写，已有用户Skill需要确认，新Skill无需确认', async () => {
    const repository = new MemoryWorkspaceRepository();
    const tools = new Map(createWorkspaceRunnerTools(repository, ['old']).map(item => [item.name, item]));
    await expect(
      tools.get('write_file')!.confirmation?.({ path: '/skills/builtin/card-workspace-io/SKILL.md' }, 'call'),
    ).rejects.toThrow('不可修改');
    expect(await tools.get('apply_patch')!.confirmation?.({ path: '/skills/user/old/SKILL.md' }, 'call')).toMatchObject({
      toolName: 'apply_patch',
    });
    expect(await tools.get('write_file')!.confirmation?.({ path: '/skills/user/new/SKILL.md' }, 'call')).toBeUndefined();
    expect(
      await tools.get('move_path')!.confirmation?.({ from: '/skills/user/old', to: '/skills/user/renamed' }, 'call'),
    ).toBeDefined();
    expect(
      await tools.get('move_path')!.confirmation?.({ from: '/skills/user/new', to: '/skills/user/old' }, 'call'),
    ).toBeDefined();
    expect(await tools.get('delete_path')!.confirmation?.({ path: '/character/description.md' }, 'call')).toBeUndefined();
  });

  it('把外部二进制文件作为不泄露物理地址的多模态工具结果返回', async () => {
    const repository = new MemoryWorkspaceRepository({
      files: [
        {
          content: '',
          external: {
            fileId: 'file-1',
            mediaType: 'image/png',
            scope: 'persistent',
            sha256: 'hash',
            size: 123,
          },
          mediaType: 'image/png',
          path: '/files/card.png',
          readonly: false,
          resourceId: 'file-1',
        },
      ],
    });
    const read = new Map(createWorkspaceRunnerTools(repository).map(item => [item.name, item])).get('read_file')!;
    const result = await read.execute({ path: '/files/card.png' }, 'read-binary');
    expect(isRichToolOutput(result)).toBe(true);
    if (!isRichToolOutput(result)) throw new Error('expected rich output');
    expect(result.display).toEqual({ binary: true, mediaType: 'image/png', path: '/files/card.png', size: 123 });
    expect(result.modelOutput).toMatchObject({
      type: 'content',
      value: [
        { type: 'text' },
        { data: { text: 'dreamcreator-file://file-1', type: 'text' }, mediaType: 'image/png', type: 'file' },
      ],
    });
  });

  it('遮罩 data.yaml 的读取、搜索和Patch视图，底层始终保留真实值', async () => {
    const key = `sk_test_${'A'.repeat(24)}`;
    const path = '/tavern-helper-scripts/character/scripts/s1/data.yaml';
    const repository = new MemoryWorkspaceRepository({
      files: [{ content: `key: ${key}\nname: old\n`, mediaType: 'text/yaml', path, readonly: false, resourceId: 'data' }],
    });
    const tools = new Map(createWorkspaceRunnerTools(repository).map(item => [item.name, item]));
    const read = (await tools.get('read_file')!.execute({ path }, 'read-secret')) as {
      secretProtection: { masked: number };
      view: string;
    };
    expect(read.secretProtection.masked).toBe(1);
    expect(read.view).not.toContain(key);
    const token = read.view.match(/<<DCA_SECRET:[a-f0-9]{20}>>/u)?.[0];
    expect(token).toBeTruthy();
    const search = (await tools.get('search_files')!.execute({ pattern: key }, 'search-secret')) as {
      matches: Array<{ text: string }>;
    };
    expect(search.matches[0].text).not.toContain(key);
    await tools.get('apply_patch')!.execute(
      { patch: `@@ -1,2 +1,2 @@\n key: ${token}\n-name: old\n+name: new`, path },
      'patch-secret',
    );
    expect((await repository.read(path)).content).toBe(`key: ${key}\nname: new\n`);
  });

  it('禁止未授权的非角色资源写入，授权后仍要求逐次确认', async () => {
    const repository = new MemoryWorkspaceRepository();
    let allowed = false;
    const tools = new Map(
      createWorkspaceRunnerTools(repository, [], { canWriteNonCharacterResources: () => allowed }).map(item => [
        item.name,
        item,
      ]),
    );
    const input = { content: 'enabled: true', path: '/regexes/global/new.yaml' };
    await expect(tools.get('write_file')!.confirmation?.(input, 'global-write')).rejects.toThrow(
      'NON_CHARACTER_RESOURCE_WRITE_DISABLED',
    );
    allowed = true;
    expect(await tools.get('write_file')!.confirmation?.(input, 'global-write')).toMatchObject({ toolName: 'write_file' });
  });

  it('仅在启用脚本或修改已启用脚本代码时要求角色脚本确认', async () => {
    const root = '/tavern-helper-scripts/character/scripts/s1';
    const repository = new MemoryWorkspaceRepository({
      files: [
        {
          content: 'enabled: false\nname: test\n',
          mediaType: 'text/yaml',
          path: `${root}/info.yaml`,
          readonly: false,
          resourceId: 'info',
        },
        { content: '', mediaType: 'text/plain', path: `${root}/script.js`, readonly: false, resourceId: 'script' },
      ],
    });
    const tools = new Map(createWorkspaceRunnerTools(repository).map(item => [item.name, item]));
    expect(
      await tools
        .get('write_file')!
        .confirmation?.({ content: 'enabled: true\nname: test\n', path: `${root}/info.yaml` }, 'enable'),
    ).toBeDefined();
    expect(
      await tools.get('write_file')!.confirmation?.({ content: 'return 1;', path: `${root}/script.js` }, 'edit-off'),
    ).toBeUndefined();
    await repository.write(`${root}/info.yaml`, 'enabled: true\nname: test\n', 'set-enabled', { overwrite: true });
    expect(
      await tools.get('write_file')!.confirmation?.({ content: 'return 2;', path: `${root}/script.js` }, 'edit-on'),
    ).toBeDefined();
  });
});
