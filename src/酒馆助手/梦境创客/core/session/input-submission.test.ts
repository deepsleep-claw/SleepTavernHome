import { describe, expect, it, vi } from 'vitest';
import { SessionInputSubmissions, type SessionInput } from './input-submission';
import type { SessionView } from './types';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function view(sessionId: string, id: string, kind = 'user'): SessionView {
  return { sessionId, ui: [{ id, kind }] } as SessionView;
}

const message: SessionInput = { id: 'input-a', sessionId: 'a', text: '修改描述', kind: 'message' };

describe('SessionInputSubmissions', () => {
  it('精确匹配会话和输入 ID，接收回执不等待生成完成', async () => {
    const store = new SessionInputSubmissions();
    const execution = deferred();
    const accepted = vi.fn();
    const receipt = store.submit(message, () => execution.promise, vi.fn());
    void receipt.then(accepted);
    store.observe(view('b', message.id));
    store.observe(view('a', 'other-input'));
    store.observe(view('a', message.id, 'assistant'));
    await Promise.resolve();
    expect(accepted).not.toHaveBeenCalled();
    store.observe(view('a', message.id));
    expect(await receipt).toEqual({ id: message.id, sessionId: 'a', kind: 'message' });
    execution.resolve();
  });

  it('重复请求复用原回执，等待接收期间拒绝同会话的另一条输入', async () => {
    const store = new SessionInputSubmissions();
    const execution = deferred();
    const execute = vi.fn(() => execution.promise);
    const receipt = store.submit(message, execute, vi.fn());
    expect(store.submit(message, execute, vi.fn())).toBe(receipt);
    await expect(store.submit({ ...message, id: 'other' }, execute, vi.fn())).rejects.toThrow('正在提交');
    expect(execute).toHaveBeenCalledOnce();
    execution.resolve();
    await receipt;
    expect(store.submit(message, execute, vi.fn())).toBe(receipt);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('接收前失败释放提交，接收后的失败只报告错误并保留回执', async () => {
    const store = new SessionInputSubmissions();
    const onError = vi.fn();
    await expect(
      store.submit(
        message,
        async () => {
          throw new Error('未接收');
        },
        onError,
      ),
    ).rejects.toThrow('未接收');
    expect(store.get(message)).toBeUndefined();
    const execution = deferred();
    const receipt = store.submit(message, () => execution.promise, onError);
    store.observe(view('a', message.id));
    await receipt;
    execution.reject(new Error('保存失败'));
    await Promise.resolve();
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: '保存失败' }));
    expect(store.get(message)).toBe(receipt);
  });

  it('大量已完成的输入不会淘汰仍在执行的命令', async () => {
    const store = new SessionInputSubmissions();
    const execution = deferred();
    const execute = vi.fn(() => execution.promise);
    const receipt = store.submit(message, execute, vi.fn());
    store.observe(view('a', message.id));
    await receipt;
    for (let index = 0; index < 140; index++) {
      await store.submit({ ...message, id: `guide:${index}`, kind: 'guidance' }, async () => {}, vi.fn());
    }
    expect(store.submit(message, execute, vi.fn())).toBe(receipt);
    expect(execute).toHaveBeenCalledOnce();
    execution.resolve();
  });

  it('运行时关闭时结束等待，迟到的任务完成不再产生回执', async () => {
    const store = new SessionInputSubmissions();
    const execution = deferred();
    const receipt = store.submit(message, () => execution.promise, vi.fn());
    const rejected = expect(receipt).rejects.toThrow('已关闭');
    store.dispose();
    await rejected;
    execution.resolve();
    await Promise.resolve();
    expect(store.get(message)).toBeUndefined();
  });

  it('继续命令在目标会话恢复运行后释放提交锁，允许继续发送引导', async () => {
    const store = new SessionInputSubmissions();
    const execution = deferred();
    const input: SessionInput = { ...message, kind: 'command', text: '/resume' };
    const accepted = vi.fn();
    const receipt = store.submit(input, () => execution.promise, vi.fn(), true);
    void receipt.then(accepted);
    store.observe({ ...view('b', ''), status: 'running' });
    store.observe({ ...view('a', ''), status: 'stopped' });
    await Promise.resolve();
    expect(accepted).not.toHaveBeenCalled();
    store.observe({ ...view('a', ''), status: 'running' });
    expect(await receipt).toMatchObject({ kind: 'command', sessionId: 'a' });
    await expect(
      store.submit({ ...message, id: 'guide', kind: 'guidance' }, async () => {}, vi.fn()),
    ).resolves.toMatchObject({ id: 'guide' });
    execution.resolve();
  });

  it('Skill 命令按用户消息 ID 确认接收，压缩命令等待执行完成', async () => {
    const store = new SessionInputSubmissions();
    const execution = deferred();
    const skill: SessionInput = { ...message, kind: 'command', text: '/skill check 检查' };
    const receipt = store.submit(skill, () => execution.promise, vi.fn());
    store.observe(view('a', skill.id));
    await expect(receipt).resolves.toMatchObject({ kind: 'command' });
    const compactExecution = deferred();
    const compact = { ...skill, id: 'compact', text: '/compact' };
    const accepted = vi.fn();
    const compactReceipt = store.submit(compact, () => compactExecution.promise, vi.fn());
    void compactReceipt.then(accepted);
    store.observe({ ...view('a', 'another-input'), status: 'running' });
    await Promise.resolve();
    expect(accepted).not.toHaveBeenCalled();
    compactExecution.resolve();
    await compactReceipt;
    execution.resolve();
  });
});
