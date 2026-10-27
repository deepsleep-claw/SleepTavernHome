/** 为连续的内存操作留出输入、滚动和绘制的时间。 */
export function createCooperativeYield() {
  let nextYield = performance.now() + 8;
  return async (signal?: AbortSignal, force = false): Promise<void> => {
    signal?.throwIfAborted();
    if (!force && performance.now() < nextYield) return;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    nextYield = performance.now() + 8;
    signal?.throwIfAborted();
  };
}
