import type { PluginActivationContext } from '../../../公共模块/脚本更新器/contracts';
import type { DreamCardAgentRuntime } from '../runtime/dream-card-agent-runtime';
import { destroyDreamCardAgentWindow, openDreamCardAgentWindow } from './popup';
import { CLIENT_ENV_KEY, CLIENT_HOST_KEY, createRuntimeClient, type ClientHost } from './runtime-client';

const DRAWER_ID = 'dream-creator-drawer';
let openDefault = () => openDreamCardAgentWindow();
export function openDefaultInterface() {
  openDefault();
}

function scriptString(value: string): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function clientDocument(entryUrl: string, mode: 'embedded' | 'detached'): string {
  const icon = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#172536"/><text x="32" y="47" font-size="42" text-anchor="middle">🐋</text></svg>',
  );
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>梦境创客</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${icon}">
<link rel="stylesheet" href="https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free/css/all.min.css">
<style>html,body{height:100%;margin:0;overflow:hidden}#dca-client-loading{padding:24px;font:14px sans-serif} .dca-client-toast{position:fixed;z-index:99999;right:16px;top:16px;max-width:80%;padding:12px;background:#292b34;color:#fff;border-radius:8px}</style></head>
<body><div id="dca-client-loading">正在连接酒馆……</div><script type="module">
try {
  const host = ${mode === 'embedded' ? 'window.parent' : 'window.opener'};
  if (!host || host.closed) throw new Error('酒馆页面已关闭，请从酒馆重新打开创客。');
  const registry = host[${scriptString(CLIENT_HOST_KEY)}];
  if (!registry) throw new Error('酒馆核心尚未就绪，请从酒馆重新打开创客。');
  window[${scriptString(CLIENT_ENV_KEY)}] = { host, mode: ${scriptString(mode)} };
  Object.assign(window, registry.globals);
  window.Vue = await import('https://testingcf.jsdelivr.net/npm/vue@3.5.42/dist/vue.esm-browser.prod.js');
  window.toastr = Object.fromEntries(['error','warning','success','info'].map(level => [level, text => {
    const node = document.createElement('div'); node.className = 'dca-client-toast'; node.setAttribute('role','alert'); node.textContent = String(text); document.body.append(node); setTimeout(() => node.remove(), 6000);
  }]));
  await import(${scriptString(entryUrl)});
} catch (error) { const message = document.getElementById('dca-client-loading') || document.body.appendChild(document.createElement('p')); message.textContent = '连接失败：' + String(error); }
</script></body></html>`;
}

export function configureWindowHost(
  runtime: DreamCardAgentRuntime,
  context: PluginActivationContext,
  entryUrl: string,
): () => void {
  const host = window.parent;
  const document = host.document;
  const owner = crypto.randomUUID();
  let external: Window | null = null;
  let drawer: HTMLElement | undefined;
  let frame: HTMLIFrameElement | undefined;
  let disposed = false;
  let startupTimer: number | undefined;
  let handoffTimer: number | undefined;
  let closeDrawer = () => {};
  let fallbackFullscreenStyle: string | undefined;
  const fullscreenListeners = new Set<(fullscreen: boolean) => void>();
  const nativeFullscreen = () =>
    Boolean(drawer?.querySelector('.th-modern-drawer-fullscreen-content, .dca-native-fullscreen'));
  const publishFullscreen = () => fullscreenListeners.forEach(listener => listener(nativeFullscreen()));
  const fullscreenObserver = new (host as Window & typeof globalThis).MutationObserver(publishFullscreen);
  const embeddedViews = new Set<() => void>();
  const clearEmbedded = () => {
    for (const dispose of [...embeddedViews]) dispose();
    embeddedViews.clear();
    frame?.remove();
    frame = undefined;
  };
  const globals = Object.fromEntries(
    ['$', '_', 'YAML', 'z', 'showdown', 'SillyTavern'].map(name => [
      name,
      (window as unknown as Record<string, unknown>)[name],
    ]),
  );
  const openDetached = () => {
    if (!runtime.snapshot().interfaceModes.detached) {
      toastr.info('请先在设置中启用独立浏览器窗口。', '梦境创客');
      return;
    }
    if (external && !external.closed) {
      external.focus();
      return;
    }
    external = host.open('about:blank', `dream-creator-${owner}`, 'popup,width=1200,height=820');
    if (!external) {
      toastr.warning('浏览器阻止了新窗口，请允许本站弹窗后重试。', '梦境创客');
      return;
    }
    const opened = external;
    try {
      opened.opener = host;
      opened.document.open();
      opened.document.write(clientDocument(entryUrl, 'detached'));
      opened.document.close();
      startupTimer = host.setTimeout(() => {
        if (external !== opened || disposed) return;
        external = null;
        toastr.warning('新窗口尚未完成连接，原工作台已保留。可以关闭新窗口后重试。', '梦境创客');
      }, 30_000);
    } catch (error) {
      external = null;
      toastr.error(`新窗口初始化失败：${String(error)}`, '梦境创客');
    }
  };
  const registry: ClientHost = {
    owner,
    globals,
    client: createRuntimeClient(runtime),
    context,
    openDetached,
    registerView: (mode, dispose, view) => {
      if (mode === 'embedded') embeddedViews.add(dispose);
      if (mode === 'detached' && view === external) {
        if (startupTimer !== undefined) host.clearTimeout(startupTimer);
        handoffTimer = host.setTimeout(() => {
          if (disposed || view !== external || view.closed) return;
          closeDrawer();
          destroyDreamCardAgentWindow();
          clearEmbedded();
        }, 0);
      }
      return () => embeddedViews.delete(dispose);
    },
    toggleNativeFullscreen: () => {
      const content = drawer?.querySelector<HTMLElement>('.drawer-content');
      if (!content) return;
      const modern = content.querySelector<HTMLElement>('.th-modern-drawer-fullscreen-toggle');
      if (modern) modern.click();
      else if (content.classList.contains('dca-native-fullscreen')) {
        content.classList.remove('dca-native-fullscreen');
        content.setAttribute('style', fallbackFullscreenStyle ?? '');
        fallbackFullscreenStyle = undefined;
      } else {
        fallbackFullscreenStyle = content.getAttribute('style') ?? '';
        content.classList.add('dca-native-fullscreen');
        for (const [name, value] of Object.entries({
          position: 'fixed',
          inset: '0',
          width: '100vw',
          height: '100dvh',
          'max-width': '100vw',
          'max-height': '100dvh',
          'z-index': '6000',
        }))
          content.style.setProperty(name, value, 'important');
      }
      publishFullscreen();
    },
    subscribeNativeFullscreen: listener => {
      fullscreenListeners.add(listener);
      listener(nativeFullscreen());
      return () => fullscreenListeners.delete(listener);
    },
  };
  (host as unknown as Record<string, unknown>)[CLIENT_HOST_KEY] = registry;

  const loadFrame = () => {
    if (frame || !drawer) return;
    const content = drawer.querySelector('.drawer-content')!;
    frame = document.createElement('iframe');
    frame.title = '梦境创客工作台';
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;min-height:0';
    frame.srcdoc = clientDocument(entryUrl, 'embedded');
    content.append(frame);
  };
  const mountDrawer = async () => {
    if (drawer || disposed) return;
    const element = document.createElement('div');
    drawer = element;
    element.id = DRAWER_ID;
    element.className = 'drawer';
    element.innerHTML =
      '<div class="drawer-toggle" title="梦境创客" aria-label="梦境创客"><div class="drawer-icon fa-solid fa-wand-magic-sparkles closedIcon" tabindex="0" role="button" aria-label="梦境创客"></div></div><div id="dream-creator-drawer-content" class="drawer-content closedDrawer dca-native-content"></div>';
    const content = element.querySelector<HTMLElement>('.drawer-content')!;
    content.style.cssText =
      'width:min(1200px,96vw);height:calc(100dvh - 70px);padding:0;overflow:hidden;max-height:calc(100dvh - 50px)';
    const toolbar = document.getElementById('top-settings-holder');
    const characterEntry = [...(toolbar?.children ?? [])].find(
      child => child.id === 'unimportantYes' || child.querySelector('#rightNavDrawerIcon'),
    );
    toolbar?.insertBefore(element, characterEntry ?? null);
    fullscreenObserver.observe(element, { attributes: true, subtree: true, attributeFilter: ['class'] });
    try {
      const importModule = (host as Window & typeof globalThis).Function('url', 'return import(url)') as (
        url: string,
      ) => Promise<{ doNavbarIconClick: (this: HTMLElement) => Promise<void> }>;
      const main = await importModule(new URL('/script.js', host.location.href).href);
      if (disposed || drawer !== element) return;
      const toggle = element.querySelector<HTMLElement>('.drawer-toggle')!;
      closeDrawer = () => {
        if (drawer !== element || !content.classList.contains('openDrawer')) return;
        void main.doNavbarIconClick.call(toggle).catch(error => toastr.error(String(error), '梦境创客'));
      };
      toggle.addEventListener('click', () => {
        if (external && !external.closed) {
          external.focus();
          return;
        }
        destroyDreamCardAgentWindow();
        loadFrame();
        void main.doNavbarIconClick.call(toggle);
      });
      toggle.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle.click();
        }
      });
    } catch (error) {
      element.remove();
      drawer = undefined;
      toastr.error(`顶部栏入口加载失败：${String(error)}`, '梦境创客');
    }
  };

  const unsubscribe = runtime.subscribe(state => {
    if (state.interfaceModes.navigation) void mountDrawer();
    else if (drawer) {
      clearEmbedded();
      drawer.remove();
      drawer = undefined;
      frame = undefined;
    }
  });
  openDefault = () => {
    if (external && !external.closed) {
      external.focus();
      return;
    }
    const modes = runtime.snapshot().interfaceModes;
    if (modes.overlay) {
      closeDrawer();
      clearEmbedded();
      openDreamCardAgentWindow();
    } else if (modes.navigation) {
      if (!drawer?.querySelector('.openDrawer')) drawer?.querySelector<HTMLElement>('.drawer-toggle')?.click();
    } else if (modes.detached) openDetached();
  };

  return () => {
    disposed = true;
    if (startupTimer !== undefined) host.clearTimeout(startupTimer);
    if (handoffTimer !== undefined) host.clearTimeout(handoffTimer);
    fullscreenObserver.disconnect();
    fullscreenListeners.clear();
    unsubscribe();
    clearEmbedded();
    drawer?.remove();
    if ((host as unknown as Record<string, unknown>)[CLIENT_HOST_KEY] === registry)
      delete (host as unknown as Record<string, unknown>)[CLIENT_HOST_KEY];
    openDefault = () => {};
  };
}
