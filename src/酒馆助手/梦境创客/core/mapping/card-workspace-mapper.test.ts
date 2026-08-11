import { describe, expect, it } from 'vitest';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { materializeCardWorkspace, projectCardWorkspace } from './card-workspace-mapper';
import {
  encodeWorkspaceSegment,
  parseFrontmatter,
  parseYamlObject,
  serializeFrontmatter,
  serializeYaml,
} from './serde';
import type { CardWorkspaceState, WorldbookEntryData } from './types';

function entry(overrides: Partial<WorldbookEntryData> = {}): WorldbookEntryData {
  return {
    content: '学院北侧是一座安静的图书馆。',
    effect: { cooldown: null, delay: null, sticky: 2 },
    enabled: true,
    extra: { automationId: 'keep-me' },
    name: '图书馆',
    position: { depth: 4, order: 100, role: 'system', type: 'before_character_definition' },
    probability: 100,
    recursion: { delay_until: null, prevent_incoming: false, prevent_outgoing: true },
    resourceId: 'entry-library',
    strategy: {
      keys: ['图书馆', /藏书/iu],
      keys_secondary: { keys: ['学院'], logic: 'and_any' },
      scan_depth: 'same_as_global',
      type: 'selective',
    },
    uid: 42,
    unknownFields: { future_option: { enabled: true } },
    ...overrides,
  };
}

function state(): CardWorkspaceState {
  return {
    bindings: { additional: ['补充设定'], chat: '学院', primary: '学院' },
    character: {
      avatarId: 'alice.png',
      bindingId: 'binding-alice',
      creator: '作者',
      extensions: { card_agent: { legacy: 'preserve' }, foreign: { nested: true } },
      fields: {
        creator_notes: '作者笔记',
        description: '爱丽丝是学院学生。',
        mes_example: '<START>\n{{char}}：你好。',
        personality: '好奇而谨慎。',
        post_history_instructions: '保持文风。',
        scenario: '魔法学院。',
        system_prompt: '扮演角色。',
      },
      greetings: [
        { content: '初次见面。', id: 'greeting-1', name: '初见' },
        { content: '你终于来了。', id: 'greeting-2', name: '重逢' },
      ],
      name: '爱丽丝',
      tags: ['学院', '原创'],
      version: '1.2.0',
    },
    chat: [
      { hidden: false, id: 0, name: '爱丽丝', role: 'assistant', text: '初次见面。' },
      { hidden: false, id: 1, name: 'User', role: 'user', text: '你好。' },
      { hidden: true, id: 2, name: '旁白', role: 'system', text: '下雨了。' },
    ],
    globalWorldbookNames: ['全局规则'],
    resources: {
      regexes: {
        character: { available: true, regexes: [], targetId: 'binding-alice' },
        global: { available: true, regexes: [], targetId: 'global' },
        'preset-current': { available: true, regexes: [], targetId: 'preset:default' },
      },
      scripts: {
        character: { available: true, scripts: [], targetId: 'binding-alice', trees: [] },
        global: { available: true, scripts: [], targetId: 'global', trees: [] },
        'preset-current': { available: true, scripts: [], targetId: 'preset:default', trees: [] },
      },
    },
    worldbooks: [
      {
        entries: [entry()],
        name: '学院',
        resourceId: 'book-academy',
        roundTripSafe: true,
        unknownFields: { display: 'grid' },
        writable: true,
      },
      {
        entries: [entry({ name: '校服', resourceId: 'entry-uniform', uid: 7 })],
        name: '补充设定',
        resourceId: 'book-extra',
        roundTripSafe: true,
        unknownFields: {},
        writable: true,
      },
      {
        entries: [entry({ name: '禁止事项', resourceId: 'entry-global', uid: 1 })],
        name: '全局规则',
        resourceId: 'book-global',
        roundTripSafe: true,
        unknownFields: { vendor: 'future' },
        writable: false,
      },
    ],
  };
}

describe('card workspace mapper', () => {
  it('投影固定角色文件、具名开场白和世界书，聊天由独立实时工作区负责', () => {
    const files = projectCardWorkspace(state(), 2);
    const paths = files.map(item => item.path);
    expect(paths).toContain('/character/description.md');
    expect(paths).toContain('/greetings/001-初见.md');
    expect(paths.some(path => path.startsWith('/context/'))).toBe(false);
    expect(paths).toContain(`/worldbooks/${encodeWorkspaceSegment('学院')}/book.yaml`);
    expect(files.find(item => item.path.includes('worldbooks-global-readonly'))?.readonly).toBe(true);
    expect(files.find(item => item.path === '/character/identity.yaml')?.readonly).toBe(true);

    const entryFile = files.find(item => item.resourceId === 'entry-library');
    const parsed = parseFrontmatter(entryFile?.content ?? '', entryFile?.path ?? '');
    expect(parsed.metadata).toMatchObject({
      strategy: {
        keys: [
          { type: 'text', value: '图书馆' },
          { flags: 'iu', pattern: '藏书', type: 'regex' },
        ],
      },
      unknown_fields: { future_option: { enabled: true } },
    });
  });

  it('无修改往返时保留正文、正则、未知字段和全局只读书', () => {
    const base = state();
    const result = materializeCardWorkspace(base, projectCardWorkspace(base));
    expect(result.warnings).toEqual([]);
    expect(result.state.character.extensions).toMatchObject({
      card_agent: { binding_id: 'binding-alice', legacy: 'preserve' },
      foreign: { nested: true },
    });
    expect(result.state.worldbooks.find(book => book.resourceId === 'book-academy')).toMatchObject({
      entries: [
        {
          extra: { automationId: 'keep-me' },
          unknownFields: { future_option: { enabled: true } },
        },
      ],
      unknownFields: { display: 'grid' },
    });
    const keyword = result.state.worldbooks.find(book => book.resourceId === 'book-academy')?.entries[0]?.strategy.keys[1];
    expect(keyword).toBeInstanceOf(RegExp);
    expect(result.state.worldbooks.some(book => book.resourceId === 'book-global')).toBe(true);
  });

  it('从Working Copy读取角色和世界书的明确修改', async () => {
    const base = state();
    const workspace = new MemoryWorkspaceRepository({ files: projectCardWorkspace(base) });
    await workspace.write('/character/description.md', '爱丽丝是首席学生。', 'character-edit');
    const entryPath = workspace.snapshot().find(item => item.resourceId === 'entry-library')?.path;
    expect(entryPath).toBeTruthy();
    const original = await workspace.read(entryPath!);
    const { metadata } = parseFrontmatter(original.content, original.path);
    await workspace.write(entryPath!, `---\n${String(original.content.split('---\n')[1])}---\n新的世界书正文。`, 'entry-edit');
    const result = materializeCardWorkspace(base, workspace.snapshot()).state;
    expect(result.character.fields.description).toBe('爱丽丝是首席学生。');
    expect(result.worldbooks.find(book => book.resourceId === 'book-academy')?.entries[0]).toMatchObject({
      content: '新的世界书正文。',
      extra: { automationId: 'keep-me' },
    });
    expect(metadata.name).toBe('图书馆');
  });

  it('目录重命名会同步角色与聊天绑定', async () => {
    const base = state();
    const workspace = new MemoryWorkspaceRepository({ files: projectCardWorkspace(base) });
    await workspace.move(
      `/worldbooks/${encodeWorkspaceSegment('学院')}`,
      `/worldbooks/${encodeWorkspaceSegment('新学院')}`,
      'rename-book',
    );
    const result = materializeCardWorkspace(base, workspace.snapshot()).state;
    expect(result.worldbooks.find(book => book.resourceId === 'book-academy')?.name).toBe('新学院');
    expect(result.bindings).toMatchObject({ chat: '新学院', primary: '新学院' });
  });

  it('支持直接新增开场白文件，并对缺失索引项给出警告', async () => {
    const base = state();
    const workspace = new MemoryWorkspaceRepository({ files: projectCardWorkspace(base) });
    await workspace.remove('/greetings/001-初见.md', 'remove-greeting');
    await workspace.write('/greetings/003-夜谈.md', '今晚聊聊吧。', 'new-greeting');
    const result = materializeCardWorkspace(base, workspace.snapshot());
    expect(result.warnings).toEqual(['开场白索引引用了不存在的文件：001-初见.md']);
    expect(result.state.character.greetings).toEqual([
      { content: '你终于来了。', id: 'greeting-2', name: '重逢' },
      expect.objectContaining({ content: '今晚聊聊吧。', name: '夜谈' }),
    ]);
  });

  it('拒绝删除固定字段和损坏的结构化关键字', async () => {
    const base = state();
    const workspace = new MemoryWorkspaceRepository({ files: projectCardWorkspace(base) });
    await workspace.remove('/character/scenario.md', 'remove-required');
    expect(() => materializeCardWorkspace(base, workspace.snapshot())).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );

    const broken = projectCardWorkspace(base);
    const entryFile = broken.find(item => item.resourceId === 'entry-library')!;
    entryFile.content = entryFile.content.replace("flags: iu", 'flags: "["');
    expect(() => materializeCardWorkspace(base, broken)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATTERN' }),
    );
  });

  it.each([
    ['enabled', 'yes'],
    ['probability', 101],
    ['effect', []],
    ['effect.cooldown', 'later'],
    ['position.role', 'developer'],
    ['position.type', 'somewhere'],
    ['strategy.type', 'random'],
    ['strategy.keys', 'keyword'],
    ['strategy.keys_secondary', []],
    ['strategy.keys_secondary.keys', 'secondary'],
    ['strategy.keys_secondary.logic', 'or'],
    ['strategy.scan_depth', null],
    ['extra', []],
  ])('拒绝非法世界书字段 %s', (fieldPath, value) => {
    const base = state();
    const files = projectCardWorkspace(base);
    const entryFile = files.find(item => item.resourceId === 'entry-library')!;
    const parsed = parseFrontmatter(entryFile.content, entryFile.path);
    const segments = fieldPath.split('.');
    let target = parsed.metadata;
    for (const segment of segments.slice(0, -1)) {
      target = target[segment] as Record<string, unknown>;
    }
    target[segments.at(-1)!] = value;
    entryFile.content = serializeFrontmatter(parsed.metadata, parsed.body);
    expect(() => materializeCardWorkspace(base, files)).toThrowError(expect.objectContaining({ code: 'INVALID_PATCH' }));
  });

  it('拒绝损坏的标签、绑定和开场白索引', () => {
    const base = state();
    const tagsBroken = projectCardWorkspace(base);
    tagsBroken.find(item => item.path === '/character/tags.yaml')!.content = 'tags: not-an-array\n';
    expect(() => materializeCardWorkspace(base, tagsBroken)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATCH' }),
    );

    const bindingsBroken = projectCardWorkspace(base);
    bindingsBroken.find(item => item.path === '/worldbooks/bindings.yaml')!.content =
      'additional: invalid\nchat: null\nprimary: null\n';
    expect(() => materializeCardWorkspace(base, bindingsBroken)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATCH' }),
    );

    const indexBroken = projectCardWorkspace(base);
    indexBroken.find(item => item.path === '/greetings/index.yaml')!.content = 'greetings: invalid\n';
    expect(() => materializeCardWorkspace(base, indexBroken)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATCH' }),
    );
  });

  it('拒绝开场白索引重复引用同一资源', () => {
    const base = state();
    const files = projectCardWorkspace(base);
    files.find(item => item.path === '/greetings/index.yaml')!.content = serializeYaml({
      greetings: [
        { file: '001-初见.md', id: 'greeting-1', name: '初见' },
        { file: '001-初见.md', id: 'greeting-1', name: '重复' },
      ],
    });
    expect(() => materializeCardWorkspace(base, files)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATCH' }),
    );
  });

  it('允许删除整个可写世界书，并永久保留不可安全往返的书', async () => {
    const base = state();
    base.worldbooks.push({
      entries: [],
      name: '旧格式书',
      resourceId: 'book-unsafe',
      roundTripSafe: false,
      unknownFields: { opaque: true },
      writable: true,
    });
    const workspace = new MemoryWorkspaceRepository({ files: projectCardWorkspace(base) });
    await workspace.remove(`/worldbooks/${encodeWorkspaceSegment('学院')}`, 'delete-book');
    const result = materializeCardWorkspace(base, workspace.snapshot()).state;
    expect(result.worldbooks.some(book => book.resourceId === 'book-academy')).toBe(false);
    expect(result.bindings).toMatchObject({ chat: null, primary: null });
    expect(result.worldbooks.find(book => book.resourceId === 'book-unsafe')).toMatchObject({
      roundTripSafe: false,
      unknownFields: { opaque: true },
    });
  });

  it('空聊天与空开场白不会制造占位文件', () => {
    const base = state();
    base.chat = [];
    base.character.greetings = [];
    const files = projectCardWorkspace(base);
    expect(files.some(item => item.path.startsWith('/context/chat/messages-'))).toBe(false);
    expect(materializeCardWorkspace(base, files).state.character.greetings).toEqual([]);
  });

  it('支持临时UID的新条目并为缺省可选字段补安全默认值', () => {
    const base = state();
    base.worldbooks[0].entries.push(
      entry({
        extra: undefined,
        name: '临时条目',
        resourceId: 'entry-temp-base',
        uid: 'temp:1234567890',
        unknownFields: {},
      }),
    );
    const files = projectCardWorkspace(base);
    const template = files.find(item => item.resourceId === 'entry-temp-base')!;
    const parsed = parseFrontmatter(template.content, template.path);
    delete parsed.metadata.extra;
    delete parsed.metadata.unknown_fields;
    parsed.metadata.uid = 'temp:new';
    files.push({
      ...template,
      content: serializeFrontmatter(parsed.metadata, '新建正文'),
      path: template.path.replace('entry-temp-base', 'new-entry').replace('0002-', '0003-'),
      resourceId: 'entry-new',
    });
    const result = materializeCardWorkspace(base, files).state;
    expect(result.worldbooks.find(book => book.resourceId === 'book-academy')?.entries.at(-1)).toMatchObject({
      content: '新建正文',
      extra: {},
      resourceId: 'entry-new',
      uid: 'temp:entry-new',
      unknownFields: {},
    });
  });

  it('缺少可选索引、作者与版本文件时使用稳定回退', async () => {
    const base = state();
    base.character.extensions = { foreign: true };
    base.bindings = { additional: [], chat: null, primary: null };
    const workspace = new MemoryWorkspaceRepository({ files: projectCardWorkspace(base) });
    await workspace.remove('/greetings/index.yaml', 'remove-index');
    await workspace.remove('/character/creator.md', 'remove-creator');
    await workspace.remove('/character/version.md', 'remove-version');
    const result = materializeCardWorkspace(base, workspace.snapshot()).state;
    expect(result.character.creator).toBe('作者');
    expect(result.character.version).toBe('1.2.0');
    expect(result.character.greetings).toHaveLength(2);
    expect(result.bindings).toEqual({ additional: [], chat: null, primary: null });
    expect(result.character.extensions.card_agent).toMatchObject({ binding_id: 'binding-alice' });
  });

  it('元数据省略可选安全标记时采用原对象或默认值', () => {
    const base = state();
    const files = projectCardWorkspace(base);
    const bookFile = files.find(item => item.resourceId === 'worldbook:book-academy:metadata')!;
    const metadata = parseYamlObject(bookFile.content, bookFile.path);
    delete metadata.round_trip_safe;
    delete metadata.unknown_fields;
    bookFile.content = serializeYaml(metadata);
    expect(materializeCardWorkspace(base, files).state.worldbooks.find(book => book.resourceId === 'book-academy')).toMatchObject(
      { roundTripSafe: true, unknownFields: { display: 'grid' } },
    );
  });

  it('拒绝缺少绑定文件和非字符串绑定', async () => {
    const base = state();
    const workspace = new MemoryWorkspaceRepository({ files: projectCardWorkspace(base) });
    await workspace.remove('/worldbooks/bindings.yaml', 'remove-bindings');
    expect(() => materializeCardWorkspace(base, workspace.snapshot())).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );

    const invalid = projectCardWorkspace(base);
    invalid.find(item => item.path === '/worldbooks/bindings.yaml')!.content =
      'additional: []\nchat: 1\nprimary: 学院\n';
    expect(() => materializeCardWorkspace(base, invalid)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PATCH' }),
    );
  });
});
