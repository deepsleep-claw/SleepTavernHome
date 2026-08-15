export type RemoteBuiltinSkillDescriptor = {
  description: string;
  id: string;
  name: string;
};

/** 只有轻量元数据进入主脚本；正文和资源由resources/中的ZIP按需下载。 */
export const REMOTE_BUILTIN_SKILLS: readonly RemoteBuiltinSkillDescriptor[] = [
  { id: 'html-project', name: 'HTML工程', description: '使用角色绑定的HTML工程，拆分源码、检查、编译、预览与导出。' },
  { id: 'plain-html-regex', name: '纯HTML正则界面', description: '编写无需酒馆助手脚本的安全HTML替换界面。' },
  { id: 'tavern-helper-regex', name: '酒馆助手正则界面', description: '编写能调用酒馆助手接口的HTML代码块与交互界面。' },
  { id: 'mvu-zod-card', name: 'MVU角色卡', description: '识别并维护MVU Zod或旧版角色卡；新建角色卡默认采用Zod方案。' },
  { id: 'mvu-frontend', name: 'MVU前端界面', description: '为MVU Zod角色卡制作可预览、可销毁、响应式的前端界面。' },
  { id: 'tavern-helper-api', name: '酒馆助手API参考', description: '按需查询当前酒馆助手类型定义，确认接口、参数与返回值。' },
] as const;

export const REMOTE_BUILTIN_SKILL_IDS = REMOTE_BUILTIN_SKILLS.map(skill => skill.id);
