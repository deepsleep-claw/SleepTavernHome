const moduleUrl = `http://127.0.0.1:5500/dist/酒馆助手/梦境创客/index.js?t=${Date.now()}`;

void (async () => {
  try {
    const dreamCreator = await import(moduleUrl);
    if (dreamCreator.PLUGIN_ID !== 'dream-card-agent' || typeof dreamCreator.activate !== 'function') {
      throw new Error('本地产物不是可用的梦境创客模块');
    }

    const version = dreamCreator.PLUGIN_VERSION ?? '0.0.0-local';
    let snapshot = {
      status: 'up-to-date',
      currentVersion: version,
      runningVersion: version,
      latestVersion: version,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
    };
    const listeners = new Set();
    const emit = () => listeners.forEach(listener => listener({ ...snapshot }));
    const updater = {
      pluginId: dreamCreator.PLUGIN_ID,
      pluginName: '梦境创客（本地调试）',
      getSnapshot: () => ({ ...snapshot }),
      subscribe: listener => {
        listeners.add(listener);
        listener({ ...snapshot });
        return () => listeners.delete(listener);
      },
      check: async () => {
        snapshot = { ...snapshot, checkedAt: new Date().toISOString(), status: 'up-to-date' };
        emit();
        return { ...snapshot };
      },
      install: async () => {},
    };

    await dreamCreator.activate({
      release: {
        version,
        tag: `dream-card-agent-local-v${version}`,
        entry: 'dist/酒馆助手/梦境创客/index.js',
        url: moduleUrl,
        updaterApiMajor: 1,
      },
      updater,
    });
    console.info(`[梦境创客] 已加载本地调试版本 v${version}`);
  } catch (error) {
    console.error('[梦境创客] 本地调试版本加载失败。', error);
    if (typeof toastr !== 'undefined') {
      toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
    }
  }
})();
