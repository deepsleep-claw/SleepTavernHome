export const PLUGIN_ID = 'tool-output-bridge';
export const VERSION = '0.1.0';
export const CONFIG_KEY = 'tool_output_bridge';
export const REQUEST_KEY = '__tool_output_bridge';

export interface OutputTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  outputPath: string;
  enabled: boolean;
}

export interface BridgeConfig {
  version: 1;
  enabled: boolean;
  modelNameIncludes: string;
  keepOriginalText: boolean;
  promptEnabled: boolean;
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
  promptEnabled: true,
  prompt: '请通过以下工具提交本轮回复：{{tool_names}}。将需要展示给读者的正文写入对应字段（{{tool_outputs}}），保留正文原有的 Markdown、标签与换行。正文提交完成后结束本轮回复。',
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

export function validateConfig(input: unknown): BridgeConfig {
  if (!isRecord(input)) throw new Error('插件配置必须是对象。');
  if (input.version !== undefined && input.version !== 1) throw new Error('请更新基米工具以读取此配置版本。');
  const config = { ...structuredClone(DEFAULT_CONFIG), ...input } as BridgeConfig;
  for (const key of ['enabled', 'keepOriginalText', 'promptEnabled', 'streamArguments'] as const) {
    if (typeof config[key] !== 'boolean') throw new Error(`配置 ${key} 必须为布尔值。`);
  }
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
    if (typeof tool.outputPath !== 'string') throw new Error(`工具 ${tool.name} 缺少正文字段路径。`);
    pathSegments(tool.outputPath);
    return structuredClone(tool) as OutputTool;
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

export function injectRequest(request: Record<string, any>, config: BridgeConfig): Record<string, any> {
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
  if (config.promptEnabled && config.prompt.trim()) {
    const content = config.prompt.replaceAll('{{tool_names}}', active.map(tool => tool.name).join('、'))
      .replaceAll('{{tool_outputs}}', active.map(tool => `${tool.name}.${tool.outputPath}`).join('、'));
    body.messages = [{ role: 'system', content }, ...(body.messages ?? [])];
  }
  return body;
}
