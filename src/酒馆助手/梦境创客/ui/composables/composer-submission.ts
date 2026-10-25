import { computed, reactive } from 'vue';
import type { SessionInputReceipt } from '../../core/session/input-submission';

const submissions = new WeakMap<object, Map<string, string>>();

/** 提交锁按运行时和会话保存，组件重挂载仍共享同一份在途状态。 */
export function useComposerSubmission(owner: object, scope: () => string) {
  let pending = submissions.get(owner);
  if (!pending) {
    pending = reactive(new Map<string, string>());
    submissions.set(owner, pending);
  }
  return {
    pending: computed(() => pending.has(scope())),
    async submit(execute: (id: string) => Promise<SessionInputReceipt | undefined>, accept: () => void) {
      const sessionId = scope();
      if (!sessionId || pending.has(sessionId)) return;
      const id = crypto.randomUUID();
      pending.set(sessionId, id);
      try {
        const receipt = await execute(id);
        if (receipt?.id === id && receipt.sessionId === sessionId) accept();
      } finally {
        if (pending.get(sessionId) === id) pending.delete(sessionId);
      }
    },
  };
}
