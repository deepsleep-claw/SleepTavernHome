import { describe, expect, it } from 'vitest';
import { resolveWebsiteFavicon } from './website-favicon';

describe('website favicon resolver', () => {
  it('为 GitHub 选择官方明暗 SVG，并保留 ico 回退', () => {
    expect(resolveWebsiteFavicon(new URL('https://github.com/SillyTavern/SillyTavern'))).toEqual({
      darkUrl: 'https://github.githubassets.com/favicons/favicon-dark.svg',
      fallbackUrl: 'https://github.com/favicon.ico',
      lightUrl: 'https://github.githubassets.com/favicons/favicon.svg',
      strategy: 'theme-variants',
    });
  });

  it('普通站点只使用同源 favicon，不猜测主题变体', () => {
    expect(resolveWebsiteFavicon(new URL('https://docs.example.test/guide'))).toEqual({
      darkUrl: 'https://docs.example.test/favicon.ico',
      lightUrl: 'https://docs.example.test/favicon.ico',
      strategy: 'origin-fallback',
    });
  });
});

