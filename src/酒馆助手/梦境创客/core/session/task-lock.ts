export class GlobalAgentTaskLock {
  private activeSessionId?: string;
  private depth = 0;

  acquire(sessionId: string): void {
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      throw new Error(`已有其他Agent任务正在运行：${this.activeSessionId}`);
    }
    this.activeSessionId = sessionId;
    this.depth += 1;
  }

  release(sessionId: string): void {
    if (this.activeSessionId !== sessionId) return;
    this.depth -= 1;
    if (this.depth <= 0) {
      this.activeSessionId = undefined;
      this.depth = 0;
    }
  }

  active(): string | undefined {
    return this.activeSessionId;
  }
}

export const globalAgentTaskLock = new GlobalAgentTaskLock();
