export function readHostViewport(host: Window) {
  const mobile = host.innerWidth <= 720;
  const visual = mobile ? host.visualViewport : undefined;
  return {
    mobile,
    width: visual?.width || host.innerWidth,
    height: visual?.height || host.innerHeight,
    left: visual?.offsetLeft ?? 0,
    top: visual?.offsetTop ?? 0,
  };
}

/** 软键盘和浏览器地址栏可能只改变可视区域，不触发窗口 resize。 */
export function observeHostViewport(host: Window, update: () => void, inputDocument = host.document): () => void {
  let frame: number | undefined;
  let settleTimer: number | undefined;
  let lastViewport = readHostViewport(host);
  const scheduleFrame = () => {
    if (frame !== undefined) return;
    frame = host.requestAnimationFrame(() => {
      frame = undefined;
      lastViewport = readHostViewport(host);
      update();
    });
  };
  const schedule = () => {
    scheduleFrame();
    if (settleTimer !== undefined) host.clearTimeout(settleTimer);
    // 键盘动画可能先派发事件、后更新可视区域；收尾再读取一次，避免保留中间尺寸。
    settleTimer = host.setTimeout(() => {
      settleTimer = undefined;
      const current = readHostViewport(host);
      if (
        current.width !== lastViewport.width || current.height !== lastViewport.height ||
        current.left !== lastViewport.left || current.top !== lastViewport.top || current.mobile !== lastViewport.mobile
      )
        scheduleFrame();
    }, 350);
  };
  const documents = [...new Set([host.document, inputDocument])];
  host.addEventListener('resize', schedule);
  host.addEventListener('orientationchange', schedule);
  host.addEventListener('pageshow', schedule);
  host.addEventListener('focus', schedule);
  host.visualViewport?.addEventListener('resize', schedule);
  host.visualViewport?.addEventListener('scroll', schedule);
  for (const document of documents) {
    document.addEventListener('focusout', schedule);
    document.addEventListener('visibilitychange', schedule);
  }
  schedule();
  return () => {
    if (frame !== undefined) host.cancelAnimationFrame(frame);
    if (settleTimer !== undefined) host.clearTimeout(settleTimer);
    host.removeEventListener('resize', schedule);
    host.removeEventListener('orientationchange', schedule);
    host.removeEventListener('pageshow', schedule);
    host.removeEventListener('focus', schedule);
    host.visualViewport?.removeEventListener('resize', schedule);
    host.visualViewport?.removeEventListener('scroll', schedule);
    for (const document of documents) {
      document.removeEventListener('focusout', schedule);
      document.removeEventListener('visibilitychange', schedule);
    }
  };
}
