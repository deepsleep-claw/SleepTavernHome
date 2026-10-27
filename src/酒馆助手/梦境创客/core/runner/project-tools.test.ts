import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';

const check = vi.fn();
const regexYaml = vi.fn();
vi.mock('../projects/html-project', () => ({
  HtmlProjectCompiler: class {
    check = check;
    regexYaml = regexYaml;
  },
}));

import { createProjectRunnerTools } from './project-tools';

describe('project runner tools', () => {
  beforeEach(() => {
    check.mockReset().mockResolvedValue({ diagnostics: [], output: '<b>ok</b>', outputBytes: 9, projectName: 'Demo', renderer: 'plain-html' });
    regexYaml.mockReset().mockReturnValue({ content: 'name: Demo', path: '/regexes/character/demo.yaml', replace: false });
  });

  it('编译期间停止任务后不再写入正则', async () => {
    const repository = new MemoryWorkspaceRepository({ files: [{
      content: 'name: Demo', mediaType: 'text/yaml', path: '/character/files/demo/project.yaml', readonly: false, resourceId: 'project',
    }] });
    const controller = new AbortController();
    const write = vi.spyOn(repository, 'write');
    check.mockImplementationOnce(async () => {
      controller.abort();
      return { diagnostics: [], output: '<p>完成</p>', outputBytes: 13, projectName: 'Demo', renderer: 'plain-html' };
    });
    const manager = createProjectRunnerTools(repository, {
      approvalMode: () => 'yolo', canWriteNonCharacterResources: () => false, resourceBaseUrl: 'https://example.invalid/',
    })[0];
    await expect(manager.execute({ action: 'compile', project: '/character/files/demo/project.yaml' }, 'compile', { abortSignal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['plain-html', 'tavern-helper'] as const)('模板提供 %s 的完整清单与源码且不写入工作区', async renderer => {
    const repository = new MemoryWorkspaceRepository();
    const write = vi.spyOn(repository, 'write');
    const manager = createProjectRunnerTools(repository, {
      approvalMode: () => 'manual', canWriteNonCharacterResources: () => false, resourceBaseUrl: 'https://example.invalid/',
    })[0];
    const input = { action: 'template', project: '/character/files/status/project.yaml', renderer };
    expect(await manager.confirmation?.(input, 'template')).toBeUndefined();
    const result = await manager.execute(input, 'template') as { files: Array<{path: string; content: string}> };
    const config = parse(result.files.find(file => file.path === input.project)!.content);
    expect(config).toMatchObject({ name: '角色状态', renderer, build: { entry: 'template.html' }, regex: { find: '/\\[STATUS\\]/g', destination: { display: true, prompt: false } } });
    for (const path of [config.build.entry, ...config.build.styles, ...config.build.scripts])
      expect(result.files.some(file => file.path === `/character/files/status/${path}`)).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('检查和编译只读取工程与目标正则作用域，取消后不继续遍历', async () => {
    const file = (path: string) => ({ path, content: 'content', mediaType: 'text/plain' as const, readonly: false, resourceId: path });
    const repository = new MemoryWorkspaceRepository({ files: [
      file('/character/files/demo/project.yaml'), file('/character/files/demo/index.html'),
      file('/regexes/character/existing.yaml'), file('/regexes/global/global.yaml'),
      file('/skills/builtin/large/resource.md'), file('/character/files/another/project.yaml'),
    ] });
    const read = vi.spyOn(repository, 'read');
    const manager = createProjectRunnerTools(repository, { approvalMode: () => 'yolo', canWriteNonCharacterResources: () => false, resourceBaseUrl: 'https://example.invalid/' })[0];
    await manager.execute({ action: 'check', project: '/character/files/demo/project.yaml' }, 'check');
    expect(read.mock.calls.map(([path]) => path).sort()).toEqual(['/character/files/demo/index.html', '/character/files/demo/project.yaml']);
    read.mockClear();
    await manager.execute({ action: 'compile', project: '/character/files/demo/project.yaml' }, 'compile');
    expect(read.mock.calls.map(([path]) => path)).toContain('/regexes/character/existing.yaml');
    expect(read.mock.calls.map(([path]) => path).some(path => path.startsWith('/skills/') || path.includes('/another/') || path.includes('/global/'))).toBe(false);
    read.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(manager.execute({ action: 'check', project: '/character/files/demo/project.yaml' }, 'cancelled', { abortSignal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
  });

  it('检查工程不写文件，编译后通过VFS写入角色正则', async () => {
    const repository = new MemoryWorkspaceRepository({ files: [{
      content: 'name: Demo', mediaType: 'text/yaml', path: '/character/files/demo/project.yaml', readonly: false, resourceId: 'project',
    }] });
    const tools = new Map(createProjectRunnerTools(repository, {
      approvalMode: () => 'yolo',
      canWriteNonCharacterResources: () => false,
      resourceBaseUrl: 'https://example.invalid/resources/',
    }).map(item => [item.name, item]));
    await expect(tools.get('manage_html_project')!.execute({ action: 'check', project: '/character/files/demo/project.yaml' }, 'check')).resolves.toMatchObject({ valid: true });
    await expect(tools.get('manage_html_project')!.execute({ action: 'compile', project: '/character/files/demo/project.yaml' }, 'compile')).resolves.toMatchObject({ path: '/regexes/character/demo.yaml' });
    expect((await repository.read('/regexes/character/demo.yaml')).content).toBe('name: Demo');
  });

  it('YOLO下角色编译自动放行，非角色编译仍请求高风险确认并校验权限', async () => {
    const repository = new MemoryWorkspaceRepository();
    const tools = new Map(createProjectRunnerTools(repository, {
      approvalMode: () => 'yolo',
      canWriteNonCharacterResources: () => false,
      resourceBaseUrl: 'https://example.invalid/resources/',
    }).map(item => [item.name, item]));
    const compile = tools.get('manage_html_project')!;
    expect(await compile.confirmation?.({ action: 'compile', project: '/character/files/demo/project.yaml' }, 'character')).toBeUndefined();
    expect(await compile.confirmation?.({ action: 'compile', project: '/character/files/demo/project.yaml', scope: 'global' }, 'global')).toMatchObject({ risk: 'high' });
    await expect(compile.execute({ action: 'compile', project: '/character/files/demo/project.yaml', scope: 'global' }, 'global')).rejects.toThrow('NON_CHARACTER_RESOURCE_WRITE_DISABLED');
  });
});
