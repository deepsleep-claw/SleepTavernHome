import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryTavernFileClient } from '../persistence/file-client';
import { MemoryAgentSettingsStore } from '../persistence/settings';
import { sha256 } from '../transaction/canonical';
import { exportSkillZip } from './skill-package';
import { RemoteBuiltinSkillStore } from './remote-builtin-store';
import type { AgentSkill } from './types';

describe('RemoteBuiltinSkillStore', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('从脚本同级资源清单下载、校验并缓存一个自定义后缀ZIP，之后可离线从酒馆文件加载', async () => {
    const skill: AgentSkill = {
      body: '按需正文',
      builtin: false,
      description: '使用角色绑定的HTML工程，拆分源码、检查、编译、预览与导出。',
      id: 'temporary',
      loading: 'on-demand',
      locked: false,
      name: 'HTML工程',
      resources: { 'references/schema.md': { content: '# schema', mediaType: 'text/markdown', size: 8 } },
    };
    const bytes = exportSkillZip(skill);
    const hash = await sha256(bytes);
    const manifest = {
      protocolVersion: 1,
      skills: [{
        description: skill.description,
        file: 'html-project.zip.ds',
        id: 'html-project',
        loading: 'on-demand',
        name: skill.name,
        sha256: hash,
        size: bytes.byteLength,
        version: 1,
      }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest), { status: 200 });
      if (url.endsWith('html-project.zip.ds')) return new Response(Uint8Array.from(bytes), { status: 200 });
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new RemoteBuiltinSkillStore('http://127.0.0.1:5500/dist/酒馆助手/梦境创客/resources/', client, settings, () => 100);
    await store.refreshManifest();
    const loaded = await store.ensure('html-project');
    expect(loaded).toMatchObject({ builtin: true, id: 'html-project', loading: 'on-demand', locked: true });
    expect(settings.load().builtinSkillPackages['html-project']).toMatchObject({ sha256: hash, size: bytes.byteLength });
    expect(client.uploadedNames[0]).toMatch(/^DreamCreator--Resource--BuiltinSkill--html-project--.*\.zip\.ds$/u);
    expect(store.statuses()[0].state).toBe('available');

    const reloaded = new RemoteBuiltinSkillStore(
      'http://127.0.0.1:5500/dist/酒馆助手/梦境创客/resources/',
      client,
      settings,
      () => 200,
    );
    await reloaded.refreshManifest();
    await reloaded.ensure('html-project');
    expect(client.uploadedNames).toHaveLength(1);
    expect(settings.load().builtinSkillPackages['html-project']?.downloadedAt).toBe(100);
  });

  it('把旧 .zip 缓存视为过期并替换为 .zip.ds', async () => {
    const skill: AgentSkill = {
      body: '按需正文',
      builtin: false,
      description: '测试Skill',
      id: 'temporary',
      loading: 'on-demand',
      locked: false,
      name: 'HTML工程',
      resources: {},
    };
    const bytes = exportSkillZip(skill);
    const hash = await sha256(bytes);
    const manifest = {
      protocolVersion: 1,
      skills: [{
        description: skill.description,
        file: 'html-project.zip.ds',
        id: 'html-project',
        loading: 'on-demand',
        name: skill.name,
        sha256: hash,
        size: bytes.byteLength,
        version: 1,
      }],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest), { status: 200 });
      if (url.endsWith('html-project.zip.ds')) return new Response(Uint8Array.from(bytes), { status: 200 });
      return new Response('', { status: 404 });
    }));
    const client = new MemoryTavernFileClient();
    const oldUrl = await client.upload('DreamCreator--Resource--BuiltinSkill--html-project--old.zip', bytes);
    const settings = new MemoryAgentSettingsStore();
    const current = settings.load();
    current.builtinSkillPackages['html-project'] = {
      downloadedAt: 50,
      id: 'html-project',
      protocolVersion: 1,
      sha256: hash,
      size: bytes.byteLength,
      sourceUrl: 'http://example.test/html-project.zip',
      url: oldUrl,
      version: 1,
    };
    await settings.save(current);

    const store = new RemoteBuiltinSkillStore('http://example.test/resources/', client, settings, () => 100);
    await store.refreshManifest();
    expect(store.statuses()[0].state).toBe('outdated');
    await store.ensure('html-project');

    expect(settings.load().builtinSkillPackages['html-project']?.url).toMatch(/\.zip\.ds$/u);
    expect(client.urls()).not.toContain(oldUrl);
  });
});
