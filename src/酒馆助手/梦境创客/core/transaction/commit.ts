import type { CardWorkspaceState } from '../mapping/types';
import { synchronizeCardAgentMetadata } from '../mapping/card-workspace-mapper';
import type { CardStateAdapter } from './adapter';
import { canonicalEqual } from './canonical';
import { prepareThreeWayMerge, resolveMerge, type ApprovalDecision, type MergePreparation } from './merge';
import { applyStateOperation, readStatePath, type StateOperation } from './state-diff';

export type CommitResult =
  | { preparation: MergePreparation; state: CardWorkspaceState; status: 'committed' }
  | { error: Error; preparation: MergePreparation; rollbackError?: Error; state: CardWorkspaceState; status: 'rolled-back' };

function operationRank(operation: StateOperation): number {
  if (operation.path.startsWith('/character/fields')) return 0;
  if (operation.path.startsWith('/character/greetings') || operation.path === '/character/creator' || operation.path === '/character/version' || operation.path === '/character/tags') return 1;
  if (operation.path.startsWith('/worldbooks')) return 2;
  if (operation.path.startsWith('/resources')) return 3;
  if (operation.path.startsWith('/bindings')) return 4;
  if (operation.path === '/character/extensions/card_agent') return 5;
  return 5;
}

function derivedMetadataOperation(current: CardWorkspaceState, resolved: CardWorkspaceState): StateOperation | undefined {
  const before = current.character.extensions.card_agent;
  synchronizeCardAgentMetadata(resolved);
  const after = resolved.character.extensions.card_agent;
  if (canonicalEqual(before, after)) return undefined;
  return {
    after,
    before,
    highRisk: false,
    kind: before === undefined ? 'create' : 'modify',
    label: '同步梦境创客角色元数据',
    path: '/character/extensions/card_agent',
  };
}

function inverse(operation: StateOperation): StateOperation {
  return { ...operation, after: operation.before, before: operation.after };
}

function resourceRoot(operation: StateOperation): string | undefined {
  const match = operation.path.match(/^\/resources\/(?:regexes|scripts)\/(?:character|global|preset-current)(?:\/|$)/u);
  return match?.[0].replace(/\/$/u, '');
}

async function applyOperations(
  adapter: CardStateAdapter,
  operations: StateOperation[],
  onApplied: (operation: StateOperation) => void,
): Promise<void> {
  for (let index = 0; index < operations.length; ) {
    const root = resourceRoot(operations[index]);
    if (root && adapter.applyBatch) {
      const batch: StateOperation[] = [];
      while (index < operations.length && resourceRoot(operations[index]) === root) batch.push(operations[index++]);
      const normalized = await adapter.applyBatch(batch);
      batch.forEach((operation, batchIndex) => onApplied(normalized[batchIndex] || operation));
      continue;
    }
    const operation = operations[index++];
    onApplied((await adapter.apply(operation)) || operation);
  }
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
  metadataBindingId?: string;
  working: CardWorkspaceState;
}): Promise<CommitResult> {
  const current = await options.adapter.read();
  const preparation = prepareThreeWayMerge(options.base, options.working, current);
  const resolved = resolveMerge(current, preparation, options.decisions);
  if (options.metadataBindingId) resolved.state.character.bindingId = options.metadataBindingId;
  const metadataOperation = derivedMetadataOperation(current, resolved.state);
  if (metadataOperation) resolved.operations.push(metadataOperation);
  const operations = [...resolved.operations].sort(
    (left, right) =>
      operationRank(left) - operationRank(right) ||
      Number(left.kind === 'reorder') - Number(right.kind === 'reorder') ||
      left.path.localeCompare(right.path),
  );
  const applied: StateOperation[] = [];
  try {
    await applyOperations(options.adapter, operations, normalized => {
      const operation = operations.find(candidate => candidate.path === normalized.path && candidate.kind === normalized.kind);
      if (!operation) throw new Error(`无法定位规范化操作：${normalized.path}`);
      if (normalized !== operation) {
        const index = resolved.operations.indexOf(operation);
        if (index >= 0) resolved.operations[index] = normalized;
        applyStateOperation(resolved.state, normalized);
      }
      applied.push(normalized);
    });
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
      await applyOperations(options.adapter, applied.reverse().map(inverse), () => undefined);
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
