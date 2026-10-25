// @vitest-environment happy-dom
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { bindMobileHistory, createWorkspaceNavigation } from './workspace-navigation';

describe('工作台返回导航', () => {
  it('先处理最上层菜单，再返回页面', () => {
    const page = ref('settings');
    const nav = createWorkspaceNavigation(
      ref(true),
      () => {
        page.value = page.value === 'settings' ? 'session' : 'home';
      },
      () => page.value !== 'home',
    );
    const dialog = vi.fn();
    const close = nav.register(dialog);
    nav.back();
    expect(dialog).toHaveBeenCalledOnce();
    expect(page.value).toBe('settings');
    close();
    nav.back();
    expect(page.value).toBe('session');
    nav.back();
    expect(page.value).toBe('home');
    expect(nav.canGoBack.value).toBe(false);
  });

  it('浏览器返回逐层消费临时入口，保留宿主状态且不积累历史', () => {
    const hostState = { route: 'tavern', selection: 42 };
    const states: unknown[] = [hostState];
    let index = 0;
    const events = new EventTarget();
    const pop = () => events.dispatchEvent(new Event('popstate'));
    const history = {
      get state() {
        return states[index];
      },
      pushState(value: unknown) {
        states.splice(++index);
        states[index] = value;
      },
      back() {
        if (index) {
          index--;
          pop();
        }
      },
    };
    const target = {
      history,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    } as unknown as Window;
    let depth = 3;
    const back = vi.fn(() => {
      depth--;
    });
    const binding = bindMobileHistory(target, { canGoBack: () => depth > 0, back, subscribe: () => () => {} });
    history.back();
    history.back();
    history.back();
    expect(back).toHaveBeenCalledTimes(3);
    expect(history.state).toEqual(hostState);
    expect(states).toHaveLength(2);
    depth = 1;
    binding.sync();
    binding.destroy();
    expect(history.state).toEqual(hostState);
    expect(back).toHaveBeenCalledTimes(3);
  });
});
