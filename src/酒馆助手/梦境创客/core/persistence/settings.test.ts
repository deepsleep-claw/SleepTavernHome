import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET } from '../preset/compiler';
import { createApiProfile } from '../provider/profiles';
import { DEFAULT_BUILTIN_AGENT } from './builtin-agent';
import {
  DEFAULT_DREAM_CARD_AGENT_SETTINGS,
  mergeSettingsChanges,
  normalizeSettings,
  type CharacterStoreReference,
} from './settings';

function character(bindingId: string, revision: number): CharacterStoreReference {
  return {
    bindingId,
    characterName: bindingId,
    revision,
    sha256: `hash-${bindingId}`,
    size: 10,
    updatedAt: revision,
    url: `/meta-${bindingId}.json`,
  };
}

describe('settings cross-window merge', () => {
  it('合并两个页面分别创建的角色元信息引用', () => {
    const base = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS);
    const fromFirstWindow = structuredClone(base);
    fromFirstWindow.characterStores.first = character('first', 1);
    const latestFromSecondWindow = structuredClone(base);
    latestFromSecondWindow.characterStores.second = character('second', 1);
    latestFromSecondWindow.syncRevision = 3;

    const merged = mergeSettingsChanges(base, fromFirstWindow, latestFromSecondWindow);
    expect(Object.keys(merged.characterStores).sort()).toEqual(['first', 'second']);
    expect(merged.syncRevision).toBe(4);
  });

  it('只重放本页真正改变的字段，并保留另一页刚保存的设置', () => {
    const base = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS);
    const incoming = structuredClone(base);
    incoming.floatingButtonAnchor = 'top-left';
    const latest = structuredClone(base);
    latest.developerMode = true;
    latest.sendWithCtrlEnter = true;
    latest.characterStores.other = character('other', 2);

    const merged = mergeSettingsChanges(base, incoming, latest);
    expect(merged).toMatchObject({ developerMode: true, floatingButtonAnchor: 'top-left', sendWithCtrlEnter: true });
    expect(merged.characterStores.other).toBeDefined();
  });

  it('保留显式删除语义', () => {
    const base = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS);
    base.characterStores.old = character('old', 1);
    const incoming = structuredClone(base);
    delete incoming.characterStores.old;
    const latest = structuredClone(base);
    latest.characterStores.new = character('new', 1);

    const merged = mergeSettingsChanges(base, incoming, latest);
    expect(merged.characterStores.old).toBeUndefined();
    expect(merged.characterStores.new).toBeDefined();
  });

  it('按Skill记录合并两个窗口的全局Skill索引', () => {
    const base = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS);
    const first = structuredClone(base);
    first.globalSkills.writer = {
      description: '写作', id: 'writer', loading: 'full', name: '写作', revision: 1, updatedAt: 1, url: '/writer.md',
    };
    const latest = structuredClone(base);
    latest.globalSkills.reviewer = {
      description: '审阅', id: 'reviewer', loading: 'on-demand', name: '审阅', revision: 1, updatedAt: 2, url: '/reviewer.md',
    };

    expect(Object.keys(mergeSettingsChanges(base, first, latest).globalSkills).sort()).toEqual(['reviewer', 'writer']);
  });

  it('始终用当前脚本内置预设替换设置中的旧副本', () => {
    const raw = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS);
    raw.presetProfiles = [
      { ...structuredClone(DEFAULT_PRESET), name: '旧内置副本', nodes: [{ ...DEFAULT_PRESET.nodes[0], content: '旧内容' }] },
      { ...structuredClone(DEFAULT_PRESET), id: 'preset:user', name: '用户预设' },
    ];
    const normalized = normalizeSettings(raw);
    expect(normalized.presetProfiles[0]).toEqual(DEFAULT_PRESET);
    expect(normalized.presetProfiles[1].id).toBe('preset:user');
  });

  it('始终用当前脚本内置Agent替换设置中的旧默认副本', () => {
    const raw = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS);
    raw.agentConfigurations = [
      { id: DEFAULT_BUILTIN_AGENT.id, name: '旧默认名称', presetId: DEFAULT_PRESET.id, skillIds: [] },
      { id: 'agent:user', name: '用户 Agent', presetId: DEFAULT_PRESET.id, skillIds: [] },
    ];
    const normalized = normalizeSettings(raw);
    expect(normalized.agentConfigurations[0]).toEqual({
      id: DEFAULT_BUILTIN_AGENT.id,
      name: DEFAULT_BUILTIN_AGENT.name,
      presetId: DEFAULT_BUILTIN_AGENT.presetId,
      skillIds: DEFAULT_BUILTIN_AGENT.skillIds,
    });
    expect(normalized.agentConfigurations[1].id).toBe('agent:user');
  });

  it('把用户改过的旧默认Agent另存保留，同时恢复只读内置Agent', () => {
    const raw = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS);
    raw.agentConfigurations = [
      { id: DEFAULT_BUILTIN_AGENT.id, name: '我的默认Agent', presetId: DEFAULT_PRESET.id, skillIds: ['writer'] },
    ];
    raw.activeAgentConfigurationId = DEFAULT_BUILTIN_AGENT.id;
    const normalized = normalizeSettings(raw);
    expect(normalized.agentConfigurations.map(configuration => configuration.id)).toEqual([
      DEFAULT_BUILTIN_AGENT.id,
      'agent:preserved-default',
    ]);
    expect(normalized.activeAgentConfigurationId).toBe('agent:preserved-default');
    expect(normalized.agentConfigurations[1]).toMatchObject({ name: '我的默认Agent（已保留）', skillIds: ['writer'] });
  });

  it('把旧API Profile一次性迁移成一个Provider和一个模型并保留默认选择', async () => {
    const profile = await createApiProfile({
      apiKey: 'key', baseURL: 'https://example.invalid/v1', compatibilityMode: 'deepseek',
      interfaceType: 'openai-responses', model: 'deepseek-v4', name: '旧配置',
    });
    const raw = structuredClone(DEFAULT_DREAM_CARD_AGENT_SETTINGS);
    raw.version = 3 as 4;
    raw.profiles = [profile];
    raw.activeProfileId = profile.id;
    raw.providers = [];
    const normalized = normalizeSettings(raw);
    expect(normalized.profiles).toEqual([]);
    expect(normalized.providers).toHaveLength(1);
    expect(normalized.providers[0]).toMatchObject({
      baseURL: profile.baseURL, id: `provider:${profile.id}`, models: [{ id: profile.id, modelId: profile.model }],
    });
    expect(normalized.defaultModelSelection).toEqual({ providerId: `provider:${profile.id}`, modelId: profile.id });
  });
});
