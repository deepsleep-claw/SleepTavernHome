import { z } from 'zod';
import {
  DEFAULT_CONFIG,
  validateConfig,
  type BridgeConfig,
} from '../../../projects/tool-output-bridge/src/shared/config';

export const SCRIPT_NAME = '基米工具';
export const SCRIPT_VERSION = '0.2.0';
export const SETTINGS_KEY = 'tool_output_bridge';
export const SETTINGS_BUTTON = '基米工具设置';

const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  outputPath: z.string().prefault('text'),
  outputPaths: z.array(z.string()).optional(),
  enabled: z.boolean(),
});

export const SettingsSchema = z
  .object({
    version: z.literal(1).prefault(1),
    enabled: z.boolean().prefault(false),
    modelNameIncludes: z.string().trim().min(1).max(128).prefault('Gemini'),
    keepOriginalText: z.boolean().prefault(DEFAULT_CONFIG.keepOriginalText),
    promptMode: z.enum(['none', 'system_prompt', 'user', 'assistant', 'system']).prefault('system_prompt'),
    promptDepth: z.number().int().safe().prefault(0),
    prompt: z.string().prefault(DEFAULT_CONFIG.prompt),
    forceMode: z.enum(['auto', 'required', 'named']).prefault(DEFAULT_CONFIG.forceMode),
    forcedTool: z.string().prefault(DEFAULT_CONFIG.forcedTool),
    separator: z.string().prefault(DEFAULT_CONFIG.separator),
    tools: z.array(ToolSchema).prefault(DEFAULT_CONFIG.tools),
  })
  .superRefine((settings, context) => {
    try {
      validateConfig({ ...settings, googleMode: 'native', streamArguments: false });
    } catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) });
    }
  })
  .prefault({});

export type Settings = z.infer<typeof SettingsSchema>;

export function requestConfig(settings: Settings): BridgeConfig {
  return validateConfig({ ...settings, googleMode: 'native', streamArguments: false });
}

export function describeError(error: unknown): string {
  return error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : String(error);
}
