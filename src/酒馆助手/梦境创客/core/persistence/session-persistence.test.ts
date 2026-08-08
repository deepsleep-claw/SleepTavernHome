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
    history: { checkpoints: [], position: -1 },
    mode: 'normal',
    modelMessages: compiledPreset.messages,
    preset: DEFAULT_PRESET,
    sessionId: 'session',
    skills: [],
    status: 'completed',
    title: '会话',
    ui: [],
    updatedAt: 2,
    version: 1,
  };
}

describe('session persistence coordinator', () => {
  it('把运行时、规范上下文与Working Copy放进同一完整Revision', async () => {
    const settings = new MemoryAgentSettingsStore();
    const store = new SessionRevisionStore(new MemoryTavernFileClient(), settings);
    const persistence = new SessionPersistenceCoordinator({
      avatarId: 'avatar.png',
      bindingId: 'binding',
      characterName: '梦梦',
      store,
    });
    const state = await runtime();
    const files = [
      { content: '正文', mediaType: 'text/markdown' as const, path: '/character/description.md', readonly: false, resourceId: 'r' },
    ];
    await persistence.persist(state, files);
    const loaded = await persistence.load('session');
    expect(loaded.runtime).toEqual(state);
    expect(loaded.workingCopy).toEqual(files);
    expect(settings.load().sessions.session).toMatchObject({ avatarId: 'avatar.png', bindingId: 'binding' });
  });

  it('非租约持有者不能写Revision', async () => {
    const persistence = new SessionPersistenceCoordinator({
      avatarId: 'avatar.png',
      bindingId: 'binding',
      characterName: '梦梦',
      lease: () => ({ isOwner: () => false }) as never,
      store: new SessionRevisionStore(new MemoryTavernFileClient(), new MemoryAgentSettingsStore()),
    });
    await expect(persistence.persist(await runtime(), [])).rejects.toThrow('租约持有者');
  });
});
