import { describe, expect, it } from 'vitest';
import { compilePreset, DEFAULT_PRESET } from '../preset/compiler';
import { defaultPresetValues } from '../session/prompt';
import type { PersistedSessionRuntime } from '../session/types';
import { MemoryTavernFileClient } from './file-client';
import { SessionPersistenceCoordinator } from './session-persistence';
import { SessionRevisionStore } from './session-store';
import { MemoryAgentSettingsStore } from './settings';

async function runtime(): Promise<PersistedSessionRuntime> {
  const compiledPreset = await compilePreset(DEFAULT_PRESET, defaultPresetValues([]));
  return {
    compiledPreset,
    createdAt: 1,
    events: [{ at: 2, status: 'completed', type: 'status' }],
    headerMessageCount: compiledPreset.messages.length,
    mode: 'normal',
    modelMessages: compiledPreset.messages,
    preset: DEFAULT_PRESET,
    sessionId: 'session',
    skills: [],
    status: 'completed',
    title: '会话',
    ui: [],
    updatedAt: 2,
    version: 2,
  };
}

describe('session persistence coordinator', () => {
  it('把运行时与规范上下文放进单个会话文件', async () => {
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(new MemoryTavernFileClient(), settings);
    const persistence = new SessionPersistenceCoordinator({
      avatarId: 'avatar.png',
      bindingId: 'binding',
      characterName: '梦梦',
      store,
    });
    const state = await runtime();
    await persistence.persist(state);
    const loaded = await persistence.load('session');
    expect(loaded.runtime).toEqual(state);
    expect(settings.load().characterStores.binding).toMatchObject({ avatarId: 'avatar.png', bindingId: 'binding' });
  });

  it('持久化不再依赖后端租约文件', async () => {
    const settings = new MemoryAgentSettingsStore();
    const persistence = new SessionPersistenceCoordinator({
      avatarId: 'avatar.png',
      bindingId: 'binding',
      characterName: '梦梦',
      store: new SessionRevisionStore(new MemoryTavernFileClient(), settings),
    });
    await persistence.persist(await runtime());
    expect(Object.keys(settings.load().characterStores)).toEqual(['binding']);
  });
});
