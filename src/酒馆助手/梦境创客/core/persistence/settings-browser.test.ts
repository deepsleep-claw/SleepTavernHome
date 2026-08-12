// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DREAM_CARD_AGENT_SETTINGS,
  TavernAgentSettingsStore,
  type CharacterStoreReference,
} from './settings';

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

  it('旧设置自动迁移为默认Agent配置，并沿用原预设与已启用Skill', () => {
    const legacy = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS) as unknown as Record<string, unknown>;
    delete legacy.activeAgentConfigurationId;
    delete legacy.agentConfigurations;
    legacy.version = 2;
    legacy.globalSkills = {
      disabled: {
        description: '停用',
        enabled: false,
        id: 'disabled',
        loading: 'full',
        name: '停用',
        revision: 1,
        updatedAt: 1,
        url: '/disabled.md',
      },
      writer: {
        description: '写作',
        enabled: true,
        id: 'writer',
        loading: 'full',
        name: '写作',
        revision: 1,
        updatedAt: 1,
        url: '/writer.md',
      },
    };
    SillyTavern.extensionSettings['dream-card-agent'] = legacy;
    const store = new TavernAgentSettingsStore();
    const settings = store.load();
    expect(settings.agentConfigurations).toEqual([
      expect.objectContaining({ id: 'agent:default', name: '梦境创客默认 Agent', skillIds: [] }),
      expect.objectContaining({ id: 'agent:migrated', name: '迁移的 Agent 配置', skillIds: ['writer'] }),
    ]);
    expect(settings.activeAgentConfigurationId).toBe('agent:migrated');
    store.destroy();
  });
});
