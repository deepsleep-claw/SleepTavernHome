import { klona } from 'klona';
import type { CardWorkspaceState } from '../mapping/types';
import { applyStateOperation, type StateOperation } from './state-diff';

export interface CardStateAdapter {
  apply(operation: StateOperation): Promise<StateOperation | void>;
  applyBatch?(operations: StateOperation[]): Promise<Array<StateOperation | void>>;
  read(): Promise<CardWorkspaceState>;
}

export type MemoryAdapterOptions = {
  failAtApply?: number;
  failRollbackAtApply?: number;
};

export class MemoryCardStateAdapter implements CardStateAdapter {
  private applyCount = 0;
  private rollbackMode = false;
  private state: CardWorkspaceState;
  readonly applied: StateOperation[] = [];

  constructor(initial: CardWorkspaceState, private readonly options: MemoryAdapterOptions = {}) {
    this.state = klona(initial);
  }

  async apply(operation: StateOperation): Promise<void> {
    this.applyCount += 1;
    const failurePoint = this.rollbackMode ? this.options.failRollbackAtApply : this.options.failAtApply;
    if (failurePoint === this.applyCount) {
      throw new Error(`Fault adapter在第${this.applyCount}次写入失败。`);
    }
    applyStateOperation(this.state, operation);
    this.applied.push(klona(operation));
  }

  async read(): Promise<CardWorkspaceState> {
    return klona(this.state);
  }

  beginRollback(): void {
    this.rollbackMode = true;
    this.applyCount = 0;
  }

  replaceExternal(state: CardWorkspaceState): void {
    this.state = klona(state);
  }
}
