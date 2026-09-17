import { getDreamCardAgentRuntime, type DreamCardAgentRuntime } from '../runtime/dream-card-agent-runtime';
import type { PluginActivationContext } from '../../../公共模块/脚本更新器/contracts';

const CLIENT_METHODS = [
  'applyAgentConfiguration',
  'applyPreset',
  'checkHtmlProject',
  'clearAllAttachments',
  'clearAllCache',
  'clearCharacterAttachments',
  'clearCharacterCache',
  'closeSession',
  'compileHtmlProject',
  'compactContext',
  'confirmOperationReplay',
  'copyProvider',
  'createSession',
  'deleteCharacterSession',
  'deleteSession',
  'deleteWorkingPath',
  'diagnosticBundle',
  'downloadBuiltinSkillResource',
  'editUserMessage',
  'enqueueGuidance',
  'exportProviderBundle',
  'forkSession',
  'importProviderBundle',
  'listModels',
  'loadBrowserDraft',
  'loadGlobalSkill',
  'openGlobalSession',
  'openHistorySession',
  'openSession',
  'redo',
  'refreshBuiltinSkillResources',
  'refreshCharacter',
  'removeAgentConfiguration',
  'removeGlobalSkill',
  'removeManagedFile',
  'removeModel',
  'removePresetProfile',
  'removeProvider',
  'renameSession',
  'resend',
  'resetAllData',
  'resetCharacterData',
  'resolveToolConfirmation',
  'resume',
  'revealModel',
  'revealProvider',
  'saveAgentConfiguration',
  'saveBrowserDraft',
  'saveGlobalSkill',
  'saveModel',
  'savePresetProfile',
  'saveProvider',
  'selectAgentConfiguration',
  'selectCharacterAndCreateSession',
  'selectDefaultModel',
  'selectPresetProfile',
  'selectSessionModel',
  'send',
  'setModelControls',
  'setSessionMode',
  'setWorkspaceAvatar',
  'snapshot',
  'stop',
  'stopSession',
  'subscribe',
  'switchCharacterAndCreateSession',
  'switchCharacterAndOpenSession',
  'undo',
  'undoToUserMessage',
  'updateSettings',
  'uploadWorkspaceFiles',
  'useCurrentWorkingFile',
  'writeWorkingFile',
  'backupSessions',
  'exportBrowserSessions',
  'restoreCurrentSessionBackup',
  'refreshSessionBackups',
] as const satisfies readonly (keyof DreamCardAgentRuntime)[];
export type DreamCardAgentClient = Pick<DreamCardAgentRuntime, (typeof CLIENT_METHODS)[number]>;
export type ClientHost = {
  registerView: (mode: 'embedded' | 'detached', dispose: () => void, view?: Window) => () => void;
  toggleNativeFullscreen: () => void;
  subscribeNativeFullscreen: (listener: (fullscreen: boolean) => void) => () => void;
  globals: Record<string, unknown>;
  owner: string;
  client: DreamCardAgentClient;
  context: PluginActivationContext;
  openDetached: () => void;
};
export const CLIENT_HOST_KEY = '__dream_creator_client_host__';
export const CLIENT_ENV_KEY = '__dream_creator_client_environment__';
export type ClientEnvironment = { mode: 'embedded' | 'detached'; host: Window };

export function clientEnvironment(): ClientEnvironment | undefined {
  return (window as unknown as Record<string, ClientEnvironment | undefined>)[CLIENT_ENV_KEY];
}

export function readClientHost(host: Window): ClientHost | undefined {
  try {
    return (host as unknown as Record<string, ClientHost | undefined>)[CLIENT_HOST_KEY];
  } catch {
    return undefined;
  }
}

export function createRuntimeClient(source: DreamCardAgentRuntime): DreamCardAgentClient {
  return Object.fromEntries(
    CLIENT_METHODS.filter(name => typeof source[name] === 'function').map(name => [
      name,
      (...args: unknown[]) => Reflect.apply(source[name] as (...values: unknown[]) => unknown, source, args),
    ]),
  ) as DreamCardAgentClient;
}

let client: DreamCardAgentClient | undefined;
export function getDreamCardAgentClient(): DreamCardAgentClient {
  const environment = clientEnvironment();
  if (environment) {
    const host = readClientHost(environment.host);
    if (!host) throw new Error('酒馆连接已中断，请等待宿主页面重新加载。');
    return host.client;
  }
  client ??= createRuntimeClient(getDreamCardAgentRuntime());
  return client;
}

export function openDetachedInterface(): void {
  const host = readClientHost(clientEnvironment()?.host ?? window.parent);
  if (!host) throw new Error('酒馆连接不可用。');
  host.openDetached();
}
