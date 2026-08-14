// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DREAM_CARD_AGENT_SETTINGS,
  TavernAgentSettingsStore,
  type CharacterStoreReference,
} from './settings';
import { DEFAULT_BUILTIN_AGENT } from './builtin-agent';

function character(id: string): CharacterStoreReference {
  return {
    bindingId: id,
    characterName: id,
    revision: 1,
    sha256: `hash-${id}`,
    size: 10,
    updatedAt: 1,
    url: `/meta-${id}.json`,
  };
}

describe('tavern settings cross-window cache', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('builtin', { saveSettings: vi.fn(async () => undefined) });
    vi.stubGlobal('SillyTavern', {
      extensionSettings: {},
      saveSettingsDebounced: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('两个页面基于同一旧版本保存时仍保留双方的角色索引', async () => {
    const firstStore = new TavernAgentSettingsStore();
    const secondStore = new TavernAgentSettingsStore();
    const first = firstStore.load();
    const second = secondStore.load();

    first.characterStores.first = character('first');
    await firstStore.save(first);
    second.characterStores.second = character('second');
    await secondStore.save(second);

    expect(Object.keys(firstStore.load().characterStores).sort()).toEqual(['first', 'second']);
    expect(builtin.saveSettings).toHaveBeenCalledTimes(2);
    expect(SillyTavern.saveSettingsDebounced).not.toHaveBeenCalled();
    firstStore.destroy();
    secondStore.destroy();
  });

  it('旧版Agent配置不再迁移，始终使用当前内置配置', () => {
    const legacy = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS) as unknown as Record<string, unknown>;
    legacy.activeAgentConfigurationId = 'agent:old';
    legacy.agentConfigurations = [{ id: 'agent:old', name: '旧配置', presetId: 'preset:default', skillIds: ['writer'] }];
    SillyTavern.extensionSettings['dream-card-agent'] = legacy;
    const store = new TavernAgentSettingsStore();
    const settings = store.load();
    expect(settings.agentConfigurations).toEqual([
      expect.objectContaining({
        id: DEFAULT_BUILTIN_AGENT.id,
        name: DEFAULT_BUILTIN_AGENT.name,
        skills: DEFAULT_BUILTIN_AGENT.skills,
        toolIds: DEFAULT_BUILTIN_AGENT.toolIds,
      }),
    ]);
    expect(settings.activeAgentConfigurationId).toBe(DEFAULT_BUILTIN_AGENT.id);
    store.destroy();
  });
});
