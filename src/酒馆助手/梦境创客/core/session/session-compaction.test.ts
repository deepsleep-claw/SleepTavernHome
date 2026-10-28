import { describe, expect, it } from 'vitest';
import type { ModelStepExecutor, ModelStepRequest, ModelStepResult } from '../runner/step-executor';
import { defaultBuiltinAgentConfiguration } from '../persistence/builtin-agent';
import { MemoryCardStateAdapter } from '../transaction/adapter';
import { transactionState } from '../transaction/test-fixture';
import { CardAgentSessionService } from './session-service';
import { GlobalAgentTaskLock } from './task-lock';
import type { PersistedSessionRuntime } from './types';

function reply(text: string): ModelStepResult {
  return { text, finishReason: 'stop', assistantMessages: [{ role: 'assistant', content: text }], toolCalls: [] };
}

describe('中断会话的上下文维护', () => {
  it('模型主动压缩在时间线明确显示来源', async () => {
    let step = 0;
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      agentConfiguration: defaultBuiltinAgentConfiguration(),
      lock: new GlobalAgentTaskLock(),
      executor: {
        execute: async () => {
          step++;
          if (step === 1) return reply('旧步骤'.repeat(1_000));
          if (step === 2) {
            const call = { toolCallId: 'compact', toolName: 'compact_context', input: { summary: '旧步骤已经完成' } };
            return {
              ...reply(''),
              finishReason: 'tool-calls',
              toolCalls: [call],
              assistantMessages: [{ role: 'assistant', content: [{ ...call, type: 'tool-call' }] }],
            };
          }
          return reply('继续处理');
        },
      },
    });
    await service.send('第一轮');
    const view = await service.send('继续');
    expect(view.ui.some(item => item.kind === 'status' && item.content.includes('模型主动整理'))).toBe(true);
  });
  it('摘要保存失败时还原上下文和完成事件，可再次压缩', async () => {
    let saved!: PersistedSessionRuntime;
    let rejectSummary = true;
    let summaries = 0;
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      agentConfiguration: defaultBuiltinAgentConfiguration(),
      lock: new GlobalAgentTaskLock(),
      executor: {
        execute: async request => {
          if (request.purpose === 'summary') {
            summaries++;
            return reply('已保存的摘要');
          }
          return reply('原来的完整步骤'.repeat(300));
        },
      },
      onPersist: async value => {
        if (rejectSummary && value.events.at(-1)?.type === 'context-compacted') {
          rejectSummary = false;
          throw new Error('存储暂不可用');
        }
        saved = structuredClone(value);
      },
    });
    await service.send('第一轮');
    await service.send('第二轮');
    const before = structuredClone(saved.modelMessages);
    const failed = await service.compactContext();
    expect(saved.modelMessages).toEqual(before);
    expect(failed.events.some(event => event.type === 'context-compacted')).toBe(false);
    expect(failed.ui.some(item => item.status === 'failed' && item.content.includes('原上下文已保留'))).toBe(true);
    expect(summaries).toBe(1);
    await service.compactContext();
    expect(JSON.stringify(saved.modelMessages)).toContain('已保存的摘要');
    expect(summaries).toBe(2);
  });

  it('短会话无需摘要请求，明确显示跳过原因', async () => {
    let requests = 0;
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      agentConfiguration: defaultBuiltinAgentConfiguration(),
      lock: new GlobalAgentTaskLock(),
      executor: {
        execute: async () => {
          requests++;
          return reply('简短回答');
        },
      },
    });
    await service.send('你好');
    const view = await service.compactContext();
    expect(view.status).toBe('completed');
    expect(view.ui.at(-1)?.content).toContain('暂无足够可压缩的旧消息');
    expect(requests).toBe(1);
  });

  it('请求和自动摘要都失败后仍能手动压缩，保留原轮次并继续', async () => {
    let saved!: PersistedSessionRuntime;
    let normal = 0;
    let summaries = 0;
    const executor: ModelStepExecutor = {
      execute: async request => {
        if (request.purpose === 'summary') {
          if (++summaries <= 3) throw Object.assign(new Error('服务暂不可用'), { statusCode: 503 });
          return reply('第一轮工作已经完成');
        }
        normal++;
        if (normal === 1) return reply('第一轮进展'.repeat(500));
        if (normal === 2) throw new Error('context_length_exceeded');
        return reply('剩余任务完成');
      },
    };
    const service = await CardAgentSessionService.create({
      adapter: new MemoryCardStateAdapter(transactionState()),
      agentConfiguration: defaultBuiltinAgentConfiguration(),
      executor,
      lock: new GlobalAgentTaskLock(),
      onPersist: async value => {
        saved = structuredClone(value);
      },
    });
    await service.send('第一轮');
    expect((await service.send('第二轮')).status).toBe('failed');
    const checkpoint = saved.activeCheckpointId;
    expect(checkpoint).toBeTruthy();
    const compacted = await service.compactContext();
    expect(compacted.status).toBe('stopped');
    expect(compacted.ui.at(-1)?.content).toContain('可从中断处继续');
    expect(saved.activeCheckpointId).toBe(checkpoint);
    expect((await service.resume()).status).toBe('completed');
    expect(saved.activeCheckpointId).toBeUndefined();
    expect(normal).toBe(3);
    expect(summaries).toBe(4);
  });

  it('压缩与重载不执行挂起写入，继续时只执行一次并保留撤销记录', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const originalDescription = (await adapter.read()).character.fields.description;
    const requests: ModelStepRequest[] = [];
    let saved!: PersistedSessionRuntime;
    let stopOnTool = true;
    const executor: ModelStepExecutor = {
      execute: async request => {
        requests.push(request);
        if (request.purpose === 'summary') return reply('第一轮内容已归纳');
        if (requests.length === 1) return reply('旧内容'.repeat(500));
        if (requests.length === 2) {
          const call = {
            toolName: 'write_file',
            toolCallId: 'pending-write',
            input: { path: '/character/definition/description.md', content: '压缩后继续写入', overwrite: true },
          };
          return {
            text: '',
            finishReason: 'tool-calls',
            assistantMessages: [{ role: 'assistant', content: [{ type: 'tool-call', ...call }] }],
            toolCalls: [call],
          };
        }
        return reply('完成');
      },
    };
    const service: CardAgentSessionService = await CardAgentSessionService.create({
      adapter,
      agentConfiguration: defaultBuiltinAgentConfiguration(),
      executor,
      lock: new GlobalAgentTaskLock(),
      mode: 'yolo',
      onPersist: async value => {
        saved = structuredClone(value);
        if (
          stopOnTool &&
          value.events.at(-1)?.type === 'model-completed' &&
          JSON.stringify(value.modelMessages.at(-1)).includes('pending-write')
        ) {
          stopOnTool = false;
          service.stop();
        }
      },
    });
    await service.send('先整理');
    expect((await service.send('修改描述')).status).toBe('stopped');
    const checkpoint = saved.activeCheckpointId;
    expect((await service.compactContext()).status).toBe('stopped');
    expect((await adapter.read()).character.fields.description).toBe(originalDescription);
    expect(saved.activeCheckpointId).toBe(checkpoint);
    const restored = await CardAgentSessionService.restore({ adapter, executor }, saved);
    expect((await restored.resume()).status).toBe('completed');
    expect((await adapter.read()).character.fields.description).toBe('压缩后继续写入');
    expect(
      restored
        .view()
        .events.filter(event => event.type === 'tool-executing' && event.call.toolCallId === 'pending-write'),
    ).toHaveLength(1);
    await restored.undo();
    expect((await adapter.read()).character.fields.description).toBe(originalDescription);
  });
});
