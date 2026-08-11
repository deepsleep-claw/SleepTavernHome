import { describe, expect, it, vi } from 'vitest';
import { FakeTavernChatBridge } from '../tavern/chat-bridge';
import { TavernChatWorkspace } from '../tavern/chat-workspace';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { createTavernChatRunnerTools } from './tavern-chat-tools';

describe('酒馆聊天Runner工具', () => {
  it('普通模式只在本轮第一次直接操作前请求一次授权', async () => {
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(new FakeTavernChatBridge());
    await workspace.initialize(repository);
    const tools = createTavernChatRunnerTools(repository, workspace, { isYolo: () => false });
    const create = tools.find(item => item.name === 'create_tavern_chat')!;
    const truncate = tools.find(item => item.name === 'truncate_tavern_chat')!;

    expect(create.confirmation?.({ name: '测试' }, 'call-1')).toMatchObject({ toolName: 'create_tavern_chat' });
    await create.execute({ name: '测试' }, 'call-1');
    expect(truncate.confirmation?.({ chatId: 'c02', fromMessageId: 0 }, 'call-2')).toBeUndefined();
  });

  it('生成前先等待Working Copy检查点，拒绝时把明确错误返回给模型', async () => {
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(new FakeTavernChatBridge());
    await workspace.initialize(repository);
    const beforeGeneration = vi.fn(async () => false);
    const tools = createTavernChatRunnerTools(repository, workspace, { beforeGeneration, isYolo: () => true });
    const generate = tools.find(item => item.name === 'generate_tavern_reply')!;

    await workspace.writeFile(
      '/context/chats/c01/messages/0000-0099/000001.md',
      ['---', 'role: user', '---', '测试'].join('\n'),
      repository,
    );
    await expect(generate.execute({ chatId: 'c01' }, 'generate-1')).rejects.toThrow('CHECKPOINT_REJECTED');
    expect(beforeGeneration).toHaveBeenCalledOnce();
  });

  it('重复toolCallId不会再次执行酒馆副作用', async () => {
    const bridge = new FakeTavernChatBridge();
    const repository = new MemoryWorkspaceRepository();
    const workspace = new TavernChatWorkspace(bridge);
    await workspace.initialize(repository);
    const create = createTavernChatRunnerTools(repository, workspace, { isYolo: () => true }).find(
      item => item.name === 'create_tavern_chat',
    )!;

    await create.execute({ name: '幂等测试' }, 'same-call');
    expect(await create.execute({ name: '幂等测试' }, 'same-call')).toEqual({ idempotent: true });
    expect(bridge.calls.filter(call => call === 'create-chat:幂等测试')).toHaveLength(1);
  });
});
