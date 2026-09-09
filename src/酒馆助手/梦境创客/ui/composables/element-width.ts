import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export function useElementWidth(element: Ref<HTMLElement | undefined>) {
  const width = ref(Number.POSITIVE_INFINITY);
  let observer: ResizeObserver | undefined;
  onMounted(() => {
    if (!element.value) return;
    width.value = element.value.getBoundingClientRect().width;
    observer = new ResizeObserver(entries => {
      width.value = entries[0]?.contentRect.width ?? width.value;
    });
    observer.observe(element.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return width;
}
