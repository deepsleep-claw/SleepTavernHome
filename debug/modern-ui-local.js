const moduleUrl = `http://127.0.0.1:5500/dist/酒馆助手/现代化界面/index.js?t=${Date.now()}`;

void (async () => {
  try {
    const modernUi = await import(moduleUrl);
    if (modernUi.PLUGIN_ID !== 'modern-ui' || typeof modernUi.activate !== 'function') {
      throw new Error('本地产物不是可用的现代化界面模块');
    }

    const version = modernUi.PLUGIN_VERSION ?? '0.0.0-local';
    const snapshot = {
      status: 'up-to-date',
      currentVersion: version,
      runningVersion: version,
      latestVersion: version,
      updateAvailable: false,
    };
    const updater = {
      pluginId: modernUi.PLUGIN_ID,
      pluginName: '现代化界面（本地调试）',
      getSnapshot: () => ({ ...snapshot }),
      subscribe: listener => {
        listener({ ...snapshot });
        return () => {};
      },
      check: async () => ({ ...snapshot }),
      install: async () => {},
    };

    await modernUi.activate({
      release: {
        version,
        tag: `local-v${version}`,
        entry: 'dist/酒馆助手/现代化界面/index.js',
        url: moduleUrl,
        updaterApiMajor: 1,
      },
      updater,
    });
    console.info(`[现代化界面] 已加载本地调试版本 v${version}`);
  } catch (error) {
    console.error('[现代化界面] 本地调试版本加载失败。', error);
    if (typeof toastr !== 'undefined') {
      toastr.error(error instanceof Error ? error.message : String(error), '现代化界面');
    }
  }
})();
