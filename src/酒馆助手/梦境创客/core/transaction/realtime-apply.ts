import type { CardStateAdapter } from './adapter';
import type { StateOperation } from './state-diff';

function operationRank(operation: StateOperation): number {
  if (operation.path.startsWith('/character/fields')) return 0;
  if (
    operation.path.startsWith('/character/greetings') ||
    operation.path === '/character/creator' ||
    operation.path === '/character/version' ||
    operation.path === '/character/tags'
  )
    return 1;
  if (operation.path.startsWith('/worldbooks')) return 2;
  if (operation.path.startsWith('/resources')) return 3;
  if (operation.path.startsWith('/bindings')) return 4;
  if (operation.path === '/character/extensions/card_agent') return 5;
  return 5;
}

function worldbookOperationRank(operation: StateOperation): number {
  if (!operation.path.startsWith('/worldbooks/')) return 0;
  const segment = operation.path.split('/')[3];
  if (segment === undefined || segment === 'name') return 0;
  if (segment === 'entries') return 1;
  if (segment === 'entries-order') return 2;
  return 1;
}

function resourceRoot(operation: StateOperation): string | undefined {
  return operation.path
    .match(/^\/resources\/(?:regexes|scripts)\/(?:character|global|preset-current)(?:\/|$)/u)?.[0]
    .replace(/\/$/u, '');
}

export function sortRealtimeStateOperations(operations: StateOperation[]): StateOperation[] {
  return [...operations].sort(
    (left, right) =>
      operationRank(left) - operationRank(right) ||
      worldbookOperationRank(left) - worldbookOperationRank(right) ||
      Number(left.kind === 'reorder') - Number(right.kind === 'reorder') ||
      left.path.localeCompare(right.path),
  );
}

/** 顺序即时写入，不做旧事务式自动回滚；失败前的成功操作会如实返回。 */
export async function applyRealtimeStateOperations(
  adapter: CardStateAdapter,
  input: StateOperation[],
): Promise<{ applied: StateOperation[]; error?: Error }> {
  const operations = sortRealtimeStateOperations(input);
  const applied: StateOperation[] = [];
  try {
    for (let index = 0; index < operations.length; ) {
      const root = resourceRoot(operations[index]);
      if (root && adapter.applyBatch) {
        const batch: StateOperation[] = [];
        while (index < operations.length && resourceRoot(operations[index]) === root) batch.push(operations[index++]);
        const normalized = await adapter.applyBatch(batch);
        batch.forEach((operation, batchIndex) => applied.push(normalized[batchIndex] || operation));
        continue;
      }
      const operation = operations[index++];
      applied.push((await adapter.apply(operation)) || operation);
    }
    return { applied };
  } catch (error) {
    return { applied, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
