import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlobalTavernChatBridge } from './chat-bridge';

describe('全局酒馆聊天桥接', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('截断时一次提交连续楼层，并等待酒馆完整保存后再返回', async () => {
    const remove = vi.fn(async () => undefined);
    vi.stubGlobal('getChatMessages', vi.fn(() => [
      { message_id: 0 },
      { message_id: 1 },
      { message_id: 2 },
      { message_id: 3 },
    ]));
    vi.stubGlobal('deleteChatMessages', remove);

    await createGlobalTavernChatBridge().truncate(1);

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith([1, 2, 3], { refresh: 'all' });
  });
});
