import { describe, expect, it, vi } from 'vitest';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { createPlaygroundRunnerTools } from './playground-tools';

describe('playground runner tools', () => {
  it('JavaScript 缺少意图时在执行前拒绝，并把意图用于确认说明', async () => {
    const tool = createPlaygroundRunnerTools(new MemoryWorkspaceRepository(), {
      approvalMode: () => 'manual',
      prepareRender: vi.fn(),
    }).find(item => item.name === 'run_javascript')!;
    await expect(tool.execute({ code: 'return 1' }, 'no-intent')).rejects.toThrow('执行意图');
    expect(
      await tool.confirmation?.(
        { intent: '读取当前变量以检查初始化', environment: 'tavern', code: 'return 1' },
        'intent',
      ),
    ).toMatchObject({ description: '读取当前变量以检查初始化' });
  });
  it('准备预览时保存来源哈希并返回严格标记', async () => {
    const repository = new MemoryWorkspaceRepository({
      files: [
        {
          content: '<strong>hello</strong>',
          mediaType: 'text/html',
          path: '/character/files/demo/index.html',
          readonly: false,
          resourceId: 'html',
        },
      ],
    });
    const prepareRender = vi.fn();
    const tool = createPlaygroundRunnerTools(repository, { approvalMode: () => 'yolo', prepareRender }).find(
      item => item.name === 'prepare_render',
    )!;
    const result = (await tool.execute(
      {
        backgroundCss: 'background: #101418; color-scheme: dark;',
        data: { theme: 'dark' },
        inputText: 'hello',
        renderer: 'plain-html',
        sourcePath: '/character/files/demo/index.html',
        sourceType: 'file',
      },
      'render',
    )) as { marker: string; renderId: string; sourceHash: string };
    expect(result.marker).toBe(`<dream-render id="${result.renderId}"></dream-render>`);
    expect(result.sourceHash).toHaveLength(64);
    expect(prepareRender).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundCss: 'background: #101418; color-scheme: dark;',
        data: { theme: 'dark' },
        renderId: result.renderId,
      }),
    );
  });

  it('tavern环境仅在手动审批模式请求一次确认', async () => {
    const repository = new MemoryWorkspaceRepository();
    const manual = createPlaygroundRunnerTools(repository, {
      approvalMode: () => 'manual',
      prepareRender: vi.fn(),
    }).find(item => item.name === 'run_javascript')!;
    const yolo = createPlaygroundRunnerTools(repository, { approvalMode: () => 'yolo', prepareRender: vi.fn() }).find(
      item => item.name === 'run_javascript',
    )!;
    expect(await manual.confirmation?.({ code: 'return 1', environment: 'tavern' }, 'manual')).toMatchObject({
      risk: 'ordinary',
    });
    expect(await yolo.confirmation?.({ code: 'return 1', environment: 'tavern' }, 'yolo')).toBeUndefined();
  });
});
