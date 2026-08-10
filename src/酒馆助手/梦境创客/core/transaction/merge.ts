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

type LineChange = { end: number; replacement: string[]; start: number };

function lineChange(base: string, changed: string): LineChange | undefined {
  const baseLines = base.split('\n');
  const changedLines = changed.split('\n');
  let start = 0;
  while (start < baseLines.length && start < changedLines.length && baseLines[start] === changedLines[start]) start += 1;
  if (start === baseLines.length && start === changedLines.length) return undefined;
  let baseEnd = baseLines.length;
  let changedEnd = changedLines.length;
  while (baseEnd > start && changedEnd > start && baseLines[baseEnd - 1] === changedLines[changedEnd - 1]) {
    baseEnd -= 1;
    changedEnd -= 1;
  }
  return { end: baseEnd, replacement: changedLines.slice(start, changedEnd), start };
}

function mergeIndependentLineChanges(base: string, agent: string, current: string): string | undefined {
  const agentChange = lineChange(base, agent);
  const currentChange = lineChange(base, current);
  if (!agentChange) return current;
  if (!currentChange) return agent;
  const separate = agentChange.end <= currentChange.start || currentChange.end <= agentChange.start;
  const sameInsertionPoint =
    agentChange.start === agentChange.end &&
    currentChange.start === currentChange.end &&
    agentChange.start === currentChange.start;
  if (!separate || sameInsertionPoint) return undefined;
  const lines = base.split('\n');
  const changes = [agentChange, currentChange].sort((left, right) => right.start - left.start);
  for (const change of changes) lines.splice(change.start, change.end - change.start, ...change.replacement);
  return lines.join('\n');
}

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
    const baseValue = readStatePath(base, change.path);
    if (typeof baseValue === 'string' && typeof agentValue === 'string' && typeof currentValue === 'string') {
      const merged = mergeIndependentLineChanges(baseValue, agentValue, currentValue);
      if (merged !== undefined) {
        if (canonicalEqual(merged, currentValue)) redundantPaths.push(change.path);
        else cleanChanges.push({ ...change, after: merged, before: currentValue });
        continue;
      }
    }
    conflicts.push({
      agent: klona(agentValue),
      base: klona(baseValue),
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
  const cleanByPath = new Map(preparation.cleanChanges.map(change => [change.path, change]));
  const operations = preparation.agentChanges
    .filter(change => decisions[change.path] === 'agent')
    .map(change => cleanByPath.get(change.path) ?? change);
  return { operations, state: applyStateOperations(current, operations) };
}
