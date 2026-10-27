/**
 * 无外部依赖，可同时嵌入导入脚本和 webpack 的远程依赖入口。
 * @param {string} [preference]
 * @param {(url: string) => Promise<any>} [importRemote]
 */
export function createCdnRuntime(preference = 'auto', importRemote = url => import(/* webpackIgnore: true */ url)) {
  const origins = {
    jsdmirror: 'https://cdn.jsdmirror.com',
    jsdelivr: 'https://cdn.jsdelivr.net',
  };
  const source = preference === 'jsdelivr' || preference === 'jsdmirror' ? preference : 'auto';
  const order = source === 'jsdelivr' ? ['jsdelivr', 'jsdmirror'] : ['jsdmirror', 'jsdelivr'];
  const describeError = error => (error instanceof Error ? error.message : String(error));

  /** @param {string} url */
  function urls(url) {
    const parsed = new URL(url);
    if (!['cdn.jsdelivr.net', 'testingcf.jsdelivr.net', 'cdn.jsdmirror.com'].includes(parsed.hostname)) return [url];
    return order.map(id => `${origins[id]}${parsed.pathname}${parsed.search}${parsed.hash}`);
  }

  /** @param {string} url @param {RequestInit} [init] */
  async function fetchText(url, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { text: await response.text(), contentType: response.headers.get('content-type') ?? '' };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** @param {string} url @param {(module: any) => void} [validate] */
  async function importModule(url, validate = () => {}) {
    const errors = [];
    for (const candidate of urls(url)) {
      try {
        // 预取可取消并复用 HTTP 缓存；模块按顺序导入，避免重复执行。
        const response = await fetchText(candidate);
        if (!/(?:javascript|ecmascript)/iu.test(response.contentType)) throw new Error('响应不是 JavaScript 模块');
        const module = await importRemote(candidate);
        validate(module);
        return { module, url: candidate };
      } catch (error) {
        errors.push(`${new URL(candidate).hostname}: ${describeError(error)}`);
      }
    }
    throw new Error(`模块加载失败：${errors.join('；')}`);
  }

  /** @param {string} url @param {RequestInit} [init] */
  async function fetchResource(url, init = {}) {
    const errors = [];
    for (const candidate of urls(url)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(candidate, { ...init, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        return new Response(bytes, { status: response.status, headers: response.headers });
      } catch (error) {
        errors.push(`${new URL(candidate).hostname}: ${describeError(error)}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(`资源加载失败：${errors.join('；')}`);
  }

  /** @param {HTMLLinkElement} link @param {string} url */
  function stylesheet(link, url) {
    const candidates = urls(url);
    let index = 0;
    link.addEventListener('error', () => {
      if (index + 1 < candidates.length) link.href = candidates[++index];
    });
    link.href = candidates[0];
  }

  return { source, urls, fetchText, fetchResource, importModule, stylesheet };
}
