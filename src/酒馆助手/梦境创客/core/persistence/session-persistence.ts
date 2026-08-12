import type { PersistedSessionRuntime, SessionLifecycleStatus } from '../session/types';
import { SessionRevisionStore, type SessionRevision } from './session-store';
import type { SessionIndexEntry } from './settings';

function manifestStatus(status: SessionLifecycleStatus): SessionIndexEntry['status'] {
  if (status === 'abnormal') return 'abnormal';
  if (status === 'completed') return 'completed';
  if (status === 'stopped') return 'stopped';
  if (status === 'running' || status === 'waiting-approval') return 'running';
  return 'idle';
}

export type SessionPersistenceOptions = {
  avatarId: string;
  bindingId: string;
  characterName: string;
  store: SessionRevisionStore;
};

export class SessionPersistenceCoordinator {
  constructor(private readonly options: SessionPersistenceOptions) {}

  async persist(runtime: PersistedSessionRuntime): Promise<void> {
    await this.options.store.commit({
      avatarId: this.options.avatarId,
      bindingId: this.options.bindingId,
      characterName: this.options.characterName,
      runtime,
      status: manifestStatus(runtime.status),
    });
  }

  async load(sessionId: string): Promise<SessionRevision & { runtime: PersistedSessionRuntime }> {
    return this.options.store.load(this.options.bindingId, sessionId);
  }
}
