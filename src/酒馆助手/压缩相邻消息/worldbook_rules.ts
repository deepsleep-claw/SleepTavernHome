import { getPlaceholderAliases, type WorldbookRule, type WorldbookSource } from './worldbook_settings';

export type WorldbookRuleContext = {
  world: string;
  name: string;
  content: string;
  sources: WorldbookSource[];
  trigger: 'constant' | 'selective' | 'vectorized' | 'extension';
  plugin?: string;
  keywords?: string[];
};

export type WorldbookRuleFacts = WorldbookRuleContext & {
  has_dynamic_content: boolean;
  can_cache: boolean;
};

export type CompiledWorldbookRule = {
  rule: WorldbookRule;
  regex?: RegExp;
  placeholder: string;
  aliases: string[];
};
export type CompiledWorldbookRules = {
  rules: CompiledWorldbookRule[];
  placeholders: Map<string, string[]>;
  errors: { rule_id: string; message: string }[];
};
export type WorldbookPlacement = {
  rule_id: string;
  kind: 'cache' | 'placeholder' | 'keep';
  placeholder: string;
};
export type WorldbookRuleUnit = { key: string; facts: WorldbookRuleFacts };
export type WorldbookExtractionPlan = {
  placements: Map<string, WorldbookPlacement[]>;
  compiled: CompiledWorldbookRules;
  available_placeholders: Set<string>;
};

export function parseWorldbookRegex(pattern: string): RegExp | undefined {
  try {
    if (pattern.startsWith('/')) {
      const end = pattern.lastIndexOf('/');
      if (end > 0) return new RegExp(pattern.slice(1, end), pattern.slice(end + 1).replace(/g/g, ''));
    }
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

export function compileWorldbookRules(rules: WorldbookRule[]): CompiledWorldbookRules {
  const result: CompiledWorldbookRules = { rules: [], placeholders: new Map(), errors: [] };
  [...rules].reverse().forEach(rule => {
    const aliases = getPlaceholderAliases(rule.placeholder);
    const placeholder = aliases[0] ?? '';
    if (placeholder) result.placeholders.set(placeholder, aliases);
    if (!rule.enabled) return;
    const pattern = rule.pattern.trim();
    const regex = pattern ? parseWorldbookRegex(pattern) : undefined;
    if (pattern && !regex) {
      result.errors.push({ rule_id: rule.id, message: '正则表达式无效' });
      return;
    }
    result.rules.push({ rule, regex, placeholder, aliases });
  });
  return result;
}

function matchesRule({ rule, regex }: CompiledWorldbookRule, facts: WorldbookRuleFacts): boolean {
  const provider = rule.provider;
  if (provider === 'worldbook') {
    if (facts.trigger === 'extension') return false;
  } else if (facts.plugin !== provider) return false;
  if (facts.trigger !== 'extension') {
    if (!facts.sources.some(source => rule.sources.includes(source))) return false;
    if (rule.trigger !== 'all' && rule.trigger !== facts.trigger) return false;
  }
  if (rule.content === 'static' && facts.has_dynamic_content) return false;
  if (rule.content === 'dynamic' && !facts.has_dynamic_content) return false;
  if (!regex) return true;
  regex.lastIndex = 0;
  const text =
    rule.target === 'worldbook_name' ? facts.world : rule.target === 'entry_name' ? facts.name : facts.content;
  return regex.test(text);
}

export function getWorldbookPlacements(
  facts: WorldbookRuleFacts,
  compiled: CompiledWorldbookRules,
  available_placeholders: ReadonlySet<string>,
): WorldbookPlacement[] {
  const placements: WorldbookPlacement[] = [];
  for (const candidate of compiled.rules) {
    if (!matchesRule(candidate, facts)) continue;
    const base = { rule_id: candidate.rule.id, placeholder: candidate.placeholder };
    if (candidate.rule.action === 'keep') {
      placements.push({ ...base, kind: 'keep' });
      break;
    }
    if (
      candidate.rule.aggressive_green_cache &&
      facts.trigger === 'selective' &&
      facts.can_cache &&
      !facts.plugin &&
      !facts.has_dynamic_content
    ) {
      placements.push({ ...base, kind: 'cache' });
    }
    if (candidate.aliases.some(alias => available_placeholders.has(alias)))
      placements.push({ ...base, kind: 'placeholder' });
  }
  return placements;
}

export function planWorldbookExtraction(
  units: WorldbookRuleUnit[],
  compiled: CompiledWorldbookRules,
  prompt_contents: string[],
): WorldbookExtractionPlan {
  const available_placeholders = new Set(
    [...compiled.placeholders.values()]
      .flat()
      .filter(placeholder => prompt_contents.some(content => content.includes(placeholder))),
  );
  return {
    compiled,
    available_placeholders,
    placements: new Map(
      units.map(unit => [unit.key, getWorldbookPlacements(unit.facts, compiled, available_placeholders)]),
    ),
  };
}

export function hasGreenCacheRules(rules: WorldbookRule[]): boolean {
  return compileWorldbookRules(rules).rules.some(
    ({ rule }) =>
      rule.aggressive_green_cache &&
      rule.trigger !== 'constant' &&
      rule.content !== 'dynamic' &&
      rule.sources.length > 0,
  );
}
