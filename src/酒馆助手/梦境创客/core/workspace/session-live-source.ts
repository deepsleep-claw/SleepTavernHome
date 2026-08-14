import { klona } from 'klona';
import { DreamCreatorWorkspaceFileStore } from '../persistence/workspace-file-store';
import { materializeUserSkills, projectSkills } from '../skills/skill-registry';
import type { AgentSkill } from '../skills/types';
import { diffRequestedWorkspaceFiles } from './file-diff';
import type { LiveWorkspaceApplyInput, LiveWorkspaceApplyResult, LiveWorkspaceSource } from './live-repository';
import { MemoryWorkspaceRepository } from './memory-repository';
import { WorkspaceError, type WorkspaceChange, type WorkspaceFile } from './types';

type WorkspaceDomain = 'card' | 'chat' | 'skill' | 'storage';

function domain(path: string): WorkspaceDomain {
  if (path.startsWith('/skills/user/')) return 'skill';
  if (
    path.startsWith('/files/') ||
    path.startsWith('/temp/') ||
    path.startsWith('/character/files/') ||
    path.startsWith('/character/temp/')
  )
    return 'storage';
  if (path.startsWith('/character/chats/')) return 'chat';
  return 'card';
}

function changeDomain(change: WorkspaceChange): WorkspaceDomain {
  const target = domain(change.path);
  if (change.kind === 'move' && domain(change.from) !== target) {
    throw new WorkspaceError('INVALID_PATH', `不能跨工作区域移动：${change.from} → ${change.path}`, change.path);
  }
  return target;
}

async function applyIntent(repository: MemoryWorkspaceRepository, change: WorkspaceChange, id: string): Promise<void> {
  if (change.kind === 'create') await repository.stageFiles([change.after], id);
  else if (change.kind === 'modify') await repository.write(change.path, change.after.content, id, { overwrite: true });
  else if (change.kind === 'delete') await repository.remove(change.path, id);
  else await repository.move(change.from, change.path, id);
}

export type SessionWorkspaceLiveSourceOptions = {
  bindingId: string;
  cardSource: LiveWorkspaceSource;
  decorate?: (files: WorkspaceFile[]) => WorkspaceFile[];
  getSkills: () => AgentSkill[];
  getStorageBindingId?: () => string;
  getStorageFiles: () => WorkspaceFile[];
  onSkillsCommit?: (skills: AgentSkill[], previousSkillIds: string[]) => Promise<AgentSkill[]>;
  sessionId: string;
  setSkills: (skills: AgentSkill[]) => void;
  setStorageFiles: (files: WorkspaceFile[]) => void;
  workspaceStore?: DreamCreatorWorkspaceFileStore;
};

/** 会话级实时Source：把统一VFS拆分到角色资源、全局Skill和角色文件存储。 */
export class SessionWorkspaceLiveSource implements LiveWorkspaceSource {
  constructor(private readonly options: SessionWorkspaceLiveSourceOptions) {}

  async load(): Promise<WorkspaceFile[]> {
    const files = [
      ...(await this.options.cardSource.load()),
      ...projectSkills(this.options.getSkills()),
      ...this.options.getStorageFiles(),
    ];
    return klona(this.options.decorate?.(files) ?? files);
  }

  async apply(input: LiveWorkspaceApplyInput): Promise<LiveWorkspaceApplyResult> {
    const before = await this.load();
    const grouped = new Map<WorkspaceDomain, WorkspaceChange[]>();
    for (const change of input.changes) {
      const key = changeDomain(change);
      grouped.set(key, [...(grouped.get(key) ?? []), change]);
    }
    if (grouped.get('chat')?.length) {
      throw new WorkspaceError(
        'READ_ONLY_PATH',
        '聊天文件由专用酒馆聊天桥即时写入，不能进入普通VFS提交。',
        grouped.get('chat')![0].path,
      );
    }
    let status: LiveWorkspaceApplyResult['status'] = 'success';
    let warning: string | undefined;
    try {
      const cardChanges = grouped.get('card') ?? [];
      if (cardChanges.length > 0) {
        const result = await this.options.cardSource.apply({ changes: cardChanges, toolCallId: `${input.toolCallId}:card` });
        status = result.status;
        warning = result.warning;
        if (status !== 'success') {
          const files = await this.load();
          return { changes: diffRequestedWorkspaceFiles(input.changes, before, files), files, status, warning };
        }
      }
      const skillChanges = grouped.get('skill') ?? [];
      if (skillChanges.length > 0) await this.applySkills(skillChanges, input.toolCallId);
      const storageChanges = grouped.get('storage') ?? [];
      if (storageChanges.length > 0) await this.applyStorage(storageChanges, input.toolCallId);
    } catch (error) {
      const files = await this.load();
      const changes = diffRequestedWorkspaceFiles(input.changes, before, files);
      if (changes.length === 0) throw error;
      return {
        changes,
        files,
        status: 'partial_success',
        warning: `部分修改已写入；后续操作失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const files = await this.load();
    return { changes: diffRequestedWorkspaceFiles(input.changes, before, files), files, status, warning };
  }

  private async applySkills(changes: WorkspaceChange[], toolCallId: string): Promise<void> {
    const previous = this.options.getSkills();
    const repository = new MemoryWorkspaceRepository({
      files: projectSkills(previous),
      readonlyRoots: ['/skills/builtin'],
    });
    for (const [index, change] of changes.entries()) {
      await applyIntent(repository, change, `${toolCallId}:skill:${index}`);
    }
    const candidate = materializeUserSkills(repository.snapshot(), previous);
    const committed = this.options.onSkillsCommit
      ? await this.options.onSkillsCommit(candidate, previous.map(skill => skill.id))
      : candidate;
    this.options.setSkills(klona(committed));
  }

  private async applyStorage(changes: WorkspaceChange[], toolCallId: string): Promise<void> {
    if (!this.options.workspaceStore) throw new Error('当前环境没有可用的梦境创客文件存储。');
    const previous = this.options.getStorageFiles();
    const repository = new MemoryWorkspaceRepository({ files: previous });
    for (const [index, change] of changes.entries()) {
      await applyIntent(repository, change, `${toolCallId}:storage:${index}`);
    }
    const decisions = Object.fromEntries(repository.changes().map(change => [change.path, 'agent' as const]));
    const committed = await this.options.workspaceStore.applyWorkspace(
      this.options.getStorageBindingId?.() ?? this.options.bindingId,
      this.options.sessionId,
      previous,
      repository.snapshot(),
      decisions,
    );
    this.options.setStorageFiles(klona(committed));
  }
}
