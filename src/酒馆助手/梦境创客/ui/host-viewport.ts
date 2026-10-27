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
export function observeHostViewport(host: Window, update: () => void): () => void {
  let frame: number | undefined;
  const schedule = () => {
    if (frame !== undefined) return;
    frame = host.requestAnimationFrame(() => {
      frame = undefined;
      update();
    });
  };
  host.addEventListener('resize', schedule);
  host.addEventListener('orientationchange', schedule);
  host.addEventListener('pageshow', schedule);
  host.visualViewport?.addEventListener('resize', schedule);
  host.visualViewport?.addEventListener('scroll', schedule);
  return () => {
    if (frame !== undefined) host.cancelAnimationFrame(frame);
    host.removeEventListener('resize', schedule);
    host.removeEventListener('orientationchange', schedule);
    host.removeEventListener('pageshow', schedule);
    host.visualViewport?.removeEventListener('resize', schedule);
    host.visualViewport?.removeEventListener('scroll', schedule);
  };
}
