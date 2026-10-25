import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import {
  followingAfterScroll,
  isNearTimelineTail,
  keyboardScrollIntent,
  restoredScrollTop,
  timelineReadingMemory,
  touchScrollIntent,
  wheelScrollIntent,
  type ScrollIntent,
  type ScrollMetrics,
  type TimelineReadingState,
} from './timeline-scroll-state';

const INPUT_INTENT_LIFETIME_MS = 1200;
const INITIAL_TIMELINE_LIMIT = 200;
const TOUCH_SCROLL_SETTLE_MS = 160;

export function useTimelineScroll(options: {
  owner: object;
  key: () => string;
  itemCount: () => number;
  scroller: Ref<HTMLElement | undefined>;
  column: Ref<HTMLElement | undefined>;
  limit: Ref<number>;
  collapsedRuns: Ref<Record<string, boolean>>;
}) {
  const memory = timelineReadingMemory(options.owner);
  const following = ref(true);
  let activeKey = '';
  let generation = 0;
  let disposed = false;
  let frame: number | undefined;
  let observer: ResizeObserver | undefined;
  let intent: ScrollIntent = 'none';
  let intentUntil = 0;
  let touchY: number | undefined;
  let touching = false;
  let touchMoved = false;
  let touchReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  let lastMetrics: ScrollMetrics | undefined;
  let lastItemCount = 0;
  let programmaticTop: number | undefined;
  let restoring: TimelineReadingState | undefined;
  let prepending: TimelineReadingState | undefined;

  function metrics(): ScrollMetrics | undefined {
    const node = options.scroller.value;
    return node
      ? { scrollTop: node.scrollTop, viewportHeight: node.clientHeight, contentHeight: node.scrollHeight }
      : undefined;
  }

  function savePosition() {
    const current = metrics();
    if (!current) return;
    // 图片和历史尚未撑开时，保留原始阅读目标，避免把暂时夹紧的位置记成最终位置。
    memory.save(
      activeKey,
      restoring ??
        prepending ?? {
          metrics: current,
          following: following.value,
          limit: options.limit.value,
          itemCount: lastItemCount,
          collapsedRuns: options.collapsedRuns.value,
        },
    );
  }

  function cancelFrame() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }

  function writeTop(top: number) {
    const node = options.scroller.value;
    if (!node || Math.abs(node.scrollTop - top) < 1) return;
    node.scrollTop = top;
    programmaticTop = node.scrollTop;
    lastMetrics = metrics();
  }

  function currentIntent(): ScrollIntent {
    return Date.now() <= intentUntil ? intent : 'none';
  }

  function applyLayout() {
    const current = metrics();
    if (!current) return;
    // 手指按下到惯性滚动结束期间，scrollTop 只交给浏览器维护。
    if (touching || touchReleaseTimer !== undefined) {
      lastItemCount = options.itemCount();
      savePosition();
      return;
    }
    if (currentIntent() === 'away') following.value = false;
    if (restoring) {
      const target = restoring.metrics.scrollTop;
      writeTop(restoredScrollTop(target, current));
      if (
        target <= Math.max(0, current.contentHeight - current.viewportHeight) + 1 ||
        current.contentHeight >= restoring.metrics.contentHeight ||
        options.itemCount() < restoring.itemCount
      )
        restoring = undefined;
    } else if (following.value) {
      writeTop(Math.max(0, current.contentHeight - current.viewportHeight));
    }
    lastMetrics = metrics();
    lastItemCount = options.itemCount();
    savePosition();
  }

  function scheduleLayout() {
    if (disposed || !options.scroller.value) return;
    cancelFrame();
    const version = generation;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (disposed || version !== generation) return;
      applyLayout();
      // 流式正文与展开块可能在相邻两帧完成布局，两次都重新核对用户意图。
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (!disposed && version === generation) applyLayout();
      });
    });
  }

  function recordIntent(next: ScrollIntent) {
    if (next === 'none') return;
    intent = next;
    intentUntil = Date.now() + INPUT_INTENT_LIFETIME_MS;
    restoring = undefined;
    programmaticTop = undefined;
    if (next === 'away') {
      following.value = false;
      cancelFrame();
    }
  }

  function clearTouch() {
    if (touchReleaseTimer !== undefined) clearTimeout(touchReleaseTimer);
    touchReleaseTimer = undefined;
    touching = false;
    touchMoved = false;
    touchY = undefined;
  }

  function waitForTouchScrollEnd() {
    if (touchReleaseTimer !== undefined) clearTimeout(touchReleaseTimer);
    touchReleaseTimer = setTimeout(() => {
      touchReleaseTimer = undefined;
      const current = metrics();
      if (!current || disposed) return;
      // 最后一次手动滚动已经贴底时，保留跟随意图，允许接上等待期间的新内容。
      following.value = intent !== 'away' && (following.value || isNearTimelineTail(current));
      intent = 'none';
      savePosition();
      if (following.value) scheduleLayout();
    }, TOUCH_SCROLL_SETTLE_MS);
  }

  function onScroll() {
    const current = metrics();
    if (!current) return;
    const layoutChanged =
      lastMetrics &&
      (current.contentHeight !== lastMetrics.contentHeight || current.viewportHeight !== lastMetrics.viewportHeight);
    const programmed = programmaticTop !== undefined && Math.abs(current.scrollTop - programmaticTop) < 1;
    const activeIntent = currentIntent();
    const moved = lastMetrics && Math.abs(current.scrollTop - lastMetrics.scrollTop) >= 1;
    if ((touching || touchReleaseTimer !== undefined) && moved && !programmed) {
      touchMoved = true;
      if (!touching) waitForTouchScrollEnd();
    }
    const userScroll = !programmed && !restoring && (activeIntent !== 'none' || (!layoutChanged && moved));
    following.value =
      activeIntent === 'away' ? false : followingAfterScroll(following.value, current, Boolean(userScroll));
    if (userScroll) {
      if (following.value) intent = 'none';
      else cancelFrame();
    }
    programmaticTop = undefined;
    lastMetrics = current;
    savePosition();
  }

  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey) recordIntent(wheelScrollIntent(event.deltaY));
  }
  function onTouchStart(event: TouchEvent) {
    clearTouch();
    touchY = event.touches[0]?.clientY;
    touching = touchY !== undefined;
    if (touching) {
      recordIntent('unknown');
      cancelFrame();
    }
  }
  function onTouchMove(event: TouchEvent) {
    const next = event.touches[0]?.clientY;
    if (touchY !== undefined && next !== undefined) {
      const direction = touchScrollIntent(touchY, next);
      if (direction !== 'none') touchMoved = true;
      recordIntent(direction);
    }
    touchY = next;
  }
  function onTouchEnd(event: TouchEvent) {
    touchY = event.touches[0]?.clientY;
    if (touchY !== undefined) return;
    touching = false;
    if (touchMoved) waitForTouchScrollEnd();
    else {
      intent = 'none';
      scheduleLayout();
    }
  }
  function onPointerDown(event: PointerEvent) {
    if (event.target === options.scroller.value) recordIntent('unknown');
  }
  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const editable = Boolean(target?.closest('input, textarea, select, button, a, [contenteditable="true"]'));
    if (!event.isComposing) recordIntent(keyboardScrollIntent(event.key, event.shiftKey, editable));
  }

  function jumpToLatest() {
    clearTouch();
    restoring = undefined;
    intent = 'none';
    following.value = true;
    scheduleLayout();
  }

  async function loadEarlier() {
    const before = metrics();
    if (!before || prepending) return;
    const version = generation;
    recordIntent('away');
    prepending = {
      metrics: before,
      following: false,
      limit: options.limit.value,
      itemCount: lastItemCount,
      collapsedRuns: { ...options.collapsedRuns.value },
    };
    options.limit.value += INITIAL_TIMELINE_LIMIT;
    await nextTick();
    const after = metrics();
    if (disposed || version !== generation || !after) return;
    writeTop(before.scrollTop + after.contentHeight - before.contentHeight);
    prepending = undefined;
    lastItemCount = options.itemCount();
    savePosition();
  }

  watch(
    options.key,
    async key => {
      if (activeKey) savePosition();
      prepending = undefined;
      activeKey = key;
      const version = ++generation;
      cancelFrame();
      clearTouch();
      intent = 'none';
      programmaticTop = undefined;
      lastMetrics = undefined;
      const saved = memory.read(key);
      options.limit.value = saved?.limit ?? INITIAL_TIMELINE_LIMIT;
      options.collapsedRuns.value = saved?.collapsedRuns ?? {};
      following.value = saved?.following ?? true;
      restoring = saved && !saved.following ? saved : undefined;
      lastItemCount = options.itemCount();
      await nextTick();
      if (!disposed && version === generation) scheduleLayout();
    },
    { immediate: true, flush: 'pre' },
  );

  onMounted(() => {
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleLayout);
      if (options.column.value) observer.observe(options.column.value);
      if (options.scroller.value) observer.observe(options.scroller.value);
    }
    scheduleLayout();
  });
  onBeforeUnmount(() => {
    savePosition();
    disposed = true;
    generation += 1;
    cancelFrame();
    clearTouch();
    observer?.disconnect();
  });

  return {
    following,
    jumpToLatest,
    loadEarlier,
    onScroll,
    onWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onPointerDown,
    onKeydown,
  };
}
