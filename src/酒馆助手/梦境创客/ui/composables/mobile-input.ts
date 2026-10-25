import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export function useMobileTextInput() {
  const mobile = ref(false);
  const query = '(max-width: 720px) and (hover: none) and (pointer: coarse)';
  let media: MediaQueryList | undefined;
  const update = () => {
    mobile.value = media?.matches ?? false;
  };
  onMounted(() => {
    media = window.matchMedia(query);
    update();
    media.addEventListener?.('change', update);
  });
  onBeforeUnmount(() => media?.removeEventListener?.('change', update));
  return computed(() => mobile.value);
}
