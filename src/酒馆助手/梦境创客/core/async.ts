/** 给只读等待及可取消操作设置上限，结束后移除计时器和监听器。 */
export function boundedWait<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finish = (action: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      action();
    };
    const abort = () => finish(() => reject(new Error('操作已取消。')));
    const timer = setTimeout(() => finish(() => reject(new Error(`${label}超时，请重试。`))), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
    if (signal?.aborted) abort();
  });
}
