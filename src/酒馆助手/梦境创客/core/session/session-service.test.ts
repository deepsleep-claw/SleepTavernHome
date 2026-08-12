import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { MemoryBinaryBlobStore } from '../history/blob-store';
import { ContentAddressedSnapshotStore } from '../history/snapshot-store';
import { MemoryTavernFileClient } from '../persistence/file-client';
import { MemoryAgentSettingsStore } from '../persistence/settings';
import { DreamCreatorWorkspaceFileStore } from '../persistence/workspace-file-store';
import type { StructuredPreset } from '../preset/compiler';
import type { AgentSkill } from '../skills/types';
import { FakeTavernChatBridge } from '../tavern/chat-bridge';
import type { PersistedSessionRuntime } from './types';
import { MemoryCardStateAdapter } from '../transaction/adapter';
import type { ApprovalDecision } from '../transaction/merge';
import { transactionState } from '../transaction/test-fixture';
import type { WorkspaceFile } from '../workspace/types';
import type { ModelStepExecutor, ModelStepRequest, ModelStepResult, RunnerToolCall } from '../runner/step-executor';
import { CardAgentSessionService } from './session-service';
import { ExternalSessionAttachmentStore } from './attachment-store';
import { GlobalAgentTaskLock } from './task-lock';

function step(toolCalls: RunnerToolCall[] = [], text = '完成啦'): ModelStepResult {
  const assistantMessages: ModelMessage[] = [
    toolCalls.length
      ? {
          content: toolCalls.map(call => ({
            input: call.input,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            type: 'tool-call' as const,
          })),
          role: 'assistant',
        }
      : { content: text, role: 'assistant' },
  ];
  return { assistantMessages, finishReason: toolCalls.length ? 'tool-calls' : 'stop', text, toolCalls };
}

class QueueExecutor implements ModelStepExecutor {
  readonly requests: ModelStepRequest[] = [];
  constructor(
    private readonly queue: Array<ModelStepResult | ((request: ModelStepRequest) => Promise<ModelStepResult>)>,
  ) {}
  async execute(request: ModelStepRequest): Promise<ModelStepResult> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error('missing step');
    return typeof next === 'function' ? next(request) : next;
  }
}

function writeDescription(content: string, id = 'write-description'): RunnerToolCall {
  return { input: { content, path: '/character/description.md' }, toolCallId: id, toolName: 'write_file' };
}

function snapshots(): ContentAddressedSnapshotStore {
  return new ContentAddressedSnapshotStore(new MemoryBinaryBlobStore());
}

describe('card agent session service', () => {
  it('普通发送固定Skill头部，压缩时使用当前配置重新编译', async () => {
    const oldSkill: AgentSkill = {
      body: 'OLD_SKILL_BODY',
      builtin: false,
      description: '测试',
      directories: [],
      id: 'dynamic-skill',
      loading: 'full',
      name: '动态Skill',
      resources: {},
    };
    const nextSkill = { ...oldSkill, body: 'NEW_SKILL_BODY' };
    const preset: StructuredPreset = {
      id: 'preset:dynamic-skill',
      name: '动态Skill预设',
      nodes: [
        { content: '{{skill_instructions}}', enabled: true, id: 'skills', order: 10, role: 'system', title: 'Skill' },
      ],
      version: 1,
    };
    const compactCall = {
      input: { summary: '保留目标' },
      toolCallId: 'compact-current-header',
      toolName: 'compact_context',
    };
    const executor = new QueueExecutor([
      step([], 'x'.repeat(150_000)),
      step([compactCall]),
      step([], '压缩后完成'),
    ]);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      agentConfiguration: { id: 'agent:test', name: '测试', presetId: preset.id, skillIds: [oldSkill.id] },
      contextWindow: 50_000,
      executor,
      lock: new GlobalAgentTaskLock(),
      preset,
      skills: [oldSkill],
      snapshots: snapshots(),
    });

    const first = await service.send('第一轮');
    if (first.approval) {
      const paths = [
        ...first.approval.stateChanges.map(change => change.path),
        ...first.approval.skillChanges.map(change => change.path),
        ...first.approval.fileChanges.map(change => change.path),
      ];
      await service.approve(Object.fromEntries(paths.map(path => [path, 'current' as const])));
    }
    await service.setSkills([nextSkill]);
    await service.send('第二轮');

    expect(executor.requests[1].forceTool).toBe('compact_context');
    expect(String(executor.requests[1].messages[0].content)).toContain('OLD_SKILL_BODY');
    expect(String(executor.requests[2].messages[0].content)).toContain('NEW_SKILL_BODY');
    expect(String(executor.requests[2].messages[0].content)).not.toContain('OLD_SKILL_BODY');
  });

  it('把附件保存为规范化用户消息，并仅向界面暴露摘要', async () => {
    const executor = new QueueExecutor([step([], '看到了')]);
    const persisted = vi.fn(async (_runtime: PersistedSessionRuntime) => undefined);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor,
      lock: new GlobalAgentTaskLock(),
      onPersist: persisted,
      snapshots: snapshots(),
    });
    const completed = await service.send('', 'attachment-user', [
      { data: 'AQID', filename: 'reference.png', mediaType: 'image/png', size: 3 },
    ]);
    const userMessage = executor.requests[0].messages.at(-1);
    expect(userMessage).toMatchObject({
      content: [
        {
          data: { data: 'AQID', type: 'data' },
          filename: 'reference.png',
          mediaType: 'image/png',
          type: 'file',
        },
      ],
      role: 'user',
    });
    expect(completed.ui.find(item => item.id === 'attachment-user')?.attachments).toEqual([
      expect.objectContaining({ filename: 'reference.png', mediaType: 'image/png', size: 3 }),
    ]);
    expect(completed.ui.find(item => item.id === 'attachment-user')?.attachments?.[0]).not.toHaveProperty('data');
    expect(persisted.mock.calls.at(-1)?.[0].attachments).toEqual(
      expect.objectContaining({
        [completed.ui.find(item => item.id === 'attachment-user')!.attachments![0].id]: expect.objectContaining({
          data: 'AQID',
        }),
      }),
    );
  });

  it('附件消息回退后重新发送时仍保留文件内容', async () => {
    const executor = new QueueExecutor([step([], '第一版'), step([], '第二版')]);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor,
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      snapshots: snapshots(),
    });
    await service.send('检查参考', 'attachment-resend', [
      { data: 'AQID', filename: 'reference.png', mediaType: 'image/png', size: 3 },
    ]);
    await service.undoToUserMessage('attachment-resend');
    await service.resend('attachment-resend');
    expect(executor.requests[1].messages.at(-1)).toMatchObject({
      content: expect.arrayContaining([
        expect.objectContaining({ filename: 'reference.png', mediaType: 'image/png', type: 'file' }),
      ]),
      role: 'user',
    });
  });

  it('外部附件显示为玩家文件操作，并跟随消息检查点回退与重做', async () => {
    const settings = new MemoryAgentSettingsStore();
    const fileStore = new DreamCreatorWorkspaceFileStore(new MemoryTavernFileClient(), settings, () => 100);
    const executor = new QueueExecutor([step([], '第一版')]);
    const persisted = vi.fn(async (_runtime: PersistedSessionRuntime) => undefined);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      attachmentStore: new ExternalSessionAttachmentStore('binding-1', fileStore, settings),
      executor,
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      onPersist: persisted,
      sessionId: 'session-with-file',
      snapshots: snapshots(),
      workspaceFiles: [],
      workspaceStore: fileStore,
    });
    const completed = await service.send('检查参考', 'external-attachment', [
      { data: 'AQID', filename: 'reference.png', mediaType: 'image/png', size: 3 },
    ]);
    expect(completed.ui).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'manual', toolName: '玩家添加文件' }),
      ]),
    );
    expect(executor.requests[0].messages.at(-1)).toMatchObject({
      content: expect.arrayContaining([
        expect.objectContaining({ data: { data: 'AQID', type: 'data' }, filename: 'reference.png' }),
      ]),
    });
    expect(persisted.mock.calls.at(-1)?.[0].attachments).toEqual(
      expect.objectContaining({
        [completed.ui.find(item => item.kind === 'user')!.attachments![0].id]: expect.not.objectContaining({ data: expect.anything() }),
      }),
    );
    const [reference] = fileStore.listReferences('binding-1');
    expect(reference).toMatchObject({ logicalPath: 'reference.png', scope: 'persistent' });

    await service.undoToUserMessage('external-attachment');
    expect(fileStore.getReference(reference.fileId)?.orphanedAt).toBe(100);
    await service.redo();
    expect(fileStore.getReference(reference.fileId)?.orphanedAt).toBeUndefined();
  });

  it('保存会话级推理档位，并在一轮完成后保持联网开关', async () => {
    const executor = new QueueExecutor([step([], '完成')]);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor,
      lock: new GlobalAgentTaskLock(),
      snapshots: snapshots(),
    });
    await service.setModelControls({ reasoningEffort: 'high', webSearch: true });
    expect(service.view().modelControls).toEqual({ reasoningEffort: 'high', webSearch: true });
    const completed = await service.send('检查设定');
    expect(executor.requests[0].modelSettings).toMatchObject({ reasoningEffort: 'high', webSearch: true });
    expect(completed.modelControls).toEqual({ reasoningEffort: 'high', webSearch: true });
  });

  it('完成读取到Diff审批再最小写回的普通模式闭环', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const persist = vi.fn(async () => undefined);
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([step([writeDescription('新的描述')]), step()]),
      lock: new GlobalAgentTaskLock(),
      onPersist: persist,
      snapshots: snapshots(),
    });
    const waiting = await service.send('请修改描述', 'user-1');
    expect(waiting.status).toBe('awaiting-approval');
    expect(waiting.approval?.stateChanges).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/character/fields/description' })]),
    );
    expect((await adapter.read()).character.fields.description).toBe('base description');
    const decisions: Record<string, ApprovalDecision> = Object.fromEntries(
      waiting.approval!.stateChanges.map(change => [change.path, 'current' as const]),
    );
    decisions['/character/fields/description'] = 'agent';
    const committed = await service.approve(decisions);
    expect(committed.status).toBe('completed');
    expect((await adapter.read()).character.fields.description).toBe('新的描述');
    expect(adapter.applied.map(item => item.path)).toEqual(['/character/fields/description']);
    expect(persist).toHaveBeenCalled();
  });

  it('YOLO自动提交低风险修改，但重要绑定仍等待人工批准', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const lowRisk = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([step([writeDescription('YOLO描述')]), step()]),
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      snapshots: snapshots(),
    });
    expect((await lowRisk.send('改描述')).status).toBe('completed');
    expect((await adapter.read()).character.fields.description).toBe('YOLO描述');

    const highRiskAdapter = new MemoryCardStateAdapter(transactionState());
    const highRisk = await CardAgentSessionService.create({
      adapter: highRiskAdapter,
      executor: new QueueExecutor([
        step([
          {
            input: { content: 'additional: []\nchat: null\nprimary: null\n', path: '/worldbooks/bindings.yaml' },
            toolCallId: 'binding',
            toolName: 'write_file',
          },
        ]),
        step(),
      ]),
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      snapshots: snapshots(),
    });
    const waiting = await highRisk.send('解除主世界书绑定');
    expect(waiting.status).toBe('awaiting-approval');
    expect(waiting.approval?.stateChanges).toEqual(
      expect.arrayContaining([expect.objectContaining({ highRisk: true, path: '/bindings/primary' })]),
    );
  });

  it('审批期间发生外部冲突时要求重新检查，并仅覆盖Agent改动路径', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([step([writeDescription('Agent版本')]), step()]),
      lock: new GlobalAgentTaskLock(),
      snapshots: snapshots(),
    });
    const waiting = await service.send('修改描述');
    const external = await adapter.read();
    external.character.fields.description = '用户手改版本';
    external.character.fields.personality = '用户新性格';
    adapter.replaceExternal(external);
    const decisions = { '/character/fields/description': 'agent' as const };
    const recheck = await service.approve(decisions);
    expect(recheck.status).toBe('awaiting-approval');
    expect(recheck.approval?.conflicts[0]).toMatchObject({
      agent: 'Agent版本',
      base: 'base description',
      current: '用户手改版本',
    });
    expect((await service.approve(decisions)).status).toBe('completed');
    const final = await adapter.read();
    expect(final.character.fields.description).toBe('Agent版本');
    expect(final.character.fields.personality).toBe('用户新性格');
    expect(waiting.approval).toBeDefined();
  });

  it('支持回退、重做、保留用户消息并原地编辑后分支重发', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const executor = new QueueExecutor([
      step([writeDescription('第一版', 'write-1')]),
      step([], '第一轮完成'),
      step([writeDescription('第二版', 'write-2')]),
      step([], '第二轮完成'),
    ]);
    const service = await CardAgentSessionService.create({
      adapter,
      executor,
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      snapshots: snapshots(),
    });
    await service.send('做第一版', 'editable-user');
    const undone = await service.undo();
    expect((await adapter.read()).character.fields.description).toBe('base description');
    expect(undone.ui.filter(item => item.kind === 'user').map(item => item.content)).toContain('做第一版');
    expect(undone.ui.some(item => item.kind === 'assistant')).toBe(false);
    const redone = await service.redo();
    expect((await adapter.read()).character.fields.description).toBe('第一版');
    expect(redone.ui.some(item => item.kind === 'assistant')).toBe(true);
    await service.undo();
    service.editUserMessage('editable-user', '改做第二版');
    await service.resend('editable-user');
    expect((await adapter.read()).character.fields.description).toBe('第二版');
    expect(service.view().ui.filter(item => item.id === 'editable-user')).toHaveLength(1);
  });

  it('已有Skill即使在YOLO中也要求工具确认和最终确认，新Skill可自动采用', async () => {
    const skill = {
      assets: {},
      body: '# 原流程',
      builtin: false,
      description: '原技能',
      id: 'writer',
      loading: 'on-demand' as const,
      name: '写作',
      references: {},
    };
    const requestToolApproval = vi.fn(async () => true);
    const existing = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor: new QueueExecutor([
        step([
          {
            input: {
              content: '---\ndescription: 已修改\nloading: on-demand\nname: 写作\n---\n# 新流程\n',
              path: '/skills/user/writer/SKILL.md',
            },
            toolCallId: 'skill-edit',
            toolName: 'write_file',
          },
        ]),
        step(),
      ]),
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      requestToolApproval,
      skills: [skill],
      snapshots: snapshots(),
    });
    const waiting = await existing.send('调整Skill');
    expect(requestToolApproval).toHaveBeenCalledOnce();
    expect(waiting.status).toBe('awaiting-approval');
    expect(waiting.approval?.skillChanges[0]).toMatchObject({ highRisk: true, kind: 'modify' });

    const created = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor: new QueueExecutor([
        step([
          {
            input: {
              content: '---\ndescription: 新技能\nloading: on-demand\nname: 灵感\n---\n# 流程\n',
              path: '/skills/user/idea/SKILL.md',
            },
            toolCallId: 'skill-new',
            toolName: 'write_file',
          },
        ]),
        step(),
      ]),
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      snapshots: snapshots(),
    });
    expect((await created.send('创建Skill')).status).toBe('completed');
    expect(created.view().workingFiles.some(file => file.path === '/skills/user/idea/SKILL.md')).toBe(true);
  });

  it('Runner运行期间只更新前端状态，轮次结束后才持久化一次', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const persist = vi.fn(async (_runtime: PersistedSessionRuntime, _files: WorkspaceFile[]) => undefined);
    let finish!: (result: ModelStepResult) => void;
    const executor = new QueueExecutor([
      step([writeDescription('批量保存后的描述', 'batched-write')]),
      () =>
        new Promise<ModelStepResult>(resolve => {
          finish = resolve;
        }),
    ]);
    const service = await CardAgentSessionService.create({
      adapter,
      executor,
      lock: new GlobalAgentTaskLock(),
      onPersist: persist,
      snapshots: snapshots(),
    });
    const running = service.send('测试整轮批量保存');
    await vi.waitFor(() => expect(executor.requests).toHaveLength(2));
    expect(service.view().events.some(event => event.type === 'tool-completed')).toBe(true);
    expect(persist).not.toHaveBeenCalled();

    finish(step([], '完成'));
    expect((await running).status).toBe('awaiting-approval');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('调用酒馆生成前提交Working Copy，并在同一Agent运行中继续测试聊天', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const chatBridge = new FakeTavernChatBridge();
    const requestToolApproval = vi.fn(async () => true);
    const executor = new QueueExecutor([
      step([writeDescription('生成前已经提交', 'before-chat-write')]),
      step([
        {
          input: {
            content: ['---', 'role: user', '---', '请测试角色回复'].join('\n'),
            path: '/context/chats/c01/messages/0000-0099/000001.md',
          },
          toolCallId: 'append-chat-message',
          toolName: 'write_file',
        },
      ]),
      step([
        {
          input: { chatId: 'c01' },
          toolCallId: 'generate-chat-reply',
          toolName: 'generate_tavern_reply',
        },
      ]),
      step([], '测试完成'),
    ]);
    const service = await CardAgentSessionService.create({
      adapter,
      executor,
      lock: new GlobalAgentTaskLock(),
      requestToolApproval,
      snapshots: snapshots(),
      tavernChatBridge: chatBridge,
    });

    const running = service.send('修改角色并测试');
    await vi.waitFor(() => expect(service.view().status).toBe('awaiting-approval'));
    expect((await adapter.read()).character.fields.description).toBe('base description');
    expect(service.view().approval?.stateChanges).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/character/fields/description' })]),
    );
    await service.approve({ '/character/fields/description': 'agent' });

    const completed = await running;
    expect(completed.approval).toBeUndefined();
    expect(completed.status).toBe('completed');
    expect((await adapter.read()).character.fields.description).toBe('生成前已经提交');
    expect(chatBridge.calls).toContain('generate-reply');
    expect(requestToolApproval).toHaveBeenCalledOnce();
  });

  it('拒绝生成前全部改动时不执行酒馆生成，并把结果留给Agent继续决策', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const chatBridge = new FakeTavernChatBridge();
    const executor = new QueueExecutor([
      step([writeDescription('不应写入', 'rejected-before-chat')]),
      step([
        {
          input: {
            content: ['---', 'role: user', '---', '用于触发测试'].join('\n'),
            path: '/context/chats/c01/messages/0000-0099/000001.md',
          },
          toolCallId: 'append-before-rejected-generate',
          toolName: 'write_file',
        },
      ]),
      step([
        {
          input: { chatId: 'c01' },
          toolCallId: 'rejected-generate',
          toolName: 'generate_tavern_reply',
        },
      ]),
      step([], '已根据拒绝结果停止测试'),
    ]);
    const service = await CardAgentSessionService.create({
      adapter,
      executor,
      lock: new GlobalAgentTaskLock(),
      requestToolApproval: async () => true,
      snapshots: snapshots(),
      tavernChatBridge: chatBridge,
    });

    const running = service.send('修改后测试');
    await vi.waitFor(() => expect(service.view().status).toBe('awaiting-approval'));
    await service.approve({ '/character/fields/description': 'current' });

    expect((await running).status).toBe('completed');
    expect((await adapter.read()).character.fields.description).toBe('base description');
    expect(chatBridge.calls).not.toContain('generate-reply');
    expect(service.view().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ error: expect.stringContaining('CHECKPOINT_REJECTED'), type: 'tool-failed' }),
      ]),
    );
  });

  it('生成前检查点等待中可以停止，不会永久卡住Runner', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const chatBridge = new FakeTavernChatBridge();
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([
        step([writeDescription('停止前候选', 'stop-before-chat')]),
        step([
          {
            input: { chatId: 'c01', message: '开始测试' },
            toolCallId: 'stop-waiting-generate',
            toolName: 'send_tavern_message',
          },
        ]),
      ]),
      lock: new GlobalAgentTaskLock(),
      requestToolApproval: async () => true,
      snapshots: snapshots(),
      tavernChatBridge: chatBridge,
    });

    const running = service.send('修改后尝试生成');
    await vi.waitFor(() => expect(service.view().status).toBe('awaiting-approval'));
    expect(service.view().approval?.midRun).toBe(true);

    service.stop();
    const stopped = await running;

    expect(stopped.status).toBe('awaiting-approval');
    expect(stopped.approval?.midRun).toBe(false);
    expect(chatBridge.calls).not.toContain('generate-reply');
  });

  it('页面中断后仍能恢复生成前检查点，拒绝结果会传回原工具步骤', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const chatBridge = new FakeTavernChatBridge();
    let persistedRuntime!: PersistedSessionRuntime;
    let persistedFiles!: WorkspaceFile[];
    const interrupted = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([
        step([writeDescription('中断前候选', 'interrupted-write')]),
        step([
          {
            input: {
              content: ['---', 'role: user', '---', '准备测试'].join('\n'),
              path: '/context/chats/c01/messages/0000-0099/000001.md',
            },
            toolCallId: 'interrupted-chat-append',
            toolName: 'write_file',
          },
        ]),
        step([
          {
            input: { chatId: 'c01' },
            toolCallId: 'interrupted-generate',
            toolName: 'generate_tavern_reply',
          },
        ]),
      ]),
      lock: new GlobalAgentTaskLock(),
      onPersist: async (runtime, files) => {
        persistedRuntime = structuredClone(runtime);
        persistedFiles = structuredClone(files);
      },
      requestToolApproval: async () => true,
      snapshots: snapshots(),
      tavernChatBridge: chatBridge,
    });

    void interrupted.send('中断恢复测试');
    await vi.waitFor(() => expect(interrupted.view().status).toBe('awaiting-approval'));
    const restored = await CardAgentSessionService.restore(
      {
        adapter,
        executor: new QueueExecutor([step([], '已从拒绝处恢复')]),
        lock: new GlobalAgentTaskLock(),
        requestToolApproval: async () => true,
        snapshots: snapshots(),
        tavernChatBridge: chatBridge,
      },
      persistedRuntime,
      persistedFiles,
    );

    expect(restored.view().status).toBe('awaiting-approval');
    expect((await restored.approve({ '/character/fields/description': 'current' })).status).toBe('failed');
    expect((await restored.resume()).status).toBe('completed');
    expect(chatBridge.calls).not.toContain('generate-reply');
    expect(restored.view().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ error: expect.stringContaining('CHECKPOINT_REJECTED'), type: 'tool-failed' }),
      ]),
    );

    const cancelledAfterRestore = await CardAgentSessionService.restore(
      {
        adapter,
        executor: new QueueExecutor([]),
        lock: new GlobalAgentTaskLock(),
        requestToolApproval: async () => true,
        snapshots: snapshots(),
        tavernChatBridge: chatBridge,
      },
      persistedRuntime,
      persistedFiles,
    );
    expect(cancelledAfterRestore.view().approval?.midRun).toBe(true);
    cancelledAfterRestore.stop();
    expect(cancelledAfterRestore.view()).toMatchObject({
      approval: { midRun: false },
      status: 'awaiting-approval',
    });
  });

  it('流式展示模型思考，并在模型步骤结束后记录耗时和折叠状态', async () => {
    let now = 1_000;
    const executor = new QueueExecutor([
      async request => {
        request.onReasoningDelta?.('先检查角色描述。\n');
        now = 3_400;
        request.onReasoningDelta?.('再确认世界书关联。');
        return step([], '检查完成');
      },
    ]);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor,
      lock: new GlobalAgentTaskLock(),
      now: () => now,
      snapshots: snapshots(),
    });
    await service.send('只读检查');
    expect(service.view().ui.find(item => item.kind === 'reasoning')).toMatchObject({
      content: '先检查角色描述。\n再确认世界书关联。',
      durationMs: 2_400,
      status: 'completed',
    });
  });

  it('联网工具开始时切分流式思考，并避免在模型结束后重复追加完整思考', async () => {
    let now = 1_000;
    const providerCall = {
      input: { query: '今日新闻' },
      output: [{ title: '新闻来源', url: 'https://example.test/news' }],
      providerExecuted: true as const,
      toolCallId: 'web-search-1',
      toolName: 'web_search',
    };
    const executor = new QueueExecutor([
      async request => {
        request.onReasoningDelta?.('先确定搜索范围。');
        now = 2_000;
        await request.onProviderToolStarted?.(providerCall);
        await request.onProviderToolCompleted?.(providerCall);
        now = 3_000;
        request.onReasoningDelta?.('再核对搜索结果。');
        return {
          assistantMessages: [
            {
              content: [
                { text: '先确定搜索范围。再核对搜索结果。', type: 'reasoning' as const },
                { text: '这是最终回复。', type: 'text' as const },
              ],
              role: 'assistant' as const,
            },
          ],
          finishReason: 'stop',
          providerToolCalls: [providerCall],
          text: '这是最终回复。',
          toolCalls: [],
        };
      },
    ]);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor,
      lock: new GlobalAgentTaskLock(),
      now: () => now,
      snapshots: snapshots(),
    });

    const completed = await service.send('搜索新闻');
    const processItems = completed.ui.filter(item => item.kind === 'reasoning' || item.kind === 'tool');
    expect(processItems.map(item => item.kind)).toEqual(['reasoning', 'tool', 'reasoning']);
    expect(processItems.filter(item => item.kind === 'reasoning').map(item => item.content)).toEqual([
      '先确定搜索范围。',
      '再核对搜索结果。',
    ]);
  });

  it('把大量流式delta合并为单次定时界面发布，完成边界仍立即刷新', async () => {
    let finish!: () => void;
    let publishStreaming!: () => void;
    const cancelStreaming = vi.fn();
    const onUpdate = vi.fn();
    const executor = new QueueExecutor([
      async request => {
        for (let index = 0; index < 200; index += 1) request.onTextDelta?.('字');
        await new Promise<void>(resolve => {
          finish = resolve;
        });
        return step([], '完成');
      },
    ]);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor,
      lock: new GlobalAgentTaskLock(),
      onUpdate,
      scheduleStreamingUpdate: callback => {
        publishStreaming = callback;
        return cancelStreaming;
      },
      snapshots: snapshots(),
    });

    const running = service.send('测试流式节流');
    await vi.waitFor(() => expect(executor.requests).toHaveLength(1));
    const updatesBeforeStreamingPublish = onUpdate.mock.calls.length;
    expect(publishStreaming).toBeTypeOf('function');
    publishStreaming();
    expect(onUpdate).toHaveBeenCalledTimes(updatesBeforeStreamingPublish + 1);
    expect(
      (onUpdate.mock.calls.at(-1)?.[0] as { ui: Array<{ content: string; status?: string }> }).ui.at(-1),
    ).toMatchObject({ content: '字'.repeat(200), status: 'running' });

    finish();
    expect((await running).status).toBe('completed');
    expect(onUpdate.mock.calls.length).toBeGreaterThan(updatesBeforeStreamingPublish + 1);
  });

  it('运行中拒绝回退用户消息，并保留原Runner供停止操作', async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => {
      started = resolve;
    });
    const executor = new QueueExecutor([
      request =>
        new Promise<ModelStepResult>((_resolve, reject) => {
          request.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          started();
        }),
    ]);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor,
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      snapshots: snapshots(),
    });

    const running = service.send('保持运行直到停止', 'running-user');
    await startedPromise;
    await vi.waitFor(() => expect(service.view().status).toBe('running'));

    await expect(service.undoToUserMessage('running-user')).rejects.toThrow('运行或审批期间不能回退历史');
    expect(service.view().status).toBe('running');

    service.stop();
    const stopped = await running;
    expect(stopped.status).toBe('completed');
    expect(stopped.ui.every(item => item.status !== 'running')).toBe(true);
    expect((await service.undoToUserMessage('running-user')).status).toBe('completed');
  });

  it('构建一次视图只读取一次非角色资源写入权限', async () => {
    const canWriteNonCharacterResources = vi.fn(() => false);
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      canWriteNonCharacterResources,
      executor: new QueueExecutor([step()]),
      lock: new GlobalAgentTaskLock(),
      snapshots: snapshots(),
    });
    canWriteNonCharacterResources.mockClear();
    service.view();
    expect(canWriteNonCharacterResources).toHaveBeenCalledOnce();
  });

  it('工具调用前后的流式正文保持原有时间线顺序', async () => {
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor: new QueueExecutor([
        async request => {
          request.onTextDelta?.('输出1');
          return step([
            {
              input: { path: '/character/description.md' },
              toolCallId: 'ordered-read',
              toolName: 'read_file',
            },
          ]);
        },
        async request => {
          request.onTextDelta?.('输出2');
          return step([], '输出2');
        },
      ]),
      lock: new GlobalAgentTaskLock(),
      snapshots: snapshots(),
    });

    await service.send('检查输出顺序');
    expect(
      service
        .view()
        .ui.filter(item => item.kind === 'assistant' || item.kind === 'tool')
        .map(item => ({ content: item.content, kind: item.kind })),
    ).toEqual([
      { content: '输出1', kind: 'assistant' },
      { content: expect.stringContaining('description'), kind: 'tool' },
      { content: '输出2', kind: 'assistant' },
    ]);
  });

  it('提交失败后回滚并保留候选供再次处理', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState(), { failAtApply: 1 });
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([step([writeDescription('不会落地')]), step()]),
      lock: new GlobalAgentTaskLock(),
      snapshots: snapshots(),
    });
    const waiting = await service.send('修改');
    const result = await service.approve({ '/character/fields/description': 'agent' });
    expect(result.status).toBe('awaiting-approval');
    expect(result.error).toContain('Fault adapter');
    expect(result.approval?.error).toContain('Fault adapter');
    expect(result.approval).toBeDefined();
    expect((await adapter.read()).character.fields.description).toBe('base description');
    expect(waiting.status).toBe('awaiting-approval');

    const retried = await service.approve({ '/character/fields/description': 'agent' });
    expect(retried).toMatchObject({ approval: undefined, error: undefined, status: 'completed' });
    expect((await adapter.read()).character.fields.description).toBe('不会落地');
  });

  it('应用已写回但会话保存失败时保留候选并允许再次应用', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    let persistCount = 0;
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([step([writeDescription('重试后保留')]), step()]),
      lock: new GlobalAgentTaskLock(),
      onPersist: async () => {
        persistCount += 1;
        if (persistCount === 2) throw new Error('upload failed');
      },
      snapshots: snapshots(),
    });
    expect((await service.send('修改')).status).toBe('awaiting-approval');

    await expect(service.approve({ '/character/fields/description': 'agent' })).rejects.toThrow('upload failed');
    expect(service.view()).toMatchObject({
      approval: expect.any(Object),
      error: expect.stringContaining('应用结果未能完整保存'),
      status: 'failed',
    });
    expect((await adapter.read()).character.fields.description).toBe('重试后保留');

    const retried = await service.approve({ '/character/fields/description': 'agent' });
    expect(retried).toMatchObject({ approval: undefined, error: undefined, status: 'completed' });
    expect(persistCount).toBe(3);
  });

  it('玩家编辑立即写入实际数据，连续保存合并为单一可回退检查点与内部消息', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    let persisted: PersistedSessionRuntime | undefined;
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([]),
      lock: new GlobalAgentTaskLock(),
      onPersist: async runtime => {
        persisted = structuredClone(runtime);
      },
      snapshots: snapshots(),
    });
    await service.writeWorkingFile('/character/description.md', '玩家写入描述');
    const saved = await service.writeWorkingFile('/character/personality.md', '玩家写入性格');
    expect(saved.status).toBe('completed');
    expect(saved.approval).toBeUndefined();
    expect(await adapter.read()).toMatchObject({
      character: { fields: { description: '玩家写入描述', personality: '玩家写入性格' } },
    });
    expect(saved.ui.filter(item => item.kind === 'manual')).toHaveLength(1);
    expect(persisted?.modelMessages.at(-1)).toMatchObject({
      content: expect.stringContaining('<manual_workspace_changes>'),
      role: 'user',
    });
    expect(String(persisted?.modelMessages.at(-1)?.content)).toContain('/character/personality.md');

    const undone = await service.undo();
    expect((await adapter.read()).character.fields).toMatchObject({
      description: 'base description',
      personality: 'base personality',
    });
    expect(undone.ui.find(item => item.kind === 'manual')).toMatchObject({ manualStatus: 'undone' });
    await service.redo();
    expect((await adapter.read()).character.fields).toMatchObject({
      description: '玩家写入描述',
      personality: '玩家写入性格',
    });
  });

  it('玩家保存待审批文件时立即接管该路径，并让已被实际数据覆盖的Agent修改自动结束', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([step([writeDescription('Agent候选')]), step()]),
      lock: new GlobalAgentTaskLock(),
      snapshots: snapshots(),
    });
    expect((await service.send('修改描述')).status).toBe('awaiting-approval');
    const saved = await service.writeWorkingFile('/character/description.md', '玩家最终版本');
    expect(saved.status).toBe('completed');
    expect(saved.approval).toBeUndefined();
    expect((await adapter.read()).character.fields.description).toBe('玩家最终版本');
    expect(saved.ui.find(item => item.kind === 'manual')).toMatchObject({ manualStatus: 'active' });
  });

  it('玩家保存失败会保留展开的失败记录，重试沿用原检查点并在成功后可回退', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState(), { failAtApply: 1 });
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([]),
      lock: new GlobalAgentTaskLock(),
      snapshots: snapshots(),
    });
    const failed = await service.writeWorkingFile('/character/description.md', '第一次失败');
    expect((await adapter.read()).character.fields.description).toBe('base description');
    expect(failed.ui.find(item => item.kind === 'manual')).toMatchObject({ manualStatus: 'failed', status: 'failed' });
    const retried = await service.writeWorkingFile('/character/description.md', '重试成功');
    expect(retried.ui.filter(item => item.kind === 'manual')).toHaveLength(1);
    expect((await adapter.read()).character.fields.description).toBe('重试成功');
    await service.undo();
    expect((await adapter.read()).character.fields.description).toBe('base description');
  });

  it('玩家基于过期文件保存时报告 Base、Current、Player 冲突而不覆盖外部编辑', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([]),
      lock: new GlobalAgentTaskLock(),
      snapshots: snapshots(),
    });
    const external = transactionState();
    external.character.fields.description = '外部编辑';
    adapter.replaceExternal(external);
    await expect(service.writeWorkingFile('/character/description.md', '玩家编辑')).rejects.toThrow(
      'MANUAL_EDIT_CONFLICT',
    );
    expect((await adapter.read()).character.fields.description).toBe('外部编辑');
  });

  it('从较早消息回退时隐藏其Agent结果和全部后续消息，重做按检查点逐步恢复', async () => {
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      executor: new QueueExecutor([
        step([writeDescription('第一轮', 'early-1')]),
        step([], '第一轮回复'),
        step([writeDescription('第二轮', 'early-2')]),
        step([], '第二轮回复'),
      ]),
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      snapshots: snapshots(),
    });
    await service.send('第一条', 'early-user-1');
    await service.send('第二条', 'early-user-2');
    const undone = await service.undoToUserMessage('early-user-1');
    expect(undone.ui.map(item => item.id)).toEqual(['early-user-1']);
    const redone = await service.redo();
    expect(redone.ui.some(item => item.content === '第一轮回复')).toBe(true);
    expect(redone.ui.some(item => item.id === 'early-user-2')).toBe(true);
    expect(redone.ui.some(item => item.content === '第二轮回复')).toBe(false);
  });

  it('失败原因可以持久化，失败轮次禁止叠加消息且回退后可重新发送', async () => {
    let persistedRuntime: PersistedSessionRuntime | undefined;
    let persistedFiles: WorkspaceFile[] = [];
    const adapter = new MemoryCardStateAdapter(transactionState());
    const snapshotStore = snapshots();
    const service = await CardAgentSessionService.create({
      adapter,
      executor: new QueueExecutor([
        async () => {
          throw new Error('provider failed');
        },
      ]),
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      onPersist: async (runtime, files) => {
        persistedRuntime = structuredClone(runtime);
        persistedFiles = structuredClone(files);
      },
      snapshots: snapshotStore,
    });
    const failed = await service.send('触发失败', 'failed-user');
    expect(failed).toMatchObject({ error: 'provider failed', status: 'failed' });
    expect(persistedRuntime).toMatchObject({ lastError: 'provider failed', status: 'failed' });
    await expect(service.send('不应叠加')).rejects.toThrow('当前轮次尚未结束');

    const restored = await CardAgentSessionService.restore(
      {
        adapter,
        executor: new QueueExecutor([step([], '重新发送成功')]),
        lock: new GlobalAgentTaskLock(),
        onPersist: async (runtime, files) => {
          persistedRuntime = structuredClone(runtime);
          persistedFiles = structuredClone(files);
        },
        snapshots: snapshotStore,
      },
      persistedRuntime!,
      persistedFiles,
    );
    await restored.undoToUserMessage('failed-user');
    expect(restored.view()).toMatchObject({ error: undefined, status: 'completed' });
    expect(persistedRuntime).toMatchObject({
      activeBase: undefined,
      activeCheckpointId: undefined,
      lastError: undefined,
      status: 'completed',
    });
    expect((await restored.resend('failed-user')).status).toBe('completed');
  });
});
