import { createApp, type App } from 'vue';
import WorkspaceWindow from './WorkspaceWindow.vue';
import { clientEnvironment, readClientHost } from './runtime-client';
import { configureDreamCardAgentUpdater } from './updater';
import { isolateDocumentDoubleClick } from './window-interaction';

export function mountClientWindow(): void {
  const environment = clientEnvironment();
  if (!environment) return;
  const releaseDoubleClickIsolation = environment.mode === 'embedded' ? isolateDocumentDoubleClick(document) : () => {};
  document.getElementById('dca-client-loading')?.remove();
  const root = document.createElement('div');
  root.className = 'dca-shadow-root dca-client-root';
  root.style.cssText = 'height:100%;width:100%';
  document.body.append(root);
  const disconnected = document.createElement('div');
  disconnected.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:#20222bed;color:white;display:none;place-items:center;padding:24px;text-align:center;font:16px sans-serif';
  disconnected.setAttribute('role', 'alert');
  disconnected.textContent = '酒馆连接已中断。请重新打开或刷新酒馆页面；本机已保存的内容会保留。';
  document.body.append(disconnected);
  let app: App | undefined;
  let owner = '';
  let cleanUpdater = () => {};
  let unregister = () => {};
  const unmount = () => {
    app?.unmount();
    app = undefined;
    cleanUpdater();
    unregister();
    owner = '';
  };
  const connect = () => {
    const host = environment.host.closed ? undefined : readClientHost(environment.host);
    disconnected.style.display = host ? 'none' : 'grid';
    if (!host) {
      unmount();
      return;
    }
    if (host.owner === owner) return;
    unmount();
    Object.assign(window, host.globals);
    owner = host.owner;
    cleanUpdater = configureDreamCardAgentUpdater(host.context);
    app = createApp(WorkspaceWindow);
    app.mount(root);
    unregister = host.registerView(environment.mode, unmount, window);
  };
  connect();
  const clock = setInterval(connect, 1000);
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(clock);
      releaseDoubleClickIsolation();
      unmount();
      root.remove();
      disconnected.remove();
    },
    { once: true },
  );
}
