import { normalizeModelId } from './model-catalog';

function modelName(modelId: string): string {
  return normalizeModelId(modelId)
    .split(/[/:]/u)
    .at(-1)!
    .replace(/^anthropic\./u, '');
}

export function usesGeminiThinkingLevel(modelId = ''): boolean {
  return /^gemini-(?:3(?:[.-]|$)|4-argon(?:-|$))/u.test(modelName(modelId));
}

export function isGeminiArgon(modelId = ''): boolean {
  return /^gemini-4-argon(?:-|$)/u.test(modelName(modelId));
}

export function requiresReasoning(modelId = ''): boolean {
  const id = modelName(modelId);
  return (
    usesGeminiThinkingLevel(id) ||
    /^gemini-2\.5-pro(?:-|$)/u.test(id) ||
    /^gpt-(?:6-astra|6\.1-sol)(?:-|$)/u.test(id) ||
    /^grok-4\.[567](?:-|$)/u.test(id) ||
    /^(?:kimi-)?k3\.1-pro(?:-|$)/u.test(id) ||
    /^claude-(?:(?:fable|mythos)-5(?:-|$)|(?:opus|sonnet)-5-5(?:-|$))/u.test(id)
  );
}

export function omitsSamplingParameters(modelId = ''): boolean {
  const id = modelName(modelId);
  return isGeminiArgon(id) || /^claude-(?:opus|sonnet|haiku|fable|mythos)-5(?:-|$)/u.test(id);
}

export function usesCompatibleResponsesReasoning(modelId = ''): boolean {
  const id = modelName(modelId);
  return /^(?:kimi-)?k3\.1-pro(?:-|$)/u.test(id) || /^grok-4\.[567](?:-|$)/u.test(id);
}
