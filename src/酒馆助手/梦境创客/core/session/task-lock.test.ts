import { describe, expect, it } from 'vitest';
import { GlobalAgentTaskLock } from './task-lock';

describe('global agent task lock', () => {
  it('全局仅允许一个会话任务，并支持同会话嵌套事务', () => {
    const lock = new GlobalAgentTaskLock();
    lock.acquire('a');
    lock.acquire('a');
    expect(() => lock.acquire('b')).toThrow('其他Agent任务');
    lock.release('a');
    expect(lock.active()).toBe('a');
    lock.release('a');
    expect(lock.active()).toBeUndefined();
    lock.acquire('b');
    lock.release('not-owner');
    expect(lock.active()).toBe('b');
  });
});
