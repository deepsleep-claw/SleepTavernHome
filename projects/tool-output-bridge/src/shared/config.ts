export const PLUGIN_ID = 'tool-output-bridge';
export const VERSION = '0.2.0';
export const CONFIG_KEY = 'tool_output_bridge';
export const REQUEST_KEY = '__tool_output_bridge';

export interface OutputTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  outputPath: string;
  outputPaths?: string[];
  enabled: boolean;
}

export type PromptInjectionMode = 'none' | 'system_prompt' | 'user' | 'assistant' | 'system';

export interface BridgeConfig {
  version: 1;
  enabled: boolean;
  modelNameIncludes: string;
  keepOriginalText: boolean;
  promptMode: PromptInjectionMode;
  promptDepth: number;
  prompt: string;
  forceMode: 'auto' | 'required' | 'named';
  forcedTool: string;
  googleMode: 'auto' | 'native' | 'interactions';
  streamArguments: boolean;
  separator: string;
  tools: OutputTool[];
}

export interface GlobalConfig { version: 1; enabled: boolean; modelNameIncludes: string }
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = { version: 1, enabled: false, modelNameIncludes: 'Gemini' };

export const DEFAULT_CONFIG: BridgeConfig = {
  version: 1,
  enabled: false,
  modelNameIncludes: 'Gemini',
  keepOriginalText: false,
  promptMode: 'system_prompt',
  promptDepth: 0,
  prompt: '请通过以下工具提交本轮回复：{{tool_names}}。将本轮需要展示的全部内容按用途写入对应字段（{{tool_outputs}}），按所列字段顺序填写，保留原有的 Markdown、标签与换行。全部字段提交完成后结束本轮回复。',
  forceMode: 'named',
  forcedTool: 'publish_story',
  googleMode: 'auto',
  streamArguments: true,
  separator: '\n\n',
  tools: [{
    name: 'publish_story',
    description: '将本轮故事正文发布到聊天消息。',
    parameters: { type: 'object', properties: { text: { type: 'string', description: '完整的聊天正文，保留格式与换行。' } }, required: ['text'] },
    outputPath: 'text',
    enabled: true,
  }],
};

export function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function pathSegments(path: string): string[] {
  const value = path.replace(/^\$\.?/, '');
  const parts = value.startsWith('/')
    ? value.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    : value.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (!parts.length || parts.some(part => !part || ['__proto__', 'constructor', 'prototype'].includes(part))) {
    throw new Error('正文字段路径无效。');
  }
  return parts;
}

export function outputValue(args: unknown, path: string): string {
  let value: any = args;
  for (const part of pathSegments(path)) value = value != null && Object.hasOwn(value, part) ? value[part] : undefined;
  if (typeof value !== 'string') throw new Error(`工具正文 ${path} 必须是字符串。`);
  return value;
}

export function toolOutputPaths(tool: OutputTool): string[] {
  return tool.outputPaths ?? [tool.outputPath];
}

export function collectOutput(args: unknown, tool: OutputTool, separator: string): string {
  return toolOutputPaths(tool).map(path => outputValue(args, path)).filter(Boolean).join(separator);
}

export function renderPrompt(config: BridgeConfig): string {
  if (config.promptMode === 'none' || !config.prompt.trim()) return '';
  const active = config.tools.filter(tool => tool.enabled);
  return config.prompt.replaceAll('{{tool_names}}', active.map(tool => tool.name).join('、'))
    .replaceAll('{{tool_outputs}}', active.flatMap(tool => toolOutputPaths(tool).map(path => `${tool.name}.${path}`)).join('、'));
}

function containsPrompt(message: any, content: string): boolean {
  return typeof message.content === 'string' ? message.content.includes(content)
    : Array.isArray(message.content) && message.content.some((part: any) => part?.type === 'text' && typeof part.text === 'string' && part.text.includes(content));
}

export function injectPrompt(messages: any[], config: BridgeConfig): string | undefined {
  const content = renderPrompt(config);
  if (!content) return;
  if (config.promptMode === 'system_prompt') {
    if (!messages.some(message => message.role === 'system' && containsPrompt(message, content))) messages.unshift({ role: 'system', content });
    return;
  }
  const matches = messages.filter(message => message.role === config.promptMode);
  const index = config.promptDepth < 0 ? matches.length + config.promptDepth : config.promptDepth;
  const target = matches[index];
  const role = { user: 'User', assistant: 'Assistant', system: 'System', none: '' }[config.promptMode];
  if (!target) return `找不到 ${role} 深度 ${config.promptDepth} 的消息，当前共有 ${matches.length} 条 ${role} 消息。提示词未注入。`;
  if (containsPrompt(target, content)) return;
  if (typeof target.content === 'string' || target.content == null) {
    target.content = target.content ? `${target.content}\n\n${content}` : content;
  } else if (Array.isArray(target.content)) {
    target.content.push({ type: 'text', text: content });
  } else {
    return `${role} 深度 ${config.promptDepth} 的消息内容无法追加文本。提示词未注入。`;
  }
}

export function validateConfig(input: unknown): BridgeConfig {
  if (!isRecord(input)) throw new Error('插件配置必须是对象。');
  if (input.version !== undefined && input.version !== 1) throw new Error('请更新基米工具以读取此配置版本。');
  const { promptEnabled, ...settings } = input;
  if (promptEnabled !== undefined && typeof promptEnabled !== 'boolean') throw new Error('配置 promptEnabled 必须为布尔值。');
  const config = { ...structuredClone(DEFAULT_CONFIG), ...settings } as BridgeConfig;
  if (input.promptMode === undefined) config.promptMode = promptEnabled === false ? 'none' : 'system_prompt';
  for (const key of ['enabled', 'keepOriginalText', 'streamArguments'] as const) {
    if (typeof config[key] !== 'boolean') throw new Error(`配置 ${key} 必须为布尔值。`);
  }
  if (!['none', 'system_prompt', 'user', 'assistant', 'system'].includes(config.promptMode)) throw new Error('提示词注入方式无效。');
  if (!Number.isSafeInteger(config.promptDepth)) throw new Error('提示词注入深度必须是整数。');
  if (!['auto', 'required', 'named'].includes(config.forceMode)) throw new Error('工具选择模式无效。');
  if (!['auto', 'native', 'interactions'].includes(config.googleMode)) throw new Error('接口模式无效。');
  config.modelNameIncludes = globalConfigFromSettings(config).modelNameIncludes;
  if (typeof config.prompt !== 'string' || config.prompt.length > 65536) throw new Error('提示词长度须小于 65536 字符。');
  if (typeof config.separator !== 'string' || config.separator.length > 1000) throw new Error('正文分隔符过长。');
  if (!Array.isArray(config.tools) || config.tools.length > 32) throw new Error('工具数量须为 0 至 32 个。');
  const names = new Set<string>();
  config.tools = config.tools.map((tool, index) => {
    if (!isRecord(tool)) throw new Error(`第 ${index + 1} 个工具格式无效。`);
    if (typeof tool.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(tool.name)) throw new Error('工具名称须为 1 至 64 个英文字母、数字、下划线或连字符，且以字母或下划线开头。');
    if (names.has(tool.name)) throw new Error(`工具名称重复：${tool.name}`);
    names.add(tool.name);
    if (typeof tool.description !== 'string' || tool.description.length > 16384) throw new Error(`工具 ${tool.name} 的说明无效。`);
    if (typeof tool.enabled !== 'boolean') throw new Error(`工具 ${tool.name} 的启用状态无效。`);
    if (!isRecord(tool.parameters) || tool.parameters.type !== 'object') throw new Error(`工具 ${tool.name} 的参数须为 object 类型的 JSON Schema。`);
    if (JSON.stringify(tool.parameters).length > 65536) throw new Error(`工具 ${tool.name} 的参数定义过长。`);
    const paths = tool.outputPaths ?? [tool.outputPath];
    if (!Array.isArray(paths) || !paths.length || paths.length > 32) throw new Error(`工具 ${tool.name} 须配置 1 至 32 个正文字段路径。`);
    const targets = new Set<string>();
    for (const path of paths) {
      if (typeof path !== 'string') throw new Error(`工具 ${tool.name} 的正文字段路径必须是字符串。`);
      const target = JSON.stringify(pathSegments(path));
      if (targets.has(target)) throw new Error(`工具 ${tool.name} 的正文字段路径重复。`);
      targets.add(target);
    }
    return { ...structuredClone(tool), outputPath: paths[0] } as OutputTool;
  });
  const active = config.tools.filter(tool => tool.enabled);
  if (config.enabled && !active.length) throw new Error('请至少启用一个正文工具。');
  if (config.enabled && config.forceMode === 'named' && !active.some(tool => tool.name === config.forcedTool)) throw new Error('指定调用的工具必须处于启用状态。');
  return config;
}

export function configFromPreset(value: unknown): BridgeConfig {
  return validateConfig({ ...(isRecord(value) ? value : DEFAULT_CONFIG), enabled: false, modelNameIncludes: DEFAULT_GLOBAL_CONFIG.modelNameIncludes });
}

export function globalConfigFromSettings(value: unknown): GlobalConfig {
  const config = { ...DEFAULT_GLOBAL_CONFIG, ...(isRecord(value) ? value : {}) };
  if (config.version !== 1 || typeof config.enabled !== 'boolean') throw new Error('全局设置格式无效。');
  if (typeof config.modelNameIncludes !== 'string' || !config.modelNameIncludes.trim() || config.modelNameIncludes.length > 128) throw new Error('请填写 1 至 128 个字符的模型名称关键词。');
  return { version: 1, enabled: config.enabled, modelNameIncludes: config.modelNameIncludes.trim() };
}

export function modelMatches(model: unknown, keyword: string): boolean {
  return typeof model === 'string' && !!keyword.trim() && model.toLowerCase().includes(keyword.trim().toLowerCase());
}

export function shouldActivate(body: Record<string, any>, config: GlobalConfig): boolean {
  return config.enabled && modelMatches(body.model, config.modelNameIncludes)
    && !['quiet', 'impersonate'].includes(body.type) && supportedSource(body.chat_completion_source);
}

export type ToolProtocol = 'openai' | 'gemini' | 'vertex' | 'interactions';
export function resolveProtocol(source: unknown, mode: BridgeConfig['googleMode'] = 'auto'): ToolProtocol | null {
  if (source === 'makersuite') return mode === 'interactions' ? 'interactions' : 'gemini';
  if (source === 'vertexai') return 'vertex';
  return supportedSource(source) ? 'openai' : null;
}

export function supportedSource(source: unknown): boolean {
  return ['openai', 'custom', 'openrouter', 'makersuite', 'vertexai', 'deepseek', 'groq', 'moonshot', 'mistralai', 'siliconflow', 'nanogpt', 'zai', 'chutes', 'cometapi'].includes(String(source));
}

export function injectRequest(request: Record<string, any>, config: BridgeConfig, warn?: (message: string) => void): Record<string, any> {
  const body = structuredClone(request);
  delete body[REQUEST_KEY];
  const active = config.tools.filter(tool => tool.enabled);
  const own = new Set(active.map(tool => tool.name));
  body.tools = [
    ...(Array.isArray(body.tools) ? body.tools.filter((tool: any) => !own.has(tool?.function?.name)) : []),
    ...active.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
  ];
  body.tool_choice = config.forceMode === 'named'
    ? { type: 'function', function: { name: config.forcedTool } }
    : config.forceMode === 'required' ? 'required' : 'auto';
  body.messages ??= [];
  const warning = injectPrompt(body.messages, config);
  if (warning) warn?.(warning);
  return body;
}
