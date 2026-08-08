import { klona } from 'klona';
import type { CardWorkspaceState } from '../mapping/types';
import { canonicalEqual } from './canonical';
import { applyStateOperations, diffCardStates, pathsOverlap, readStatePath, type StateOperation } from './state-diff';

export type MergeConflict = {
  agent: unknown;
  base: unknown;
  current: unknown;
  label: string;
  path: string;
};

export type MergePreparation = {
  agentChanges: StateOperation[];
  cleanChanges: StateOperation[];
  conflicts: MergeConflict[];
  redundantPaths: string[];
};

export type ApprovalDecision = 'agent' | 'current';

export function prepareThreeWayMerge(
  base: CardWorkspaceState,
  working: CardWorkspaceState,
  current: CardWorkspaceState,
): MergePreparation {
  const agentChanges = diffCardStates(base, working);
  const externalChanges = diffCardStates(base, current);
  const cleanChanges: StateOperation[] = [];
  const conflicts: MergeConflict[] = [];
  const redundantPaths: string[] = [];
  for (const change of agentChanges) {
    const overlaps = externalChanges.some(external => pathsOverlap(change.path, external.path));
    if (!overlaps) {
      cleanChanges.push(change);
      continue;
    }
    const currentValue = readStatePath(current, change.path);
    const agentValue = readStatePath(working, change.path);
    if (canonicalEqual(currentValue, agentValue)) {
      redundantPaths.push(change.path);
      continue;
    }
    conflicts.push({
      agent: klona(agentValue),
      base: klona(readStatePath(base, change.path)),
      current: klona(currentValue),
      label: change.label,
      path: change.path,
    });
  }
  return { agentChanges, cleanChanges, conflicts, redundantPaths };
}

export function defaultApprovals(preparation: MergePreparation, mode: 'normal' | 'yolo'): Record<string, ApprovalDecision> {
  const decisions: Record<string, ApprovalDecision> = {};
  if (mode === 'yolo') {
    preparation.cleanChanges.filter(change => !change.highRisk).forEach(change => {
      decisions[change.path] = 'agent';
    });
  }
  return decisions;
}

export function resolveMerge(
  current: CardWorkspaceState,
  preparation: MergePreparation,
  decisions: Record<string, ApprovalDecision>,
): { operations: StateOperation[]; state: CardWorkspaceState } {
  const operations = preparation.agentChanges.filter(change => decisions[change.path] === 'agent');
  return { operations, state: applyStateOperations(current, operations) };
}
