export type SkillLoadingMode = 'full' | 'on-demand';

export type SkillResource = {
  /** 仅在设置编辑器载入或新上传二进制文件时存在，不进入常驻Runtime状态。 */
  data?: Uint8Array;
  /** 文本资源的正文；二进制资源不设置此字段。 */
  content?: string;
  mediaType: string;
  sha256?: string;
  size: number;
};

export type AgentSkill = {
  body: string;
  builtin: boolean;
  description: string;
  /** 可选空目录；普通目录会由资源路径自然推导。 */
  directories?: string[];
  id: string;
  /** Skill作者填写的默认策略；挂载到会话时可被Agent配置覆盖。 */
  loading: SkillLoadingMode;
  /** 用户在设置中锁定后，Agent只能读取，不能修改、移动或删除。 */
  locked?: boolean;
  name: string;
  /** 相对Skill根目录的自由资源树；根目录SKILL.md由其它字段表示，不能占用。 */
  resources?: Record<string, SkillResource>;
};

export type SkillMutationAssessment = {
  allowed: boolean;
  confirmationRequired: boolean;
  reason?: string;
};
