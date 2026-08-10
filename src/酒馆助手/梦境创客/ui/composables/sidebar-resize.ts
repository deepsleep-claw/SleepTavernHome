// 侧栏宽度拖拽。桌面端从右侧拖宽，最小 320px，最大为工作台宽度的三分之二。
import { onBeforeUnmount, type Ref } from 'vue';

export function useSidebarResize(sidebarWidth: Ref<number>) {
  let stop: (() => void) | undefined;

  function beginSidebarResize(event: PointerEvent) {
    if (window.matchMedia('(max-width: 720px)').matches) return;
    event.preventDefault();
    stop?.();
    const startX = event.clientX;
    const startWidth = sidebarWidth.value;
    const workbenchWidth = (event.currentTarget as HTMLElement).closest('.dca-workbench')?.getBoundingClientRect().width;
    const move = (next: PointerEvent) => {
      const maximum = Math.max(320, (workbenchWidth ?? window.innerWidth) * (2 / 3));
      sidebarWidth.value = Math.round(Math.min(maximum, Math.max(320, startWidth + startX - next.clientX)));
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.body.classList.remove('dca-resizing-sidebar');
      stop = undefined;
    };
    document.body.classList.add('dca-resizing-sidebar');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    stop = end;
  }

  onBeforeUnmount(() => stop?.());

  return { beginSidebarResize };
}
