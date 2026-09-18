import { describe, expect, it } from 'vitest';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { FakeTavernChatBridge } from './chat-bridge';
import { TavernChatWorkspace } from './chat-workspace';

const firstMessagePath = '/character/chats/c01/messages/0000-0099/000000.md';

describe('TavernChatWorkspace', () => {
  it('失效的旧聊天只显示读取提示，不阻止恢复当前聊天', async () => {
    const bridge = new FakeTavernChatBridge();
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(bridge, {
      mounts: [{ alias: 'c09', ref: '不存在', name: '旧聊天' }],
      nextAlias: 10,
    });
    await workspace.initialize(repository);
    expect(workspace.warnings).toHaveLength(1);
    expect((await repository.read('/character/chats/c09/error.md')).readonly).toBe(true);
    expect(workspace.exportRuntime().mounts).toHaveLength(2);
  });
  it('用稳定短ID投影当前聊天，并且实时投影不进入Working Diff', async () => {
    const bridge = new FakeTavernChatBridge();
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(bridge);

    await workspace.initialize(repository);

    expect((await repository.read('/character/chats/index.yaml')).content).toContain('active_chat: c01');
    expect(await repository.read(firstMessagePath)).toMatchObject({
      content: expect.stringContaining('你好。'),
      readonly: false,
    });
    expect(workspace.exportRuntime().initialChat).toBe('c01');
    expect(repository.changes()).toEqual([]);
  });

  it('允许整体改写现有楼层，但要求不可变元信息与当前投影一致', async () => {
    const bridge = new FakeTavernChatBridge();
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(bridge);
    await workspace.initialize(repository);
    const current = await repository.read(firstMessagePath);

    await workspace.writeFile(firstMessagePath, current.content.replace('你好。', '修改后的问候。'), repository);

    expect((await bridge.readChat('初始聊天')).messages[0].swipes[0]).toBe('修改后的问候。');
    await expect(
      workspace.writeFile(firstMessagePath, current.content.replace(/revision: .+/u, 'revision: forged'), repository),
    ).rejects.toThrow('CHAT_METADATA_MISMATCH');
  });

  it('只允许在末尾创建下一楼，并由酒馆补全其余元信息', async () => {
    const bridge = new FakeTavernChatBridge();
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(bridge);
    await workspace.initialize(repository);

    await workspace.writeFile(
      '/character/chats/c01/messages/0000-0099/000001.md',
      ['---', 'role: user', 'name: 测试者', 'hidden: false', '---', '直接追加的消息'].join('\n'),
      repository,
    );

    const chat = await bridge.readChat('初始聊天');
    expect(chat.messages[1]).toMatchObject({ messageId: 1, name: '测试者', role: 'user', swipes: ['直接追加的消息'] });
    await expect(
      workspace.writeFile(
        '/character/chats/c01/messages/0000-0099/000003.md',
        ['---', 'role: user', '---', '跳号'].join('\n'),
        repository,
      ),
    ).rejects.toThrow('CHAT_APPEND_ONLY');
  });

  it('聊天楼层应用上下文补丁，任一片段失败都不写入酒馆', async () => {
    const bridge = new FakeTavernChatBridge();
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(bridge);
    await workspace.initialize(repository);
    const start = `*** Begin Patch\n*** Update File: ${firstMessagePath}\n@@\n-你好。\n+新的问候。\n`;
    await expect(
      workspace.patchFile(firstMessagePath, `${start}@@\n-missing\n+extra\n*** End Patch`, repository),
    ).rejects.toThrow(/第2个片段/u);
    expect((await bridge.readChat('初始聊天')).messages[0].swipes[0]).toBe('你好。');
    await workspace.patchFile(firstMessagePath, `${start}*** End Patch`, repository);
    expect((await bridge.readChat('初始聊天')).messages[0].swipes[0]).toBe('新的问候。');
    expect((await repository.read(firstMessagePath)).content).toContain('新的问候。');
  });

  it('新聊天获得不复用的短ID，且只有活动聊天可以通过文件改写', async () => {
    const bridge = new FakeTavernChatBridge();
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(bridge);
    await workspace.initialize(repository);

    const created = await workspace.create('梦境创客测试', repository);
    expect(created.alias).toBe('c02');
    expect((await repository.read(firstMessagePath)).readonly).toBe(true);
    await expect(workspace.writeFile(firstMessagePath, 'invalid', repository)).rejects.toThrow('CHAT_NOT_ACTIVE');
    expect(workspace.exportRuntime().nextAlias).toBe(3);
  });

  it('遵循酒馆的最新楼层Swipe与从指定楼层截断语义', async () => {
    const bridge = new FakeTavernChatBridge();
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(bridge);
    await workspace.initialize(repository);

    await workspace.switchSwipe('c01', 1, repository);
    expect((await bridge.readChat('初始聊天')).messages[0].selectedSwipe).toBe(1);
    await workspace.writeFile(
      '/character/chats/c01/messages/0000-0099/000001.md',
      ['---', 'role: user', '---', '测试'].join('\n'),
      repository,
    );
    await workspace.generateReply('c01', repository);
    await workspace.switchSwipe('c01', 'generate', repository);
    expect((await bridge.readChat('初始聊天')).messages.at(-1)?.swipes).toHaveLength(2);
    await workspace.truncate('c01', 0, repository);
    expect((await bridge.readChat('初始聊天')).messages).toEqual([]);
  });

  it('禁止把文件删除误解为只删除单层', async () => {
    const workspace = new TavernChatWorkspace(new FakeTavernChatBridge());
    expect(() => workspace.assertNoMoveOrDelete(firstMessagePath)).toThrow('truncate_tavern_chat');
  });
});
