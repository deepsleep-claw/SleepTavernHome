import { createCdnRuntime } from '../../../util/cdn_runtime.mjs';
import { UPDATER_STATE_KEY, type UpdateSource } from './contracts';

export { createCdnRuntime };

export function currentCdnRuntime() {
  return createCdnRuntime((globalThis as typeof globalThis & { __thCdnSource?: UpdateSource }).__thCdnSource);
}

export function normalizeSource(value: unknown): UpdateSource {
  return value === 'jsdmirror' || value === 'jsdelivr' ? value : 'auto';
}

export function readSourcePreference(): UpdateSource {
  const state = getVariables({ type: 'script', script_id: getScriptId() })[UPDATER_STATE_KEY];
  return normalizeSource(state?.source);
}
