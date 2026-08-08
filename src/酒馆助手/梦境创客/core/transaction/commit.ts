import type { CardWorkspaceState } from '../mapping/types';
import type { CardStateAdapter } from './adapter';
import { canonicalEqual } from './canonical';
import { prepareThreeWayMerge, resolveMerge, type ApprovalDecision, type MergePreparation } from './merge';
import { applyStateOperation, readStatePath, type StateOperation } from './state-diff';

export type CommitResult =
  | { preparation: MergePreparation; state: CardWorkspaceState; status: 'committed' }
  | { error: Error; preparation: MergePreparation; rollbackError?: Error; state: CardWorkspaceState; status: 'rolled-back' };

function operationRank(operation: StateOperation): number {
  if (operation.path.startsWith('/character/fields') || operation.path.startsWith('/character/extensions')) return 0;
  if (operation.path.startsWith('/character/greetings') || operation.path === '/character/creator' || operation.path === '/character/version' || operation.path === '/character/tags') return 1;
  if (operation.path.startsWith('/worldbooks')) return 2;
  if (operation.path.startsWith('/bindings')) return 3;
  return 4;
}

function inverse(operation: StateOperation): StateOperation {
  return { ...operation, after: operation.before, before: operation.after };
}

function verifyOperations(expected: CardWorkspaceState, actual: CardWorkspaceState, operations: StateOperation[]): void {
  for (const operation of operations) {
    if (!canonicalEqual(readStatePath(expected, operation.path), readStatePath(actual, operation.path))) {
      throw new Error(`写入后校验失败：${operation.path}`);
    }
  }
}

export async function commitWorkingCopy(options: {
  adapter: CardStateAdapter;
  base: CardWorkspaceState;
  decisions: Record<string, ApprovalDecision>;
  working: CardWorkspaceState;
}): Promise<CommitResult> {
  const current = await options.adapter.read();
  const preparation = prepareThreeWayMerge(options.base, options.working, current);
  const resolved = resolveMerge(current, preparation, options.decisions);
  const operations = [...resolved.operations].sort(
    (left, right) =>
      operationRank(left) - operationRank(right) ||
      Number(left.kind === 'reorder') - Number(right.kind === 'reorder') ||
      left.path.localeCompare(right.path),
  );
  const applied: StateOperation[] = [];
  try {
    for (const operation of operations) {
      const normalized = (await options.adapter.apply(operation)) || operation;
      if (normalized !== operation) {
        const index = resolved.operations.indexOf(operation);
        if (index >= 0) resolved.operations[index] = normalized;
        applyStateOperation(resolved.state, normalized);
      }
      applied.push(normalized);
    }
    const actual = await options.adapter.read();
    verifyOperations(resolved.state, actual, operations);
    return { preparation, state: actual, status: 'committed' };
  } catch (error) {
    const commitError = error instanceof Error ? error : new Error(String(error));
    let rollbackError: Error | undefined;
    try {
      if ('beginRollback' in options.adapter && typeof options.adapter.beginRollback === 'function') {
        options.adapter.beginRollback();
      }
      for (const operation of applied.reverse()) {
        await options.adapter.apply(inverse(operation));
      }
      const rolledBack = await options.adapter.read();
      verifyOperations(current, rolledBack, applied);
    } catch (rollback) {
      rollbackError = rollback instanceof Error ? rollback : new Error(String(rollback));
    }
    return {
      error: commitError,
      preparation,
      rollbackError,
      state: await options.adapter.read(),
      status: 'rolled-back',
    };
  }
}
