import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GREEN_CACHE_VARIABLE_PATH } from './green_cache';
import { publishSquashDebugRecord } from './debug';
import { captureFinalPrompt } from './debug_snapshot';
import { initSquashWithoutPanel } from './squash';
import { Settings } from './store';
import { entry, setupTavern } from './test-helpers';
import { createBuiltinWorldbookRule, createWorldbookRule, makeExtractionPlaceholder } from './worldbook_settings';

vi.mock('@util/script', () => ({
  registerAsUniqueScript: () => ({
    unregister: () => {},
    getPreferredScriptId: () => 'squash-test',
    listenPreferenceState: () => {},
  }),
}));
vi.mock('./debug', () => ({ publishSquashDebugRecord: vi.fn() }));

describe('世界书提示词处理', () => {
  let tavern: ReturnType<typeof setupTavern>;
  beforeEach(() => {
    vi.mocked(publishSquashDebugRecord).mockClear();
    tavern = setupTavern();
  });

  function start(worldbook: Record<string, unknown> = {}) {
    const settings = Settings.parse({
      entry_processing: { mode: 'worldbook', worldbook },
      chat_history: { type: 'squash_nearby' },
    });
    return initSquashWithoutPanel(settings);
  }

  it.each(['旧回复', ''])('普通生成与切换回复保持同一缓存锚点：末楼正文 %j', pendingText => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push({ mes: '开场', is_user: false }, { mes: '提问', is_user: true });
    const green = entry(1, '固定知识', { constant: false });
    const first = tavern.generate([green], { destinations: '' });
    const saved = structuredClone(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH));
    expect(saved.entries[0].fixed_at.message_id).toBe(1);
    tavern.data.chat.push({ mes: pendingText, is_user: false, swipe_id: 1, swipes: ['旧页', pendingText] });
    const swiped = tavern.generate([green], { type: 'swipe', activated: [], destinations: '' });
    expect(swiped).toEqual(first);
    expect([...tavern.injections.values()].find(prompt => prompt.content.includes('ANCHOR:1.0'))?.depth).toBe(0);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toEqual(saved);
    const history = vi.mocked(publishSquashDebugRecord).mock.calls.at(-1)![1].green_cache.request_history;
    expect(history).toMatchObject({ generation_type: 'swipe', message_ids: [0, 1], injection_message_ids: [0, 1] });
    tavern.data.chat[2].mes = '新的回复';
    tavern.data.chat[2].swipes[1] = '新的回复';
    const normal = tavern.generate([green], { activated: [], destinations: '' });
    expect(normal.slice(0, first.length)).toEqual(first);
    expect([...tavern.injections.values()].find(prompt => prompt.content.includes('ANCHOR:1.0'))?.depth).toBe(1);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toEqual(saved);
  });

  it('切换回复中新触发的绿灯固定到实际末层，不选择待生成的回复', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push(
      { mes: '开场', is_user: false },
      { mes: '提问', is_user: true },
      { mes: '', is_user: false, swipe_id: 1, swipes: ['旧页', ''] },
    );
    const result = tavern.generate([entry(1, '新知识', { constant: false })], { type: 'swipe', destinations: '' });
    expect(result).toEqual([
      { role: 'assistant', content: '开场' },
      { role: 'user', content: '提问' },
      { role: 'system', content: '新知识' },
    ]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries[0].fixed_at.message_id).toBe(1);
    const debug = vi.mocked(publishSquashDebugRecord).mock.calls.at(-1)![1];
    expect(debug.error_logs).toEqual([]);
    expect(debug.green_cache.chat_messages.find((message: any) => message.message_id === 2)).toMatchObject({
      in_request: false,
      anchor_eligible: false,
    });
  });

  it('重新生成删掉末层后不再重复排除前一条助手消息', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push({ mes: '开场', is_user: false }, { mes: '上一条回复', is_user: false });
    const green = entry(1, '固定知识', { constant: false });
    const first = tavern.generate([green], { destinations: '' });
    const saved = structuredClone(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH));
    tavern.data.chat.push({ mes: '重生成目标', is_user: false });
    expect(tavern.generate([green], { type: 'regenerate', activated: [], destinations: '' })).toEqual(first);
    expect(tavern.data.chat).toHaveLength(2);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toEqual(saved);
    expect([...tavern.injections.values()].find(prompt => prompt.content.includes('ANCHOR:1.0'))?.depth).toBe(0);
  });

  it('末层为用户时，重新生成保留该层', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push({ mes: '开场', is_user: false }, { mes: '用户输入', is_user: true });
    tavern.generate([entry(1, '知识', { constant: false })], { type: 'regenerate', destinations: '' });
    expect(tavern.data.chat).toHaveLength(2);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries[0].fixed_at.message_id).toBe(1);
  });

  it.each([false, true])('续写时稳定锚点不漂移，尾回复不作为新锚点：prefill=%s', prefill => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat_completion_settings.continue_prefill = prefill;
    tavern.data.chat.push({ mes: '开场', is_user: false }, { mes: '用户输入', is_user: true });
    const green = entry(1, '已有知识', { constant: false });
    tavern.generate([green], { destinations: '' });
    const fixed = structuredClone(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries[0]);
    tavern.data.chat.push({ mes: '已生成部分', is_user: false });
    const result = tavern.generate([green, entry(2, '新增知识', { constant: false })], {
      type: 'continue',
      activated: [2],
      destinations: '',
    });
    expect(result.map(message => message.content)).toEqual(['开场', '用户输入', '已有知识\n\n新增知识', '已生成部分']);
    const cached = _.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries;
    expect(cached.find((value: any) => value.uid === 1)).toEqual(fixed);
    expect(cached.every((value: any) => value.fixed_at.message_id === 1)).toBe(true);
    expect([...tavern.injections.values()].find(prompt => prompt.content.includes('ANCHOR:1.0'))?.depth).toBe(
      prefill ? 0 : 1,
    );
    expect([...tavern.injections.values()].some(prompt => prompt.content.includes('ANCHOR:2.'))).toBe(false);
  });

  it('开始事件之后追加的用户输入参与锚点计算', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push({ mes: '开场', is_user: false });
    tavern.generate([entry(1, '知识', { constant: false })], { userMessage: '新输入', destinations: '' });
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries[0].fixed_at.message_id).toBe(1);
  });

  it('准备后的空回复占位不改变请求历史和新锚点', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push({ mes: '开场', is_user: false }, { mes: '用户输入', is_user: true });
    tavern.generate([entry(1, '知识', { constant: false })], {
      destinations: '',
      beforeFinalize: () => {
        tavern.data.chat.push({ mes: '', is_user: false });
      },
    });
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries[0].fixed_at.message_id).toBe(1);
    expect(vi.mocked(publishSquashDebugRecord).mock.calls.at(-1)![1].green_cache.request_history.message_ids).toEqual([
      0, 1,
    ]);
  });

  it('准备后切换聊天不会把缓存写入新聊天', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push({ mes: '用户输入', is_user: true });
    tavern.generate([entry(1, '知识', { constant: false })], {
      beforeFinalize: () => vi.stubGlobal('SillyTavern', { ...SillyTavern, getCurrentChatId: () => 'other-chat' }),
    });
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toBeUndefined();
  });

  it('合并静态蓝灯，并统一排序关键词组内的动态蓝灯和绿灯', () => {
    start();
    const result = tavern.generate(
      [entry(3, '动态{{clock}}'), entry(1, '静态'), entry(2, '绿灯', { constant: false })],
      { macros: text => text.replace('{{clock}}', '12:00') },
    );
    expect(result).toEqual([{ role: 'system', content: '静态|绿灯\n动态12:00' }]);
  });

  it('固定绿灯后不重复提取，并在未再次触发时回放', () => {
    start({ aggressive_green_cache: { enabled: true } });
    const green = entry(1, '固定绿灯', { constant: false });
    const first = tavern.generate([green]);
    expect(first).toEqual([{ role: 'system', content: '固定绿灯\n\n|' }]);
    const cache = _.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH);
    expect(cache.entries).toHaveLength(1);
    expect(cache.entries[0].fixed_at.message_id).toBeNull();
    expect(tavern.generate([green], { activated: [] })).toEqual(first);
    expect(tavern.generate([green])).toEqual(first);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries).toHaveLength(1);
  });

  it('标题提取接管绿灯时不创建固定缓存', () => {
    start({
      aggressive_green_cache: { enabled: true },
      custom_routes: [{ title_regex: '/TavernDB-ACU-(.*)/gi', tag: 'sp_memory' }],
    });
    expect(
      tavern.generate([entry(1, '记忆', { comment: 'TavernDB-ACU-memory', constant: false })], {
        destinations: '{{压缩相邻消息::lora_custom::sp_memory}}|{{压缩相邻消息::lora_key}}',
      }),
    ).toEqual([{ role: 'system', content: '记忆|' }]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toBeUndefined();
  });

  it('混合引用按处理单元分流，同时保留聚合条目的匹配身份', () => {
    start();
    const entries = [
      entry(1, '固定设定', { comment: '静态' }),
      entry(2, '状态{{clock}}', { comment: '动态' }),
      entry(3, "<%- await getwi('静态') -%>\n<%- await getwi('动态') -%>", { comment: '聚合' }),
    ];
    const render = (text: string) =>
      text.replace("<%- await getwi('静态') -%>", '固定设定').replace("<%- await getwi('动态') -%>", '状态12:00');
    expect(tavern.generate(entries, { activated: [3], template: render })).toEqual([
      { role: 'system', content: '固定设定|状态12:00' },
    ]);
  });

  it('自定义聚合规则统一接管两个引用部分', () => {
    start({ custom_routes: [{ title_regex: '^聚合$', tag: 'merged' }] });
    const entries = [
      entry(1, '固定设定', { comment: '静态' }),
      entry(2, '{{clock}}', { comment: '动态' }),
      entry(3, "<%- await getwi('静态') -%>\n<%- await getwi('动态') -%>", { comment: '聚合' }),
    ];
    expect(
      tavern.generate(entries, {
        activated: [3],
        destinations: '{{压缩相邻消息::merged}}',
        template: text =>
          text.replace("<%- await getwi('静态') -%>", '固定设定').replace("<%- await getwi('动态') -%>", '12:00'),
      }),
    ).toEqual([{ role: 'system', content: '固定设定\n12:00' }]);
  });

  it('固定缓存保持真实楼层和 swipe，后续新增楼层不改变锚点', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push({ mes: '第一轮', is_user: true, swipe_id: 0, swipes: ['第一轮'] });
    const green = entry(1, '固定设定', { constant: false });
    expect(tavern.generate([green], { destinations: '' })).toEqual([
      { role: 'user', content: '第一轮' },
      { role: 'system', content: '固定设定' },
    ]);
    const fixed = _.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries[0];
    expect(fixed.fixed_at).toMatchObject({ message_id: 0, swipe_id: 0 });
    tavern.data.chat.push({ mes: '第二轮', is_user: false });
    expect(tavern.generate([green], { activated: [], destinations: '' })).toEqual([
      { role: 'user', content: '第一轮' },
      { role: 'system', content: '固定设定' },
      { role: 'assistant', content: '第二轮' },
    ]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries[0]).toEqual(fixed);
  });

  it('更高优先级规则接管时暂停缓存回放，缓存记录保持可复用', () => {
    start({ aggressive_green_cache: { enabled: true }, custom_routes: [{ title_regex: '^记忆$', tag: 'memory' }] });
    const green = entry(1, '记忆正文', { constant: false, comment: '记忆' });
    tavern.generate([green]);
    const saved = _.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH);
    expect(tavern.generate([green], { destinations: '{{压缩相邻消息::memory}}' })).toEqual([
      { role: 'system', content: '记忆正文' },
    ]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toEqual(saved);
    expect(tavern.generate([green], { activated: [], destinations: '{{压缩相邻消息::memory}}' })).toEqual([]);
    expect(tavern.generate([green], { activated: [], destinations: '' })).toEqual([
      { role: 'system', content: '记忆正文' },
    ]);
  });

  it('原生隐藏楼层不成为新的绿灯固定锚点', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push(
      { mes: '保留的用户楼层', is_user: true, is_system: false },
      { mes: '已经隐藏的回复', is_user: false, is_system: true },
    );
    const result = tavern.generate([entry(1, '固定设定', { constant: false })], { destinations: '' });
    expect(result).toEqual([
      { role: 'user', content: '保留的用户楼层' },
      { role: 'system', content: '固定设定' },
    ]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries[0].fixed_at.message_id).toBe(0);
  });

  it('锚点深度只计算未隐藏楼层，隐藏锚点暂停回放而不迁移', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push({ mes: '最初的用户楼层', is_user: true, is_system: false });
    const green = entry(1, '固定设定', { constant: false });
    tavern.generate([green], { destinations: '' });
    const saved = _.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH);
    tavern.data.chat.push(
      { mes: '已经隐藏的回复', is_user: false, is_system: true },
      { mes: '最新用户楼层', is_user: true, is_system: false },
    );
    tavern.generate([green], { activated: [], destinations: '' });
    const anchor = [...tavern.injections.values()].find(prompt => prompt.content.includes('ANCHOR:0.0'));
    expect(anchor?.depth).toBe(1);
    tavern.data.chat[0].is_system = true;
    expect(tavern.generate([green], { activated: [], destinations: '' })).toEqual([
      { role: 'user', content: '最新用户楼层' },
    ]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toEqual(saved);
    expect([...tavern.injections.values()].some(prompt => prompt.content.includes('ANCHOR:0.0'))).toBe(false);
    tavern.data.chat[0].is_system = false;
    expect(tavern.generate([green], { activated: [], destinations: '' })).toEqual([
      { role: 'user', content: '最初的用户楼层' },
      { role: 'system', content: '固定设定' },
      { role: 'user', content: '最新用户楼层' },
    ]);
  });

  it('条目停用时暂停缓存回放，重新启用后沿用原锚点', () => {
    start({ aggressive_green_cache: { enabled: true } });
    const green = entry(1, '固定设定', { constant: false });
    tavern.generate([green], { destinations: '' });
    const saved = _.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH);
    expect(tavern.generate([{ ...green, disable: true }], { destinations: '' })).toEqual([]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toEqual(saved);
    expect(tavern.generate([green], { activated: [], destinations: '' })).toEqual([
      { role: 'system', content: '固定设定' },
    ]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toEqual(saved);
  });

  it('停用期间的正文更新淘汰旧快照，UID 重映射仍遵守停用状态', () => {
    start({ aggressive_green_cache: { enabled: true } });
    const green = entry(1, '旧设定', { constant: false });
    tavern.generate([green], { destinations: '' });
    expect(tavern.generate([{ ...green, uid: 9, disable: true }], { destinations: '' })).toEqual([]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH).entries[0].uid).toBe(9);
    expect(tavern.generate([{ ...green, uid: 9, disable: true, content: '新设定' }], { destinations: '' })).toEqual([]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toBeUndefined();
    expect(tavern.generate([{ ...green, uid: 9, content: '新设定' }], { activated: [], destinations: '' })).toEqual([]);
  });

  it('正文和来源筛选只接管匹配条目，同文条目保留各自身份', () => {
    start({
      rules: [
        createWorldbookRule({
          sources: ['character_additional'],
          target: 'content',
          pattern: '^相同正文$',
          placeholder: makeExtractionPlaceholder('selected'),
        }),
      ],
    });
    const result = tavern.generate([entry(1, '相同正文'), entry(1, '相同正文', { world: '补充' })], {
      destinations: '<选中>{{压缩相邻消息::selected}}</选中>',
    });
    expect(result).toEqual([{ role: 'system', content: '相同正文\n\n<选中>相同正文</选中>' }]);
  });

  it('缓存开关关闭后不回放也不删除记录', () => {
    const runtime = start({ aggressive_green_cache: { enabled: true } });
    const green = entry(1, '固定设定', { constant: false });
    tavern.generate([green]);
    const saved = _.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH);
    runtime.destroy();
    start({ aggressive_green_cache: { enabled: false } });
    expect(tavern.generate([green], { activated: [], destinations: '' })).toEqual([]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toEqual(saved);
  });

  it('缓存正文更新或锚点楼层正文变化后不回放旧快照', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.data.chat.push({ mes: '第一轮', is_user: true });
    const green = entry(1, '旧设定', { constant: false });
    tavern.generate([green]);
    expect(tavern.generate([{ ...green, content: '新设定' }], { activated: [], destinations: '' })).toEqual([
      { role: 'user', content: '第一轮' },
    ]);
    tavern.generate([green]);
    tavern.data.chat[0].mes = '编辑后的第一轮';
    expect(tavern.generate([green], { activated: [], destinations: '' })).toEqual([
      { role: 'user', content: '编辑后的第一轮' },
    ]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toBeUndefined();
  });

  it('来源不再可用时暂停该来源的缓存', () => {
    start({ aggressive_green_cache: { enabled: true } });
    tavern.generate([entry(1, '固定设定', { constant: false })]);
    const saved = _.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH);
    expect(tavern.generate([], { destinations: '' })).toEqual([]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toEqual(saved);
  });

  it('找不到实际展开正文时保留原位置内容', () => {
    start();
    expect(tavern.generate([entry(1, '原始正文')], { render: () => '不可定位的新正文' })).toEqual([
      { role: 'system', content: '不可定位的新正文\n\n|' },
    ]);
  });

  it('目标仅存在于被提取正文内时保留原位置内容', () => {
    start({ rules: [createWorldbookRule({ placeholder: '{{压缩相邻消息::target}}' })] });
    const result = tavern.generate([entry(1, '正文{{压缩相邻消息::target}}')], { destinations: '' });
    expect(result).toEqual([{ role: 'system', content: '正文' }]);
  });

  it('下方规则的目标落在自身正文内时继续尝试上方规则', () => {
    start({
      rules: [
        createWorldbookRule({ placeholder: '{{压缩相邻消息::fallback}}' }),
        createWorldbookRule({ placeholder: '{{压缩相邻消息::target}}' }),
      ],
    });
    expect(
      tavern.generate([entry(1, '正文{{压缩相邻消息::target}}')], {
        destinations: '<上方>{{压缩相邻消息::fallback}}</上方>',
      }),
    ).toEqual([{ role: 'system', content: '<上方>正文</上方>' }]);
  });

  it('预演不生成 Debug、不写入绿灯缓存，也不在源条目加入临时包裹', () => {
    start({ aggressive_green_cache: { enabled: true } });
    const render = vi.fn((text: string) => text.replace('{{clock}}', '12:00'));
    const result = tavern.generate([entry(1, '静态绿灯', { constant: false }), entry(2, '{{clock}}')], {
      dryRun: true,
      render,
    });
    expect(publishSquashDebugRecord).not.toHaveBeenCalled();
    expect(replaceVariables).not.toHaveBeenCalled();
    expect(render.mock.calls.every(([text]) => !text.includes('§§TH_SQUASH'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('压缩相邻消息::');
    expect(JSON.stringify(result)).not.toContain('§§TH_SQUASH');
  });

  it('正式记录保存最终压缩结果，重复事件不重复处理', () => {
    start();
    const result = tavern.generate([entry(1, '设定')]);
    expect(publishSquashDebugRecord).toHaveBeenCalledOnce();
    const [, state, generation] = vi.mocked(publishSquashDebugRecord).mock.calls[0];
    expect(state.final_prompt).toEqual(captureFinalPrompt(result));
    expect(Array.isArray(state.prompt_rows)).toBe(true);
    expect(generation).toMatchObject({
      dry_run: false,
      type: 'normal',
      character_name: '测试角色',
      chat_id: 'test-chat',
      event: 'chat_completion_settings_ready',
    });
    tavern.emit('GENERATE_AFTER_DATA', { prompt: result }, false);
    expect(publishSquashDebugRecord).toHaveBeenCalledOnce();
  });

  it('正式请求后的预演不覆盖记录，后台生成作为独立请求保留', () => {
    start();
    const entries = [entry(1, '设定')];
    tavern.generate(entries);
    tavern.generate(entries, { dryRun: true });
    tavern.generate(entries, { dryRun: true });
    expect(publishSquashDebugRecord).toHaveBeenCalledOnce();
    tavern.generate(entries, { type: 'quiet' });
    expect(publishSquashDebugRecord).toHaveBeenCalledTimes(2);
    expect(vi.mocked(publishSquashDebugRecord).mock.calls[1][2]).toMatchObject({
      type: 'quiet',
      skipped_previews: 2,
      dry_run: false,
    });
  });

  it('独立扫描只读，交错副扫描不会覆盖已准备的主请求', () => {
    start();
    const auxiliary = tavern.scan([entry(1, '副扫描{{clock}}')], {
      macros: text => text.replace('{{clock}}', '08:00'),
    });
    expect(auxiliary.loaded.characterLore[0].content).toBe('副扫描{{clock}}');
    expect(auxiliary.content).toBe('副扫描08:00');
    expect(publishSquashDebugRecord).not.toHaveBeenCalled();
    const result = tavern.generate([entry(1, '主请求')], {
      beforeFinalize: () => {
        const scanned = tavern.scan([entry(1, '另一份副扫描')]);
        expect(scanned.content).toBe('另一份副扫描');
        expect(JSON.stringify(scanned)).not.toContain('§§TH_SQUASH');
      },
    });
    expect(result).toEqual([{ role: 'system', content: '主请求|' }]);
    expect(publishSquashDebugRecord).toHaveBeenCalledOnce();
  });

  it('模板展开并替换请求数组后仍按本次请求提取，只保存最终正文', () => {
    start();
    const result = tavern.generate([entry(1, '<%= value %>')], {
      template: text => text.replace('<%= value %>', '已展开状态'),
      replaceMessages: messages => structuredClone(messages),
    });
    expect(result).toEqual([{ role: 'system', content: '|已展开状态' }]);
    expect(vi.mocked(publishSquashDebugRecord).mock.calls[0][1].final_prompt).toEqual(captureFinalPrompt(result));
    expect(JSON.stringify(vi.mocked(publishSquashDebugRecord).mock.calls[0][1].total_rows)).not.toContain('<%= value');
    expect(JSON.stringify(result)).not.toContain('§§TH_SQUASH');
  });

  it('预演和未归属的裸请求不会消费主请求的待处理条目', () => {
    start();
    const raw = [{ role: 'system', content: '主请求' }];
    const result = tavern.generate([entry(1, '主请求')], {
      type: 'swipe',
      beforeFinalize: () => {
        tavern.generate([entry(1, '预演正文')], { dryRun: true });
        tavern.emit('CHAT_COMPLETION_SETTINGS_READY', { messages: raw });
      },
    });
    expect(raw).toEqual([{ role: 'system', content: '主请求' }]);
    expect(result).toEqual([{ role: 'system', content: '主请求|' }]);
    expect(publishSquashDebugRecord).toHaveBeenCalledOnce();
    expect(vi.mocked(publishSquashDebugRecord).mock.calls[0][2]?.type).toBe('swipe');
  });

  it('动态正则仅由原流程执行一次，提取阶段保留原位', () => {
    start({ aggressive_green_cache: { enabled: true } });
    vi.stubGlobal('getTavernRegexes', ({ type }: { type: string }) =>
      type === 'global'
        ? [
            {
              enabled: true,
              find_regex: '^正文$',
              replace_string: '{{random}}',
              trim_strings: [],
              source: { world_info: true },
              destination: { prompt: true },
              min_depth: null,
              max_depth: null,
            },
          ]
        : [],
    );
    const format = vi.fn((text: string) => `${text}-实际结果`);
    vi.stubGlobal('formatAsTavernRegexedString', format);
    const result = tavern.generate([entry(1, '正文', { constant: false })]);
    expect(result).toEqual([{ role: 'system', content: '正文-实际结果\n\n|' }]);
    expect(format).toHaveBeenCalledOnce();
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toBeUndefined();
  });

  it('确定性正则改写后的完整正文仍可提取', () => {
    start();
    vi.stubGlobal('formatAsTavernRegexedString', (text: string) => text.replace('原文', '最终正文'));
    expect(tavern.generate([entry(1, '原文')])).toEqual([{ role: 'system', content: '最终正文|' }]);
  });

  it('请求准备后重载设置仍清理边界并保留正文', () => {
    const runtime = start();
    const result = tavern.generate([entry(1, '保留正文')], {
      beforeFinalize: () => {
        runtime.destroy();
        start();
      },
    });
    expect(result).toEqual([{ role: 'system', content: '保留正文\n\n|' }]);
    expect(JSON.stringify(result)).not.toContain('§§TH_SQUASH');
  });

  it('旧版仅设置就绪事件也能处理普通条目', () => {
    vi.stubGlobal('getTavernVersion', () => '1.13.4');
    start();
    expect(tavern.generate([entry(1, '普通正文')])).toEqual([{ role: 'system', content: '普通正文|' }]);
  });

  it('RUBY 按聊天绑定书和输出键归组，同键多条目可合并，其他书不受影响', () => {
    tavern.data.character.data.extensions.RubyAnalyzer = {
      activePresetId: 'p',
      presets: [{ id: 'p', tasks: [{ outputKey: '我的输出键' }] }],
    };
    const ruby = createBuiltinWorldbookRule('ruby-output');
    start({ rules: [ruby] });
    const result = tavern.generate([entry(3, '其他书正文', { key: ['我的输出键'] })], {
      destinations: '<结果>{{压缩相邻消息::ruby_state}}</结果>',
      activated: [1, 2, 3],
      lores: {
        globalLore: [
          entry(1, '分析甲', { world: '聊天书', key: ['我的输出键'], constant: false }),
          entry(2, '分析乙', { world: '聊天书', key: ['我的输出键'] }),
        ],
      },
    });
    expect(result).toEqual([{ role: 'system', content: '其他书正文\n\n<结果>分析甲\n分析乙</结果>' }]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toBeUndefined();
  });

  it('RUBY 更新内容与输出关键词后按新配置识别，缓存资格不覆盖专属识别', () => {
    const config = { presets: [{ id: 'p', tasks: [{ outputKey: '输出' }] }] };
    tavern.data.character.data.extensions.RubyAnalyzer = config;
    const ordinary = createBuiltinWorldbookRule('green');
    ordinary.aggressive_green_cache = true;
    const ruby = createBuiltinWorldbookRule('ruby-output');
    ruby.aggressive_green_cache = true;
    start({ rules: [ordinary, ruby] });
    const content = entry(1, '旧状态', { world: '聊天书', key: ['输出'], constant: false });
    expect(tavern.generate([content], { destinations: ruby.placeholder })).toEqual([
      { role: 'system', content: '旧状态' },
    ]);
    expect(tavern.generate([{ ...content, content: '新状态' }], { destinations: ruby.placeholder })).toEqual([
      { role: 'system', content: '新状态' },
    ]);
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toBeUndefined();
    config.presets[0].tasks[0].outputKey = '新的输出';
    expect(
      tavern.generate([{ ...content, content: '新的归组', key: ['新的输出'] }], { destinations: ruby.placeholder }),
    ).toEqual([{ role: 'system', content: '新的归组' }]);
  });

  it('柏宝书只搬运已选择的专属槽，保持其他扩展与原注册内容不变', () => {
    Object.assign(window, { STBaiBaiBook: { apiVersion: 1, getSnapshot() {} } });
    const slots = tavern.data.extension_prompts;
    slots.baibai_book_memory_state = { value: '当前状态', position: 1, depth: 2 };
    slots.another_plugin = { value: '其他插件正文', position: 1, depth: 0 };
    start({ rules: [createBuiltinWorldbookRule('baibai-state')] });
    expect(tavern.generate([], { destinations: '<状态>{{压缩相邻消息::bbs_state}}</状态>' })).toEqual([
      { role: 'system', content: '其他插件正文\n\n\n<状态>当前状态</状态>' },
    ]);
    expect(slots.baibai_book_memory_state.value).toBe('当前状态');
    expect(slots.another_plugin.value).toBe('其他插件正文');
    expect(_.get(tavern.data.variables, GREEN_CACHE_VARIABLE_PATH)).toBeUndefined();
    expect(
      vi.mocked(publishSquashDebugRecord).mock.calls[0][1].total_rows.some((row: any) => row.类型 === '插件注入'),
    ).toBe(true);
  });

  it('柏宝书同文注入不唯一时保留原位，停用槽不会复活', () => {
    Object.assign(window, { STBaiBaiBook: { apiVersion: 1, getSnapshot() {} } });
    const slots = tavern.data.extension_prompts;
    slots.baibai_book_memory_state = { value: '同文状态', position: 1, depth: 1 };
    slots.other = { value: '同文状态', position: 1, depth: 0 };
    start({ rules: [createBuiltinWorldbookRule('baibai-state')] });
    const result = tavern.generate([], { destinations: '{{压缩相邻消息::bbs_state}}' });
    expect(JSON.stringify(result).match(/同文状态/g)).toHaveLength(2);
    slots.baibai_book_memory_state.value = '';
    expect(tavern.generate([], { destinations: '{{压缩相邻消息::bbs_state}}' })).toEqual([
      { role: 'system', content: '同文状态\n' },
    ]);
  });

  it('保留原位阻止上方规则接管，并保持模板展开后的真实内容', () => {
    const ordinary = createBuiltinWorldbookRule('blue-static');
    const keep = createBuiltinWorldbookRule('blue-static');
    keep.action = 'keep';
    keep.content = 'all';
    start({ rules: [ordinary, keep] });
    const result = tavern.generate([entry(1, '<%= value %>')], {
      destinations: ordinary.placeholder,
      template: text => text.replace('<%= value %>', '展开正文'),
    });
    expect(result).toEqual([{ role: 'system', content: '展开正文' }]);
    expect(vi.mocked(publishSquashDebugRecord).mock.calls[0][1].triggered_rows[0].row).toMatchObject({
      提取状态: '保留原位',
      详细内容: '展开正文',
    });
  });

  it('预处理异常恢复完整正文，不遗留请求内标记', () => {
    start();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    vi.stubGlobal('formatAsTavernRegexedString', (text: string) => {
      if (++calls === 2) throw new Error('formatter failed');
      return text;
    });
    const result = tavern.generate([entry(1, '完整正文')]);
    expect(result).toEqual([{ role: 'system', content: '完整正文\n\n|' }]);
    expect(JSON.stringify(result)).not.toContain('§§TH_SQUASH');
  });

  it('整理异常恢复原请求正文，并清理边界及占位符', () => {
    start({ aggressive_green_cache: { enabled: true } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = tavern.generate([entry(1, '完整绿灯', { constant: false })], {
      beforeFinalize: () =>
        vi.stubGlobal('getVariables', () => {
          throw new Error('variables unavailable');
        }),
    });
    expect(JSON.stringify(result)).toContain('完整绿灯');
    expect(JSON.stringify(result)).not.toContain('§§TH_SQUASH');
    expect(JSON.stringify(result)).not.toContain('压缩相邻消息');
  });

  it('空规则列表保持原文，已删除规则的命名空间占位符为空', () => {
    start({ rules: [] });
    expect(tavern.generate([entry(1, '原文')], { destinations: '{{压缩相邻消息::bbs_history}}' })).toEqual([
      { role: 'system', content: '原文' },
    ]);
  });

  it('世界书与柏宝书共用提取词时统一排序合并', () => {
    Object.assign(window, { STBaiBaiBook: { apiVersion: 1, getSnapshot() {} } });
    tavern.data.extension_prompts.baibai_book_memory_state = { value: '当前状态', position: 1, depth: 1 };
    const ordinary = createBuiltinWorldbookRule('blue-static');
    ordinary.placeholder = '{{压缩相邻消息::shared}}';
    const baibai = createBuiltinWorldbookRule('baibai-state');
    baibai.placeholder = ordinary.placeholder;
    start({ rules: [ordinary, baibai] });
    expect(tavern.generate([entry(1, '固定设定')], { destinations: ordinary.placeholder })).toEqual([
      { role: 'system', content: '固定设定\n当前状态' },
    ]);
  });

  it('替换数组后原数组也不遗留临时标记，重复准备不产生第二份记录', () => {
    start();
    let original: SillyTavern.SendingMessage[] = [];
    let repeated = false;
    eventOn(tavern_events.GENERATE_AFTER_DATA, ({ prompt }) => {
      original = prompt;
      if (!repeated) {
        repeated = true;
        tavern.emit('GENERATE_AFTER_DATA', { prompt: structuredClone(prompt) }, false);
      }
    });
    const result = tavern.generate([entry(1, '正文')], { replaceMessages: messages => structuredClone(messages) });
    expect(result).toEqual([{ role: 'system', content: '正文|' }]);
    expect(JSON.stringify(original)).not.toContain('§§TH_SQUASH');
    expect(publishSquashDebugRecord).toHaveBeenCalledOnce();
  });

  it('重载后缺少分隔符的遗留请求也能清理全部临时边界', () => {
    const runtime = start();
    const result = tavern.generate([entry(1, '保留正文')], {
      beforeFinalize: () => {
        runtime.destroy();
        start();
      },
      template: text => text.replaceAll('【【压缩相邻消息-聊天记录开头】】', ''),
    });
    expect(JSON.stringify(result)).toContain('保留正文');
    expect(JSON.stringify(result)).not.toContain('§§TH_SQUASH');
    expect(JSON.stringify(result)).not.toContain('压缩相邻消息');
  });
});
