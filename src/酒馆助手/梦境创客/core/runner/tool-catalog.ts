export const AGENT_TOOL_GROUPS = [
  {
    description: '浏览、读取、创建、修改、移动、删除和搜索虚拟工作区。',
    id: 'files',
    label: '文件',
    tools: [
      { id: 'list_path', label: '列出路径', readonly: true },
      { id: 'read_file', label: '读取文件', readonly: true },
      { id: 'write_file', label: '写入文件', readonly: false },
      { id: 'apply_patch', label: '应用补丁', readonly: false },
      { id: 'move_path', label: '移动路径', readonly: false },
      { id: 'copy_path', label: '复制路径', readonly: false },
      { id: 'delete_path', label: '删除路径', readonly: false },
      { id: 'search_files', label: '搜索文件', readonly: true },
      { id: 'set_avatar', label: '设置头像', readonly: false },
    ],
  },
  {
    description: '搜索、挂载、切换和保存酒馆预设。',
    id: 'presets',
    label: '酒馆预设',
    tools: [{ id: 'manage_preset', label: '管理酒馆预设', readonly: false }],
  },
  {
    description: '搜索、挂载、卸载、创建、复制和绑定世界书。',
    id: 'worldbooks',
    label: '世界书',
    tools: [
      { id: 'search_worldbooks', label: '搜索世界书', readonly: true },
      { id: 'manage_worldbook', label: '管理世界书', readonly: false },
    ],
  },
  {
    description: '管理酒馆聊天、发送测试消息以及生成或切换Swipe。',
    id: 'tavern-chats',
    label: '酒馆聊天',
    tools: [
      { id: 'manage_tavern_chat', label: '管理酒馆聊天', readonly: false },
      { id: 'send_tavern_message', label: '发送酒馆消息', readonly: false },
      { id: 'generate_tavern_reply', label: '生成酒馆回复', readonly: false },
    ],
  },
  {
    description: '列出、打开和关闭角色。只在全局会话中暴露。',
    globalOnly: true,
    id: 'characters',
    label: '角色导航',
    tools: [{ id: 'manage_character', label: '管理角色', readonly: false }],
  },
  {
    description: '检查和编译位于全局或角色文件区的HTML工程。',
    id: 'projects',
    label: '工程与预览',
    tools: [
      { id: 'manage_html_project', label: '管理HTML工程', readonly: false },
      { id: 'run_javascript', label: '运行JavaScript', readonly: false },
      { id: 'prepare_render', label: '准备渲染预览', readonly: false },
    ],
  },
  {
    description: '在上下文过长时生成摘要并继续会话。',
    id: 'context',
    label: '上下文',
    tools: [{ id: 'compact_context', label: '压缩上下文', readonly: false }],
  },
] as const;

export type AgentToolGroup = (typeof AGENT_TOOL_GROUPS)[number];
export type AgentToolId = AgentToolGroup['tools'][number]['id'];

export const ALL_AGENT_TOOL_IDS = AGENT_TOOL_GROUPS.flatMap(group => group.tools.map(item => item.id)) as AgentToolId[];

export function isAgentToolId(value: unknown): value is AgentToolId {
  return typeof value === 'string' && ALL_AGENT_TOOL_IDS.includes(value as AgentToolId);
}

export function isGlobalOnlyTool(id: AgentToolId): boolean {
  return AGENT_TOOL_GROUPS.some(
    group => 'globalOnly' in group && group.globalOnly === true && group.tools.some(tool => tool.id === id),
  );
}
