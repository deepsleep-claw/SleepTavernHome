import { readonly, shallowRef, type Ref } from 'vue';
import type {
  PluginActivationContext,
  PluginUpdaterController,
  UpdaterSnapshot,
} from '../../../公共模块/脚本更新器/contracts';
import { DREAM_CARD_AGENT_NAME, DREAM_CARD_AGENT_VERSION } from '../version';

const CHECK_ON_LOAD_KEY = 'dream-card-agent:check-updates-on-load';

function fallbackSnapshot(): UpdaterSnapshot {
  return {
    status: 'idle',
    currentVersion: DREAM_CARD_AGENT_VERSION,
    runningVersion: DREAM_CARD_AGENT_VERSION,
    updateAvailable: false,
  };
}

const snapshot = shallowRef<UpdaterSnapshot>(fallbackSnapshot());
let controller: PluginUpdaterController | undefined;
let unsubscribe = () => {};
let silentCheckScheduled = false;

export function createStandaloneActivationContext(): PluginActivationContext {
  let standaloneSnapshot: UpdaterSnapshot = {
    status: 'up-to-date',
    currentVersion: DREAM_CARD_AGENT_VERSION,
    runningVersion: DREAM_CARD_AGENT_VERSION,
    latestVersion: DREAM_CARD_AGENT_VERSION,
    updateAvailable: false,
    checkedAt: new Date().toISOString(),
  };
  const listeners = new Set<(value: UpdaterSnapshot) => void>();
  const publish = () => listeners.forEach(listener => listener({ ...standaloneSnapshot }));
  const updater: PluginUpdaterController = {
    pluginId: 'dream-card-agent',
    pluginName: `${DREAM_CARD_AGENT_NAME}（本地调试）`,
    getSnapshot: () => ({ ...standaloneSnapshot }),
    subscribe: listener => {
      listeners.add(listener);
      listener({ ...standaloneSnapshot });
      return () => listeners.delete(listener);
    },
    check: async () => {
      standaloneSnapshot = {
        ...standaloneSnapshot,
        status: 'up-to-date',
        checkedAt: new Date().toISOString(),
      };
      publish();
      return { ...standaloneSnapshot };
    },
    install: async () => undefined,
  };

  return {
    release: {
      version: DREAM_CARD_AGENT_VERSION,
      tag: `dream-card-agent-local-v${DREAM_CARD_AGENT_VERSION}`,
      entry: 'dist/酒馆助手/梦境创客/index.js',
      url: import.meta.url,
      updaterApiMajor: 1,
    },
    updater,
  };
}

export function shouldCheckUpdatesOnLoad(): boolean {
  return localStorage.getItem(CHECK_ON_LOAD_KEY) !== 'false';
}

export function setCheckUpdatesOnLoad(value: boolean): void {
  localStorage.setItem(CHECK_ON_LOAD_KEY, String(value));
}

export function configureDreamCardAgentUpdater(context: PluginActivationContext): () => void {
  unsubscribe();
  controller = context.updater;
  unsubscribe = controller.subscribe(value => {
    snapshot.value = value;
  });

  // 通用更新器通常已在激活插件前读取 Manifest。只有本地调试控制器或
  // 未携带启动 Manifest 的宿主仍处于 idle 时，才补一次静默检查，避免双请求。
  const initial = controller.getSnapshot();
  if (shouldCheckUpdatesOnLoad() && initial.status === 'idle' && !initial.checkedAt && !silentCheckScheduled) {
    silentCheckScheduled = true;
    queueMicrotask(() => {
      silentCheckScheduled = false;
      void controller?.check().catch(error => {
        console.warn(`[${DREAM_CARD_AGENT_NAME}] 静默检查更新失败。`, error);
      });
    });
  }

  return () => {
    unsubscribe();
    unsubscribe = () => {};
    controller = undefined;
    snapshot.value = fallbackSnapshot();
  };
}

export type DreamCardAgentUpdater = {
  snapshot: Readonly<Ref<UpdaterSnapshot>>;
  check: () => Promise<UpdaterSnapshot>;
  install: () => Promise<void>;
};

export function useDreamCardAgentUpdater(): DreamCardAgentUpdater {
  return {
    snapshot: readonly(snapshot),
    check: async () => {
      if (!controller) throw new Error('更新器尚未初始化');
      return await controller.check();
    },
    install: async () => {
      if (!controller) throw new Error('更新器尚未初始化');
      await controller.install();
    },
  };
}
