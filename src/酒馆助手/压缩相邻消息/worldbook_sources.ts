import type { WorldbookSource } from './worldbook_settings';

type SourceEntry = { world: string; uid: number };
export type WorldbookSourcesEvent<T extends SourceEntry = SourceEntry> = {
  globalLore: T[];
  characterLore: T[];
  chatLore: T[];
  personaLore: T[];
};

export function collectWorldbookSources(
  lores: WorldbookSourcesEvent,
  bindings: { primary: string | null; additional: string[]; chat?: string | null },
): Map<string, WorldbookSource[]> {
  const sources = new Map<string, Set<WorldbookSource>>();
  const add = (entry: SourceEntry, source: WorldbookSource) => {
    const key = `${entry.world}.${entry.uid}`;
    const selected = sources.get(key) ?? new Set<WorldbookSource>();
    selected.add(source);
    sources.set(key, selected);
  };
  lores.globalLore.forEach(entry => add(entry, 'global'));
  lores.chatLore.forEach(entry => add(entry, 'chat'));
  lores.personaLore.forEach(entry => add(entry, 'persona'));
  lores.characterLore.forEach(entry => {
    if (!bindings.additional.includes(entry.world) || entry.world === bindings.primary) add(entry, 'character');
    if (bindings.additional.includes(entry.world)) add(entry, 'character_additional');
  });
  Object.values(lores)
    .flat()
    .forEach(entry => {
      if (entry.world === bindings.primary) add(entry, 'character');
      if (bindings.additional.includes(entry.world)) add(entry, 'character_additional');
      if (entry.world === bindings.chat) add(entry, 'chat');
    });
  return new Map([...sources].map(([key, values]) => [key, [...values]]));
}
