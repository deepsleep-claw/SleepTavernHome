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
  /** @deprecated 旧版固定目录兼容；读取时会折叠进resources。 */
  assets?: Record<string, string>;
  body: string;
  builtin: boolean;
  description: string;
  /** 可选空目录；普通目录会由资源路径自然推导。 */
  directories?: string[];
  id: string;
  loading: SkillLoadingMode;
  name: string;
  /** @deprecated 旧版固定目录兼容；读取时会折叠进resources。 */
  references?: Record<string, string>;
  /** 相对Skill根目录的自由资源树；根目录SKILL.md由其它字段表示，不能占用。 */
  resources?: Record<string, SkillResource>;
};

export type SkillMutationAssessment = {
  allowed: boolean;
  confirmationRequired: boolean;
  reason?: string;
};
