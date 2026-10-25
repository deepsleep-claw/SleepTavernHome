import type { SessionAttachmentInput } from './attachments';
import type { SessionView } from './types';

export type SessionInput = {
  id: string;
  sessionId: string;
  kind: 'message' | 'guidance' | 'compact' | 'command';
  text: string;
  attachments?: SessionAttachmentInput[];
};
export type SessionInputReceipt = Pick<SessionInput, 'id' | 'sessionId' | 'kind'>;
type Submission = {
  receipt: SessionInputReceipt;
  accepted: boolean;
  completed: boolean;
  acceptOnRunning: boolean;
  promise: Promise<SessionInputReceipt>;
  resolve: (receipt: SessionInputReceipt) => void;
  reject: (error: unknown) => void;
};

const RECEIPT_LIMIT = 128;

/** 接收结果独立于生成任务的完成状态，同一输入 ID 只执行一次。 */
export class SessionInputSubmissions {
  private readonly entries = new Map<string, Submission>();

  get(input: SessionInput): Promise<SessionInputReceipt> | undefined {
    return this.entries.get(this.key(input))?.promise;
  }

  submit(
    input: SessionInput,
    execute: () => Promise<unknown>,
    onAcceptedError: (error: unknown) => void,
    acceptOnRunning = false,
  ) {
    const existing = this.get(input);
    if (existing) return existing;
    if ([...this.entries.values()].some(entry => entry.receipt.sessionId === input.sessionId && !entry.accepted)) {
      return Promise.reject(new Error('上一条输入正在提交，请稍候。'));
    }
    let resolve!: Submission['resolve'];
    let reject!: Submission['reject'];
    const promise = new Promise<SessionInputReceipt>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const entry: Submission = {
      receipt: { id: input.id, sessionId: input.sessionId, kind: input.kind },
      accepted: false,
      completed: false,
      acceptOnRunning,
      promise,
      resolve,
      reject,
    };
    const key = this.key(input);
    this.entries.set(key, entry);
    // execute 在当前调用栈固定会话，后续 await 不再读取界面的活动会话。
    let execution: Promise<unknown>;
    try {
      execution = execute();
    } catch (error) {
      execution = Promise.reject(error);
    }
    void execution.then(
      () => {
        if (this.entries.get(key) !== entry) return;
        entry.completed = true;
        this.accept(entry);
        this.prune();
      },
      error => {
        if (this.entries.get(key) !== entry) return;
        entry.completed = true;
        if (entry.accepted) {
          onAcceptedError(error);
          this.prune();
        } else {
          this.entries.delete(key);
          entry.reject(error);
        }
      },
    );
    return promise;
  }

  observe(view: SessionView): void {
    for (const entry of this.entries.values()) {
      const receipt = entry.receipt;
      if (entry.accepted || receipt.sessionId !== view.sessionId || receipt.kind === 'compact') continue;
      if (entry.acceptOnRunning && ['running', 'waiting-approval'].includes(view.status)) {
        this.accept(entry);
        continue;
      }
      const kind = receipt.kind === 'guidance' ? 'guidance' : 'user';
      if (view.ui.some(item => item.kind === kind && item.id === receipt.id && !item.hidden)) this.accept(entry);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (!entry.accepted) entry.reject(new Error('会话运行时已关闭。'));
    }
    this.entries.clear();
  }

  private accept(entry: Submission) {
    if (entry.accepted) return;
    entry.accepted = true;
    entry.resolve(entry.receipt);
  }

  private prune() {
    for (const [key, candidate] of this.entries) {
      if (this.entries.size <= RECEIPT_LIMIT) break;
      if (candidate.accepted && candidate.completed) this.entries.delete(key);
    }
  }

  private key(input: SessionInputReceipt): string {
    return JSON.stringify([input.sessionId, input.id]);
  }
}
