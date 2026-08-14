import { beforeEach, describe, expect, it, vi } from 'vitest';
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
