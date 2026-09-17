import { describe, expect, it } from 'vitest';
import { MemoryWorkspaceRepository } from './memory-repository';
import { WorkspaceError, type WorkspaceFile } from './types';

const files: WorkspaceFile[] = [
  {
    content: '旧标题\n第二行\n结尾\n',
    mediaType: 'text/markdown',
    path: '/character/description.md',
    readonly: false,
    resourceId: 'description',
  },
  {
    content: '图书馆位于学院北侧。\n这里很安静。',
    mediaType: 'text/markdown',
    path: '/worldbooks/学院/entries/42-library.md',
    readonly: false,
    resourceId: 'entry-42',
  },
  {
    content: '只读聊天',
    mediaType: 'text/markdown',
    path: '/context/chat/messages-0001.md',
    readonly: true,
    resourceId: 'chat-1',
  },
];

describe('MemoryWorkspaceRepository', () => {
  it('空世界书仍显示并允许列出固定entries目录', async () => {
    const workspace = new MemoryWorkspaceRepository({
      files: [
        {
          content: 'name: 空世界书',
          mediaType: 'text/yaml',
          path: '/worldbooks/空世界书/book.yaml',
          readonly: false,
          resourceId: 'empty-book',
        },
      ],
    });

    expect(await workspace.list('/worldbooks/空世界书')).toEqual([
      expect.objectContaining({ kind: 'directory', name: 'entries', path: '/worldbooks/空世界书/entries' }),
      expect.objectContaining({ kind: 'file', name: 'book.yaml' }),
    ]);
    expect(await workspace.list('/worldbooks/空世界书/entries')).toEqual([]);
  });

  it('移动目录时保留资源身份并记录为移动', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    await workspace.move('/worldbooks/学院', '/worldbooks/新学院', 'move-1');
    expect((await workspace.read('/worldbooks/新学院/entries/42-library.md')).resourceId).toBe('entry-42');
    expect(workspace.changes()).toMatchObject([
      {
        from: '/worldbooks/学院/entries/42-library.md',
        kind: 'move',
        path: '/worldbooks/新学院/entries/42-library.md',
      },
    ]);
  });

  it('删除文件并拒绝删除根目录', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    await workspace.remove('/worldbooks/学院/entries/42-library.md', 'remove-1');
    await expect(workspace.read('/worldbooks/学院/entries/42-library.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(workspace.remove('/', 'remove-root')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('保护只读根和文件', async () => {
    const workspace = new MemoryWorkspaceRepository({ files, readonlyRoots: ['/skills/builtin'] });
    await expect(workspace.write('/context/chat/messages-0001.md', '覆盖', 'readonly-file')).rejects.toBeInstanceOf(
      WorkspaceError,
    );
    await expect(workspace.write('/skills/builtin/io/SKILL.md', '覆盖', 'readonly-root')).rejects.toMatchObject({
      code: 'READ_ONLY_PATH',
    });
    await expect(workspace.remove('/context', 'readonly-tree')).rejects.toMatchObject({ code: 'READ_ONLY_PATH' });
    await expect(workspace.move('/context', '/archive', 'readonly-move')).rejects.toMatchObject({
      code: 'READ_ONLY_PATH',
    });
  });

  it('替换外部投影时不产生Working Copy变更', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    workspace.replaceProjection('/worldbooks/资料', [
      {
        content: 'name: 资料',
        mediaType: 'text/yaml',
        path: '/worldbooks/资料/book.yaml',
        readonly: true,
        resourceId: 'reference:book',
      },
    ]);
    expect((await workspace.read('/worldbooks/资料/book.yaml')).content).toBe('name: 资料');
    expect(workspace.changes()).toEqual([]);

    workspace.replaceProjection('/worldbooks/资料', []);
    await expect(workspace.read('/worldbooks/资料/book.yaml')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(workspace.changes()).toEqual([]);
  });

  it('批量建立文件时保持原子性与工具调用幂等', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    const staged: WorkspaceFile[] = [
      {
        content: 'name: 新世界',
        mediaType: 'text/yaml',
        path: '/worldbooks/新世界/book.yaml',
        readonly: false,
        resourceId: 'new:book',
      },
      {
        content: '正文',
        mediaType: 'text/markdown',
        path: '/worldbooks/新世界/entries/0001.md',
        readonly: false,
        resourceId: 'new:entry',
      },
    ];
    await workspace.stageFiles(staged, 'stage-worldbook');
    await workspace.stageFiles(staged, 'stage-worldbook');
    expect(workspace.changes().filter(change => change.path.startsWith('/worldbooks/新世界'))).toHaveLength(2);

    await expect(
      workspace.stageFiles([staged[0], { ...staged[1], path: '/worldbooks/另一本/entry.md' }], 'stage-conflict'),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    await expect(workspace.read('/worldbooks/另一本/entry.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('记录创建、修改和删除，并返回不可外部篡改的快照', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    await workspace.write('/character/description.md', '改写', 'modify', { overwrite: true });
    await workspace.write('/character/new.yaml', 'enabled: true', 'create');
    await workspace.write('/notes.txt', 'note', 'plain');
    await workspace.remove('/worldbooks', 'delete-tree');
    const snapshot = workspace.snapshot();
    snapshot[0].content = '外部篡改';
    expect((await workspace.read('/character/description.md')).content).toBe('改写');
    expect((await workspace.read('/character/new.yaml')).mediaType).toBe('text/yaml');
    expect((await workspace.read('/notes.txt')).mediaType).toBe('text/plain');
    expect(workspace.changes().map(change => change.kind)).toEqual(['modify', 'create', 'create', 'delete']);
  });

  it('拒绝缺失路径、重复目标、向自身移动和空工具调用ID', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    await expect(workspace.list('/missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(workspace.read('/missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(workspace.remove('/missing', 'remove-missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(workspace.move('/missing', '/new', 'move-missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(workspace.move('/worldbooks', '/worldbooks/nested', 'move-self')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    await expect(workspace.move('/', '/new', 'move-root')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await workspace.write('/archive/description.md', '已存在', 'write-existing');
    await expect(workspace.move('/character', '/archive', 'move-existing')).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    await expect(workspace.write('/new.md', 'x', '')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});
