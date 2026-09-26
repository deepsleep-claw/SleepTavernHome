import { createApp, h, reactive, type VNode } from 'vue';
import { type BridgeConfig, type GlobalConfig, DEFAULT_CONFIG, DEFAULT_GLOBAL_CONFIG, VERSION, validateConfig, modelMatches, resolveProtocol } from '../shared/config';
import type { BackendStatus } from './fetch';

type Draft = Omit<BridgeConfig, 'tools'> & { tools: (BridgeConfig['tools'][number] & { schemaText: string })[] };
interface Actions {
  save: (value: BridgeConfig, name: string) => Promise<void>;
  saveGlobal: (value: GlobalConfig) => GlobalConfig;
  probe: () => Promise<BackendStatus | null>;
}

export function mountPanel(element: HTMLElement, actions: Actions) {
  const draft = (config: BridgeConfig): Draft => ({ ...structuredClone(config), tools: config.tools.map(tool => ({ ...structuredClone(tool), schemaText: JSON.stringify(tool.parameters, null, 2) })) });
  const state = reactive({ config: draft(DEFAULT_CONFIG), global: { ...DEFAULT_GLOBAL_CONFIG }, model: '', source: '', preset: '', status: '正在检测后端…', backend: null as BackendStatus | null, error: '', message: '', busy: false, dirty: false });
  const changed = () => { state.dirty = true; state.message = ''; };
  const field = (label: string, value: string, update: (value: string) => void, multi = false): VNode => h('label', { class: ['tob-field', multi && 'tob-field-wide'] }, [
    h('span', label), h(multi ? 'textarea' : 'input', { class: 'text_pole', type: multi ? undefined : 'text', value, rows: multi ? 5 : undefined, onInput: (event: Event) => { update((event.target as HTMLInputElement).value); changed(); } }),
  ]);
  const check = (label: string, value: boolean, update: (value: boolean) => void, preset = true): VNode => h('label', { class: 'checkbox_label tob-checkbox' }, [
    h('input', { type: 'checkbox', class: 'checkbox', checked: value, onChange: (event: Event) => { update((event.target as HTMLInputElement).checked); if (preset) changed(); } }), h('span', label),
  ]);
  const select = (label: string, value: string, choices: [string, string][], update: (value: string) => void): VNode => h('label', { class: 'tob-field' }, [
    h('span', label), h('select', { class: 'text_pole', value, onChange: (event: Event) => { update((event.target as HTMLSelectElement).value); changed(); } }, choices.map(([id, text]) => h('option', { value: id }, text))),
  ]);
  const button = (label: string, click: () => void, disabled = false) => h('button', { type: 'button', class: 'menu_button', disabled, onClick: click }, label);
  const hint = (text: string) => h('small', { class: 'tob-hint' }, text);
  const drawer = (title: string, children: (VNode | null)[], main = false): VNode => h('div', { class: ['inline-drawer', main ? 'tob-panel' : 'tob-section'] }, [
    h('div', { class: 'inline-drawer-toggle inline-drawer-header', role: 'button', tabindex: 0, onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (event.currentTarget as HTMLElement).click(); }
    } }, [h('b', title), h('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' })]),
    h('div', { class: 'inline-drawer-content' }, children),
  ]);
  const saveGlobal = (patch: Partial<GlobalConfig>) => {
    state.error = '';
    try { state.global = actions.saveGlobal({ ...state.global, ...patch }); }
    catch (error) { state.error = error instanceof Error ? error.message : String(error); }
  };
  const probe = async () => {
    state.status = '正在检测后端…';
    state.backend = await actions.probe();
    state.status = state.backend ? `后端已连接 · ${state.backend.host.name} ${state.backend.host.version} · 插件 ${state.backend.version}` : '前端适配模式 · 使用宿主的原生生成接口';
  };
  const app = createApp({ setup: () => () => {
    const c = state.config;
    const protocol = resolveProtocol(state.source, c.googleMode);
    const protocolName = protocol ? { openai: 'OpenAI 兼容工具', gemini: 'Gemini 原生工具', vertex: 'Vertex 工具', interactions: 'Gemini Interactions' }[protocol] : '当前接口不支持工具正文';
    const activeStatus = !state.global.enabled ? '全局开关已关闭' : !state.model ? '等待选择模型' : !modelMatches(state.model, state.global.modelNameIncludes) ? '模型名称未匹配' : !protocol ? '当前接口不支持工具正文' : '模型名称已匹配，普通聊天请求将启用工具正文';
    return drawer(`基米工具 ${VERSION}`, [
      check('启用基米工具（全局）', state.global.enabled, enabled => saveGlobal({ enabled }), false),
      h('label', { class: 'tob-field' }, [h('span', '模型名称包含'), h('input', { class: 'text_pole', type: 'text', value: state.global.modelNameIncludes, maxlength: 128, onChange: (event: Event) => {
        const input = event.target as HTMLInputElement; saveGlobal({ modelNameIncludes: input.value }); input.value = state.global.modelNameIncludes;
      } })]),
      hint('不区分大小写，例如 Gemini。全局设置自动保存，对当前用户的所有聊天补全预设生效。'),
      h('p', { class: 'tob-status', role: 'status' }, `当前模型：${state.model || '尚未选择'} · ${activeStatus}`),
      h('p', { class: 'tob-status' }, state.status),
      h('div', { class: 'tob-actions' }, [button('重新检测后端', () => { void probe(); })]),
      h('hr'),
      h('p', ['当前聊天补全预设：', h('strong', state.preset || '尚未选择')]),
      check('同时保留模型原来的正文', c.keepOriginalText, value => { c.keepOriginalText = value; }),
      select('工具选择', c.forceMode, [['auto', '自动选择'], ['required', '必须调用工具'], ['named', '必须调用指定正文工具']], value => { c.forceMode = value as BridgeConfig['forceMode']; }),
      c.forceMode === 'named' ? select('指定正文工具', c.forcedTool, c.tools.filter(tool => tool.enabled).map(tool => [tool.name, tool.name]), value => { c.forcedTool = value; }) : null,
      field('工具正文分隔符', c.separator, value => { c.separator = value; }, true),
      drawer('提示词', [
        check('注入提示词', c.promptEnabled, value => { c.promptEnabled = value; }),
        field('提示词内容', c.prompt, value => { c.prompt = value; }, true),
        hint('支持 {{tool_names}} 和 {{tool_outputs}} 占位符。提示词作为系统消息加入当前请求。'),
      ]),
      drawer(`正文工具 (${c.tools.length})`, [
        ...c.tools.map((tool, index) => h('fieldset', { key: index, class: 'tob-tool' }, [
          h('legend', `工具 ${index + 1}`), check('启用此工具', tool.enabled, value => { tool.enabled = value; }),
          field('名称', tool.name, value => { const previous = tool.name; tool.name = value; if (c.forcedTool === previous) c.forcedTool = value; }),
          field('说明', tool.description, value => { tool.description = value; }, true),
          field('参数 JSON Schema', tool.schemaText, value => { tool.schemaText = value; }, true),
          field('正文字段路径', tool.outputPath, value => { tool.outputPath = value; }),
          hint('例如 text、story.text、chapters[0].text 或 /story/text。目标字段须为字符串。'),
          h('div', { class: 'tob-actions' }, [button('删除工具', () => { c.tools.splice(index, 1); changed(); })]),
        ])),
        h('div', { class: 'tob-actions' }, [button('添加工具', () => {
          let suffix = c.tools.length + 1; while (c.tools.some(tool => tool.name === `publish_story_${suffix}`)) suffix++;
          c.tools.push({ ...draft(DEFAULT_CONFIG).tools[0], name: `publish_story_${suffix}` }); changed();
        }, c.tools.length >= 32)]),
      ]),
      drawer('接口适配', [
        select('接口模式', c.googleMode, [['auto', '自动检测（推荐）'], ['native', '宿主原生接口'], ['interactions', 'AI Studio Interactions（需要后端）']], value => { c.googleMode = value as BridgeConfig['googleMode']; }),
        h('p', { class: 'tob-status' }, `当前适配：${protocolName}`),
        hint('自动模式按当前请求来源选择 OpenAI 兼容、Gemini 或 Vertex 工具格式。'),
        check('为支持的 Vertex 模型启用参数流', c.streamArguments, value => { c.streamArguments = value; }),
        hint('后端可为支持的 Gemini 3 系列 Vertex 模型启用参数增量。AI Studio 原生接口是否逐段返回参数取决于上游；Interactions 使用参数增量事件。'),
        c.googleMode === 'interactions' ? hint('Interactions 使用完整历史和 store=false；该接口的采样配置与 generateContent 不同，温度、top-p、top-k 与数值思考预算不会传入。') : null,
      ]),
      h('p', { role: 'alert', class: 'tob-error' }, state.error),
      h('p', { role: 'status' }, state.message || (state.dirty ? '有未保存的预设修改' : '')),
      h('div', { class: 'tob-actions' }, [button(state.busy ? '正在保存…' : '保存到当前预设', async () => {
        state.busy = true; state.error = ''; state.message = '';
        const name = state.preset;
        try {
          const snapshot: Draft = JSON.parse(JSON.stringify(c));
          const config = validateConfig({ ...snapshot, enabled: true, tools: snapshot.tools.map(({ schemaText, ...tool }) => ({ ...tool, parameters: JSON.parse(schemaText) })) });
          await actions.save(config, name);
          if (state.preset === name) { state.dirty = false; state.message = '已保存。'; }
        } catch (error) { state.error = error instanceof Error ? error.message : String(error); }
        finally { state.busy = false; }
      }, state.busy || !state.preset)]),
    ], true);
  } });
  app.mount(element);
  return {
    state, probe,
    load(config: BridgeConfig, preset: string) { state.config = draft(config); state.preset = preset; state.dirty = false; state.error = ''; state.message = ''; },
    loadGlobal(config: GlobalConfig, model: string, source: string) { state.global = { ...config }; state.model = model; state.source = source; },
    destroy: () => app.unmount(),
  };
}
