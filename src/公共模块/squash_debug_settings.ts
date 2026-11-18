import { z } from 'zod';

export const SQUASH_DEBUG_SETTINGS_KEY = 'dream_whale_squash_debug_settings';
export const DEFAULT_DEBUG_RECORD_LIMIT = 50;
export const MAX_DEBUG_RECORD_LIMIT = 2000;

export const DebugRecordLimitSchema = z.number().int().min(1).max(MAX_DEBUG_RECORD_LIMIT);
const DebugSettingsSchema = z.object({ max_records: DebugRecordLimitSchema.default(DEFAULT_DEBUG_RECORD_LIMIT) });

export function readDebugRecordLimit(): number {
  const settings = getVariables({ type: 'global' })[SQUASH_DEBUG_SETTINGS_KEY] ?? {};
  const parsed = DebugSettingsSchema.safeParse(settings);
  return parsed.success ? parsed.data.max_records : DEFAULT_DEBUG_RECORD_LIMIT;
}

export function saveDebugRecordLimit(value: number): number {
  const max_records = DebugRecordLimitSchema.parse(value);
  const variables = getVariables({ type: 'global' });
  replaceVariables({ ...variables, [SQUASH_DEBUG_SETTINGS_KEY]: { max_records } }, { type: 'global' });
  return max_records;
}
