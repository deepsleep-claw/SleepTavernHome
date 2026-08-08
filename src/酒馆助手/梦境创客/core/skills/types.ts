export type SkillLoadingMode = 'full' | 'on-demand';

export type AgentSkill = {
  assets: Record<string, string>;
  body: string;
  builtin: boolean;
  description: string;
  enabled: boolean;
  id: string;
  loading: SkillLoadingMode;
  name: string;
  references: Record<string, string>;
};

export type SkillMutationAssessment = {
  allowed: boolean;
  confirmationRequired: boolean;
  reason?: string;
};
