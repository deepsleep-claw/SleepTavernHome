import type { Component } from 'vue';

export const UPDATER_STATE_KEY = '__updater';
export const UPDATER_STATE_SCHEMA_VERSION = 1;

export type UpdateChannel = 'stable';

export type ReleaseDescriptor = {
  version: string;
  tag: string;
  entry: string;
  url: string;
  updaterApiMajor: number;
};

export type StoredUpdaterState = {
  schemaVersion: typeof UPDATER_STATE_SCHEMA_VERSION;
  pluginId: string;
  channel: UpdateChannel;
  active: ReleaseDescriptor;
  pending?: ReleaseDescriptor;
  lastCheck?: {
    checkedAt: string;
    latestVersion?: string;
    error?: string;
  };
};

export type UpdaterStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'installing' | 'error';

export type UpdaterSnapshot = {
  status: UpdaterStatus;
  currentVersion: string;
  runningVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  checkedAt?: string;
  error?: string;
};

export type UpdaterListener = (snapshot: UpdaterSnapshot) => void;

export type PluginUpdaterController = {
  readonly pluginId: string;
  readonly pluginName: string;
  getSnapshot: () => UpdaterSnapshot;
  subscribe: (listener: UpdaterListener) => () => void;
  check: () => Promise<UpdaterSnapshot>;
  install: () => Promise<void>;
};

export type PluginActivationContext = {
  release: ReleaseDescriptor;
  updater: PluginUpdaterController;
  updaterUi?: Component;
};

export type PluginRuntime = {
  dispose?: () => void;
};

export type LoadablePluginModule = {
  PLUGIN_ID?: string;
  PLUGIN_VERSION?: string;
  activate?: (context: PluginActivationContext) => PluginRuntime | void | Promise<PluginRuntime | void>;
};

export type PluginUpdaterConfig = {
  pluginId: string;
  pluginName: string;
  repository: string;
  manifestUrl: string;
  cdnBaseUrl: string;
  channel: UpdateChannel;
  tagPrefix: string;
  updaterApiMajor: number;
  fallback: ReleaseDescriptor;
};

export type UpdaterBootstrapData = {
  manifest?: unknown;
  manifestError?: string;
};

export type PluginUpdaterModule = {
  UPDATER_API_MAJOR?: number;
  UPDATER_VERSION?: string;
  bootPlugin?: (config: PluginUpdaterConfig, bootstrap?: UpdaterBootstrapData) => Promise<PluginRuntime | void>;
};
