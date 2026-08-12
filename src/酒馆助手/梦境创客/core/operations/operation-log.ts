import { klona } from 'klona';
import type { PersistedOperationLog, TurnOperationSummary, WorkspaceOperationRecord } from './types';

export class WorkspaceOperationLog {
  private readonly records: WorkspaceOperationRecord[];
  private readonly turns: TurnOperationSummary[];

  constructor(restored?: PersistedOperationLog) {
    this.records = klona(restored?.records ?? []);
    this.turns = klona(restored?.turns ?? []);
  }

  append(record: WorkspaceOperationRecord): void {
    if (this.records.some(item => item.operationId === record.operationId)) return;
    this.records.push(klona(record));
    const turn = this.ensureTurn(record.turnId);
    turn.operationIds.push(record.operationId);
    turn.redoOperationIds = [];
  }

  recordsForTurn(turnId: string): WorkspaceOperationRecord[] {
    const turn = this.turns.find(item => item.turnId === turnId);
    if (!turn) return [];
    const ids = new Set(turn.operationIds);
    return this.records.filter(record => ids.has(record.operationId)).map(record => klona(record));
  }

  latestTurn(): TurnOperationSummary | undefined {
    const turn = this.turns.at(-1);
    return turn ? klona(turn) : undefined;
  }

  setRecoveryAvailable(turnId: string, available: boolean): void {
    this.ensureTurn(turnId).recoveryAvailable = available;
  }

  markUndone(turnId: string, operationIds: string[]): void {
    const selected = new Set(operationIds);
    for (const record of this.records) {
      if (record.turnId === turnId && selected.has(record.operationId)) record.state = 'undone';
    }
    this.ensureTurn(turnId).redoOperationIds = [...operationIds];
  }

  markRedone(turnId: string, operationIds: string[]): void {
    const selected = new Set(operationIds);
    for (const record of this.records) {
      if (record.turnId === turnId && selected.has(record.operationId)) record.state = 'applied';
    }
    this.ensureTurn(turnId).redoOperationIds = [];
  }

  abandonRedoBeforeNextTurn(): void {
    const latest = this.turns.at(-1);
    if (latest) latest.redoOperationIds = [];
  }

  export(): PersistedOperationLog {
    return { records: klona(this.records), turns: klona(this.turns), version: 1 };
  }

  private ensureTurn(turnId: string): TurnOperationSummary {
    let turn = this.turns.find(item => item.turnId === turnId);
    if (!turn) {
      turn = { operationIds: [], recoveryAvailable: true, redoOperationIds: [], turnId };
      this.turns.push(turn);
    }
    return turn;
  }
}
