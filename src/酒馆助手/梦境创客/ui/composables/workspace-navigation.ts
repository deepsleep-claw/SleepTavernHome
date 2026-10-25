import { computed, inject, onBeforeUnmount, provide, shallowRef, watch, type InjectionKey, type Ref } from 'vue';

type BackLayer = { back: () => void };
export function createWorkspaceNavigation(isMobile: Ref<boolean>, pageBack: () => void, canPageBack: () => boolean) {
  const layers = shallowRef<BackLayer[]>([]);
  const canGoBack = computed(() => layers.value.length > 0 || canPageBack());
  function register(back: () => void) {
    const layer = { back };
    layers.value = [...layers.value, layer];
    return () => {
      layers.value = layers.value.filter(item => item !== layer);
    };
  }
  function back() {
    const layer = layers.value.at(-1);
    if (layer) layer.back();
    else if (canPageBack()) pageBack();
  }
  return { isMobile, layers, canGoBack, back, register };
}
type WorkspaceNavigation = ReturnType<typeof createWorkspaceNavigation>;
const key: InjectionKey<WorkspaceNavigation> = Symbol('workspace-navigation');
export function provideWorkspaceNavigation(navigation: WorkspaceNavigation) {
  provide(key, navigation);
}
export function useWorkspaceNavigation() {
  return inject(key, undefined);
}
export function useBackLayer(open: Ref<boolean>, back: () => void, navigation = useWorkspaceNavigation()) {
  let unregister = () => {};
  watch(
    open,
    value => {
      unregister();
      unregister = value && navigation ? navigation.register(back) : () => {};
    },
    { immediate: true, flush: 'sync' },
  );
  onBeforeUnmount(() => unregister());
}

export type MobileNavigationClient = {
  canGoBack: () => boolean;
  back: () => void;
  subscribe: (update: () => void) => () => void;
};

/** 一个临时历史入口承接内部返回；宿主原有的 state 和 URL 保持原样。 */
export function bindMobileHistory(target: Window, client: MobileNavigationClient, visible = () => true) {
  const owner = crypto.randomUUID();
  const marker = '__dreamCreatorNavigation';
  let armed = false;
  let removing = false;
  let disposed = false;
  const ownsCurrent = () => target.history.state?.[marker] === owner;
  function sync() {
    if (disposed || removing) return;
    const active = visible() && client.canGoBack();
    if (active && !armed) {
      target.history.pushState({ ...target.history.state, [marker]: owner }, '');
      armed = true;
    } else if (!active && armed) {
      armed = false;
      if (ownsCurrent()) {
        removing = true;
        target.history.back();
      }
    }
  }
  function popped() {
    if (removing) {
      removing = false;
      sync();
      return;
    }
    if (ownsCurrent()) {
      armed = true;
      sync();
      return;
    }
    if (!armed) return;
    armed = false;
    if (visible() && client.canGoBack()) client.back();
    sync();
  }
  target.addEventListener('popstate', popped);
  const unsubscribe = client.subscribe(sync);
  sync();
  return {
    sync,
    destroy() {
      disposed = true;
      unsubscribe();
      target.removeEventListener('popstate', popped);
      if (armed && ownsCurrent()) target.history.back();
      armed = false;
    },
  };
}
