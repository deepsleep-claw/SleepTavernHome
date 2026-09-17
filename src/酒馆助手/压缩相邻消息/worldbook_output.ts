import { WorldbookExtractionPositionOrder } from './worldbook_settings';
import type { WorldbookExtractionPlan } from './worldbook_rules';
import _ from 'lodash';

type WorldbookExtractionPosition = (typeof WorldbookExtractionPositionOrder)[number];

export type SortableWorldbookExtractionItem = {
  position: (typeof WorldbookExtractionPositionOrder)[number];
  depth: number;
  order: number;
  index: number;
  part_index?: number;
  stable_key?: string;
};
type WorldbookSortSettings = {
  entry_processing: { worldbook: { position_order: SortableWorldbookExtractionItem['position'][] } };
};

export function sortWorldbookExtractionItems<T extends SortableWorldbookExtractionItem>(
  entries: T[],
  settings: WorldbookSortSettings,
): T[] {
  const position_order = settings.entry_processing.worldbook.position_order;
  const position_index = (position: WorldbookExtractionPosition) => {
    const index = position_order.indexOf(position);
    return index === -1 ? WorldbookExtractionPositionOrder.indexOf(position) : index;
  };

  return [...entries].sort((lhs, rhs) => {
    const position_difference = position_index(lhs.position) - position_index(rhs.position);
    if (position_difference !== 0) {
      return position_difference;
    }

    if (lhs.position === 'at_depth' && rhs.position === 'at_depth' && lhs.depth !== rhs.depth) {
      return rhs.depth - lhs.depth;
    }

    if (lhs.order !== rhs.order) {
      return lhs.order - rhs.order;
    }

    const stable_key_difference = (lhs.stable_key ?? '').localeCompare(rhs.stable_key ?? '');
    if (stable_key_difference !== 0) {
      return stable_key_difference;
    }

    if (lhs.index !== rhs.index) {
      return lhs.index - rhs.index;
    }

    return (lhs.part_index ?? 0) - (rhs.part_index ?? 0);
  });
}

export function groupWorldbookExtractions<T extends { key: string }>(
  items: T[],
  plan: WorldbookExtractionPlan,
): Map<string, T[]> {
  const groups = new Map<string, T[]>([...plan.compiled.placeholders.keys()].map(placeholder => [placeholder, []]));
  items.forEach(item => {
    const placement = plan.placements.get(item.key)?.find(candidate => candidate.kind === 'placeholder');
    if (placement) groups.get(placement.placeholder)?.push(item);
  });
  return groups;
}

export function replaceWorldbookPlaceholders(content: string, replacements: ReadonlyMap<string, string>): string {
  if (!replacements.size) return content;
  const pattern = new RegExp(
    [...replacements.keys()]
      .sort((a, b) => b.length - a.length)
      .map(_.escapeRegExp)
      .join('|'),
    'g',
  );
  return content.replace(pattern, placeholder => replacements.get(placeholder)!);
}
