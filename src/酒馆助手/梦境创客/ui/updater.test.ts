// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginActivationContext, UpdaterSnapshot } from '../../../公共模块/脚本更新器/contracts';
import {
  configureDreamCardAgentUpdater,
  createStandaloneActivationContext,
  setCheckUpdatesOnLoad,
  useDreamCardAgentUpdater,
} from './updater';

function context(
  initial: UpdaterSnapshot,
  check: () => Promise<UpdaterSnapshot> = vi.fn(async () => initial),
): PluginActivationContext {
  return {
    release: {
      entry: 'dist/酒馆助手/梦境创客/index.js',
      tag: 'dream-card-agent-v0.1.0',
      updaterApiMajor: 1,
      url: 'http://localhost/index.js',
      version: '0.1.0',
    },
    updater: {
      check,
      getSnapshot: () => ({ ...initial }),
      install: vi.fn(async () => undefined),
      pluginId: 'dream-card-agent',
      pluginName: '梦境创客',
      subscribe: next => {
        next({ ...initial });
        return () => {};
      },
    },
  };
}

describe('梦境创客更新状态桥', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('为旧的直接导入方式提供本地调试上下文', async () => {
    const standalone = createStandaloneActivationContext();

    expect(standalone.release.version).toBe('0.1.0');
    expect(standalone.updater.getSnapshot()).toMatchObject({
      status: 'up-to-date',
      currentVersion: '0.1.0',
      updateAvailable: false,
    });
    await expect(standalone.updater.check()).resolves.toMatchObject({ status: 'up-to-date' });
  });

  it('把控制器快照提供给顶栏，并只在尚未检查时补一次静默检查', async () => {
    const initial: UpdaterSnapshot = {
      currentVersion: '0.1.0',
      runningVersion: '0.1.0',
      status: 'idle',
      updateAvailable: false,
    };
    const check = vi.fn(async (): Promise<UpdaterSnapshot> => ({
      ...initial,
      checkedAt: '2026-08-13T00:00:00.000Z',
      status: 'up-to-date',
    }));
    const cleanup = configureDreamCardAgentUpdater(context(initial, check));
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
    expect(useDreamCardAgentUpdater().snapshot.value.runningVersion).toBe('0.1.0');
    cleanup();
  });

  it('关闭加载检查后不触发后台请求', async () => {
    setCheckUpdatesOnLoad(false);
    const initial: UpdaterSnapshot = {
      currentVersion: '0.1.0',
      runningVersion: '0.1.0',
      status: 'idle',
      updateAvailable: false,
    };
    const check = vi.fn(async () => initial);
    const cleanup = configureDreamCardAgentUpdater(context(initial, check));
    await Promise.resolve();
    expect(check).not.toHaveBeenCalled();
    cleanup();
  });
});
