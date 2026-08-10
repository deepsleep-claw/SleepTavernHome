import type { PersistedSessionRuntime, SessionLifecycleStatus } from '../session/types';
import type { WorkspaceFile } from '../workspace/types';
import { SessionRevisionStore, type SessionRevision } from './session-store';
import type { SessionIndexEntry } from './settings';

function manifestStatus(status: SessionLifecycleStatus): SessionIndexEntry['status'] {
  if (status === 'abnormal') return 'abnormal';
  if (status === 'completed') return 'completed';
  if (status === 'stopped') return 'stopped';
  if (status === 'running' || status === 'waiting-approval' || status === 'committing') return 'running';
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

  async persist(
    runtime: PersistedSessionRuntime,
    workingCopy: WorkspaceFile[],
    snapshotBlobs: Record<string, Uint8Array>,
  ): Promise<void> {
    await this.options.store.commit({
      avatarId: this.options.avatarId,
      bindingId: this.options.bindingId,
      characterName: this.options.characterName,
      runtime,
      snapshotBlobs,
      status: manifestStatus(runtime.status),
      workingCopy,
    });
  }

  async load(sessionId: string): Promise<SessionRevision & { runtime: PersistedSessionRuntime }> {
    return this.options.store.load(this.options.bindingId, sessionId);
  }
}
