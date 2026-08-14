import { describe, expect, it, vi } from 'vitest';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { createPlaygroundRunnerTools } from './playground-tools';

describe('playground runner tools', () => {
  it('准备预览时保存来源哈希并返回严格标记', async () => {
    const repository = new MemoryWorkspaceRepository({ files: [{
      content: '<strong>hello</strong>', mediaType: 'text/html', path: '/character/files/demo/index.html', readonly: false, resourceId: 'html',
    }] });
    const prepareRender = vi.fn();
    const tool = createPlaygroundRunnerTools(repository, { approvalMode: () => 'yolo', prepareRender })
      .find(item => item.name === 'prepare_render')!;
    const result = await tool.execute({
      data: { theme: 'dark' },
      inputText: 'hello',
      renderer: 'plain-html',
      sourcePath: '/character/files/demo/index.html',
      sourceType: 'file',
    }, 'render') as { marker: string; renderId: string; sourceHash: string };
    expect(result.marker).toBe(`<dream-render id="${result.renderId}"></dream-render>`);
    expect(result.sourceHash).toHaveLength(64);
    expect(prepareRender).toHaveBeenCalledWith(expect.objectContaining({ data: { theme: 'dark' }, renderId: result.renderId }));
  });

  it('tavern环境仅在手动审批模式请求一次确认', async () => {
    const repository = new MemoryWorkspaceRepository();
    const manual = createPlaygroundRunnerTools(repository, { approvalMode: () => 'manual', prepareRender: vi.fn() })
      .find(item => item.name === 'run_javascript')!;
    const yolo = createPlaygroundRunnerTools(repository, { approvalMode: () => 'yolo', prepareRender: vi.fn() })
      .find(item => item.name === 'run_javascript')!;
    expect(await manual.confirmation?.({ code: 'return 1', environment: 'tavern' }, 'manual')).toMatchObject({ risk: 'ordinary' });
    expect(await yolo.confirmation?.({ code: 'return 1', environment: 'tavern' }, 'yolo')).toBeUndefined();
  });
});
