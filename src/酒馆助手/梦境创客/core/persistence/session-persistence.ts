import type { PersistedSessionRuntime, SessionLifecycleStatus } from '../session/types';
import type { WorkspaceFile } from '../workspace/types';
import type { LeaseCoordinator } from './lease';
import { SessionRevisionStore, type SessionManifest, type SessionRevision } from './session-store';

function manifestStatus(status: SessionLifecycleStatus): SessionManifest['status'] {
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
  lease?: () => LeaseCoordinator | undefined;
  store: SessionRevisionStore;
};

export class SessionPersistenceCoordinator {
  constructor(private readonly options: SessionPersistenceOptions) {}

  async persist(runtime: PersistedSessionRuntime, workingCopy: WorkspaceFile[]): Promise<void> {
    const lease = this.options.lease?.();
    if (lease && !lease.isOwner()) throw new Error('当前页面不是会话租约持有者，不能写入。');
    const snapshots = runtime.history.checkpoints.flatMap(item => [item.beforeSnapshot, item.afterSnapshot]).filter(Boolean) as string[];
    if (runtime.pending?.candidateSnapshot) snapshots.push(runtime.pending.candidateSnapshot);
    await this.options.store.commit({
      avatarId: this.options.avatarId,
      bindingId: this.options.bindingId,
      characterName: this.options.characterName,
      context: runtime.modelMessages,
      events: runtime.events,
      runtime,
      sessionId: runtime.sessionId,
      snapshotHashes: [...new Set(snapshots)],
      status: manifestStatus(runtime.status),
      title: runtime.title,
      workingCopy,
    });
  }

  async load(sessionId: string): Promise<SessionRevision & { runtime: PersistedSessionRuntime }> {
    const revision = await this.options.store.load(sessionId);
    if (!revision.runtime) throw new Error('会话缺少运行时状态，无法恢复。');
    return { ...revision, runtime: revision.runtime };
  }
}
