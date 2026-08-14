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
  it('支持列出、读取、新建与隐式目录', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    expect((await workspace.list('/')).map(entry => entry.name)).toEqual(['character', 'context', 'worldbooks']);

    await workspace.write('/greetings/001-初见.md', '你好。', 'write-1');
    expect((await workspace.read('/greetings/001-初见.md')).content).toBe('你好。');
    expect(workspace.changes()).toMatchObject([{ kind: 'create', path: '/greetings/001-初见.md' }]);
  });

  it('整体写入默认只允许新建，覆盖已有文件必须显式声明', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    await expect(workspace.write('/character/description.md', '误覆盖', 'write-existing')).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
    await workspace.write('/character/description.md', '明确覆盖', 'overwrite-existing', { overwrite: true });
    expect((await workspace.read('/character/description.md')).content).toBe('明确覆盖');
  });

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

  it('用统一Diff精确修改且工具调用幂等', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    const patch = '@@ -1,3 +1,3 @@\n-旧标题\n+新标题\n 第二行\n 结尾';
    await workspace.patch('/character/description.md', patch, 'patch-1');
    await workspace.patch('/character/description.md', patch, 'patch-1');
    expect((await workspace.read('/character/description.md')).content).toBe('新标题\n第二行\n结尾\n');
  });

  it('拒绝上下文不匹配的Patch', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    await expect(
      workspace.patch('/character/description.md', '@@ -1 +1 @@\n-不存在\n+新内容', 'patch-invalid'),
    ).rejects.toMatchObject({ code: 'INVALID_PATCH' });
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

  it('拒绝越过根目录和Windows路径', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    await expect(workspace.read('/character/../context/chat.md')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(workspace.write('C:\\secret.txt', 'x', 'bad-path')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('像rg一样搜索正则、Glob、上下文和截断', async () => {
    const workspace = new MemoryWorkspaceRepository({ files });
    const result = await workspace.search({
      contextLines: 1,
      glob: '**/*.md',
      maxResults: 1,
      mode: 'regex',
      path: '/worldbooks',
      pattern: '学院|安静',
    });
    expect(result).toMatchObject({ matchedFiles: 1, returnedMatches: 1, truncated: true });
    expect(result.matches[0]).toMatchObject({ line: 1, path: '/worldbooks/学院/entries/42-library.md' });
    expect(result.matches[0].contextAfter).toEqual(['这里很安静。']);
  });

  it('默认的普通文本搜索不会把正则字符当作表达式', async () => {
    const workspace = new MemoryWorkspaceRepository({
      files: [{ ...files[0], content: 'a+b\nab' }],
    });
    const result = await workspace.search({ pattern: 'a+b' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].text).toBe('a+b');
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
      workspace.stageFiles(
        [staged[0], { ...staged[1], path: '/worldbooks/另一本/entry.md' }],
        'stage-conflict',
      ),
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
