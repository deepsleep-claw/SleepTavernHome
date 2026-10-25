import { findSelectedModel, type ApiProvider } from '../../core/provider/provider-config';
import { reasoningOptions } from '../../core/provider/session-model-options';
import { commandDisabledReason, COMPOSER_COMMANDS, suggestionScore } from '../../core/session/composer-commands';
import {
  composerReferences,
  REFERENCE_CATEGORIES,
  type ReferenceCategory,
} from '../../core/session/composer-references';
import type { SessionView } from '../../core/session/types';
import type { ComposerShortcut } from './composer-shortcuts';

type CatalogState = { active?: SessionView; providers?: ApiProvider[]; busy?: boolean };
export type ComposerSuggestion = {
  id: string;
  value: string;
  label: string;
  description: string;
  icon: string;
  group: string;
  category?: ReferenceCategory;
  disabledReason?: string;
};

export function composerCommandContext(state: CatalogState) {
  const selected = findSelectedModel(state.providers ?? [], state.active?.modelSelection);
  return {
    status: state.active?.status,
    busy: state.busy,
    hasModels: (state.providers ?? []).some(
      provider => provider.enabled && provider.models.some(model => model.enabled),
    ),
    supportsReasoning: reasoningOptions(selected?.provider, selected?.model).length > 0,
    skillCount: state.active?.skills?.length ?? 0,
    compactionEnabled: state.active?.agentConfiguration?.toolIds.includes('compact_context') ?? true,
  };
}

export function composerSuggestions(shortcut: ComposerShortcut, state: CatalogState): ComposerSuggestion[] {
  const context = composerCommandContext(state);
  let items: ComposerSuggestion[];
  if (shortcut.kind === 'command') {
    items = COMPOSER_COMMANDS.map(command => ({
      id: command.id,
      value: `/${command.id}`,
      label: `/${command.id} · ${command.label}`,
      description: `${command.usage} · ${command.description} · ${command.aliases.join('、')}`,
      icon: command.icon,
      group: '指令',
      disabledReason: commandDisabledReason(command, context),
    }));
  } else if (shortcut.kind === 'reference') {
    items = composerReferences(state.active?.workingFiles ?? [], state.active?.skills ?? []).map(reference => {
      const category = REFERENCE_CATEGORIES.find(item => item.id === reference.category)!;
      return {
        id: reference.id,
        value: reference.insertion,
        label: reference.label,
        description: reference.description,
        icon: category.icon,
        group: category.label,
        category: category.id,
      };
    });
  } else if (shortcut.command?.id === 'model') {
    items = (state.providers ?? [])
      .filter(provider => provider.enabled)
      .flatMap(provider =>
        provider.models
          .filter(model => model.enabled)
          .map(model => ({
            id: `${provider.id}/${model.id}`,
            value: `${provider.name}/${model.name}`,
            label: model.name,
            description: `${provider.name} · ${model.modelId}`,
            icon: 'fa-solid fa-microchip',
            group: provider.name,
          })),
      );
  } else if (shortcut.command?.id === 'effort') {
    const selected = findSelectedModel(state.providers ?? [], state.active?.modelSelection);
    items = reasoningOptions(selected?.provider, selected?.model).map(option => ({
      id: option.value,
      value: option.value,
      label: option.label,
      description: option.description,
      icon: 'fa-solid fa-brain',
      group: '推理强度',
    }));
  } else if (shortcut.command?.id === 'skill') {
    items = (state.active?.skills ?? []).map(skill => ({
      id: skill.id,
      value: encodeURIComponent(skill.id),
      label: skill.name,
      description: skill.description,
      icon: 'fa-solid fa-wand-magic-sparkles',
      group: '已挂载 Skills',
    }));
  } else items = [];
  if (shortcut.kind === 'argument' && shortcut.command) {
    const reason = commandDisabledReason(shortcut.command, context);
    if (reason) items = items.map(item => ({ ...item, disabledReason: reason }));
  }
  return rankSuggestions(items, shortcut.query);
}

function rankSuggestions(items: ComposerSuggestion[], query: string): ComposerSuggestion[] {
  return items
    .map(item => {
      const label = suggestionScore(`${item.label} ${item.value}`, query);
      const description = suggestionScore(item.description, query);
      return { item, score: Math.min(label ?? Infinity, description === undefined ? Infinity : description + 300) };
    })
    .filter(match => Number.isFinite(match.score))
    .sort((left, right) => left.score - right.score)
    .map(match => match.item);
}

export function createComposerSuggestionSource() {
  let sessionId: string | undefined;
  let paths: string[] = [];
  let skillMetadata: Array<{ id: string; name: string; description: string; builtin: boolean }> = [];
  let catalog: ComposerSuggestion[] = [];
  let query: string | undefined;
  let matches: ComposerSuggestion[] = [];
  return (shortcut: ComposerShortcut, state: CatalogState): ComposerSuggestion[] => {
    if (shortcut.kind !== 'reference') return composerSuggestions(shortcut, state);
    const files = state.active?.workingFiles ?? [];
    const skills = state.active?.skills ?? [];
    const changed =
      sessionId !== state.active?.sessionId ||
      paths.length !== files.length ||
      files.some((file, index) => paths[index] !== file.path) ||
      skillMetadata.length !== skills.length ||
      skills.some((skill, index) => {
        const previous = skillMetadata[index];
        return (
          previous.id !== skill.id ||
          previous.name !== skill.name ||
          previous.description !== skill.description ||
          previous.builtin !== skill.builtin
        );
      });
    if (changed) {
      sessionId = state.active?.sessionId;
      paths = files.map(file => file.path);
      skillMetadata = skills.map(({ id, name, description, builtin }) => ({ id, name, description, builtin }));
      catalog = composerSuggestions({ ...shortcut, query: '' }, state);
      query = undefined;
    }
    // 流式快照只改变消息正文时，复用同一候选数组，避免反复搜索与重排手机面板。
    if (query !== shortcut.query) {
      query = shortcut.query;
      matches = rankSuggestions(catalog, query);
    }
    return matches;
  };
}
