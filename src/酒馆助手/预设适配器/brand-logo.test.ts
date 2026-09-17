import { createApp, h, nextTick, type App } from 'vue';
import { parse } from 'vue/compiler-sfc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BrandLogo from './BrandLogo.vue';
import popup_source from './Popup.vue?raw';
import logo_source from './assets/sleeping-embrace.svg?raw';

const styles = parse(popup_source)
  .descriptor.styles.map(style => style.content)
  .join('\n');
const apps: App[] = [];
let style_element: HTMLStyleElement;
let next_id = 0;

beforeEach(() => {
  next_id = 0;
  vi.stubGlobal('SillyTavern', { uuidv4: () => `test-${++next_id}` });
  style_element = document.createElement('style');
  style_element.textContent = styles;
  document.head.append(style_element);
});

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  style_element.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mountLogo(theme = 'night-gold', count = 1) {
  const host = document.createElement('section');
  host.className = 'preset-adapter-floating-window';
  host.dataset.presetAdapterTheme = theme;
  host.innerHTML = '<div class="preset-adapter-root"><div class="preset-adapter-brand"></div></div>';
  document.body.append(host);
  const app = createApp({ render: () => Array.from({ length: count }, () => h(BrandLogo)) });
  apps.push(app);
  app.mount(host.querySelector('.preset-adapter-brand')!);
  return host;
}

function normalizedColor(value: string) {
  const element = document.createElement('span');
  element.style.color = value;
  document.body.append(element);
  const color = getComputedStyle(element).color;
  element.remove();
  return color;
}

function expectLocalReferences(svg: SVGSVGElement) {
  for (const use of svg.querySelectorAll('use')) {
    const id = use.getAttribute('href')!.slice(1);
    expect(svg.querySelector(`[id="${id}"]`)).not.toBeNull();
  }
  for (const element of svg.querySelectorAll('[mask]')) {
    const id = element.getAttribute('mask')!.match(/^url\(#(.+)\)$/)![1];
    expect(svg.querySelector(`[id="${id}"]`)?.tagName.toLowerCase()).toBe('mask');
  }
  const title = svg.getAttribute('aria-labelledby')!;
  expect(svg.querySelector(`[id="${title}"]`)?.textContent).toBe('眠鲸');
}

describe('品牌图标', () => {
  it('渲染内置图形并保持等比例显示', () => {
    const host = mountLogo();
    const svg = host.querySelector('svg')!;
    const source = new DOMParser().parseFromString(logo_source, 'image/svg+xml');
    expect(svg.getAttribute('viewBox')).toBe('0 0 256 256');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect([...svg.querySelectorAll('path')].map(path => path.getAttribute('d'))).toEqual(
      [...source.querySelectorAll('path')].map(path => path.getAttribute('d')),
    );
    expect([...svg.querySelectorAll('mask [fill]')].map(element => element.getAttribute('fill'))).toEqual(
      [...source.querySelectorAll('mask [fill]')].map(element => element.getAttribute('fill')),
    );
    expect(svg.querySelector(':scope > g')?.getAttribute('fill')).toBe('currentColor');
    expect(getComputedStyle(svg).width).toBe('100%');
    expect(getComputedStyle(svg).height).toBe('100%');
    expect(parse(popup_source).descriptor.template?.content).toContain('<BrandLogo />');
  });

  it('多个实例各自持有完整的遮罩和图形引用', () => {
    const host = mountLogo('night-gold', 2);
    const ids = [...host.querySelectorAll('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    const svgs = [...host.querySelectorAll('svg')];
    expect(svgs).toHaveLength(2);
    svgs.forEach(expectLocalReferences);
    svgs[0].parentElement?.remove();
    expectLocalReferences(svgs[1]);
  });

  it.each([
    ['night-gold', '#f2bd65'],
    ['deep-blue', '#a9dcff'],
    ['purple-black', '#e5c4ff'],
    ['jade-green', '#145b47'],
    ['moon-white', '#7d561f'],
    ['frost-blue', '#155d9f'],
  ])('%s 继承主题颜色', (theme, expected) => {
    const host = mountLogo(theme);
    expect(getComputedStyle(host.querySelector('svg')!).color).toBe(normalizedColor(expected));
  });

  it('切换主题时更新颜色并保持同一个图标实例', async () => {
    const host = mountLogo('night-gold');
    const svg = host.querySelector('svg')!;
    const markup = svg.outerHTML;
    host.dataset.presetAdapterTheme = 'jade-green';
    await nextTick();
    expect(host.querySelector('svg')).toBe(svg);
    expect(svg.outerHTML).toBe(markup);
    expect(getComputedStyle(svg).color).toBe(normalizedColor('#145b47'));
    expectLocalReferences(svg);
  });

  it.each([
    ['night-gold', '--preset-adapter-theme-highlight'],
    ['deep-blue', '--preset-adapter-theme-accent-text'],
  ])('%s 支持自定义主题颜色', (theme, variable) => {
    const host = mountLogo(theme);
    host.style.setProperty(variable, '#467f9c');
    expect(getComputedStyle(host.querySelector('svg')!).color).toBe(normalizedColor('#467f9c'));
  });
});
